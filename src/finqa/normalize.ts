import type { FinqaCase, FinqaSearchUnit, RawFinqaRecord } from "./types.js";

export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function parseNumericCell(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-" || trimmed === "--") {
    return null;
  }

  const negative = /^\(.*\)$/.test(trimmed) || /^-\s*/.test(trimmed);
  const cleaned = trimmed
    .replace(/[,$%]/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return negative ? -Math.abs(parsed) : parsed;
}

export function normalizeFinqaCase(raw: RawFinqaRecord): FinqaCase {
  const [headerRow = [], ...bodyRows] = raw.table;
  const headers = headerRow.map((cell) => String(cell ?? "").trim());
  const headerKeys = headers.map(normalizeKey);

  const rows = bodyRows.map((row, rowIndex) => {
    const label = String(row[0] ?? "").trim();
    return {
      index: rowIndex,
      label,
      labelKey: normalizeKey(label),
      cells: headers.map((column, index) => ({
        column,
        columnKey: headerKeys[index] ?? `column_${index}`,
        raw: String(row[index] ?? "").trim(),
        value: parseNumericCell(String(row[index] ?? ""))
      }))
    };
  });

  const preText = raw.pre_text ?? [];
  const postText = raw.post_text ?? [];
  const flatTable = raw.table.map((row) => row.join(" | ")).join("\n");

  return {
    id: raw.id,
    filename: raw.filename,
    question: raw.qa.question,
    answer: raw.qa.answer,
    program: raw.qa.program,
    preText,
    postText,
    table: {
      headers,
      headerKeys,
      rows
    },
    searchableText: [
      raw.id,
      raw.filename,
      raw.qa.question,
      raw.qa.program ?? "",
      ...preText,
      ...postText,
      flatTable
    ]
      .filter(Boolean)
      .join("\n")
  };
}

export function buildSearchUnits(finqaCase: FinqaCase): FinqaSearchUnit[] {
  const units: FinqaSearchUnit[] = [
    {
      caseId: finqaCase.id,
      filename: finqaCase.filename,
      kind: "question",
      text: finqaCase.question
    }
  ];

  for (const text of [...finqaCase.preText, ...finqaCase.postText]) {
    if (text.trim()) {
      units.push({
        caseId: finqaCase.id,
        filename: finqaCase.filename,
        kind: "text",
        text
      });
    }
  }

  for (const row of finqaCase.table.rows) {
    units.push({
      caseId: finqaCase.id,
      filename: finqaCase.filename,
      kind: "table_row",
      rowIndex: row.index,
      text: `${row.label}: ${row.cells.map((cell) => `${cell.column}=${cell.raw}`).join("; ")}`
    });
  }

  return units;
}
