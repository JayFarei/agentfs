import { describe, expect, it } from "vitest";
import { reviewDraft, runQuery } from "../src/runner.js";
import {
  artifactSnapshot,
  callNames,
  createEvolutionHarness,
  expectCleanEvolutionHome,
  expectOnlyArtifactDelta,
  readProcedureJson,
  readProcedureSource,
  readReviewEvents,
  readTrajectoryForRun
} from "./helpers/evolution.js";

describe("multi-turn review before crystallization", () => {
  it("lets the user confirm, specify an extra requirement, and commit a Flue-style generated procedure", async () => {
    const harness = await createEvolutionHarness("atlasfs-review-evolution-");
    await expectCleanEvolutionHome(harness.baseDir, harness.tenantId);
    const question = "what portion of revenue came from agricultural products?";
    const beforeQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);

    const first = await runQuery({
      question,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });

    expect(first.mode).toBe("novel");
    expect(first.roundedAnswer).toBe(18.18);
    expect(first.draftId).toBeTruthy();
    expect(first.review?.assumptions).toEqual([
      "No year was specified, so the draft uses 2016.",
      "Revenue denominator was ambiguous, so the draft uses total operating revenues."
    ]);
    expect(callNames(first)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_cases.runRevenueShare"
    ]);
    const afterQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeQuery, afterQuery, { trajectories: 1, drafts: 1 });
    const trajectory = await readTrajectoryForRun(harness.baseDir, first);
    expect(trajectory).toMatchObject({
      question,
      result: {
        answer: 18.178626949501027,
        roundedAnswer: 18.18
      }
    });

    const confirmed = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "confirm",
      message: "use 2016 and total operating revenues",
      baseDir: harness.baseDir
    });
    expect(confirmed.draft.status).toBe("awaiting_commit");
    const afterConfirm = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterQuery, afterConfirm, { reviewEvents: 1 });

    const specified = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "specify",
      message: "also include 2015 and show the change",
      backend: harness.backend,
      baseDir: harness.baseDir
    });
    expect(specified.draft.requirements.years).toEqual(["2016", "2015"]);
    expect(specified.draft.requirements.includeChange).toBe(true);
    expect(specified.draft.result.answer).toBe("2016: 18.18%; 2015: 16.42%; change: +1.76 pp");
    const afterSpecify = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterConfirm, afterSpecify, {});

    const committed = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "yes",
      backend: harness.backend,
      baseDir: harness.baseDir,
      observerRuntime: harness.observerRuntime
    });
    expect(committed.draft.status).toBe("committed");
    expect(committed.procedure?.jsonPath).toBeTruthy();
    expect(committed.procedure?.tsPath).toBeTruthy();
    const afterCommit = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterSpecify, afterCommit, { procedures: 2 });

    const events = await readReviewEvents<{ action: string; message?: string }>(harness.baseDir, first.draftId!);
    expect(events.map((event) => event.action)).toEqual(["confirm", "specify", "yes"]);

    const procedureJson = await readProcedureJson<{
      name: string;
      sourceTrajectoryId: string;
      matcher: { intent: string };
      params: { filename: string; segment: string; denominator: string; years: string[]; includeChange: boolean };
      implementation: { kind: string; functionName: string; observer: string };
    }>(harness.baseDir, harness.tenantId, "revenue_share");
    expect(procedureJson).toMatchObject({
      name: "revenue_share",
      sourceTrajectoryId: first.trajectoryId,
      matcher: {
        intent: "revenue_share"
      },
      params: {
        filename: "UNP/2016/page_52.pdf",
        segment: "agricultural products",
        denominator: "total operating revenues",
        years: ["2016", "2015"],
        includeChange: true
      },
      implementation: {
        kind: "ts_function",
        functionName: "reviewedRevenueShare",
        observer: "fixture"
      }
    });

    const source = await readProcedureSource(harness.baseDir, harness.tenantId, "revenue_share");
    expect(source).toContain("reviewedRevenueShare");

    const replay = await runQuery({
      question,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });
    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("revenue_share");
    expect(replay.answer).toBe("2016: 18.18%; 2015: 16.42%; change: +1.76 pp");
    expect(callNames(replay)).toEqual(["procedures.revenue_share"]);
    const afterReplay = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterCommit, afterReplay, {});
  });

  it("marks a refused draft as non-committable", async () => {
    const harness = await createEvolutionHarness("atlasfs-refuse-evolution-");
    await expectCleanEvolutionHome(harness.baseDir, harness.tenantId);
    const beforeQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);

    const first = await runQuery({
      question: "what portion of revenue came from agricultural products?",
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });
    const afterQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeQuery, afterQuery, { trajectories: 1, drafts: 1 });

    const refused = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "refuse",
      message: "wrong document",
      baseDir: harness.baseDir
    });
    expect(refused.draft.status).toBe("refused");
    const afterRefuse = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterQuery, afterRefuse, { reviewEvents: 1 });

    await expect(
      reviewDraft({
        draftIdOrPath: first.draftId!,
        action: "yes",
        backend: harness.backend,
        baseDir: harness.baseDir,
        observerRuntime: harness.observerRuntime
      })
    ).rejects.toThrow("was refused");
    const afterRejectedCommit = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterRefuse, afterRejectedCommit, {});
  });
});
