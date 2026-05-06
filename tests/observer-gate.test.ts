import { describe, expect, it } from "vitest";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import { shouldCrystallise } from "../src/observer/gate.js";
import type { LibrarySnapshot } from "../src/observer/template.js";

const EMPTY_LIB: LibrarySnapshot = {
  shapeHashes: new Set<string>(),
};

function buildTrajectory(
  partial: Partial<TrajectoryRecord> & { calls: TrajectoryRecord["calls"] },
): TrajectoryRecord {
  return {
    id: partial.id ?? "traj_test",
    tenantId: partial.tenantId ?? "t",
    question: partial.question ?? "test",
    mode: partial.mode ?? "interpreted",
    calls: partial.calls,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    ...(partial.errored !== undefined ? { errored: partial.errored } : {}),
    ...(partial.cost !== undefined ? { cost: partial.cost } : {}),
    ...(partial.provenance !== undefined ? { provenance: partial.provenance } : {}),
    ...(partial.result !== undefined ? { result: partial.result } : {}),
    ...(partial.phase !== undefined ? { phase: partial.phase } : {}),
    ...(partial.crystallisable !== undefined ? { crystallisable: partial.crystallisable } : {}),
    ...(partial.sourcePath !== undefined ? { sourcePath: partial.sourcePath } : {}),
    ...(partial.artifactDir !== undefined ? { artifactDir: partial.artifactDir } : {}),
    ...(partial.answer !== undefined ? { answer: partial.answer } : {}),
    ...(partial.answerValidation !== undefined
      ? { answerValidation: partial.answerValidation }
      : {}),
  };
}

const VALID_CALLS: TrajectoryRecord["calls"] = [
  {
    index: 0,
    primitive: "db.cases.findSimilar",
    input: { query: "AAPL 2017 revenue", limit: 5 },
    output: [
      { filename: "AAPL/2017/page_42.pdf", question: "x", searchableText: "y" },
    ],
    startedAt: new Date().toISOString(),
    durationMs: 0,
  },
  {
    index: 1,
    primitive: "lib.pickFiling",
    input: {
      question: "AAPL 2017",
      candidates: [{ filename: "AAPL/2017/page_42.pdf" }],
    },
    output: { filename: "AAPL/2017/page_42.pdf" },
    startedAt: new Date().toISOString(),
    durationMs: 0,
  },
];

describe("shouldCrystallise", () => {
  it("approves a clean composition trajectory", () => {
    const traj = buildTrajectory({ calls: VALID_CALLS });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "fresh",
      existing: EMPTY_LIB,
    });
    expect(out).toEqual({ ok: true });
  });

  it("rejects trajectories with fewer than 2 calls", () => {
    const traj = buildTrajectory({ calls: [VALID_CALLS[0]!] });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "x",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("at least 2");
  });

  it("rejects when all calls share the same primitive", () => {
    const calls: TrajectoryRecord["calls"] = [
      { ...VALID_CALLS[0]!, index: 0 },
      { ...VALID_CALLS[0]!, index: 1 },
    ];
    const traj = buildTrajectory({ calls });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "x",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("distinct primitive");
  });

  it("approves mode='novel' trajectories (first-time successful composition)", () => {
    const traj = buildTrajectory({ calls: VALID_CALLS, mode: "novel" });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "fresh-novel",
      existing: EMPTY_LIB,
    });
    expect(out).toEqual({ ok: true });
  });

  it("rejects errored trajectories regardless of mode", () => {
    const traj = buildTrajectory({
      calls: VALID_CALLS,
      mode: "novel",
      errored: true,
    });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "x",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("errored");
  });

  it("rejects mode='llm-backed' (D-015: agent authors LLM-backed functions)", () => {
    const traj = buildTrajectory({ calls: VALID_CALLS, mode: "llm-backed" });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "x",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("composition pattern");
  });

  it("rejects plan-phase trajectories because only committed artifacts can crystallise", () => {
    const traj = buildTrajectory({
      calls: VALID_CALLS,
      mode: "novel",
      phase: "plan",
      crystallisable: false,
    });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "plan",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("committed");
  });

  it("approves commit-phase trajectories only after answer validation accepts", () => {
    const traj = buildTrajectory({
      calls: VALID_CALLS,
      mode: "novel",
      phase: "commit",
      crystallisable: true,
      answerValidation: { accepted: true },
    });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "commit",
      existing: EMPTY_LIB,
    });
    expect(out).toEqual({ ok: true });
  });

  it("rejects commit-phase trajectories when answer validation fails", () => {
    const traj = buildTrajectory({
      calls: VALID_CALLS,
      mode: "novel",
      phase: "commit",
      crystallisable: false,
      answerValidation: { accepted: false },
    });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "commit",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("validation");
  });

  it("rejects trajectories that already call a crystallised tool", () => {
    const calls: TrajectoryRecord["calls"] = [
      VALID_CALLS[0]!,
      {
        ...VALID_CALLS[1]!,
        primitive: "lib.crystallise_pickfiling_deadbeef",
      },
    ];
    const traj = buildTrajectory({ calls, mode: "interpreted" });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "nested",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("reuse evidence");
  });

  it("rejects when no db.* call present", () => {
    const calls: TrajectoryRecord["calls"] = [
      { ...VALID_CALLS[1]!, index: 0 },
      {
        ...VALID_CALLS[1]!,
        index: 1,
        primitive: "lib.locateFigure",
      },
    ];
    const traj = buildTrajectory({ calls });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "x",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("substrate-rooted");
  });

  it("rejects when first db.* call's output isn't a list", () => {
    const calls: TrajectoryRecord["calls"] = [
      { ...VALID_CALLS[0]!, output: { filename: "x" } },
      VALID_CALLS[1]!,
    ];
    const traj = buildTrajectory({ calls });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "x",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("did not return a list");
  });

  it("rejects when shape-hash already crystallised", () => {
    const traj = buildTrajectory({ calls: VALID_CALLS });
    const existing: LibrarySnapshot = {
      shapeHashes: new Set<string>(["fresh"]),
    };
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "fresh",
      existing,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("already crystallised");
  });

  it("rejects when a call output has an error key", () => {
    const calls: TrajectoryRecord["calls"] = [
      VALID_CALLS[0]!,
      {
        ...VALID_CALLS[1]!,
        output: { error: "could not pick" },
      },
    ];
    const traj = buildTrajectory({ calls });
    const out = shouldCrystallise({
      trajectory: traj,
      shapeHash: "x",
      existing: EMPTY_LIB,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("error");
  });
});
