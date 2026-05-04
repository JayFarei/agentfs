// FlueBodyDispatcher — implements the SDK's `BodyDispatcher` contract.
//
// Per plan R4 + R5 + Phase-4 acceptance: `body: llm({...})` and
// `body: agent({skill})` both dispatch through the per-tenant in-process
// Flue session here. Pure-TS bodies never reach this file; the fn() factory
// runs them inline.
//
// Cost-accumulation contract (see src/sdk/runtime.ts top-of-file comment):
//   - tokens / ms / llmCalls — additive (`ctx.cost.tokens.cold += ...`)
//   - tier — max-observed (`ctx.cost.tier = Math.max(ctx.cost.tier, 3)`)
//
// Output validation: per the dual-validation policy in the SDK, the fn()
// factory always validates `spec.output` after dispatch returns. If the
// body carries its own `output` schema we ALSO pass it to Flue so the SDK
// can fail fast on shape errors before the fn() factory's check; this
// mirrors how the .flue/agents/finqa-agent-factory.ts file used a typed
// `result:` option on `session.prompt`.

import path from "node:path";

import type { GenericSchema } from "valibot";
import type { FlueSession } from "@flue/sdk/client";

import type {
  Body,
  AgentBody,
  LlmBody,
  PureTSBody,
} from "../sdk/body.js";
import type {
  BodyDispatcher,
  DispatchContext,
} from "../sdk/runtime.js";
import type { CostTier } from "../sdk/result.js";

import { FlueSessionPool } from "./session.js";
import {
  DiskSkillLoader,
  type Skill,
  type SkillLoader,
} from "./skill.js";

// --- Construction ----------------------------------------------------------

export type FlueBodyDispatcherOpts = {
  /** Per-tenant Flue session pool. Required. */
  pool: FlueSessionPool;
  /** Skill loader for `agent({skill})` bodies. Defaults to a disk loader. */
  skills?: SkillLoader;
  /**
   * Datafetch home, used to construct the default `DiskSkillLoader` when
   * `skills` is not provided. Falls back to env `DATAFETCH_HOME`/
   * `ATLASFS_HOME`/`./.datafetch`.
   */
  baseDir?: string;
};

export class FlueBodyDispatcher implements BodyDispatcher {
  private readonly pool: FlueSessionPool;
  private readonly skills: SkillLoader;

  constructor(opts: FlueBodyDispatcherOpts) {
    this.pool = opts.pool;
    if (opts.skills !== undefined) {
      this.skills = opts.skills;
    } else {
      const baseDir =
        opts.baseDir ??
        process.env["DATAFETCH_HOME"] ??
        process.env["ATLASFS_HOME"] ??
        path.join(process.cwd(), ".datafetch");
      this.skills = new DiskSkillLoader({ baseDir });
    }
  }

  async dispatch<I, O>(
    body: Body<I, O>,
    input: I,
    ctx: DispatchContext,
  ): Promise<O> {
    switch (body.kind) {
      case "pure":
        return throwOnPure(body);
      case "llm":
        return this.dispatchLlm<I, O>(body, input, ctx);
      case "agent":
        return this.dispatchAgent<I, O>(body, input, ctx);
    }
  }

  // --- llm body -----------------------------------------------------------

  private async dispatchLlm<I, O>(
    body: LlmBody<O>,
    input: I,
    ctx: DispatchContext,
  ): Promise<O> {
    const session = await this.pool.getSession(ctx.tenant);
    const promptText = renderLlmPrompt(body.prompt, input);
    return runFlueCall<O>({
      session,
      prompt: promptText,
      model: body.model,
      output: body.output,
      ctx,
    });
  }

  // --- agent body ---------------------------------------------------------

  private async dispatchAgent<I, O>(
    body: AgentBody<O>,
    input: I,
    ctx: DispatchContext,
  ): Promise<O> {
    const skill = await this.skills.load(body.skill, ctx.tenant);
    const session = await this.pool.getSession(ctx.tenant);
    const promptText = renderAgentPrompt(skill, input);
    return runFlueCall<O>({
      session,
      prompt: promptText,
      model: body.model,
      // Agent bodies don't carry a runtime schema. The fn() factory
      // validates the result against `spec.output`; we forward unwrapped.
      output: undefined,
      ctx,
    });
  }
}

// --- Helpers ----------------------------------------------------------------

function throwOnPure<I, O>(_body: PureTSBody<I, O>): never {
  throw new Error(
    "FlueBodyDispatcher should never see pure bodies; the fn() factory " +
      "dispatches them inline.",
  );
}

// LLM body: append the structured input as a JSON code block after the
// inline prompt template. The model sees the prompt first, then the data.
// Mirrors the convention used by `.flue/agents/finqa-observer.ts` style.
function renderLlmPrompt(prompt: string, input: unknown): string {
  return [
    prompt.trim(),
    "",
    "Input (JSON):",
    "```json",
    JSON.stringify(input, null, 2),
    "```",
  ].join("\n");
}

// Agent body: combine the skill body with the structured input. The
// skill markdown is treated as the system instruction; the input is
// appended as a JSON code block, exactly like the LLM body case.
function renderAgentPrompt(skill: Skill, input: unknown): string {
  return [
    skill.prompt.trim(),
    "",
    "Input (JSON):",
    "```json",
    JSON.stringify(input, null, 2),
    "```",
  ].join("\n");
}

type FlueCallArgs<O> = {
  session: FlueSession;
  prompt: string;
  model: string;
  output: GenericSchema<O> | undefined;
  ctx: DispatchContext;
};

const TIER_LLM = 3 as CostTier;

async function runFlueCall<O>(args: FlueCallArgs<O>): Promise<O> {
  const { session, prompt, model, output, ctx } = args;
  const startedMs = Date.now();
  let result: O;
  try {
    if (output !== undefined) {
      // Typed result path: Flue parses + validates against the schema and
      // returns the inferred output value directly.
      result = (await session.prompt(prompt, {
        model,
        result: output,
      })) as O;
    } else {
      // Untyped result path: Flue returns a `{ text }` envelope. The
      // fn() factory's outer `spec.output` validation catches shape
      // errors. For free-text llm bodies we expose the raw string as O.
      const r = await session.prompt(prompt, { model });
      result = r.text as unknown as O;
    }
  } finally {
    const elapsed = Date.now() - startedMs;
    chargeCost(ctx, elapsed);
  }
  return result;
}

// Charge the per-call cost into the dispatch context's accumulator per
// the documented contract:
//   - llmCalls += 1
//   - ms.cold  += elapsed
//   - tokens.cold: usage tokens, when the SDK exposes them. The
//     PromptResponse shape in @flue/sdk@0.3.6 is `{ text }`, no usage
//     field, so we record 0 here. Wave 6's cost panel reads `llmCalls`
//     and `ms.cold` for the speed-up demo; tokens become non-zero once
//     the SDK exposes them.
//   - tier = max(tier, 3)
function chargeCost(ctx: DispatchContext, elapsedMs: number): void {
  ctx.cost.llmCalls += 1;
  ctx.cost.ms.cold += elapsedMs;
  ctx.cost.tokens.cold += 0;
  ctx.cost.tier = Math.max(ctx.cost.tier, TIER_LLM) as CostTier;
}
