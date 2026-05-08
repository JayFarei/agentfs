// inferTableMathPlan — given a question and a filing, infer the
// operation (range / difference / share), the relevant rows, the years,
// and the unit-handling. Pure TS. Ported from
// `src/datafetch/db/finqa_table_math.ts:inferPlan`.
//
// The output of this function is the input to `executeTableMath`.

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

const FilingSchema = v.looseObject({
  id: v.optional(v.string()),
  filename: v.string(),
  preText: v.array(v.string()),
  postText: v.array(v.string()),
  table: v.object({
    headers: v.array(v.string()),
    headerKeys: v.optional(v.array(v.string())),
    rows: v.array(RowSchema),
  }),
});

type Filing = v.InferOutput<typeof FilingSchema>;
type Row = v.InferOutput<typeof RowSchema>;

const InputSchema = v.object({
  question: v.string(),
  filing: FilingSchema,
});

type Input = v.InferOutput<typeof InputSchema>;

const UnitSchema = v.union([
  v.literal("raw"),
  v.literal("thousands"),
  v.literal("millions"),
  v.literal("billions"),
]);

const OperationSchema = v.union([
  v.literal("difference"),
  v.literal("range"),
  v.literal("share"),
]);

const PlanSchema = v.object({
  operation: OperationSchema,
  rowLabel: v.string(),
  denominatorRowLabel: v.optional(v.string()),
  years: v.array(v.string()),
  requestedUnit: UnitSchema,
  nativeUnit: UnitSchema,
});

type Plan = v.InferOutput<typeof PlanSchema>;

// --- Helpers ---------------------------------------------------------------

const genericTokens = new Set([
  "amount",
  "calculate",
  "came",
  "change",
  "considering",
  "contractual",
  "difference",
  "from",
  "future",
  "generated",
  "mathematical",
  "millions",
  "obligations",
  "payments",
  "percent",
  "percentage",
  "portion",
  "range",
  "revenue",
  "revenues",
  "share",
  "total",
  "under",
  "value",
  "what",
  "year",
]);

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function singularize(token: string): string {
  return token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeKey(value)
      .split("_")
      .map((token) => singularize(token))
      .filter((token) => token.length > 1 && !genericTokens.has(token)),
  );
}

function isTotalRow(row: Row): boolean {
  return (
    tokens(row.label).has("total") || normalizeKey(row.label).startsWith("total_")
  );
}

function scoreRow(row: Row, questionTokens: Set<string>): number {
  const rowTokens = tokens(row.label);
  let score = 0;
  for (const token of rowTokens) {
    if (questionTokens.has(token)) score += 1;
  }
  return score;
}

function inferOperation(question: string): Plan["operation"] {
  const q = question.toLowerCase();
  if (q.includes("range")) return "range";
  if (q.includes("change") || q.includes("difference")) return "difference";
  return "share";
}

function inferYears(question: string, filing: Filing): string[] {
  const q = question.toLowerCase();
  const headerKeys =
    filing.table.headerKeys ?? filing.table.headers.map(normalizeKey);

  const range = q.match(/\b(20\d{2})\s*[-–]\s*(20\d{2})\b/);
  if (range && range[1] && range[2]) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = start <= end ? 1 : -1;
    const years: string[] = [];
    for (
      let year = start;
      step > 0 ? year <= end : year >= end;
      year += step
    ) {
      years.push(String(year));
    }
    return years.filter((year) => headerKeys.includes(year));
  }

  const years = Array.from(new Set(q.match(/\b20\d{2}\b/g) ?? []));
  if (years.length > 0) {
    return years.filter((year) => headerKeys.includes(year));
  }

  const firstYear = headerKeys.find((key) => /^20\d{2}$/.test(key));
  if (!firstYear) {
    throw new Error(
      `inferTableMathPlan: no year columns found in ${filing.filename}`,
    );
  }
  return [firstYear];
}

function rankRows(question: string, filing: Filing): Array<{ row: Row; score: number }> {
  const questionTokens = tokens(question);
  return filing.table.rows
    .map((row) => ({ row, score: scoreRow(row, questionTokens) }))
    .sort((left, right) => right.score - left.score);
}

function bestNumeratorRow(
  question: string,
  filing: Filing,
  operation: Plan["operation"],
): Row {
  const scored = rankRows(question, filing).filter(
    (entry) => operation !== "share" || !isTotalRow(entry.row),
  );
  const best = scored[0];
  if (!best || best.score <= 0) {
    throw new Error(
      `inferTableMathPlan: could not infer table row for question: ${question}`,
    );
  }
  return best.row;
}

function bestDenominatorRow(
  question: string,
  filing: Filing,
  numerator: Row,
): Row {
  const questionTokens = tokens(question);
  const ranked = filing.table.rows
    .filter((row) => row.index !== numerator.index && isTotalRow(row))
    .map((row) => ({
      row,
      score:
        scoreRow(row, questionTokens) +
        (normalizeKey(row.label).includes("total") ? 3 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score <= 0) {
    throw new Error(
      `inferTableMathPlan: could not infer denominator row for question: ${question}`,
    );
  }
  return best.row;
}

const UNIT_RE =
  /\bin\s+(thousands|millions|billions)\b|\((amounts?\s+)?in\s+(thousands|millions|billions)\)|\b(thousands|millions|billions)\s+of\s+(dollars|usd)\b|\$\s+in\s+(thousands|millions|billions)\b/i;

function detectUnit(text: string): Plan["requestedUnit"] {
  const m = text.match(UNIT_RE);
  if (!m) return "raw";
  const found = (m[1] ?? m[3] ?? m[4] ?? m[6] ?? "").toLowerCase();
  if (found === "thousands" || found === "millions" || found === "billions") {
    return found;
  }
  return "raw";
}

function detectNativeUnit(filing: Filing): Plan["requestedUnit"] {
  for (const h of filing.table.headers) {
    const lower = (h ?? "").toLowerCase();
    const m = lower.match(/\b(thousands|millions|billions)\b/);
    if (m && m[1]) return m[1] as Plan["requestedUnit"];
  }
  const blob = `${filing.preText.join(" ")} ${filing.postText.join(" ")}`;
  return detectUnit(blob);
}

// --- Factory ---------------------------------------------------------------

export const inferTableMathPlan = fn<Input, Plan>({
  intent:
    "given a question and a filing, infer the table-math plan (operation, rows, years, units)",
  examples: [
    {
      input: {
        question: "what was the range of operating revenues 2014-2018?",
        filing: {
          filename: "AXP/2018/page_10.pdf",
          preText: ["Operating revenues are reported in millions."],
          postText: [],
          table: {
            headers: ["row", "2014", "2015", "2016", "2017", "2018"],
            headerKeys: ["row", "2014", "2015", "2016", "2017", "2018"],
            rows: [
              {
                index: 0,
                label: "operating revenues",
                labelKey: "operating_revenues",
                cells: [
                  { column: "row", raw: "operating revenues", value: null },
                  { column: "2014", raw: "34292", value: 34292 },
                  { column: "2015", raw: "32818", value: 32818 },
                  { column: "2016", raw: "32119", value: 32119 },
                  { column: "2017", raw: "33471", value: 33471 },
                  { column: "2018", raw: "37334", value: 37334 },
                ],
              },
            ],
          },
        },
      },
      output: {
        operation: "range",
        rowLabel: "operating revenues",
        years: ["2014", "2015", "2016", "2017", "2018"],
        requestedUnit: "raw",
        nativeUnit: "millions",
      },
    },
  ],
  input: InputSchema,
  output: PlanSchema,
  body: ({ question, filing }: Input) => {
    const operation = inferOperation(question);
    const years = inferYears(question, filing);
    const row = bestNumeratorRow(question, filing, operation);
    const denominator =
      operation === "share"
        ? bestDenominatorRow(question, filing, row)
        : undefined;
    const plan: Plan = {
      operation,
      rowLabel: row.label,
      years,
      requestedUnit: detectUnit(question),
      nativeUnit: detectNativeUnit(filing),
    };
    if (denominator) {
      plan.denominatorRowLabel = denominator.label;
    }
    return plan;
  },
});
