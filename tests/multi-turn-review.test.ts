import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FixtureObserverRuntime } from "../src/datafetch/db/finqa_observe.js";
import { loadLocalDemoCases, reviewDraft, runQuery } from "../src/runner.js";

describe("multi-turn review before crystallization", () => {
  it("lets the user confirm, specify an extra requirement, and commit a Flue-style generated procedure", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-review-test-"));
    const cases = await loadLocalDemoCases();
    const backend = { kind: "local" as const, cases };

    const first = await runQuery({
      question: "what portion of revenue came from agricultural products?",
      tenantId: "financial-analyst",
      backend,
      baseDir
    });

    expect(first.mode).toBe("novel");
    expect(first.roundedAnswer).toBe(18.18);
    expect(first.draftId).toBeTruthy();
    expect(first.review?.assumptions).toEqual([
      "No year was specified, so the draft uses 2016.",
      "Revenue denominator was ambiguous, so the draft uses total operating revenues."
    ]);
    expect(first.calls.map((call) => (call as { primitive: string }).primitive)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_cases.runRevenueShare"
    ]);

    const confirmed = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "confirm",
      message: "use 2016 and total operating revenues",
      baseDir
    });
    expect(confirmed.draft.status).toBe("awaiting_commit");

    const specified = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "specify",
      message: "also include 2015 and show the change",
      backend,
      baseDir
    });
    expect(specified.draft.requirements.years).toEqual(["2016", "2015"]);
    expect(specified.draft.requirements.includeChange).toBe(true);
    expect(specified.draft.result.answer).toBe("2016: 18.18%; 2015: 16.42%; change: +1.76 pp");

    const committed = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "yes",
      backend,
      baseDir,
      observerRuntime: new FixtureObserverRuntime()
    });
    expect(committed.draft.status).toBe("committed");
    expect(committed.procedure?.jsonPath).toBeTruthy();
    expect(committed.procedure?.tsPath).toBeTruthy();

    const procedureJson = JSON.parse(await readFile(committed.procedure!.jsonPath, "utf8")) as {
      matcher: { intent: string };
      implementation: { kind: string; observer: string };
    };
    expect(procedureJson.matcher.intent).toBe("revenue_share");
    expect(procedureJson.implementation.kind).toBe("ts_function");
    expect(procedureJson.implementation.observer).toBe("fixture");

    const source = await readFile(committed.procedure!.tsPath, "utf8");
    expect(source).toContain("reviewedRevenueShare");

    const replay = await runQuery({
      question: "what portion of revenue came from agricultural products?",
      tenantId: "financial-analyst",
      backend,
      baseDir
    });
    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("revenue_share");
    expect(replay.answer).toBe("2016: 18.18%; 2015: 16.42%; change: +1.76 pp");
    expect(replay.calls).toHaveLength(1);
  });

  it("marks a refused draft as non-committable", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-refuse-test-"));
    const cases = await loadLocalDemoCases();
    const backend = { kind: "local" as const, cases };

    const first = await runQuery({
      question: "what portion of revenue came from agricultural products?",
      tenantId: "financial-analyst",
      backend,
      baseDir
    });

    const refused = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "refuse",
      message: "wrong document",
      baseDir
    });
    expect(refused.draft.status).toBe("refused");

    await expect(
      reviewDraft({
        draftIdOrPath: first.draftId!,
        action: "yes",
        backend,
        baseDir,
        observerRuntime: new FixtureObserverRuntime()
      })
    ).rejects.toThrow("was refused");
  });
});
