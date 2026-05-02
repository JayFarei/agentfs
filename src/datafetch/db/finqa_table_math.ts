import type { FinqaCase, FinqaCell, FinqaRow } from "../../finqa/types.js";
import { normalizeKey } from "../../finqa/normalize.js";

export type TableMathOperation = "difference" | "range" | "share";

export type TableMathPlan = {
  operation: TableMathOperation;
  rowLabel: string;
  denominatorRowLabel?: string;
  years: string[];
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
    years
  };
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
    const answer = Math.max(...numbers) - Math.min(...numbers);
    return result(filing, plan, answer, values);
  }

  if (plan.operation === "difference") {
    if (values.length < 2) {
      throw new Error(`Difference requires at least two year values in ${filing.filename}`);
    }
    const answer = values[values.length - 1].cell.value - values[0].cell.value;
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
