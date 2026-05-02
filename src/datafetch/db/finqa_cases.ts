import type { Collection, Db, Document } from "mongodb";
import type { FinqaCase } from "../../finqa/types.js";
import { normalizeKey } from "../../finqa/normalize.js";
import { getAtlasDb } from "./client.js";

export type FinqaCasesBackend =
  | {
      kind: "local";
      cases: FinqaCase[];
    }
  | {
      kind: "mongo";
      db: Db;
    };

export type FinqaCasesPrimitive = {
  findExact(filter: Partial<FinqaCase>, limit?: number): Promise<FinqaCase[]>;
  search(query: string, opts?: { limit?: number }): Promise<FinqaCase[]>;
  findSimilar(query: string, limit?: number): Promise<FinqaCase[]>;
  hybrid(query: string, opts?: { limit?: number }): Promise<FinqaCase[]>;
  runAveragePaymentVolumePerTransaction(args: {
    filename: string;
    company: string;
  }): Promise<{ answer: number; roundedAnswer: number; evidence: unknown[] }>;
};

function caseCollection(db: Db): Collection<FinqaCase> {
  return db.collection<FinqaCase>("finqa_cases");
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
  );
}

function lexicalScore(query: string, candidate: FinqaCase): number {
  const q = tokenize(query);
  const text = tokenize(candidate.searchableText);
  let score = 0;
  for (const token of q) {
    if (text.has(token)) {
      score += 1;
    }
  }
  if (candidate.question.toLowerCase() === query.toLowerCase()) {
    score += 20;
  }
  return score;
}

function matchesFilter(candidate: FinqaCase, filter: Partial<FinqaCase>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }
    return (candidate as unknown as Record<string, unknown>)[key] === value;
  });
}

function normalizeCompanyName(company: string): string {
  const key = normalizeKey(company);
  if (key === "american_express") {
    return "american_express";
  }
  return key;
}

function localAveragePaymentVolume(
  cases: FinqaCase[],
  args: { filename: string; company: string }
): { answer: number; roundedAnswer: number; evidence: unknown[] } {
  const filing = cases.find((candidate) => candidate.filename === args.filename);
  if (!filing) {
    throw new Error(`No FinQA case found for filename ${args.filename}`);
  }

  const companyKey = normalizeCompanyName(args.company);
  const row = filing.table.rows.find((candidate) => candidate.labelKey === companyKey);
  if (!row) {
    throw new Error(`No row found for company ${args.company} in ${args.filename}`);
  }

  const numerator = row.cells.find((cell) => cell.columnKey === "payments_volume_billions");
  const denominator = row.cells.find((cell) => cell.columnKey === "total_transactions_billions");
  if (!numerator?.value || !denominator?.value) {
    throw new Error(`Missing payment volume or transaction count for ${args.company}`);
  }

  const answer = numerator.value / denominator.value;
  return {
    answer,
    roundedAnswer: round2(answer),
    evidence: [
      {
        caseId: filing.id,
        filename: filing.filename,
        rowLabel: row.label,
        rowKey: row.labelKey,
        numerator,
        denominator
      }
    ]
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function mongoAveragePaymentVolume(
  collection: Collection<FinqaCase>,
  args: { filename: string; company: string }
): Promise<{ answer: number; roundedAnswer: number; evidence: unknown[] }> {
  const companyKey = normalizeCompanyName(args.company);
  const [result] = await collection
    .aggregate<{
      answer: number;
      roundedAnswer: number;
      filename: string;
      rowLabel: string;
      numerator: unknown;
      denominator: unknown;
    }>([
      { $match: { filename: args.filename } },
      {
        $project: {
          id: 1,
          filename: 1,
          row: {
            $first: {
              $filter: {
                input: "$table.rows",
                as: "row",
                cond: { $eq: ["$$row.labelKey", companyKey] }
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
          answer: { $divide: ["$numerator.value", "$denominator.value"] }
        }
      },
      {
        $project: {
          filename: 1,
          rowLabel: 1,
          numerator: 1,
          denominator: 1,
          answer: 1,
          roundedAnswer: { $round: ["$answer", 2] }
        }
      }
    ])
    .toArray();

  if (!result) {
    throw new Error(`No aggregation result for ${args.company} in ${args.filename}`);
  }

  return {
    answer: result.answer,
    roundedAnswer: result.roundedAnswer,
    evidence: [
      {
        filename: result.filename,
        rowLabel: result.rowLabel,
        numerator: result.numerator,
        denominator: result.denominator
      }
    ]
  };
}

export function createFinqaCasesPrimitive(backend: FinqaCasesBackend): FinqaCasesPrimitive {
  return {
    async findExact(filter, limit = 10) {
      if (backend.kind === "local") {
        return backend.cases.filter((candidate) => matchesFilter(candidate, filter)).slice(0, limit);
      }

      return caseCollection(backend.db).find(filter as Document).limit(limit).toArray();
    },

    async search(query, opts = {}) {
      const limit = opts.limit ?? 10;
      if (backend.kind === "local") {
        return backend.cases
          .map((candidate) => ({ candidate, score: lexicalScore(query, candidate) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((entry) => entry.candidate);
      }

      const collection = caseCollection(backend.db);
      try {
        return await collection
          .find(
            { $text: { $search: query } },
            { projection: { score: { $meta: "textScore" } } }
          )
          .sort({ score: { $meta: "textScore" } })
          .limit(limit)
          .toArray();
      } catch {
        return collection
          .find({ searchableText: { $regex: query.split(/\s+/).filter(Boolean).join("|"), $options: "i" } })
          .limit(limit)
          .toArray();
      }
    },

    async findSimilar(query, limit = 10) {
      return this.search(query, { limit });
    },

    async hybrid(query, opts = {}) {
      return this.search(query, opts);
    },

    async runAveragePaymentVolumePerTransaction(args) {
      if (backend.kind === "local") {
        return localAveragePaymentVolume(backend.cases, args);
      }

      return mongoAveragePaymentVolume(caseCollection(backend.db), args);
    }
  };
}

export async function createAtlasFinqaCasesPrimitive(): Promise<FinqaCasesPrimitive> {
  return createFinqaCasesPrimitive({ kind: "mongo", db: await getAtlasDb() });
}
