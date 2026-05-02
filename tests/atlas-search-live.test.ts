import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixtureObserverRuntime } from "../src/datafetch/db/finqa_observe.js";
import { FixtureOutlookAgentRuntime } from "../src/datafetch/db/finqa_outlook.js";
import { closeAtlasClient } from "../src/datafetch/db/client.js";
import { loadFinqaToAtlas } from "../src/loader/loadFinqaToAtlas.js";
import { setupAtlasSearch } from "../src/loader/setupAtlasSearch.js";
import { reviewDraft, runQuery, type RunnerBackend } from "../src/runner.js";
import {
  artifactSnapshot,
  callNames,
  expectCleanEvolutionHome,
  expectOnlyArtifactDelta,
  readAgentJson,
  readProcedureJson,
  testTenantId
} from "./helpers/evolution.js";

const liveDescribe = process.env.RUN_ATLAS_TESTS === "1" ? describe : describe.skip;

liveDescribe("MongoDB Atlas Search-backed evolution", () => {
  const backend: RunnerBackend = { kind: "atlas" };
  const observerRuntime = new FixtureObserverRuntime();
  const outlookAgentRuntime = new FixtureOutlookAgentRuntime();

  beforeAll(async () => {
    await loadFinqaToAtlas({ dataset: "dev", filename: "V/2008/page_17.pdf" });
    await loadFinqaToAtlas({ dataset: "private_test", filename: "UNP/2016/page_52.pdf" });
    await loadFinqaToAtlas({ dataset: "train", filename: "V/2012/page_28.pdf" });
    await setupAtlasSearch({ wait: true, timeoutMs: 180_000 });
  }, 240_000);

  afterAll(async () => {
    await closeAtlasClient();
  });

  it("answers the average-payment query through Atlas-backed search", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-live-average-"));
    await expectCleanEvolutionHome(baseDir, testTenantId);
    const beforeQuery = await artifactSnapshot(baseDir, testTenantId);

    const result = await runQuery({
      question: "what is the average payment volume per transaction for american express?",
      tenantId: testTenantId,
      backend,
      baseDir
    });

    expect(result.mode).toBe("novel");
    expect(result.roundedAnswer).toBe(127.4);
    expect(callNames(result)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_resolve.locateFigure",
      "finqa_resolve.locateFigure",
      "arithmetic.divide"
    ]);
    const afterQuery = await artifactSnapshot(baseDir, testTenantId);
    expectOnlyArtifactDelta(beforeQuery, afterQuery, { trajectories: 1 });
  }, 60_000);

  it("runs multi-turn revenue review against Atlas data", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-live-review-"));
    await expectCleanEvolutionHome(baseDir, testTenantId);

    const first = await runQuery({
      question: "what portion of revenue came from agricultural products?",
      tenantId: testTenantId,
      backend,
      baseDir
    });
    expect(first.mode).toBe("novel");
    expect(first.roundedAnswer).toBe(18.18);
    expect(first.draftId).toBeTruthy();

    await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "specify",
      message: "also include 2015 and show the change",
      backend,
      baseDir
    });
    const committed = await reviewDraft({
      draftIdOrPath: first.draftId!,
      action: "yes",
      backend,
      baseDir,
      observerRuntime
    });

    expect(committed.draft.status).toBe("committed");
    const procedure = await readProcedureJson<{
      matcher: { intent: string };
      implementation: { kind: string; functionName: string };
      params: { filename: string; years: string[]; includeChange: boolean };
    }>(baseDir, testTenantId, "revenue_share");
    expect(procedure).toMatchObject({
      matcher: { intent: "revenue_share" },
      implementation: {
        kind: "ts_function",
        functionName: "reviewedRevenueShare"
      },
      params: {
        filename: "UNP/2016/page_52.pdf",
        years: ["2016", "2015"],
        includeChange: true
      }
    });

    const replay = await runQuery({
      question: "what portion of revenue came from agricultural products?",
      tenantId: testTenantId,
      backend,
      baseDir
    });
    expect(replay.mode).toBe("procedure");
    expect(replay.answer).toBe("2016: 18.18%; 2015: 16.42%; change: +1.76 pp");
    expect(callNames(replay)).toEqual(["procedures.revenue_share"]);
  }, 90_000);

  it("recreates the reusable negative-outlook agent loop over Atlas data", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-live-outlook-"));
    await expectCleanEvolutionHome(baseDir, testTenantId);

    const sentenceIntent = await runQuery({
      question: "Find the negative competitive outlook references about Visa, count them, and show evidence sentences.",
      tenantId: testTenantId,
      backend,
      baseDir,
      observerRuntime,
      outlookAgentRuntime
    });

    expect(sentenceIntent.mode).toBe("novel");
    expect(sentenceIntent.answer).toBe("4 negative competitive outlook sentence references");
    expect(callNames(sentenceIntent)).toContain("finqa_outlook.createOutlookScorerAgentSpec");
    expect(callNames(sentenceIntent)).toContain("procedure_store.save");

    const titleIntent = await runQuery({
      question: "Find the negative competitive outlook references about Visa, but only from titles or quotes.",
      tenantId: testTenantId,
      backend,
      baseDir,
      observerRuntime,
      outlookAgentRuntime
    });

    expect(titleIntent.mode).toBe("novel");
    expect(titleIntent.answer).toBe("1 negative competitive outlook title or quote references");
    expect(callNames(titleIntent)).toContain("agent_store.findReusable");
    expect(callNames(titleIntent)).not.toContain("finqa_outlook.createOutlookScorerAgentSpec");

    const agent = await readAgentJson<{ capability: string; agentName: string }>(
      baseDir,
      testTenantId,
      "negativeOutlookReferenceScorerAgent"
    );
    expect(agent).toMatchObject({
      agentName: "negativeOutlookReferenceScorerAgent",
      capability: "negative_outlook_reference_scoring"
    });

    const replay = await runQuery({
      question: "Find the negative competitive outlook references about Visa, but only from titles or quotes.",
      tenantId: testTenantId,
      backend,
      baseDir,
      outlookAgentRuntime
    });
    expect(replay.mode).toBe("procedure");
    expect(callNames(replay)).toEqual(["procedures.negative_outlook_title_or_quote_references"]);
  }, 120_000);
});
