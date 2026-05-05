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
// factory always validates `spec.output` after dispatch returns. We use
// Flue's untyped path (`{ text }` envelope) for both LlmBody and AgentBody
// and JSON-parse the text ourselves — Claude commonly returns the
// response as a JSON object (sometimes inside a ```json ... ``` fence).
// On parse failure we return the raw text and let the fn() factory's
// outer schema produce a clean error.
//
// This is the "option 2" fix from the Wave 2 review: keep the SDK locked
// (don't extend `DispatchContext` with an `expectedOutput` field that
// `fn()` would have to populate) and instead recover structure on the
// dispatcher side via JSON parsing. Routing both body kinds through the
// same path also makes ```json``` fence handling consistent.

import path from "node:path";
import { performance } from "node:perf_hooks";

import { defaultBaseDir } from "../paths.js";

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
      const baseDir = opts.baseDir ?? defaultBaseDir();
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
    // Always go through the untyped + JSON-extract path. Even when
    // `body.output` is present, the fn() factory re-validates against
    // `spec.output` after we return, so Flue's typed-result fast-fail
    // layer would be redundant. Routing both LLM and Agent bodies
    // through the same path makes JSON-fence handling consistent.
    return runFlueCall<O>({
      session,
      prompt: promptText,
      model: body.model,
      output: undefined,
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
    // Same untyped path as dispatchLlm. The skill markdown is the system
    // instruction; the input is appended as JSON; the response text is
    // JSON-parsed (with ```json fence handling) so the fn() factory's
    // schema validation sees a structured value.
    return runFlueCall<O>({
      session,
      prompt: promptText,
      model: body.model,
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

type FlueCallArgs = {
  session: FlueSession;
  prompt: string;
  model: string;
  /**
   * Reserved. Both `dispatchLlm` and `dispatchAgent` pass `undefined`
   * today and rely on `extractStructuredOrText` + the fn() factory's
   * outer validation. Keeping the field on the args shape so a future
   * change can re-introduce Flue's typed-result fast-fail path without
   * a signature break.
   */
  output: undefined;
  ctx: DispatchContext;
};

const TIER_LLM = 3 as CostTier;

async function runFlueCall<O>(args: FlueCallArgs): Promise<O> {
  const { session, prompt, model, ctx } = args;
  const startedMs = performance.now();
  let result: O;
  try {
    // Flue returns a `{ text }` envelope. Most skill / structured-LLM
    // calls expect an object; try JSON-extract first (handles bare JSON
    // and ```json fenced blocks), and fall back to the raw text if that
    // fails. The fn() factory's outer schema validation produces a clean
    // error either way.
    const r = await session.prompt(prompt, { model });
    result = extractStructuredOrText<O>(r.text);
  } finally {
    const elapsed = performance.now() - startedMs;
    chargeCost(ctx, elapsed);
  }
  return result;
}

// --- JSON extraction --------------------------------------------------------

// Pull the first JSON object/array out of a free-text LLM response. Handles:
//   - bare JSON ("{...}" or "[...]")
//   - fenced ```json blocks
//   - prose-prefixed JSON ("Here is the result: {...}")
//
// Returns the parsed value when extraction succeeds, otherwise the raw
// text. The caller treats the result as `O` and lets the fn() factory's
// schema validation reject mismatches.
function extractStructuredOrText<O>(text: string): O {
  const candidate = findJsonCandidate(text);
  if (candidate !== null) {
    try {
      return JSON.parse(candidate) as O;
    } catch {
      // fall through to raw text
    }
  }
  return text as unknown as O;
}

function findJsonCandidate(text: string): string | null {
  // Prefer fenced ```json blocks; the model often wraps its answer.
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/i.exec(text);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  // Otherwise, find the first balanced JSON value at the outermost
  // brace/bracket. We scan for the first `{` or `[` and walk forward,
  // tracking brace depth and string state to find its matching close.
  const start = findFirstStructureStart(text);
  if (start < 0) return null;
  const end = findStructureEnd(text, start);
  if (end < 0) return null;
  return text.slice(start, end + 1);
}

function findFirstStructureStart(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{" || ch === "[") return i;
  }
  return -1;
}

function findStructureEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
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
