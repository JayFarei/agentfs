import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAtlasClient } from "../src/datafetch/db/client.js";
import { loadFinqaToAtlas } from "../src/loader/loadFinqaToAtlas.js";
import { setupAtlasSearch } from "../src/loader/setupAtlasSearch.js";
import { runQuery, type RunnerBackend } from "../src/runner.js";
import { callNames, testTenantId } from "./helpers/evolution.js";

const liveDescribe = process.env.RUN_ATLAS_TESTS === "1" ? describe : describe.skip;

function pickedFilename(result: { calls: unknown[] }): string | undefined {
  const pick = result.calls.find(
    (call): call is { primitive: string; output: { filename?: string } } =>
      typeof call === "object" &&
      call !== null &&
      "primitive" in call &&
      (call as { primitive?: unknown }).primitive === "finqa_resolve.pickFiling"
  );
  return pick?.output.filename;
}

liveDescribe("MongoDB Atlas Search generalization probes", () => {
  const backend: RunnerBackend = { kind: "atlas" };

  beforeAll(async () => {
    await loadFinqaToAtlas({ dataset: "test", filename: "UNP/2016/page_52.pdf" });
    await loadFinqaToAtlas({ dataset: "dev", filename: "KIM/2014/page_130.pdf" });
    await loadFinqaToAtlas({ dataset: "test", filename: "IP/2009/page_45.pdf" });
    await setupAtlasSearch({ wait: true, timeoutMs: 180_000 });
  }, 240_000);

  afterAll(async () => {
    await closeAtlasClient();
  });

  it("grounds multi-token target phrases before executing a revenue share", async () => {
    const result = await runQuery({
      question: "what percentage of Union Pacific freight revenue came from coal in 2016?",
      tenantId: testTenantId,
      backend,
      baseDir: await mkdtemp(path.join(os.tmpdir(), "atlasfs-generalization-unp-"))
    });

    expect(pickedFilename(result)).toBe("UNP/2016/page_52.pdf");
    expect(result.roundedAnswer).toBe(13.12);
    expect(callNames(result)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_cases.runRevenueShare"
    ]);
  }, 60_000);

  it("uses generic table execution for a mathematical range query", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-generalization-range-"));
    const result = await runQuery({
      question: "what is the mathematical range for chemical revenue from 2014-2016, in millions?",
      tenantId: testTenantId,
      backend,
      baseDir
    });

    expect(pickedFilename(result)).toBe("UNP/2016/page_52.pdf");
    expect(result.roundedAnswer).toBe(190);
    expect(callNames(result)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_table_math.inferPlan",
      "finqa_table_math.execute",
      "procedure_store.save"
    ]);

    const replay = await runQuery({
      question: "what is the mathematical range for coal revenue from 2014-2016, in millions?",
      tenantId: testTenantId,
      backend,
      baseDir
    });
    expect(replay.mode).toBe("procedure");
    expect(replay.roundedAnswer).toBe(1687);
    expect(callNames(replay)).toEqual(["procedures.table_math"]);
  }, 60_000);

  it("uses generic table execution for a row-over-total percentage query", async () => {
    const result = await runQuery({
      question:
        "what percentage of contractual obligations for future payments under existing debt and lease commitments and purchase obligations at december 31, 2009 due in 2011 are maturities of long-term debt?",
      tenantId: testTenantId,
      backend,
      baseDir: await mkdtemp(path.join(os.tmpdir(), "atlasfs-generalization-share-"))
    });

    expect(pickedFilename(result)).toBe("IP/2009/page_45.pdf");
    expect(result.roundedAnswer).toBe(40.8);
    expect(callNames(result)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_table_math.inferPlan",
      "finqa_table_math.execute",
      "procedure_store.save"
    ]);
  }, 60_000);
});
