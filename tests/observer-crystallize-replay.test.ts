import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FixtureObserverRuntime } from "../src/datafetch/db/finqa_observe.js";
import { endorseTrajectory, loadLocalDemoCases, runQuery } from "../src/runner.js";

describe("observer-derived procedure crystallization", () => {
  it("codifies an LLM-needed table manipulation step and replays the generated function", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-observer-test-"));
    const cases = await loadLocalDemoCases();
    const backend = { kind: "local" as const, cases };
    const question = "which network has the highest average payment volume per transaction?";

    const first = await runQuery({
      question,
      tenantId: "financial-analyst",
      backend,
      baseDir,
      observerRuntime: new FixtureObserverRuntime()
    });

    expect(first.mode).toBe("novel");
    expect(first.roundedAnswer).toBe(145);
    expect(first.calls).toHaveLength(4);
    expect(first.calls.map((call) => (call as { primitive: string }).primitive)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_observe.codifyTableFunction",
      "finqa_observe.executeCodifiedFunction"
    ]);

    const endorsed = await endorseTrajectory({
      trajectoryIdOrPath: first.trajectoryId!,
      baseDir
    });
    const source = await readFile(endorsed.tsPath, "utf8");
    expect(source).toContain("largestAveragePaymentVolumePerTransaction");

    const replay = await runQuery({
      question,
      tenantId: "financial-analyst",
      backend,
      baseDir
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("largest_average_payment_volume_per_transaction");
    expect(replay.roundedAnswer).toBe(145);
    expect(replay.calls).toHaveLength(1);
  });
});
