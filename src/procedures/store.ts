import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredProcedure } from "./types.js";
import type { TrajectoryRecord } from "../trajectory/recorder.js";
import { atlasfsHome } from "../trajectory/recorder.js";
import type { CodifiedTableFunction } from "../datafetch/db/finqa_observe.js";
import type { TableMathPlan } from "../datafetch/db/finqa_table_math.js";

const averageProcedureName = "average_payment_volume_per_transaction";
const largestProcedureName = "largest_average_payment_volume_per_transaction";

function pipelineTemplate(filename: string): unknown[] {
  return [
    { $match: { filename: "{{filename}}" } },
    {
      $project: {
        id: 1,
        filename: 1,
        row: {
          $first: {
            $filter: {
              input: "$table.rows",
              as: "row",
              cond: { $eq: ["$$row.labelKey", "{{companyKey}}"] }
            }
          }
        }
      }
    },
    {
      $project: {
        filename: 1,
        rowLabel: "$row.label",
        numerator: {
          $first: {
            $filter: {
              input: "$row.cells",
              as: "cell",
              cond: { $eq: ["$$cell.columnKey", "payments_volume_billions"] }
            }
          }
        },
        denominator: {
          $first: {
            $filter: {
              input: "$row.cells",
              as: "cell",
              cond: { $eq: ["$$cell.columnKey", "total_transactions_billions"] }
            }
          }
        }
      }
    },
    {
      $project: {
        filename: 1,
        rowLabel: 1,
        numerator: 1,
        denominator: 1,
        answer: { $divide: ["$numerator.value", "$denominator.value"] },
        roundedAnswer: { $round: [{ $divide: ["$numerator.value", "$denominator.value"] }, 2] }
      }
    },
    { $limit: 1 },
    { $comment: `source filename: ${filename}` }
  ];
}

export function buildAveragePaymentVolumeProcedure(trajectory: TrajectoryRecord): StoredProcedure {
  const filingCall = trajectory.calls.find((call) => call.primitive === "finqa_resolve.pickFiling");
  const filing = filingCall?.output as { filename?: string } | undefined;
  const filename = filing?.filename;
  if (!filename) {
    throw new Error("Cannot crystallize procedure: trajectory has no pickFiling output filename");
  }

  return {
    name: averageProcedureName,
    tenantId: trajectory.tenantId,
    description:
      "Compute average payment volume per transaction for a company in a FinQA filing by dividing payments volume by total transactions.",
    sourceTrajectoryId: trajectory.id,
    createdAt: new Date().toISOString(),
    matcher: {
      intent: "average_payment_volume_per_transaction",
      examples: [trajectory.question]
    },
    params: {
      filename
    },
    implementation: {
      kind: "atlas_aggregation_template",
      collection: "finqa_cases",
      pipelineTemplate: pipelineTemplate(filename)
    }
  };
}

export function buildObserverProcedure(trajectory: TrajectoryRecord): StoredProcedure {
  const filingCall = trajectory.calls.find((call) => call.primitive === "finqa_resolve.pickFiling");
  const codifyCall = trajectory.calls.find((call) => call.primitive === "finqa_observe.codifyTableFunction");
  const filing = filingCall?.output as { filename?: string } | undefined;
  const codified = codifyCall?.output as
    | {
        functionName?: string;
        source?: string;
        description?: string;
        observer?: "fixture" | "anthropic" | "flue";
      }
    | undefined;
  if (!filing?.filename || !codified?.functionName || !codified.source) {
    throw new Error("Cannot crystallize observer procedure: trajectory is missing filing or codified function");
  }

  return {
    name: largestProcedureName,
    tenantId: trajectory.tenantId,
    description:
      codified.description ??
      "Find the highest average payment volume per transaction by executing an observer-codified table function.",
    sourceTrajectoryId: trajectory.id,
    createdAt: new Date().toISOString(),
    matcher: {
      intent: "largest_average_payment_volume_per_transaction",
      examples: [trajectory.question]
    },
    params: {
      filename: filing.filename
    },
    implementation: {
      kind: "ts_function",
      functionName: codified.functionName,
      source: codified.source,
      observer: codified.observer ?? "fixture"
    }
  };
}

export function buildTaskAgentProcedure(trajectory: TrajectoryRecord): StoredProcedure {
  const filingCall = trajectory.calls.find((call) => call.primitive === "finqa_resolve.pickFiling");
  const specCall = trajectory.calls.find((call) => call.primitive === "finqa_agent.createSentimentAgentSpec");
  const filing = filingCall?.output as { filename?: string } | undefined;
  const spec = specCall?.output as
    | {
        agentName?: string;
        description?: string;
        prompt?: string;
        observer?: "fixture" | "flue";
      }
    | undefined;
  if (!filing?.filename || !spec?.agentName || !spec.prompt) {
    throw new Error("Cannot crystallize task-agent procedure: trajectory is missing filing or agent spec");
  }

  return {
    name: "document_sentiment",
    tenantId: trajectory.tenantId,
    description: spec.description ?? "Extract document sentiment using a task-specific LLM agent.",
    sourceTrajectoryId: trajectory.id,
    createdAt: new Date().toISOString(),
    matcher: {
      intent: "document_sentiment",
      examples: [trajectory.question]
    },
    params: {
      filename: filing.filename
    },
    implementation: {
      kind: "task_agent",
      agentName: spec.agentName,
      prompt: spec.prompt,
      observer: spec.observer ?? "fixture"
    }
  };
}

export function buildRevenueShareProcedure(args: {
  tenantId: string;
  question: string;
  sourceTrajectoryId: string;
  filename: string;
  segment: string;
  denominator: string;
  years: string[];
  includeChange: boolean;
  codified: CodifiedTableFunction;
}): StoredProcedure {
  return {
    name: "revenue_share",
    tenantId: args.tenantId,
    description:
      "Compute what percentage of a selected revenue denominator is contributed by a chosen revenue segment, optionally comparing years.",
    sourceTrajectoryId: args.sourceTrajectoryId,
    createdAt: new Date().toISOString(),
    matcher: {
      intent: "revenue_share",
      examples: [args.question]
    },
    params: {
      filename: args.filename,
      segment: args.segment,
      denominator: args.denominator,
      years: args.years,
      includeChange: args.includeChange
    },
    implementation: {
      kind: "ts_function",
      functionName: args.codified.functionName,
      source: args.codified.source,
      observer: args.codified.observer
    }
  };
}

export function buildTableMathProcedure(args: {
  tenantId: string;
  question: string;
  sourceTrajectoryId: string;
  filename: string;
  plan?: TableMathPlan;
}): StoredProcedure {
  return {
    name: "table_math",
    tenantId: args.tenantId,
    description:
      "Execute generic table arithmetic by inferring a row, years, and operation from the question, then applying the reusable table-math primitive.",
    sourceTrajectoryId: args.sourceTrajectoryId,
    createdAt: new Date().toISOString(),
    matcher: {
      intent: "table_math",
      examples: [args.question]
    },
    params: {
      filename: args.filename,
      operation: args.plan?.operation,
      rowLabel: args.plan?.rowLabel,
      denominatorRowLabel: args.plan?.denominatorRowLabel,
      years: args.plan?.years
    },
    implementation: {
      kind: "table_math",
      primitive: "finqa_table_math"
    }
  };
}

export function buildNegativeOutlookProcedure(args: {
  name: "negative_outlook_references" | "negative_outlook_title_or_quote_references";
  intent: "negative_outlook_references" | "negative_outlook_title_or_quote_references";
  tenantId: string;
  question: string;
  sourceTrajectoryId: string;
  filename: string;
  target: string;
  unitKind: "sentence" | "title_or_quote";
  agentName: string;
  codified: CodifiedTableFunction;
}): StoredProcedure {
  return {
    name: args.name,
    tenantId: args.tenantId,
    description:
      "Find negative competitive-outlook references by composing document-unit extraction, a reusable scorer agent, and observer-generated selection glue.",
    sourceTrajectoryId: args.sourceTrajectoryId,
    createdAt: new Date().toISOString(),
    matcher: {
      intent: args.intent,
      examples: [args.question]
    },
    params: {
      filename: args.filename,
      target: args.target,
      lens: "competitive_outlook",
      unitKind: args.unitKind
    },
    implementation: {
      kind: "agentic_ts_function",
      functionName: args.codified.functionName,
      source: args.codified.source,
      observer: args.codified.observer,
      agentName: args.agentName
    }
  };
}

export function buildProcedureFromTrajectory(trajectory: TrajectoryRecord): StoredProcedure {
  if (trajectory.calls.some((call) => call.primitive === "finqa_cases.runRevenueShare")) {
    throw new Error("Revenue-share trajectories must be committed through review --yes so the final procedure is codified by the observer runtime");
  }
  if (trajectory.calls.some((call) => call.primitive === "finqa_table_math.execute")) {
    const filingCall = trajectory.calls.find((call) => call.primitive === "finqa_resolve.pickFiling");
    const planCall = trajectory.calls.find((call) => call.primitive === "finqa_table_math.inferPlan");
    const filing = filingCall?.output as { filename?: string } | undefined;
    if (!filing?.filename) {
      throw new Error("Cannot crystallize table-math procedure: trajectory has no pickFiling output filename");
    }
    return buildTableMathProcedure({
      tenantId: trajectory.tenantId,
      question: trajectory.question,
      sourceTrajectoryId: trajectory.id,
      filename: filing.filename,
      plan: planCall?.output as TableMathPlan | undefined
    });
  }
  if (trajectory.calls.some((call) => call.primitive === "finqa_agent.createSentimentAgentSpec")) {
    return buildTaskAgentProcedure(trajectory);
  }
  if (trajectory.calls.some((call) => call.primitive === "finqa_observe.codifyTableFunction")) {
    return buildObserverProcedure(trajectory);
  }
  return buildAveragePaymentVolumeProcedure(trajectory);
}

export class LocalProcedureStore {
  constructor(private readonly baseDir = atlasfsHome()) {}

  private tenantDir(tenantId: string): string {
    return path.join(this.baseDir, "procedures", tenantId);
  }

  async save(procedure: StoredProcedure): Promise<{ jsonPath: string; tsPath: string }> {
    const dir = this.tenantDir(procedure.tenantId);
    await mkdir(dir, { recursive: true });
    const jsonPath = path.join(dir, `${procedure.name}.json`);
    const tsPath = path.join(dir, `${procedure.name}.ts`);
    await writeFile(jsonPath, `${JSON.stringify(procedure, null, 2)}\n`, "utf8");
    await writeFile(tsPath, renderProcedureTs(procedure), "utf8");
    return { jsonPath, tsPath };
  }

  async list(tenantId: string): Promise<StoredProcedure[]> {
    const dir = this.tenantDir(tenantId);
    try {
      const entries = await readdir(dir);
      const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
      const procedures = await Promise.all(
        jsonFiles.map(async (entry) => JSON.parse(await readFile(path.join(dir, entry), "utf8")) as StoredProcedure)
      );
      return procedures;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

function renderProcedureTs(procedure: StoredProcedure): string {
  if (procedure.implementation.kind === "table_math") {
    return `// Generated by local AtlasFS crystallization.
// Source trajectory: ${procedure.sourceTrajectoryId}

export const procedure = ${JSON.stringify(procedure, null, 2)} as const;

export async function run(finqa_cases: {
  findExact(filter: { filename: string }, limit?: number): Promise<any[]>;
}, finqa_table_math: {
  inferPlan(args: { question: string; filing: any }): any;
  execute(args: { filing: any; plan: any }): unknown;
}, args: { question: string }) {
  const [filing] = await finqa_cases.findExact({ filename: procedure.params.filename }, 1);
  if (!filing) {
    throw new Error(\`No filing found for \${procedure.params.filename}\`);
  }
  const plan = finqa_table_math.inferPlan({ question: args.question, filing });
  return finqa_table_math.execute({ filing, plan });
}
`;
  }

  if (procedure.implementation.kind === "agentic_ts_function") {
    return `// Generated by local AtlasFS crystallization.
// Source trajectory: ${procedure.sourceTrajectoryId}

export const procedure = ${JSON.stringify(procedure, null, 2)} as const;

${procedure.implementation.source}

export async function run(
  finqa_cases: {
    findExact(filter: { filename: string }, limit?: number): Promise<any[]>;
  },
  document_units: {
    sentences(filing: any): any[];
    titleOrQuoteUnits(filing: any): any[];
  },
  finqa_outlook: {
    scoreUnits(args: { spec: any; units: any[]; target: string; lens: "competitive_outlook" }): Promise<any[]>;
  },
  agentSpec: any
) {
  const [filing] = await finqa_cases.findExact({ filename: procedure.params.filename }, 1);
  if (!filing) {
    throw new Error(\`No filing found for \${procedure.params.filename}\`);
  }
  const units = procedure.params.unitKind === "title_or_quote"
    ? document_units.titleOrQuoteUnits(filing)
    : document_units.sentences(filing);
  const scoredUnits = await finqa_outlook.scoreUnits({
    spec: agentSpec,
    units,
    target: procedure.params.target ?? "Visa",
    lens: "competitive_outlook"
  });
  return ${procedure.implementation.functionName}({ scoredUnits, units });
}
`;
  }

  if (procedure.implementation.kind === "ts_function") {
    return `// Generated by local AtlasFS crystallization.
// Source trajectory: ${procedure.sourceTrajectoryId}

export const procedure = ${JSON.stringify(procedure, null, 2)} as const;

${procedure.implementation.source}

export async function run(finqa_cases: {
  findExact(filter: { filename: string }, limit?: number): Promise<any[]>;
}) {
  const [filing] = await finqa_cases.findExact({ filename: procedure.params.filename }, 1);
  if (!filing) {
    throw new Error(\`No filing found for \${procedure.params.filename}\`);
  }
  return ${procedure.implementation.functionName}(filing);
}
`;
  }

  if (procedure.implementation.kind === "task_agent") {
    return `// Generated by local AtlasFS crystallization.
// Source trajectory: ${procedure.sourceTrajectoryId}

export const procedure = ${JSON.stringify(procedure, null, 2)} as const;

export async function run(finqa_cases: {
  findExact(filter: { filename: string }, limit?: number): Promise<any[]>;
}, finqa_agent: {
  documentText(filing: any): string;
  runSentimentAgent(args: { spec: any; question: string; documentText: string }): Promise<unknown>;
}, args: { question: string }) {
  const [filing] = await finqa_cases.findExact({ filename: procedure.params.filename }, 1);
  if (!filing) {
    throw new Error(\`No filing found for \${procedure.params.filename}\`);
  }
  return finqa_agent.runSentimentAgent({
    spec: {
      agentName: procedure.implementation.agentName,
      description: procedure.description,
      prompt: procedure.implementation.prompt,
      observer: procedure.implementation.observer
    },
    question: args.question,
    documentText: finqa_agent.documentText(filing)
  });
}
`;
  }

  return `// Generated by local AtlasFS crystallization.
// Source trajectory: ${procedure.sourceTrajectoryId}

export const procedure = ${JSON.stringify(procedure, null, 2)} as const;

export async function run(finqa_cases: {
  runAveragePaymentVolumePerTransaction(args: { filename: string; company: string }): Promise<unknown>;
}, args: { company: string }) {
  return finqa_cases.runAveragePaymentVolumePerTransaction({
    filename: procedure.params.filename,
    company: args.company
  });
}
`;
}
