import { describe, expect, it } from "vitest";
import { loadRawFinqaDataset } from "../src/finqa/loadDataset.js";
import { normalizeFinqaCase, parseNumericCell } from "../src/finqa/normalize.js";

describe("FinQA normalization", () => {
  it("parses common financial numeric cells", () => {
    expect(parseNumericCell("$ 2457")).toBe(2457);
    expect(parseNumericCell("( 23158 )")).toBe(-23158);
    expect(parseNumericCell("50.3")).toBe(50.3);
  });

  it("normalizes the Visa payment table into row and column keys", async () => {
    const raw = await loadRawFinqaDataset({ dataset: "dev", filename: "V/2008/page_17.pdf" });
    const normalized = normalizeFinqaCase(raw[0]);
    const row = normalized.table.rows.find((candidate) => candidate.labelKey === "american_express");

    expect(normalized.filename).toBe("V/2008/page_17.pdf");
    expect(row?.cells.find((cell) => cell.columnKey === "payments_volume_billions")?.value).toBe(637);
    expect(row?.cells.find((cell) => cell.columnKey === "total_transactions_billions")?.value).toBe(5);
  });
});
