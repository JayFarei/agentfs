// Quality-heuristic check on the df.answer() envelope.
//
// Ports SkillCraft's LOW_QUALITY_VALUES scan to the answer envelope.
// Soft warning only — doesn't block the answer. Surfaces as
// `qualityWarnings` on the envelope (and as stderr lines when the
// snippet runtime emits them on rehearsal).

import { describe, expect, it } from "vitest";
import { makeAnswerEnvelope } from "../src/snippet/answer.js";

describe("answer quality heuristic", () => {
  it("does not flag a clean answer", () => {
    const env = makeAnswerEnvelope({
      status: "answered",
      value: { city: "Paris", population: 2_148_000, country: "France" },
    });
    expect(env.qualityWarnings).toBeUndefined();
  });

  it("flags mostly-placeholder strings", () => {
    const env = makeAnswerEnvelope({
      status: "answered",
      value: {
        city: "Unknown",
        country: "Unknown",
        region: "N/A",
        population: 100, // one real value
      },
    });
    expect(env.qualityWarnings).toBeDefined();
    expect(env.qualityWarnings![0]!.code).toBe("low_quality_output");
    expect(env.qualityWarnings![0]!.placeholderFields).toBeGreaterThanOrEqual(3);
  });

  it("flags numeric zero stuffing", () => {
    const env = makeAnswerEnvelope({
      status: "answered",
      value: {
        rating: 0,
        votes: 0,
        episodes: 0,
        title: "Something",
      },
    });
    expect(env.qualityWarnings).toBeDefined();
    expect(env.qualityWarnings![0]!.zeroNumericFields).toBeGreaterThanOrEqual(3);
  });

  it("does not flag a single zero among real values", () => {
    const env = makeAnswerEnvelope({
      status: "answered",
      value: {
        name: "Charizard",
        baseExperience: 0, // legitimately zero or unknown — but only one
        types: ["fire", "flying"],
        height: 17,
      },
    });
    expect(env.qualityWarnings).toBeUndefined();
  });

  it("flags arrays with empty contents as placeholder", () => {
    const env = makeAnswerEnvelope({
      status: "answered",
      value: {
        breed: "Persian",
        relatives: [],
        traits: [],
        country: "",
      },
    });
    expect(env.qualityWarnings).toBeDefined();
  });

  it("walks nested objects", () => {
    const env = makeAnswerEnvelope({
      status: "answered",
      value: {
        meta: { source: "Unknown", confidence: 0 },
        result: { name: "Unknown", score: 0, tier: "N/A" },
      },
    });
    expect(env.qualityWarnings).toBeDefined();
  });

  it("returns no warning when value is undefined", () => {
    const env = makeAnswerEnvelope({
      status: "unsupported",
      reason: "no data found",
    });
    expect(env.qualityWarnings).toBeUndefined();
  });

  it("collects up to 5 examples", () => {
    const env = makeAnswerEnvelope({
      status: "answered",
      value: {
        a: "Unknown",
        b: "None",
        c: "N/A",
        d: "",
        e: null,
        f: 0,
        g: "real",
      },
    });
    expect(env.qualityWarnings).toBeDefined();
    expect(env.qualityWarnings![0]!.examples.length).toBeLessThanOrEqual(5);
    expect(env.qualityWarnings![0]!.examples.length).toBeGreaterThan(0);
  });
});
