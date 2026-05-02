import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { endorseTrajectory, loadLocalDemoCases, runQuery } from "../src/runner.js";

describe("local crystallization and replay", () => {
  it("saves a procedure from one trajectory and replays it for a sibling question", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-test-"));
    const cases = await loadLocalDemoCases();
    const backend = { kind: "local" as const, cases };

    const first = await runQuery({
      question: "what is the average payment volume per transaction for american express?",
      tenantId: "financial-analyst",
      backend,
      baseDir
    });

    expect(first.mode).toBe("novel");
    expect(first.roundedAnswer).toBe(127.4);
    expect(first.trajectoryId).toBeTruthy();
    expect(first.calls).toHaveLength(5);

    const endorsed = await endorseTrajectory({
      trajectoryIdOrPath: first.trajectoryId!,
      baseDir
    });
    const procedureJson = JSON.parse(await readFile(endorsed.jsonPath, "utf8")) as { name: string };
    expect(procedureJson.name).toBe("average_payment_volume_per_transaction");

    const replay = await runQuery({
      question: "what is the average payment volume per transaction for jcb?",
      tenantId: "financial-analyst",
      backend,
      baseDir
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("average_payment_volume_per_transaction");
    expect(replay.roundedAnswer).toBe(91.67);
    expect(replay.calls).toHaveLength(1);
  });
});
