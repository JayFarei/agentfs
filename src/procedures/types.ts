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
      | "revenue_share";
    examples: string[];
  };
  params: {
    filename: string;
    segment?: string;
    denominator?: string;
    years?: string[];
    includeChange?: boolean;
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
      };
};

export type ProcedureMatch = {
  procedure: StoredProcedure;
  company: string;
};
