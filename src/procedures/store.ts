import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredProcedure } from "./types.js";
import type { TrajectoryRecord } from "../trajectory/recorder.js";
import { atlasfsHome } from "../trajectory/recorder.js";

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

export function buildProcedureFromTrajectory(trajectory: TrajectoryRecord): StoredProcedure {
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
