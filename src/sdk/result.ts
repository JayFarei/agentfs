// Result envelope.
//
// Uniform return shape across `df.run`, `df.lib.<name>`, and `df.db.<coll>.<method>`.
// The exact shape mirrors `kb/prd/personas.md` §2 and `kb/prd/design.md` §11.2.

export type ResultMode =
  | "cache"
  | "compiled"
  | "interpreted"
  | "llm-backed"
  | "novel";

export type CostTier = 0 | 1 | 2 | 3 | 4;

export type Cost = {
  tier: CostTier;
  tokens: { hot: number; cold: number };
  ms: { hot: number; cold: number };
  llmCalls: number;
};

export type Provenance = {
  tenant: string;
  mount: string;
  functionName?: string;
  trajectoryId: string;
  pins?: Record<string, string>;
};

export type Warning = {
  code: string;
  message: string;
};

export type Result<T> = {
  value: T;
  mode: ResultMode;
  cost: Cost;
  provenance: Provenance;
  escalations: number;
  warnings?: Warning[];
};

// A zero-cost cost block. Useful for cache hits and as the starting accumulator.
export function costZero(tier: CostTier = 0): Cost {
  return {
    tier,
    tokens: { hot: 0, cold: 0 },
    ms: { hot: 0, cold: 0 },
    llmCalls: 0,
  };
}

export type MakeResultArgs<T> = {
  value: T;
  mode: ResultMode;
  cost?: Cost;
  provenance: Provenance;
  escalations?: number;
  warnings?: Warning[];
};

// Build a Result<T> with sensible defaults for cost/escalations/warnings.
export function makeResult<T>(args: MakeResultArgs<T>): Result<T> {
  const result: Result<T> = {
    value: args.value,
    mode: args.mode,
    cost: args.cost ?? costZero(),
    provenance: args.provenance,
    escalations: args.escalations ?? 0,
  };
  if (args.warnings && args.warnings.length > 0) {
    result.warnings = args.warnings;
  }
  return result;
}
