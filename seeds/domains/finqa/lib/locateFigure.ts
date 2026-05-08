// locateFigure — locate a numeric cell in a filing's table given a textual
// question. Pure TS body; ported from
// `src/datafetch/db/finqa_resolve.ts:locateFigure`.

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
  // `id` may be missing on synthesised entries; the evidence record keeps
  // it optional rather than failing schema validation outright.
  id: v.optional(v.string()),
  filename: v.string(),
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
  role: v.optional(v.union([v.literal("numerator"), v.literal("denominator")])),
  columnHint: v.optional(v.string()),
  rowLabel: v.optional(v.string()),
});

type Input = v.InferOutput<typeof InputSchema>;

const OutputSchema = v.object({
  rowLabel: v.string(),
  rowKey: v.string(),
  column: v.string(),
  columnKey: v.string(),
  raw: v.string(),
  value: v.number(),
  evidence: v.object({
    caseId: v.optional(v.string()),
    filename: v.string(),
    rowIndex: v.number(),
  }),
});

type Output = v.InferOutput<typeof OutputSchema>;

// --- Helpers ---------------------------------------------------------------

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

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

function inferCompanyKey(question: string, filing: Filing): string | null {
  const questionKey = normalizeKey(question);
  const exact = filing.table.rows.find(
    (row: Row) => row.labelKey != null && questionKey.includes(row.labelKey),
  );
  if (exact && exact.labelKey) {
    return exact.labelKey;
  }

  const ranked = filing.table.rows
    .map((row: Row) => ({ row, score: tokenOverlap(question, row.label) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top || top.score === 0) return null;
  return top.row.labelKey ?? normalizeKey(top.row.label);
}

function inferColumnKey(args: {
  role?: "numerator" | "denominator";
  columnHint?: string;
  question: string;
}): string {
  if (args.columnHint) {
    return normalizeKey(args.columnHint);
  }

  const questionKey = normalizeKey(args.question);
  if (args.role === "numerator" && questionKey.includes("payment_volume")) {
    return "payments_volume_billions";
  }
  if (args.role === "denominator" && questionKey.includes("per_transaction")) {
    return "total_transactions_billions";
  }

  // Final fallback: pick the first 4-digit-year token in the question
  // (raw or normalised form). `\b` doesn't fire around `_`, so we scan
  // the original question text — `2017` and `_2017_` both surface.
  const yearMatch = args.question.match(/\b(19|20)\d{2}\b/);
  if (yearMatch && yearMatch[0]) return yearMatch[0];

  throw new Error(
    `locateFigure: cannot infer column for role ${args.role ?? "unknown"}`,
  );
}

// --- Factory ---------------------------------------------------------------

export const locateFigure = fn<Input, Output>({
  intent:
    "locate a numeric cell in a filing's table given a textual question, optional role, optional column hint, optional row label",
  examples: [
    {
      input: {
        question: "operating revenues 2017",
        filing: {
          filename: "V/2017/page_42.pdf",
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
      output: {
        rowLabel: "operating revenues",
        rowKey: "operating_revenues",
        column: "2017",
        columnKey: "2017",
        raw: "18358",
        value: 18358,
        evidence: {
          filename: "V/2017/page_42.pdf",
          rowIndex: 0,
        },
      },
    },
  ],
  input: InputSchema,
  output: OutputSchema,
  body: (args: Input) => {
    const rowKey = args.rowLabel
      ? normalizeKey(args.rowLabel)
      : inferCompanyKey(args.question, args.filing);
    if (!rowKey) {
      throw new Error(
        `locateFigure: could not infer row from question: ${args.question}`,
      );
    }

    const row = args.filing.table.rows.find(
      (candidate: Row) => candidate.labelKey === rowKey,
    );
    if (!row) {
      throw new Error(
        `locateFigure: could not find row ${rowKey} in ${args.filing.filename}`,
      );
    }

    const columnKey = inferColumnKey({
      question: args.question,
      ...(args.role !== undefined ? { role: args.role } : {}),
      ...(args.columnHint !== undefined ? { columnHint: args.columnHint } : {}),
    });
    const cell = row.cells.find(
      (candidate) => candidate.columnKey === columnKey,
    );
    if (!cell || cell.value === null) {
      throw new Error(
        `locateFigure: could not find numeric cell ${columnKey} in row ${row.label}`,
      );
    }

    const evidence: Output["evidence"] = {
      filename: args.filing.filename,
      rowIndex: row.index,
    };
    if (args.filing.id !== undefined) {
      evidence.caseId = args.filing.id;
    }

    return {
      rowLabel: row.label,
      rowKey: row.labelKey ?? rowKey,
      column: cell.column,
      columnKey: cell.columnKey ?? columnKey,
      raw: cell.raw,
      value: cell.value,
      evidence,
    };
  },
});
