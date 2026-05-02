import type { FinqaCase } from "../finqa/types.js";
import type { TrajectoryRecorder } from "../trajectory/recorder.js";
import { finqa_resolve } from "../datafetch/db/finqa_resolve.js";
import type { FinqaCasesPrimitive } from "../datafetch/db/finqa_cases.js";
import {
  LocalFunctionStore,
  executeLearnedFunction,
  type LearnedFunction,
} from "../datafetch/primitives/learned_functions.js";
import {
  LocalLearnedAgentStore,
  type LearnedAgentSpec,
} from "../agents/learned_store.js";
import type { ExecutionPlan, JsonRef, PlanStep } from "./types.js";

/** External primitives the executor may need at dispatch time. */
export type ExecutorContext = {
  tenantId: string;
  baseDir: string;
  recorder: TrajectoryRecorder;
  question: string;
  filing: FinqaCase;
  finqaCases: FinqaCasesPrimitive;
  /** Pre-fetched candidates from `finqa_cases.findSimilar`, used when a step references them. */
  candidates: FinqaCase[];
  /** Override stores for testing; defaults are constructed from baseDir. */
  functionStore?: LocalFunctionStore;
  learnedAgentStore?: LocalLearnedAgentStore;
};

export type RunPlanResult = {
  /** Output of the step at `plan.finalStepIndex`. */
  finalOutput: unknown;
  /** All step outputs, indexed positionally. */
  stepOutputs: unknown[];
};

export async function runPlan(
  plan: ExecutionPlan,
  ctx: ExecutorContext
): Promise<RunPlanResult> {
  const stepOutputs: unknown[] = [];
  const fnStore = ctx.functionStore ?? new LocalFunctionStore(ctx.baseDir);
  const agentStore = ctx.learnedAgentStore ?? new LocalLearnedAgentStore(ctx.baseDir);

  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    const resolved = resolveBindings(step, stepOutputs, ctx);

    const out = await ctx.recorder.call(
      step.primitive,
      { ...resolved, __produces: step.produces, __index: i },
      async () => {
        const handler = REGISTRY_HANDLERS[step.primitive];
        if (handler) {
          return handler(resolved, ctx);
        }
        // Look in tenant-scoped function store
        const learnedFn = await fnStore.findByName(ctx.tenantId, step.primitive);
        if (learnedFn) {
          return invokeLearnedFunction(learnedFn, step, resolved);
        }
        // Look in tenant-scoped learned agent store
        const learnedAgent = await agentStore.findByName(ctx.tenantId, step.primitive);
        if (learnedAgent) {
          return invokeLearnedAgent(learnedAgent, resolved);
        }
        throw new Error(
          `Plan step ${i} references unknown primitive "${step.primitive}" — not in registry, function store, or agent store.`
        );
      }
    );
    stepOutputs.push(out);
  }

  return {
    finalOutput: stepOutputs[plan.finalStepIndex],
    stepOutputs,
  };
}

function resolveBindings(
  step: PlanStep,
  stepOutputs: unknown[],
  ctx: ExecutorContext
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [param, ref] of Object.entries(step.bindings)) {
    out[param] = resolveRef(ref, stepOutputs, ctx);
  }
  return out;
}

function resolveRef(
  ref: JsonRef,
  stepOutputs: unknown[],
  ctx: ExecutorContext
): unknown {
  switch (ref.kind) {
    case "literal":
      return ref.value;
    case "input":
      if (ref.name === "question") return ctx.question;
      if (ref.name === "filing") return ctx.filing;
      if (ref.name === "tenantId") return ctx.tenantId;
      throw new Error(`Unknown input ref: ${ref.name}`);
    case "step": {
      if (ref.index < 0 || ref.index >= stepOutputs.length) {
        throw new Error(`step ref index ${ref.index} out of range (0..${stepOutputs.length - 1})`);
      }
      const base = stepOutputs[ref.index];
      if (!ref.path) return base;
      return getPath(base, ref.path);
    }
    case "array":
      return ref.items.map((inner) => resolveRef(inner, stepOutputs, ctx));
  }
}

function getPath(value: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || current === undefined) return current;
    const idx = Number(part);
    if (Array.isArray(current) && Number.isInteger(idx)) {
      current = current[idx];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function invokeLearnedFunction(
  fn: LearnedFunction,
  step: PlanStep,
  resolved: Record<string, unknown>
): unknown {
  // Convention: planner emits bindings in the same order as the function's
  // positional parameters. Sort by binding key to give a deterministic order;
  // for "stats.stddev" the convention is a single `values` parameter.
  const positional = Object.values(resolved);
  return executeLearnedFunction(fn, positional);
}

async function invokeLearnedAgent(
  _agent: LearnedAgentSpec,
  _resolved: Record<string, unknown>
): Promise<unknown> {
  // Stub for the parallel agent-mint path. The std-dev demo question only
  // mints a function, never an agent, so we don't exercise this in the MVP.
  // When the agent-mint path is wired (Day 2 afternoon), this dispatches to
  // a Flue runtime using `_agent.prompt` + `_agent.inputSchema/outputSchema`.
  throw new Error(
    "Learned-agent invocation is not yet wired. Add a Flue dispatch here once the agent-mint path is enabled."
  );
}

/**
 * Static handler table for boot-registry primitives. Each handler accepts a
 * resolved bindings object and returns the primitive's result.
 *
 * Only the primitives actually exercised by off-script plans are here. The
 * pre-existing predicate dispatch in `runner.ts` covers everything else.
 */
const REGISTRY_HANDLERS: Record<
  string,
  (b: Record<string, unknown>, ctx: ExecutorContext) => Promise<unknown>
> = {
  "finqa_cases.findSimilar": async (b, ctx) => {
    const query = (b.query ?? b.question) as string;
    const limit = (b.limit as number | undefined) ?? 10;
    return ctx.finqaCases.findSimilar(query, limit);
  },
  "finqa_resolve.pickFiling": async (b, ctx) => {
    return finqa_resolve.pickFiling({
      question: (b.question as string) ?? ctx.question,
      candidates: (b.candidates as FinqaCase[]) ?? ctx.candidates,
    });
  },
  "finqa_resolve.locateFigure": async (b, ctx) => {
    return finqa_resolve.locateFigure({
      question: (b.question as string) ?? ctx.question,
      filing: (b.filing as FinqaCase) ?? ctx.filing,
      role: b.role as "numerator" | "denominator" | undefined,
      columnHint: b.columnHint as string | undefined,
      rowLabel: b.rowLabel as string | undefined,
    });
  },
  "arithmetic.divide": async (b) => {
    const num = Number(b.numerator);
    const den = Number(b.denominator);
    if (den === 0) throw new Error("arithmetic.divide: denominator is zero");
    return num / den;
  },
};
