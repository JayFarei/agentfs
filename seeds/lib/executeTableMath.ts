// executeTableMath — execute a TableMathPlan against a filing's table.
// Pure TS. Ported from
// `src/datafetch/db/finqa_table_math.ts:execute`.

import * as v from "valibot";

import { fn } from "../../src/sdk/index.js";

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
  table: v.object({
    headers: v.array(v.string()),
    headerKeys: v.optional(v.array(v.string())),
    rows: v.array(RowSchema),
  }),
});

type Filing = v.InferOutput<typeof FilingSchema>;
type Row = v.InferOutput<typeof RowSchema>;
type Cell = v.InferOutput<typeof CellSchema>;

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

const InputSchema = v.object({
  filing: FilingSchema,
  plan: PlanSchema,
});

type Input = v.InferOutput<typeof InputSchema>;

const EvidenceSchema = v.object({
  caseId: v.optional(v.string()),
  filename: v.string(),
  rowLabel: v.string(),
  denominatorRowLabel: v.optional(v.string()),
  year: v.string(),
  value: v.number(),
  denominator: v.optional(v.number()),
});

const OutputSchema = v.object({
  answer: v.number(),
  roundedAnswer: v.number(),
  operation: OperationSchema,
  evidence: v.array(EvidenceSchema),
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

function unitScale(unit: Plan["requestedUnit"]): number {
  switch (unit) {
    case "thousands":
      return 1_000;
    case "millions":
      return 1_000_000;
    case "billions":
      return 1_000_000_000;
    case "raw":
      return 1;
  }
}

function convertUnits(
  rawAnswer: number,
  nativeUnit: Plan["requestedUnit"],
  requestedUnit: Plan["requestedUnit"],
): number {
  if (requestedUnit === "raw" || nativeUnit === "raw") return rawAnswer;
  if (requestedUnit === nativeUnit) return rawAnswer;
  return rawAnswer * (unitScale(nativeUnit) / unitScale(requestedUnit));
}

function findRowByLabel(filing: Filing, label: string): Row {
  const key = normalizeKey(label);
  const row = filing.table.rows.find(
    (candidate) =>
      candidate.labelKey === key || normalizeKey(candidate.label) === key,
  );
  if (!row) {
    throw new Error(
      `executeTableMath: no row found for ${label} in ${filing.filename}`,
    );
  }
  return row;
}

function valuesForYears(
  filing: Filing,
  row: Row,
  years: string[],
): Array<{ year: string; row: Row; cell: Cell & { value: number } }> {
  return years.map((year) => {
    const yearKey = normalizeKey(year);
    const cell = row.cells.find((candidate) => candidate.columnKey === yearKey);
    if (!cell || cell.value == null) {
      throw new Error(
        `executeTableMath: no numeric value found for ${row.label} / ${year} in ${filing.filename}`,
      );
    }
    return { year, row, cell: { ...cell, value: cell.value as number } };
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildResult(
  filing: Filing,
  plan: Plan,
  answer: number,
  values: Array<{
    year: string;
    row: Row;
    cell: Cell & { value: number };
    denominator?: number;
  }>,
): Output {
  const roundedAnswer = round2(answer);
  return {
    answer,
    roundedAnswer,
    operation: plan.operation,
    evidence: values.map((value) => {
      const ev: Output["evidence"][number] = {
        filename: filing.filename,
        rowLabel: value.row.label,
        year: value.year,
        value: value.cell.value,
      };
      if (filing.id !== undefined) ev.caseId = filing.id;
      if (plan.denominatorRowLabel !== undefined) {
        ev.denominatorRowLabel = plan.denominatorRowLabel;
      }
      if (value.denominator !== undefined) ev.denominator = value.denominator;
      return ev;
    }),
  };
}

// --- Factory ---------------------------------------------------------------

export const executeTableMath = fn<Input, Output>({
  intent: "execute a table-math plan against a filing's table",
  examples: [
    {
      input: {
        filing: {
          filename: "AXP/2018/page_10.pdf",
          table: {
            headers: ["row", "2014", "2018"],
            headerKeys: ["row", "2014", "2018"],
            rows: [
              {
                index: 0,
                label: "operating revenues",
                labelKey: "operating_revenues",
                cells: [
                  { column: "row", raw: "operating revenues", value: null },
                  { column: "2014", raw: "34292", value: 34292 },
                  { column: "2018", raw: "37334", value: 37334 },
                ],
              },
            ],
          },
        },
        plan: {
          operation: "range",
          rowLabel: "operating revenues",
          years: ["2014", "2018"],
          requestedUnit: "raw",
          nativeUnit: "millions",
        },
      },
      output: {
        answer: 3042,
        roundedAnswer: 3042,
        operation: "range",
        evidence: [
          {
            filename: "AXP/2018/page_10.pdf",
            rowLabel: "operating revenues",
            year: "2014",
            value: 34292,
          },
          {
            filename: "AXP/2018/page_10.pdf",
            rowLabel: "operating revenues",
            year: "2018",
            value: 37334,
          },
        ],
      },
    },
  ],
  input: InputSchema,
  output: OutputSchema,
  body: ({ filing, plan }: Input) => {
    const row = findRowByLabel(filing, plan.rowLabel);
    const values = valuesForYears(filing, row, plan.years);

    if (plan.operation === "range") {
      const numbers = values.map((value) => value.cell.value);
      const raw = Math.max(...numbers) - Math.min(...numbers);
      const answer = convertUnits(raw, plan.nativeUnit, plan.requestedUnit);
      return buildResult(filing, plan, answer, values);
    }

    if (plan.operation === "difference") {
      if (values.length < 2) {
        throw new Error(
          `executeTableMath: difference requires at least two year values in ${filing.filename}`,
        );
      }
      const last = values[values.length - 1]!;
      const first = values[0]!;
      const raw = last.cell.value - first.cell.value;
      const answer = convertUnits(raw, plan.nativeUnit, plan.requestedUnit);
      return buildResult(filing, plan, answer, values);
    }

    if (!plan.denominatorRowLabel) {
      throw new Error(
        `executeTableMath: share operation requires a denominator row in ${filing.filename}`,
      );
    }
    const denominatorRow = findRowByLabel(filing, plan.denominatorRowLabel);
    const denominators = valuesForYears(filing, denominatorRow, plan.years);
    const numerator = values.reduce(
      (sum, value) => sum + value.cell.value,
      0,
    );
    const denominatorTotal = denominators.reduce(
      (sum, value) => sum + value.cell.value,
      0,
    );
    if (denominatorTotal === 0) {
      throw new Error(
        `executeTableMath: share denominator is zero in ${filing.filename}`,
      );
    }
    return buildResult(
      filing,
      plan,
      (numerator / denominatorTotal) * 100,
      values.map((value, index) => {
        const denomVal = denominators[index]?.cell.value;
        return denomVal !== undefined
          ? { ...value, denominator: denomVal }
          : value;
      }),
    );
  },
});
