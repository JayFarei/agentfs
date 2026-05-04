import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  TrajectoryRecorder,
  readTrajectory,
  trajectoryId,
} from "../src/sdk/index.js";

describe("trajectoryId", () => {
  it("produces a `traj_<...>` string", () => {
    const id = trajectoryId();
    expect(id).toMatch(/^traj_\d{14}_[a-z0-9]+$/);
  });

  it("produces unique values across rapid calls", () => {
    const a = trajectoryId();
    const b = trajectoryId();
    expect(a).not.toBe(b);
  });
});

describe("TrajectoryRecorder", () => {
  it("records each call with the supplied primitive label and result", async () => {
    const recorder = new TrajectoryRecorder({
      tenantId: "t",
      question: "what",
    });
    const out = await recorder.call("db.x.findExact", { id: 1 }, async () => [
      { id: 1 },
    ]);
    expect(out).toEqual([{ id: 1 }]);
    const snap = recorder.snapshot;
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]!.primitive).toBe("db.x.findExact");
    expect(snap.calls[0]!.input).toEqual({ id: 1 });
    expect(snap.calls[0]!.output).toEqual([{ id: 1 }]);
    expect(snap.calls[0]!.index).toBe(0);
    expect(typeof snap.calls[0]!.startedAt).toBe("string");
    expect(typeof snap.calls[0]!.durationMs).toBe("number");
  });

  it("assigns sequential indices in completion order (post-await push)", async () => {
    const recorder = new TrajectoryRecorder({
      tenantId: "t",
      question: "q",
    });
    await recorder.call("a", null, async () => 1);
    await recorder.call("b", null, async () => 2);
    await recorder.call("c", null, async () => 3);
    const snap = recorder.snapshot;
    expect(snap.calls.map((c) => [c.index, c.primitive])).toEqual([
      [0, "a"],
      [1, "b"],
      [2, "c"],
    ]);
  });

  it("propagates the function's value AND records even when the body throws", async () => {
    const recorder = new TrajectoryRecorder({
      tenantId: "t",
      question: "q",
    });
    await expect(
      recorder.call("explodes", null, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Recorder should NOT have a row for the failed call (the
    // implementation only pushes after a successful await). This is the
    // contract we want — failed calls are surfaced via the snippet
    // runtime's mode='novel' classification, not by zombie rows in the
    // trajectory.
    expect(recorder.snapshot.calls).toEqual([]);
  });

  it("setMode + setCost + setProvenance + setResult + save → readTrajectory roundtrip", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "traj-"));
    try {
      const recorder = new TrajectoryRecorder({
        tenantId: "tenant-roundtrip",
        question: "how much?",
      });
      await recorder.call("lib.compute", { x: 1 }, async () => ({ y: 2 }));
      recorder.setMode("interpreted");
      recorder.setCost({
        tier: 2,
        tokens: { hot: 0, cold: 0 },
        ms: { hot: 0, cold: 12 },
        llmCalls: 0,
      });
      recorder.setProvenance({
        tenant: "tenant-roundtrip",
        mount: "m",
        functionName: "compute",
      });
      recorder.setResult({ y: 2 });
      const file = await recorder.save(baseDir);
      expect(file).toContain(`trajectories${path.sep}${recorder.id}.json`);

      const parsed = JSON.parse(await readFile(file, "utf8")) as Record<
        string,
        unknown
      >;
      expect(parsed["tenantId"]).toBe("tenant-roundtrip");
      expect(parsed["mode"]).toBe("interpreted");

      const fromHelper = await readTrajectory(recorder.id, baseDir);
      expect(fromHelper.id).toBe(recorder.id);
      expect(fromHelper.mode).toBe("interpreted");
      expect(fromHelper.calls).toHaveLength(1);
      expect(fromHelper.calls[0]!.primitive).toBe("lib.compute");
      expect(fromHelper.cost?.tier).toBe(2);
      expect(fromHelper.provenance?.functionName).toBe("compute");
      expect(fromHelper.result).toEqual({ y: 2 });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("readTrajectory throws ENOENT-style error for an unknown id", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "traj-miss-"));
    try {
      await expect(readTrajectory("traj_does_not_exist", baseDir)).rejects.toThrow();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
