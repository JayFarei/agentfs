import { describe, expect, it } from "vitest";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import { extractTemplate } from "../src/observer/template.js";

const ISO = new Date().toISOString();

function buildTrajectory(calls: TrajectoryRecord["calls"]): TrajectoryRecord {
  return {
    id: "traj_derived_bindings",
    tenantId: "t",
    question: "test",
    mode: "novel",
    calls,
    createdAt: ISO,
  };
}

describe("extractTemplate derived bindings", () => {
  it("keeps filtered candidate arrays internal by binding them to retrieval output", () => {
    const picked = { id: "picked", filename: "UNP/2016/page_52.pdf" };
    const other = { id: "other", filename: "UNP/2017/page_12.pdf" };
    const tpl = extractTemplate(
      buildTrajectory([
        {
          index: 0,
          primitive: "db.finqaCases.search",
          input: { query: "chemical revenue", opts: { limit: 50 } },
          output: [picked, other],
          startedAt: ISO,
          durationMs: 0,
        },
        {
          index: 1,
          primitive: "lib.pickFiling",
          input: {
            question: "chemical revenue",
            candidates: [picked],
          },
          output: picked,
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );

    expect(tpl.parameters.map((p) => p.name)).not.toContain("candidates");
    expect(tpl.steps[1]!.inputBindings["candidates"]).toEqual({
      kind: "ref",
      ref: "out0",
    });
  });

  it("prefers the latest selected output over an earlier retrieval subtree", () => {
    const picked = { id: "picked", filename: "UNP/2016/page_52.pdf" };
    const other = { id: "other", filename: "UNP/2017/page_12.pdf" };
    const plan = { operation: "range", rowLabel: "chemicals" };
    const tpl = extractTemplate(
      buildTrajectory([
        {
          index: 0,
          primitive: "db.finqaCases.search",
          input: { query: "chemical revenue", opts: { limit: 50 } },
          output: [picked, other],
          startedAt: ISO,
          durationMs: 0,
        },
        {
          index: 1,
          primitive: "lib.pickFiling",
          input: {
            question: "chemical revenue",
            candidates: [picked],
          },
          output: picked,
          startedAt: ISO,
          durationMs: 0,
        },
        {
          index: 2,
          primitive: "lib.inferTableMathPlan",
          input: {
            question: "chemical revenue",
            filing: picked,
          },
          output: plan,
          startedAt: ISO,
          durationMs: 0,
        },
        {
          index: 3,
          primitive: "lib.executeTableMath",
          input: {
            filing: picked,
            plan,
          },
          output: { answer: 190 },
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );

    expect(tpl.steps[2]!.inputBindings["filing"]).toEqual({
      kind: "ref",
      ref: "out1",
    });
    expect(tpl.steps[3]!.inputBindings["filing"]).toEqual({
      kind: "ref",
      ref: "out1",
    });
    expect(tpl.steps[3]!.inputBindings["plan"]).toEqual({
      kind: "ref",
      ref: "out2",
    });
  });
});
