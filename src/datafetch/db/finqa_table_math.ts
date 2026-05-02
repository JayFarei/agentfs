import type { FinqaCase, FinqaCell, FinqaRow } from "../../finqa/types.js";
import { normalizeKey } from "../../finqa/normalize.js";

export type TableMathOperation = "difference" | "range" | "share";

export type TableMathUnit = "raw" | "thousands" | "millions" | "billions";

export type TableMathPlan = {
  operation: TableMathOperation;
  rowLabel: string;
  denominatorRowLabel?: string;
  years: string[];
  /** unit the user asked the answer in (or "raw" if none asked) */
  requestedUnit: TableMathUnit;
  /** unit the underlying table is reported in, detected from filing pre/post text */
  nativeUnit: TableMathUnit;
};

export type TableMathResult = {
  answer: number | string;
  roundedAnswer: number;
  operation: TableMathOperation;
  evidence: Array<{
    caseId: string;
    filename: string;
    rowLabel: string;
    denominatorRowLabel?: string;
    year: string;
    value: number;
    denominator?: number;
  }>;
};

type ScoredRow = {
  row: FinqaRow;
  score: number;
};

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
  "year"
]);

export const finqa_table_math = {
  inferPlan(args: { question: string; filing: FinqaCase }): TableMathPlan {
    return inferTableMathPlan(args.question, args.filing);
  },

  execute(args: { filing: FinqaCase; plan: TableMathPlan }): TableMathResult {
    return executeTableMath(args.filing, args.plan);
  }
};

export function isTableMathQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(range|change|difference)\b/.test(q) ||
    ((q.includes("percentage") || q.includes("percent") || q.includes("portion") || q.includes("share")) &&
      /\b20\d{2}\b/.test(q))
  );
}

function inferTableMathPlan(question: string, filing: FinqaCase): TableMathPlan {
  const operation = inferOperation(question);
  const years = inferYears(question, filing);
  const row = bestNumeratorRow(question, filing, operation);
  const denominator = operation === "share" ? bestDenominatorRow(question, filing, row) : undefined;
  return {
    operation,
    rowLabel: row.label,
    denominatorRowLabel: denominator?.label,
    years,
    requestedUnit: detectUnit(question),
    nativeUnit: detectNativeUnit(filing)
  };
}

const UNIT_RE =
  /\bin\s+(thousands|millions|billions)\b|\((amounts?\s+)?in\s+(thousands|millions|billions)\)|\b(thousands|millions|billions)\s+of\s+(dollars|usd)\b|\$\s+in\s+(thousands|millions|billions)\b/i;

function detectUnit(text: string): TableMathUnit {
  const m = text.match(UNIT_RE);
  if (!m) return "raw";
  const found = (m[1] ?? m[3] ?? m[4] ?? m[6] ?? "").toLowerCase();
  if (found === "thousands" || found === "millions" || found === "billions") return found;
  return "raw";
}

function detectNativeUnit(filing: FinqaCase): TableMathUnit {
  // Strongest signal: a column header is literally "millions" / "thousands" / "billions"
  for (const h of filing.table.headers ?? []) {
    const lower = (h ?? "").toLowerCase();
    const m = lower.match(/\b(thousands|millions|billions)\b/);
    if (m) return m[1] as TableMathUnit;
  }
  // Fallback: scan filing prose for unit phrases
  const blob = `${filing.preText.join(" ")} ${filing.postText.join(" ")}`;
  return detectUnit(blob);
}

function unitScale(unit: TableMathUnit): number {
  switch (unit) {
    case "thousands": return 1_000;
    case "millions":  return 1_000_000;
    case "billions":  return 1_000_000_000;
    case "raw":       return 1;
  }
}

function convertUnits(
  rawAnswer: number,
  nativeUnit: TableMathUnit,
  requestedUnit: TableMathUnit
): number {
  // Share / percentage answers are already unit-free; never rescale them.
  // (Caller passes operation === "share" through this fn unchanged.)
  if (requestedUnit === "raw" || nativeUnit === "raw") return rawAnswer;
  if (requestedUnit === nativeUnit) return rawAnswer;
  return rawAnswer * (unitScale(nativeUnit) / unitScale(requestedUnit));
}

function inferOperation(question: string): TableMathOperation {
  const q = question.toLowerCase();
  if (q.includes("range")) {
    return "range";
  }
  if (q.includes("change") || q.includes("difference")) {
    return "difference";
  }
  return "share";
}

function inferYears(question: string, filing: FinqaCase): string[] {
  const q = question.toLowerCase();
  const range = q.match(/\b(20\d{2})\s*[-\u2013]\s*(20\d{2})\b/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = start <= end ? 1 : -1;
    const years: string[] = [];
    for (let year = start; step > 0 ? year <= end : year >= end; year += step) {
      years.push(String(year));
    }
    return years.filter((year) => filing.table.headerKeys.includes(year));
  }

  const years = Array.from(new Set(q.match(/\b20\d{2}\b/g) ?? []));
  if (years.length > 0) {
    return years.filter((year) => filing.table.headerKeys.includes(year));
  }

  const firstYear = filing.table.headerKeys.find((key) => /^20\d{2}$/.test(key));
  if (!firstYear) {
    throw new Error(`No year columns found in ${filing.filename}`);
  }
  return [firstYear];
}

function executeTableMath(filing: FinqaCase, plan: TableMathPlan): TableMathResult {
  const row = findRowByLabel(filing, plan.rowLabel);
  const values = valuesForYears(filing, row, plan.years);

  if (plan.operation === "range") {
    const numbers = values.map((value) => value.cell.value);
    const raw = Math.max(...numbers) - Math.min(...numbers);
    const answer = convertUnits(raw, plan.nativeUnit, plan.requestedUnit);
    return result(filing, plan, answer, values);
  }

  if (plan.operation === "difference") {
    if (values.length < 2) {
      throw new Error(`Difference requires at least two year values in ${filing.filename}`);
    }
    const raw = values[values.length - 1].cell.value - values[0].cell.value;
    const answer = convertUnits(raw, plan.nativeUnit, plan.requestedUnit);
    return result(filing, plan, answer, values);
  }

  if (!plan.denominatorRowLabel) {
    throw new Error(`Share operation requires a denominator row in ${filing.filename}`);
  }
  const denominatorRow = findRowByLabel(filing, plan.denominatorRowLabel);
  const denominators = valuesForYears(filing, denominatorRow, plan.years);
  const numerator = values.reduce((sum, value) => sum + value.cell.value, 0);
  const denominator = denominators.reduce((sum, value) => sum + value.cell.value, 0);
  if (denominator === 0) {
    throw new Error(`Share denominator is zero in ${filing.filename}`);
  }
  return result(
    filing,
    plan,
    (numerator / denominator) * 100,
    values.map((value, index) => ({
      ...value,
      denominator: denominators[index]?.cell.value
    }))
  );
}

function result(
  filing: FinqaCase,
  plan: TableMathPlan,
  answer: number,
  values: Array<{ year: string; row: FinqaRow; cell: FinqaCell; denominator?: number }>
): TableMathResult {
  const roundedAnswer = round2(answer);
  return {
    answer,
    roundedAnswer,
    operation: plan.operation,
    evidence: values.map((value) => ({
      caseId: filing.id,
      filename: filing.filename,
      rowLabel: value.row.label,
      denominatorRowLabel: plan.denominatorRowLabel,
      year: value.year,
      value: value.cell.value as number,
      denominator: value.denominator
    }))
  };
}

function bestNumeratorRow(question: string, filing: FinqaCase, operation: TableMathOperation): FinqaRow {
  const scored = rankRows(question, filing).filter((entry) => operation !== "share" || !isTotalRow(entry.row));
  const best = scored[0];
  if (!best || best.score <= 0) {
    throw new Error(`Could not infer table row for question: ${question}`);
  }
  return best.row;
}

function bestDenominatorRow(question: string, filing: FinqaCase, numerator: FinqaRow): FinqaRow {
  const questionTokens = tokens(question);
  const ranked = filing.table.rows
    .filter((row) => row.index !== numerator.index && isTotalRow(row))
    .map((row) => ({
      row,
      score: scoreRow(row, questionTokens) + (normalizeKey(row.label).includes("total") ? 3 : 0)
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score <= 0) {
    throw new Error(`Could not infer denominator row for question: ${question}`);
  }
  return best.row;
}

function rankRows(question: string, filing: FinqaCase): ScoredRow[] {
  const questionTokens = tokens(question);
  return filing.table.rows
    .map((row) => ({
      row,
      score: scoreRow(row, questionTokens)
    }))
    .sort((left, right) => right.score - left.score);
}

function scoreRow(row: FinqaRow, questionTokens: Set<string>): number {
  const rowTokens = tokens(row.label);
  let score = 0;
  for (const token of rowTokens) {
    if (questionTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeKey(value)
      .split("_")
      .map((token) => singularize(token))
      .filter((token) => token.length > 1 && !genericTokens.has(token))
  );
}

function singularize(token: string): string {
  return token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function isTotalRow(row: FinqaRow): boolean {
  return tokens(row.label).has("total") || normalizeKey(row.label).startsWith("total_");
}

function findRowByLabel(filing: FinqaCase, label: string): FinqaRow {
  const key = normalizeKey(label);
  const row = filing.table.rows.find((candidate) => candidate.labelKey === key || normalizeKey(candidate.label) === key);
  if (!row) {
    throw new Error(`No row found for ${label} in ${filing.filename}`);
  }
  return row;
}

function valuesForYears(filing: FinqaCase, row: FinqaRow, years: string[]) {
  return years.map((year) => {
    const yearKey = normalizeKey(year);
    const cell = row.cells.find((candidate) => candidate.columnKey === yearKey);
    if (!cell || cell.value == null) {
      throw new Error(`No numeric value found for ${row.label} / ${year} in ${filing.filename}`);
    }
    return { year, row, cell: cell as FinqaCell & { value: number } };
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
