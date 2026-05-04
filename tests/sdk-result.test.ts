import { describe, expect, it } from "vitest";

import { costZero, makeResult } from "../src/sdk/index.js";

describe("costZero", () => {
  it("returns a tier=0 cost block by default", () => {
    expect(costZero()).toEqual({
      tier: 0,
      tokens: { hot: 0, cold: 0 },
      ms: { hot: 0, cold: 0 },
      llmCalls: 0,
    });
  });

  it("accepts a starting tier", () => {
    expect(costZero(2).tier).toBe(2);
    expect(costZero(4).tier).toBe(4);
  });

  it("returns a fresh object each call (mutation-safe accumulator)", () => {
    const a = costZero();
    const b = costZero();
    expect(a).not.toBe(b);
    a.llmCalls = 9;
    expect(b.llmCalls).toBe(0);
  });
});

describe("makeResult", () => {
  const provenance = {
    tenant: "t",
    mount: "m",
    trajectoryId: "tr",
    pins: {},
  };

  it("builds a Result with value + mode + provenance + defaults", () => {
    const r = makeResult({
      value: 42,
      mode: "interpreted",
      provenance,
    });
    expect(r).toEqual({
      value: 42,
      mode: "interpreted",
      cost: costZero(),
      provenance,
      escalations: 0,
    });
  });

  it("uses the supplied cost when present", () => {
    const cost = {
      tier: 3 as const,
      tokens: { hot: 0, cold: 100 },
      ms: { hot: 0, cold: 250 },
      llmCalls: 1,
    };
    const r = makeResult({
      value: { x: 1 },
      mode: "llm-backed",
      cost,
      provenance,
    });
    expect(r.cost).toBe(cost);
    expect(r.mode).toBe("llm-backed");
  });

  it("omits warnings field when none provided or empty array given", () => {
    const r1 = makeResult({ value: 1, mode: "novel", provenance });
    expect("warnings" in r1).toBe(false);

    const r2 = makeResult({
      value: 1,
      mode: "novel",
      provenance,
      warnings: [],
    });
    expect("warnings" in r2).toBe(false);
  });

  it("includes warnings when non-empty", () => {
    const r = makeResult({
      value: 1,
      mode: "novel",
      provenance,
      warnings: [{ code: "stale", message: "pin advanced" }],
    });
    expect(r.warnings).toEqual([{ code: "stale", message: "pin advanced" }]);
  });

  it("respects explicit escalations count", () => {
    const r = makeResult({
      value: 1,
      mode: "interpreted",
      provenance,
      escalations: 2,
    });
    expect(r.escalations).toBe(2);
  });
});
