import { describe, expect, it } from "vitest";

import { pickFiling } from "../seeds/domains/finqa/lib/pickFiling.js";

function row(label: string, values: Record<string, number>) {
  return {
    index: 0,
    label,
    labelKey: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    cells: [
      { column: "millions", columnKey: "millions", raw: label, value: null },
      ...Object.entries(values).map(([year, value]) => ({
        column: year,
        columnKey: year,
        raw: String(value),
        value,
      })),
    ],
  };
}

describe("FinQA seed pickFiling", () => {
  it("prefers a candidate whose own question matches over a distractor row label", async () => {
    const question = "What is the range of chemicals revenue between 2014 and 2016?";
    const result = await pickFiling({
      question,
      candidates: [
        {
          filename: "UNP/2016/page_52.pdf",
          question:
            "what is the mathematical range for chemical revenue from 2014-2016, in millions?",
          searchableText:
            "Union Pacific chemical revenue 2014 2016 subtract(3664, 3474)",
          table: {
            headers: ["millions", "2016", "2015", "2014"],
            headerKeys: ["millions", "2016", "2015", "2014"],
            rows: [
              row("chemicals", { "2016": 3474, "2015": 3543, "2014": 3664 }),
            ],
          },
        },
        {
          filename: "ETR/2016/page_24.pdf",
          question:
            "was the tax benefit from the stipulated settlement greater than the change in revenue between years?",
          searchableText:
            "chemicals industry 2014 net revenue 2015 net revenue amount in millions",
          table: {
            headers: ["", "amount (in millions)"],
            headerKeys: ["", "amount_in_millions"],
            rows: [
              row("2014 net revenue", { "amount (in millions)": 2224 }),
              row("2015 net revenue", { "amount (in millions)": 1666 }),
            ],
          },
        },
      ],
    });

    expect(result.value.filename).toBe("UNP/2016/page_52.pdf");
  });
});
