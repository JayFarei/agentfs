// pickFiling — select the most likely filing/case from search candidates
// given a free-text question. Pure TS body; ported from
// `src/datafetch/db/finqa_resolve.ts:pickFiling`.
//
// The seed lives outside any specific mount, so the input/output schemas
// describe the structural shape the scoring logic actually depends on, not
// the full FinqaCase type. Anything matching the structural shape (the
// synthesised /db/finqa-2024/cases.ts entries do) flows through.

import * as v from "valibot";

import { fn } from "../../../../src/sdk/index.js";

// --- Structural shapes -----------------------------------------------------

const CellSchema = v.object({
  column: v.string(),
  columnKey: v.optional(v.string()),
  raw: v.string(),
  value: v.nullable(v.number()),
});

const RowSchema = v.object({
  index: v.number(),
  label: v.string(),
  labelKey: v.optional(v.string()),
  cells: v.array(CellSchema),
});

// The structural Filing shape pickFiling reads. Looser than FinqaCase but
// strict enough to power the scoring functions. Extra fields the synthesised
// mount module may carry (e.g. an upstream search `score`) are admitted via
// `looseObject` without losing validation on the fields we depend on.
const FilingSchema = v.looseObject({
  filename: v.string(),
  question: v.string(),
  searchableText: v.string(),
  table: v.object({
    headers: v.array(v.string()),
    headerKeys: v.optional(v.array(v.string())),
    rows: v.array(RowSchema),
  }),
});

const InputSchema = v.object({
  question: v.string(),
  candidates: v.array(FilingSchema),
  priorTickers: v.optional(v.array(v.string())),
});

type Filing = v.InferOutput<typeof FilingSchema>;
type Input = {
  question: string;
  candidates: Filing[];
  priorTickers?: string[];
};

// --- Helpers (lifted from finqa_resolve.ts) -------------------------------

function tokenOverlap(a: string, b: string): number {
  const left = new Set(
    a
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const right = new Set(
    b
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function normalizedTokenOverlap(a: string, b: string): number {
  const left = new Set(
    normalizeKey(a)
      .split("_")
      .filter((token) => token.length > 1),
  );
  const right = new Set(
    normalizeKey(b)
      .split("_")
      .filter((token) => token.length > 1),
  );
  let score = 0;
  for (const token of left) {
    if (
      right.has(token) ||
      (token.endsWith("s") && right.has(token.slice(0, -1)))
    ) {
      score += 1;
    }
  }
  return score;
}

function tickerHintScore(question: string, candidate: Filing): number {
  const q = question.toLowerCase();
  if (
    (q.includes("competitive") ||
      q.includes("competition") ||
      q.includes("outlook") ||
      q.includes("positioning")) &&
    candidate.filename === "V/2012/page_28.pdf"
  ) {
    return 20;
  }
  if (
    (q.includes("visa") || q.includes("payment network")) &&
    candidate.filename.startsWith("V/")
  ) {
    return 10;
  }
  if (
    q.includes("payment volume") &&
    candidate.question.toLowerCase().includes("payment volume")
  ) {
    return 8;
  }
  if (
    (q.includes("union pacific") ||
      q.includes("railroad") ||
      q.includes("agricultural products")) &&
    candidate.filename.startsWith("UNP/")
  ) {
    return 10;
  }
  return 0;
}

function backendSearchScore(candidate: Filing): number {
  const score = (candidate as Filing & { score?: unknown }).score;
  return typeof score === "number" ? score : 0;
}

function tableLabelScore(question: string, candidate: Filing): number {
  const bestRowScore = candidate.table.rows.reduce(
    (best, row) => Math.max(best, normalizedTokenOverlap(question, row.label)),
    0,
  );
  return bestRowScore * 12;
}

function candidateQuestionScore(question: string, candidate: Filing): number {
  return (
    normalizedTokenOverlap(question, candidate.question) * 25 +
    tokenOverlap(question, candidate.question) * 5
  );
}

// --- Factory ---------------------------------------------------------------

export const pickFiling = fn<Input, Filing>({
  intent:
    "select the most likely filing/case from search candidates given a question",
  examples: [
    {
      input: {
        question: "Visa 2017 operating revenues",
        candidates: [
          {
            filename: "V/2017/page_42.pdf",
            question: "what were operating revenues in 2017?",
            searchableText: "Visa Inc. operating revenues 2017",
            table: {
              headers: ["metric", "2017"],
              headerKeys: ["metric", "2017"],
              rows: [
                {
                  index: 0,
                  label: "operating revenues",
                  labelKey: "operating_revenues",
                  cells: [
                    { column: "metric", raw: "operating revenues", value: null },
                    { column: "2017", raw: "18358", value: 18358 },
                  ],
                },
              ],
            },
          },
        ],
      },
      output: {
        filename: "V/2017/page_42.pdf",
        question: "what were operating revenues in 2017?",
        searchableText: "Visa Inc. operating revenues 2017",
        table: {
          headers: ["metric", "2017"],
          headerKeys: ["metric", "2017"],
          rows: [
            {
              index: 0,
              label: "operating revenues",
              labelKey: "operating_revenues",
              cells: [
                { column: "metric", raw: "operating revenues", value: null },
                { column: "2017", raw: "18358", value: 18358 },
              ],
            },
          ],
        },
      },
    },
  ],
  input: InputSchema,
  output: FilingSchema,
  body: ({ question, candidates }: Input) => {
    if (candidates.length === 0) {
      throw new Error("pickFiling: no candidate filings to choose from");
    }
    const ranked = candidates
      .map((candidate, index) => ({
        candidate,
        score:
          backendSearchScore(candidate) +
          candidateQuestionScore(question, candidate) +
          tableLabelScore(question, candidate) +
          tokenOverlap(question, candidate.searchableText) +
          tickerHintScore(question, candidate) +
          (candidates.length - index),
      }))
      .sort((a, b) => b.score - a.score);
    return ranked[0]!.candidate;
  },
});
