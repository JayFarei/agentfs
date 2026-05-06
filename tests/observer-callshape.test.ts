import { describe, expect, it } from "vitest";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import { extractTemplate } from "../src/observer/template.js";

const ISO = new Date().toISOString();

function buildTrajectory(calls: TrajectoryRecord["calls"]): TrajectoryRecord {
  return {
    id: "traj_callshape",
    tenantId: "t",
    question: "test",
    mode: "novel",
    calls,
    createdAt: ISO,
  };
}

describe("extractTemplate db call shape", () => {
  it("recognises query-only db retrieval inputs as positional calls", () => {
    const similar = extractTemplate(
      buildTrajectory([
        {
          index: 0,
          primitive: "db.finqaCases.findSimilar",
          input: { query: "coal revenue" },
          output: [{ filename: "UNP/2016/page_52.pdf" }],
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );
    expect(similar.steps[0]!.callShape).toBe("positional-query-limit");

    const search = extractTemplate(
      buildTrajectory([
        {
          index: 0,
          primitive: "db.finqaCases.search",
          input: { query: "coal revenue" },
          output: [{ filename: "UNP/2016/page_52.pdf" }],
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );
    expect(search.steps[0]!.callShape).toBe("positional-query-opts");
  });
});
