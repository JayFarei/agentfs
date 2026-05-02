export type StoredProcedure = {
  name: string;
  tenantId: string;
  description: string;
  sourceTrajectoryId: string;
  createdAt: string;
  matcher: {
    intent:
      | "average_payment_volume_per_transaction"
      | "largest_average_payment_volume_per_transaction"
      | "document_sentiment"
      | "revenue_share"
      | "table_math"
      | "negative_outlook_references"
      | "negative_outlook_title_or_quote_references"
      | "planned_chain";
    examples: string[];
    /** Stable hash of (normalised question, filename) — used by the planned_chain matcher fallback. */
    questionFingerprint?: string;
  };
  params: {
    filename: string;
    segment?: string;
    denominator?: string;
    years?: string[];
    includeChange?: boolean;
    operation?: "difference" | "range" | "share";
    rowLabel?: string;
    denominatorRowLabel?: string;
    target?: string;
    lens?: "competitive_outlook";
    unitKind?: "sentence" | "title_or_quote";
  };
  implementation:
    | {
        kind: "atlas_aggregation_template";
        collection: "finqa_cases";
        pipelineTemplate: unknown[];
      }
    | {
        kind: "ts_function";
        functionName: string;
        source: string;
        observer: "fixture" | "anthropic" | "flue";
      }
    | {
        kind: "task_agent";
        agentName: string;
        prompt: string;
        observer: "fixture" | "flue";
      }
    | {
        kind: "agentic_ts_function";
        functionName: string;
        source: string;
        observer: "fixture" | "anthropic" | "flue";
        agentName: string;
      }
    | {
        kind: "table_math";
        primitive: "finqa_table_math";
      }
    | {
        kind: "planned_chain";
        plan: import("../planner/types.js").ExecutionPlan;
        learnedFunctionNames: string[];
        learnedAgentNames: string[];
        questionFingerprint: string;
      };
};

export type ProcedureMatch = {
  procedure: StoredProcedure;
  company: string;
};
