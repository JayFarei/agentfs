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
  runRevenueShare(args: RevenueShareArgs): Promise<RevenueShareResult>;
};

export type RevenueShareArgs = {
  filename: string;
  segment: string;
  denominator: string;
  years: string[];
  includeChange?: boolean;
};

export type RevenueShareYearResult = {
  year: string;
  numerator: number;
  denominator: number;
  percentage: number;
  roundedPercentage: number;
  rowLabel: string;
  denominatorRowLabel: string;
};

export type RevenueShareResult = {
  answer: number | string;
  roundedAnswer?: number;
  rows: RevenueShareYearResult[];
  change?: {
    fromYear: string;
    toYear: string;
    percentagePointChange: number;
    roundedPercentagePointChange: number;
  };
  evidence: unknown[];
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

function normalizeRevenueRowName(name: string): string {
  const key = normalizeKey(name);
  const aliases: Record<string, string> = {
    agriculture: "agricultural_products",
    agricultural: "agricultural_products",
    agriculture_products: "agricultural_products",
    agricultural_commodity_group: "agricultural_products",
    chemicals_freight: "chemicals",
    chemical_freight: "chemicals",
    operating_revenue: "total_operating_revenues",
    operating_revenues: "total_operating_revenues",
    total_operating_revenue: "total_operating_revenues",
    freight_revenue: "total_freight_revenues",
    freight_revenues: "total_freight_revenues",
    total_freight_revenue: "total_freight_revenues"
  };
  return aliases[key] ?? key;
}

function findRevenueRow(filing: FinqaCase, requested: string) {
  const requestedKey = normalizeRevenueRowName(requested);
  const exact = filing.table.rows.find((row) => row.labelKey === requestedKey);
  if (exact) {
    return exact;
  }

  const partial = filing.table.rows.find(
    (row) => row.labelKey.includes(requestedKey) || requestedKey.includes(row.labelKey)
  );
  if (partial) {
    return partial;
  }

  throw new Error(`No row found for ${requested} in ${filing.filename}`);
}

function formatPercent(value: number): string {
  return `${round2(value).toFixed(2)}%`;
}

function formatSignedPoints(value: number): string {
  const rounded = round2(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(2)} pp`;
}

function revenueShareAnswer(rows: RevenueShareYearResult[], change?: RevenueShareResult["change"]): number | string {
  if (rows.length === 1 && !change) {
    return rows[0].percentage;
  }

  const rowText = rows.map((row) => `${row.year}: ${formatPercent(row.percentage)}`).join("; ");
  if (!change) {
    return rowText;
  }
  return `${rowText}; change: ${formatSignedPoints(change.percentagePointChange)}`;
}

function computeRevenueShare(filing: FinqaCase, args: RevenueShareArgs): RevenueShareResult {
  const segmentRow = findRevenueRow(filing, args.segment);
  const denominatorRow = findRevenueRow(filing, args.denominator);
  const years = args.years.length > 0 ? args.years : filing.table.headerKeys.filter((key) => /^20\d{2}$/.test(key)).slice(0, 1);
  if (years.length === 0) {
    throw new Error(`No year columns found in ${filing.filename}`);
  }

  const rows = years.map((year) => {
    const yearKey = normalizeKey(year);
    const numerator = segmentRow.cells.find((cell) => cell.columnKey === yearKey);
    const denominator = denominatorRow.cells.find((cell) => cell.columnKey === yearKey);
    if (numerator?.value == null) {
      throw new Error(`Missing ${segmentRow.label} value for ${year} in ${filing.filename}`);
    }
    if (denominator?.value == null || denominator.value === 0) {
      throw new Error(`Missing usable ${denominatorRow.label} value for ${year} in ${filing.filename}`);
    }
    const percentage = (numerator.value / denominator.value) * 100;
    return {
      year: yearKey,
      numerator: numerator.value,
      denominator: denominator.value,
      percentage,
      roundedPercentage: round2(percentage),
      rowLabel: segmentRow.label,
      denominatorRowLabel: denominatorRow.label
    };
  });

  const change =
    args.includeChange && rows.length >= 2
      ? {
          fromYear: rows[0].year,
          toYear: rows[1].year,
          percentagePointChange: rows[0].percentage - rows[1].percentage,
          roundedPercentagePointChange: round2(rows[0].percentage - rows[1].percentage)
        }
      : undefined;

  return {
    answer: revenueShareAnswer(rows, change),
    roundedAnswer: rows.length === 1 ? rows[0].roundedPercentage : undefined,
    rows,
    change,
    evidence: [
      {
        caseId: filing.id,
        filename: filing.filename,
        segmentRow: segmentRow.label,
        denominatorRow: denominatorRow.label,
        years: rows.map((row) => ({
          year: row.year,
          numerator: row.numerator,
          denominator: row.denominator
        }))
      }
    ]
  };
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

async function mongoRevenueShare(collection: Collection<FinqaCase>, args: RevenueShareArgs): Promise<RevenueShareResult> {
  const filing = await collection.findOne({ filename: args.filename });
  if (!filing) {
    throw new Error(`No FinQA case found for filename ${args.filename}`);
  }
  return computeRevenueShare(filing, args);
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
    },

    async runRevenueShare(args) {
      if (backend.kind === "local") {
        const filing = backend.cases.find((candidate) => candidate.filename === args.filename);
        if (!filing) {
          throw new Error(`No FinQA case found for filename ${args.filename}`);
        }
        return computeRevenueShare(filing, args);
      }

      return mongoRevenueShare(caseCollection(backend.db), args);
    }
  };
}

export async function createAtlasFinqaCasesPrimitive(): Promise<FinqaCasesPrimitive> {
  return createFinqaCasesPrimitive({ kind: "mongo", db: await getAtlasDb() });
}
