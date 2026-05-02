import { describe, expect, it } from "vitest";
import { createFinqaCasesPrimitive } from "../src/datafetch/db/finqa_cases.js";
import { finqa_resolve } from "../src/datafetch/db/finqa_resolve.js";
import { arithmetic } from "../src/datafetch/db/arithmetic.js";
import { loadLocalDemoCases } from "../src/runner.js";

describe("typed primitive toolbox", () => {
  it("composes retrieval, resolution, and arithmetic for the American Express example", async () => {
    const cases = await loadLocalDemoCases();
    const finqa_cases = createFinqaCasesPrimitive({ kind: "local", cases });
    const question = "what is the average payment volume per transaction for american express?";

    const candidates = await finqa_cases.findSimilar(question, 10);
    const filing = await finqa_resolve.pickFiling({ question, candidates });
    const numerator = await finqa_resolve.locateFigure({ question, filing, role: "numerator" });
    const denominator = await finqa_resolve.locateFigure({ question, filing, role: "denominator" });
    const answer = arithmetic.divide(numerator.value, denominator.value);

    expect(filing.filename).toBe("V/2008/page_17.pdf");
    expect(numerator.value).toBe(637);
    expect(denominator.value).toBe(5);
    expect(arithmetic.round(answer, 2)).toBe(127.4);
  });
});
