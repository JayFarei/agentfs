import { describe, expect, it } from "vitest";
import { endorseTrajectory, runQuery } from "../src/runner.js";
import {
  artifactSnapshot,
  callNames,
  createEvolutionHarness,
  expectCleanEvolutionHome,
  expectOnlyArtifactDelta,
  readProcedureJson,
  readTrajectoryForRun
} from "./helpers/evolution.js";

describe("local crystallization and replay", () => {
  it("evolves from a clean query into a reusable average-payment-volume procedure", async () => {
    const harness = await createEvolutionHarness("atlasfs-average-evolution-");
    await expectCleanEvolutionHome(harness.baseDir, harness.tenantId);
    const query = "what is the average payment volume per transaction for american express?";
    const beforeQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);

    const first = await runQuery({
      question: query,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });

    expect(first.mode).toBe("novel");
    expect(first.roundedAnswer).toBe(127.4);
    expect(first.trajectoryId).toBeTruthy();
    expect(callNames(first)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_resolve.locateFigure",
      "finqa_resolve.locateFigure",
      "arithmetic.divide"
    ]);

    const afterQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeQuery, afterQuery, { trajectories: 1 });
    const trajectory = await readTrajectoryForRun(harness.baseDir, first);
    expect(trajectory).toMatchObject({
      tenantId: harness.tenantId,
      question: query,
      result: {
        roundedAnswer: 127.4
      }
    });

    const endorsed = await endorseTrajectory({
      trajectoryIdOrPath: first.trajectoryId!,
      baseDir: harness.baseDir
    });
    expect(endorsed.jsonPath).toContain("average_payment_volume_per_transaction.json");
    expect(endorsed.tsPath).toContain("average_payment_volume_per_transaction.ts");
    const afterEndorse = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterQuery, afterEndorse, { procedures: 2 });

    const procedureJson = await readProcedureJson<{
      name: string;
      tenantId: string;
      sourceTrajectoryId: string;
      matcher: { intent: string; examples: string[] };
      params: { filename: string };
      implementation: { kind: string; collection: string; pipelineTemplate: unknown[] };
    }>(harness.baseDir, harness.tenantId, "average_payment_volume_per_transaction");
    expect(procedureJson).toMatchObject({
      name: "average_payment_volume_per_transaction",
      tenantId: harness.tenantId,
      sourceTrajectoryId: first.trajectoryId,
      matcher: {
        intent: "average_payment_volume_per_transaction",
        examples: [query]
      },
      params: {
        filename: "V/2008/page_17.pdf"
      },
      implementation: {
        kind: "atlas_aggregation_template",
        collection: "finqa_cases"
      }
    });
    expect(procedureJson.implementation.pipelineTemplate).toEqual(
      expect.arrayContaining([expect.objectContaining({ $comment: "source filename: V/2008/page_17.pdf" })])
    );

    const replay = await runQuery({
      question: "what is the average payment volume per transaction for jcb?",
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("average_payment_volume_per_transaction");
    expect(replay.roundedAnswer).toBe(91.67);
    expect(callNames(replay)).toEqual(["procedures.average_payment_volume_per_transaction"]);
    const afterReplay = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterEndorse, afterReplay, {});
  });
});
