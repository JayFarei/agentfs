import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import { authorFunction } from "../src/observer/author.js";
import { extractTemplate } from "../src/observer/template.js";
import type { LibraryResolver } from "../src/sdk/index.js";

const ISO = new Date().toISOString();

function buildIntentTrajectory(): TrajectoryRecord {
  const picked = {
    filename: "UNP/2016/page_52.pdf",
    question: "what is the mathematical range for chemical revenue",
  };
  const other = {
    filename: "UNP/2017/page_12.pdf",
    question: "unrelated filing",
  };
  const plan = { operation: "range", years: [2014, 2016] };

  return {
    id: "traj_intent_shape",
    tenantId: "acme",
    question: "What is the range of chemicals revenue from 2014-2016?",
    mode: "novel",
    createdAt: ISO,
    calls: [
      {
        index: 0,
        primitive: "db.finqaCases.search",
        input: { query: "range chemicals revenue 2014", opts: { limit: 5 } },
        output: [picked, other],
        startedAt: ISO,
        durationMs: 0,
      },
      {
        index: 1,
        primitive: "lib.inferTableMathPlan",
        input: {
          question: "What is the range of chemicals revenue from 2014-2016?",
          filing: picked,
        },
        output: plan,
        startedAt: ISO,
        durationMs: 0,
      },
      {
        index: 2,
        primitive: "lib.executeTableMath",
        input: { filing: picked, plan },
        output: { roundedAnswer: 190 },
        startedAt: ISO,
        durationMs: 0,
      },
    ],
  };
}

describe("authorFunction", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-author-"));
  });

  afterEach(async () => {
    delete (globalThis as { df?: unknown }).df;
    await rm(baseDir, { recursive: true, force: true });
  });

  it("authors intent-shaped wrappers that can be called without intermediate filing input", async () => {
    const trajectory = buildIntentTrajectory();
    const template = extractTemplate(trajectory);
    const resolver: LibraryResolver = {
      resolve: async () => (() => Promise.resolve(null)) as never,
      list: async () => [],
    };

    const authored = await authorFunction({
      tenantId: "acme",
      baseDir,
      trajectory,
      template,
      libraryResolver: resolver,
    });

    expect(authored.kind).toBe("authored");
    if (authored.kind !== "authored") return;
    expect(authored.source).not.toContain("input.filing");
    expect(authored.source).not.toContain('"filing": {');
    expect(authored.source).toContain("filing: out0[0]");
  });
});
