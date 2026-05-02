/**
 * Off-script-question planner types.
 *
 * The observer agent emits an ExecutionPlan: an ordered list of typed
 * primitive calls with explicit data-flow bindings between steps.
 * If a step references a primitive that doesn't yet exist (e.g. stats.stddev),
 * it appears in the `gaps` list and the runner mints it before execution.
 */

export type JsonRef =
  | { kind: "literal"; value: unknown }
  | { kind: "step"; index: number; path?: string }
  | { kind: "input"; name: "question" | "filing" | "tenantId" }
  | { kind: "array"; items: JsonRef[] };

export type PlanStep = {
  /** Fully-qualified primitive name, e.g. "finqa_resolve.locateFigure" or "stats.stddev". */
  primitive: string;
  /** Map of param-name → ref (literal value, prior step output, or runtime input). */
  bindings: Record<string, JsonRef>;
  /** Human label for the produced value, used in UI and prompts. */
  produces: string;
  /** Optional rationale from the planner. */
  rationale?: string;
};

export type ExecutionPlan = {
  steps: PlanStep[];
  /** Index of the step whose output is the final answer. */
  finalStepIndex: number;
  rationale: string;
};

export type MissingPrimitive = {
  /** Fully-qualified name the planner intends to mint. */
  name: string;
  /** function = deterministic TS; agent = Flue-backed typed agent. */
  kind: "function" | "agent";
  /** Human-readable signature for the prompt: `stddev(values: number[]): number`. */
  signature: string;
  description: string;
  /** Optional sample input/output shapes the planner has in mind. */
  exampleInput?: unknown;
  exampleOutput?: unknown;
};

export type PlanTrajectoryResult = {
  plan: ExecutionPlan;
  gaps: MissingPrimitive[];
};

/** Args passed to the observer's `planTrajectory` method. */
export type PlanTrajectoryArgs = {
  question: string;
  filing: import("../finqa/types.js").FinqaCase;
  capabilities: PlannerCapabilities;
};

export type PlannerCapabilities = {
  /** Boot-time primitives from the registry. */
  primitives: Array<{
    name: string;
    signature: string;
    description: string;
    implementation: "atlas" | "local" | "pure" | "future-flue" | "flue";
  }>;
  /** Tenant-scoped TS functions previously codified by the observer. */
  learnedFunctions: Array<{ name: string; signature: string; description: string }>;
  /** Tenant-scoped Flue agents previously created by the observer (excluding the legacy outlook spec). */
  learnedAgents: Array<{ name: string; capability: string; description: string }>;
};
