import { TrajectoryRecorder } from "../trajectory/recorder.js";
import { finqa_resolve } from "../datafetch/db/finqa_resolve.js";
import {
  createObserverRuntime,
  type ObserverRuntime,
} from "../datafetch/db/finqa_observe.js";
import type { FinqaCasesPrimitive } from "../datafetch/db/finqa_cases.js";
import { LocalFunctionStore, type LearnedFunction } from "../datafetch/primitives/learned_functions.js";
import { LocalLearnedAgentStore } from "../agents/learned_store.js";
import { LocalProcedureStore } from "../procedures/store.js";
import { getCapabilities } from "../datafetch/primitives/capabilities.js";
import { runPlan } from "./executor.js";
import type { ExecutionPlan } from "./types.js";
import type { RunQueryResult } from "../runner.js";
import { primitiveRegistry } from "../datafetch/primitives/registry.js";

export type RunPlannedQueryArgs = {
  question: string;
  tenantId: string;
  baseDir: string;
  finqaCases: FinqaCasesPrimitive;
  observerRuntime?: ObserverRuntime;
};

/**
 * Off-script question loop:
 *   1. Pre-fetch a filing so the observer has context for planning.
 *   2. Ask the observer for an ExecutionPlan + a list of MissingPrimitives (gaps).
 *   3. Mint each gap (function or agent) and persist it.
 *   4. Validate every plan step's primitive is now reachable.
 *   5. Execute the plan via runPlan, recording every call.
 *   6. Crystallise a `planned_chain` procedure so siblings replay in one call.
 */
export async function runPlannedQuery(args: RunPlannedQueryArgs): Promise<RunQueryResult> {
  const observer = args.observerRuntime ?? createObserverRuntime();
  if (!observer.planTrajectory || !observer.codifyFunction) {
    throw new Error(
      `Observer runtime does not implement planTrajectory/codifyFunction. ` +
        `Use the fixture runtime or implement these methods.`
    );
  }

  const recorder = new TrajectoryRecorder({ tenantId: args.tenantId, question: args.question });

  // (1) Pre-fetch context for the planner. Not recorded; purely advisory.
  const ctxCandidates = await args.finqaCases.findSimilar(args.question, 10);
  if (ctxCandidates.length === 0) {
    throw new Error(`No filings matched the question via Atlas Search: ${args.question}`);
  }
  const ctxFiling = await finqa_resolve.pickFiling({ question: args.question, candidates: ctxCandidates });

  // (2) Plan the trajectory.
  const capabilities = await getCapabilities(args.tenantId, args.baseDir);
  const planResult = await recorder.call(
    "planner.planTrajectory",
    {
      question: args.question,
      filingFilename: ctxFiling.filename,
      capabilityCount: capabilities.primitives.length + capabilities.learnedFunctions.length + capabilities.learnedAgents.length
    },
    () => observer.planTrajectory!({ question: args.question, filing: ctxFiling, capabilities })
  );
  const plan: ExecutionPlan = planResult.plan;

  // (3) Mint each missing primitive in parallel.
  const fnStore = new LocalFunctionStore(args.baseDir);
  const learnedAgentStore = new LocalLearnedAgentStore(args.baseDir);
  const learnedFunctionNames: string[] = [];
  const learnedAgentNames: string[] = [];

  for (const gap of planResult.gaps) {
    if (gap.kind === "function") {
      // Reuse if already learned.
      const existing = await fnStore.findByName(args.tenantId, gap.name);
      if (existing) {
        learnedFunctionNames.push(gap.name);
        continue;
      }
      const codified = await recorder.call(
        "planner.codifyFunction",
        { name: gap.name, signature: gap.signature, description: gap.description },
        () => observer.codifyFunction!({
          name: gap.name,
          signature: gap.signature,
          description: gap.description,
          exampleInput: gap.exampleInput,
          exampleOutput: gap.exampleOutput
        })
      );
      const learned: LearnedFunction = {
        name: codified.name,
        description: codified.description,
        signature: gap.signature,
        source: codified.source,
        observer: codified.observer,
        createdAt: new Date().toISOString()
      };
      await recorder.call(
        "learned_functions.save",
        { name: learned.name, observer: learned.observer },
        async () => {
          await fnStore.save(args.tenantId, learned);
          return { name: learned.name };
        }
      );
      learnedFunctionNames.push(learned.name);
    } else {
      // Agent-mint path is wired (store exists) but the planner-driven flow
      // here is the MVP; throwing keeps the failure mode visible.
      throw new Error(
        `Agent-mint path not yet wired into the planner runner. Gap: ${gap.name}.`
      );
    }
  }

  // (4) Validate every step's primitive is reachable.
  const knownNames = new Set<string>([
    ...primitiveRegistry.map((p) => p.name),
    ...capabilities.learnedFunctions.map((fn) => fn.name),
    ...capabilities.learnedAgents.map((a) => a.name),
    ...learnedFunctionNames,
    ...learnedAgentNames
  ]);
  for (const step of plan.steps) {
    if (!knownNames.has(step.primitive)) {
      throw new Error(
        `Plan references unknown primitive "${step.primitive}" — not in registry, function store, agent store, or freshly minted.`
      );
    }
  }

  // (5) Execute the plan.
  const planRunResult = await recorder.call(
    "planner.runPlan",
    { stepCount: plan.steps.length, finalStepIndex: plan.finalStepIndex },
    () =>
      runPlan(plan, {
        tenantId: args.tenantId,
        baseDir: args.baseDir,
        recorder,
        question: args.question,
        filing: ctxFiling,
        finqaCases: args.finqaCases,
        candidates: ctxCandidates,
        functionStore: fnStore,
        learnedAgentStore
      })
  );

  // (6) Crystallise a planned_chain procedure.
  const fingerprint = makeFingerprint(args.question, ctxFiling.filename);
  const procedureName = `planned_chain_${fingerprint}`;
  const { buildPlannedChainProcedure } = await import("../procedures/store.js");
  const procedure = buildPlannedChainProcedure({
    name: procedureName,
    tenantId: args.tenantId,
    description: plan.rationale,
    sourceTrajectoryId: recorder.id,
    plan,
    learnedFunctionNames,
    learnedAgentNames,
    questionFingerprint: fingerprint,
    questionExample: args.question,
    filename: ctxFiling.filename
  });
  const procStore = new LocalProcedureStore(args.baseDir);
  await recorder.call(
    "procedure_store.save",
    { procedureName },
    async () => {
      await procStore.save(procedure);
      return { procedureName };
    }
  );

  // Final answer comes from the plan's nominated final step.
  const answer = planRunResult.finalOutput;
  const numericAnswer = typeof answer === "number" ? answer : Number(answer);
  const roundedAnswer = Number.isFinite(numericAnswer)
    ? Math.round(numericAnswer * 100) / 100
    : undefined;

  recorder.setResult({
    answer: typeof answer === "number" || typeof answer === "string" ? answer : String(answer),
    roundedAnswer,
    evidence: planRunResult.stepOutputs
  });
  await recorder.save(args.baseDir);

  return {
    mode: "novel",
    answer: typeof answer === "number" || typeof answer === "string" ? answer : String(answer),
    roundedAnswer,
    procedureName,
    trajectoryId: recorder.id,
    calls: recorder.snapshot.calls,
    evidence: planRunResult.stepOutputs
  };
}

/**
 * Stable fingerprint of (question shape, filing). Used by the matcher's
 * fingerprint fallback so the second asking of the same novel question
 * replays via the saved procedure instead of re-planning.
 *
 * Strategy: lowercase, strip 4-digit years and currency-unit qualifiers,
 * collapse whitespace, then short-hash.
 */
export function makeFingerprint(question: string, filename: string): string {
  const norm = question
    .toLowerCase()
    .replace(/\b(20\d{2}|in millions?|in thousands?|in billions?)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return shortHash(`${norm}|${filename}`);
}

function shortHash(input: string): string {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
