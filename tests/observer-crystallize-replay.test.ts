import { describe, expect, it } from "vitest";
import { endorseTrajectory, runQuery } from "../src/runner.js";
import {
  artifactSnapshot,
  callNames,
  createEvolutionHarness,
  expectCleanEvolutionHome,
  expectOnlyArtifactDelta,
  readProcedureJson,
  readProcedureSource,
  readTrajectoryForRun
} from "./helpers/evolution.js";

describe("observer-derived procedure crystallization", () => {
  it("codifies an LLM-needed table manipulation step and replays the generated function", async () => {
    const harness = await createEvolutionHarness("atlasfs-observer-evolution-");
    await expectCleanEvolutionHome(harness.baseDir, harness.tenantId);
    const question = "which network has the highest average payment volume per transaction?";
    const beforeQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);

    const first = await runQuery({
      question,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir,
      observerRuntime: harness.observerRuntime
    });

    expect(first.mode).toBe("novel");
    expect(first.roundedAnswer).toBe(145);
    expect(callNames(first)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_observe.codifyTableFunction",
      "finqa_observe.executeCodifiedFunction"
    ]);
    const afterQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeQuery, afterQuery, { trajectories: 1 });
    const trajectory = await readTrajectoryForRun(harness.baseDir, first);
    expect(trajectory).toMatchObject({
      question,
      result: {
        roundedAnswer: 145,
        label: "diners club"
      }
    });

    const endorsed = await endorseTrajectory({
      trajectoryIdOrPath: first.trajectoryId!,
      baseDir: harness.baseDir
    });
    const afterEndorse = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterQuery, afterEndorse, { procedures: 2 });
    expect(endorsed.jsonPath).toContain("largest_average_payment_volume_per_transaction.json");

    const procedureJson = await readProcedureJson<{
      name: string;
      sourceTrajectoryId: string;
      matcher: { intent: string; examples: string[] };
      params: { filename: string };
      implementation: { kind: string; functionName: string; observer: string; source: string };
    }>(harness.baseDir, harness.tenantId, "largest_average_payment_volume_per_transaction");
    expect(procedureJson).toMatchObject({
      name: "largest_average_payment_volume_per_transaction",
      sourceTrajectoryId: first.trajectoryId,
      matcher: {
        intent: "largest_average_payment_volume_per_transaction",
        examples: [question]
      },
      params: {
        filename: "V/2008/page_17.pdf"
      },
      implementation: {
        kind: "ts_function",
        functionName: "largestAveragePaymentVolumePerTransaction",
        observer: "fixture"
      }
    });

    const source = await readProcedureSource(
      harness.baseDir,
      harness.tenantId,
      "largest_average_payment_volume_per_transaction"
    );
    expect(source).toContain("largestAveragePaymentVolumePerTransaction");

    const replay = await runQuery({
      question,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("largest_average_payment_volume_per_transaction");
    expect(replay.roundedAnswer).toBe(145);
    expect(callNames(replay)).toEqual(["procedures.largest_average_payment_volume_per_transaction"]);
    const afterReplay = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterEndorse, afterReplay, {});
  });
});
