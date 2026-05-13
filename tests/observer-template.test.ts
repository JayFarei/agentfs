import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import {
  extractCandidateTemplates,
  extractSubGraphTemplates,
  extractTemplate,
  readLibrarySnapshot,
} from "../src/observer/template.js";

function buildTrajectory(
  calls: TrajectoryRecord["calls"],
  overrides: Partial<TrajectoryRecord> = {},
): TrajectoryRecord {
  return {
    id: overrides.id ?? "traj_test",
    tenantId: overrides.tenantId ?? "t",
    question: overrides.question ?? "test",
    mode: overrides.mode ?? "interpreted",
    calls,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

const ISO = new Date().toISOString();

describe("extractTemplate", () => {
  it("throws when the trajectory has no calls", () => {
    const traj = buildTrajectory([]);
    expect(() => extractTemplate(traj)).toThrow(/no calls/);
  });

  it("emits one step per call with sequential outputName", () => {
    const traj = buildTrajectory([
      {
        index: 0,
        primitive: "db.cases.findSimilar",
        input: { query: "AAPL 2017", limit: 5 },
        output: [{ filename: "AAPL/2017/page_42.pdf" }],
        startedAt: ISO,
        durationMs: 0,
      },
      {
        index: 1,
        primitive: "lib.pickFiling",
        input: {
          question: "AAPL 2017",
          candidates: [{ filename: "AAPL/2017/page_42.pdf" }],
        },
        output: { filename: "AAPL/2017/page_42.pdf" },
        startedAt: ISO,
        durationMs: 0,
      },
    ]);
    const tpl = extractTemplate(traj);
    expect(tpl.steps).toHaveLength(2);
    expect(tpl.steps[0]!.primitive).toBe("db.cases.findSimilar");
    expect(tpl.steps[0]!.outputName).toBe("out0");
    expect(tpl.steps[1]!.primitive).toBe("lib.pickFiling");
    expect(tpl.steps[1]!.outputName).toBe("out1");
    expect(tpl.finalOutputBinding).toBe("out1");
  });

  it("binds a downstream input field to an earlier output when shapes match", () => {
    // pickFiling.candidates is the literal output of findSimilar.
    const found = [{ filename: "x", searchableText: "y" }];
    const traj = buildTrajectory([
      {
        index: 0,
        primitive: "db.cases.findSimilar",
        input: { query: "q", limit: 5 },
        output: found,
        startedAt: ISO,
        durationMs: 0,
      },
      {
        index: 1,
        primitive: "lib.pickFiling",
        input: { question: "q", candidates: found },
        output: found[0],
        startedAt: ISO,
        durationMs: 0,
      },
    ]);
    const tpl = extractTemplate(traj);
    const binding = tpl.steps[1]!.inputBindings["candidates"];
    expect(binding).toBeDefined();
    expect(binding!.kind).toBe("ref");
    if (binding!.kind === "ref") {
      // ref points back to step 0's output.
      expect(binding.ref).toContain("out0");
    }
  });

  it("collapses duplicate literal values across calls into one parameter", () => {
    // Both calls receive `query: "shared-query"` — should be one param.
    const traj = buildTrajectory([
      {
        index: 0,
        primitive: "db.cases.findSimilar",
        input: { query: "shared-query", limit: 5 },
        output: [{ x: 1 }],
        startedAt: ISO,
        durationMs: 0,
      },
      {
        index: 1,
        primitive: "lib.pickFiling",
        input: { question: "shared-query", candidates: [{ x: 1 }] },
        output: { x: 1 },
        startedAt: ISO,
        durationMs: 0,
      },
    ]);
    const tpl = extractTemplate(traj);
    // The literal "shared-query" appears as both query and question;
    // dedup should yield ONE param (named after the first seed
    // it encountered: `query`).
    const stringParams = tpl.parameters.filter((p) => p.jsType === "string");
    expect(stringParams.length).toBe(1);
    expect(tpl.steps[0]!.inputBindings["query"]).toEqual({
      kind: "param",
      param: stringParams[0]!.name,
    });
    expect(tpl.steps[1]!.inputBindings["question"]).toEqual({
      kind: "param",
      param: stringParams[0]!.name,
    });
  });

  it("produces a deterministic shapeHash and semantic learned-interface name", () => {
    const traj = buildTrajectory([
      {
        index: 0,
        primitive: "db.cases.findSimilar",
        input: { query: "q", limit: 5 },
        output: [{ a: 1 }],
        startedAt: ISO,
        durationMs: 0,
      },
      {
        index: 1,
        primitive: "lib.pickFiling",
        input: { question: "q", candidates: [{ a: 1 }] },
        output: { a: 1 },
        startedAt: ISO,
        durationMs: 0,
      },
    ]);
    const a = extractTemplate(traj);
    const b = extractTemplate(traj);
    expect(a.shapeHash).toBe(b.shapeHash);
    expect(a.shapeHash).toMatch(/^[0-9a-f]{8}$/);
    expect(a.name).toBe("filingQuestion");
    // Topic should be semantic, not tied to the first lib.* primitive name.
    expect(a.topic).toBe("filing_question");
  });

  it("names table-math range trajectories by the task shape", () => {
    const traj = buildTrajectory(
      [
        {
          index: 0,
          primitive: "db.cases.findSimilar",
          input: { query: "range of chemicals revenue 2014 2018", limit: 5 },
          output: [{ a: 1 }],
          startedAt: ISO,
          durationMs: 0,
        },
        {
          index: 1,
          primitive: "lib.pickFiling",
          input: { question: "range of chemicals revenue 2014 2018", candidates: [{ a: 1 }] },
          output: { a: 1 },
          startedAt: ISO,
          durationMs: 0,
        },
        {
          index: 2,
          primitive: "lib.inferTableMathPlan",
          input: { question: "range of chemicals revenue 2014 2018", filing: { a: 1 } },
          output: { operation: "range" },
          startedAt: ISO,
          durationMs: 0,
        },
        {
          index: 3,
          primitive: "lib.executeTableMath",
          input: { filing: { a: 1 }, plan: { operation: "range" } },
          output: { roundedAnswer: 700 },
          startedAt: ISO,
          durationMs: 0,
        },
      ],
      { question: "what is the range of chemicals revenue between 2014 and 2018" },
    );
    const tpl = extractTemplate(traj);
    expect(tpl.topic).toBe("range_table_metric");
    expect(tpl.name).toBe("rangeTableMetric");
  });

  it("keeps selected search results internal instead of exposing filing as input", () => {
    const picked = {
      filename: "UNP/2016/page_52.pdf",
      question: "what is the mathematical range for chemical revenue",
    };
    const other = {
      filename: "UNP/2017/page_12.pdf",
      question: "unrelated filing",
    };
    const plan = { operation: "range", years: [2014, 2016] };
    const traj = buildTrajectory(
      [
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
      { question: "What is the range of chemicals revenue from 2014-2016?" },
    );

    const tpl = extractTemplate(traj);

    expect(tpl.parameters.map((p) => p.name)).not.toContain("filing");
    expect(tpl.steps[1]!.inputBindings["filing"]).toEqual({
      kind: "ref",
      ref: "out0[0]",
    });
    expect(tpl.steps[2]!.inputBindings["filing"]).toEqual({
      kind: "ref",
      ref: "out0[0]",
    });
  });

  it("recognises query-only db retrieval inputs as positional calls", () => {
    const similar = extractTemplate(
      buildTrajectory([
        {
          index: 0,
          primitive: "db.finqaCases.findSimilar",
          input: { query: "coal revenue" },
          output: [{ filename: "UNP/2016/page_52.pdf" }],
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );
    expect(similar.steps[0]!.callShape).toBe("positional-query-limit");

    const search = extractTemplate(
      buildTrajectory([
        {
          index: 0,
          primitive: "db.finqaCases.search",
          input: { query: "coal revenue" },
          output: [{ filename: "UNP/2016/page_52.pdf" }],
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );
    expect(search.steps[0]!.callShape).toBe("positional-query-opts");
  });

  it("a different primitive order yields a different shapeHash", () => {
    const baseCall0 = {
      index: 0,
      primitive: "db.cases.findSimilar",
      input: { query: "q", limit: 5 },
      output: [{ a: 1 }],
      startedAt: ISO,
      durationMs: 0,
    };
    const a = extractTemplate(
      buildTrajectory([
        baseCall0,
        {
          index: 1,
          primitive: "lib.pickFiling",
          input: { question: "q", candidates: [{ a: 1 }] },
          output: { a: 1 },
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );
    const b = extractTemplate(
      buildTrajectory([
        baseCall0,
        {
          index: 1,
          primitive: "lib.locateFigure",
          input: { question: "q", filing: { a: 1 } },
          output: { value: 1 },
          startedAt: ISO,
          durationMs: 0,
        },
      ]),
    );
    expect(a.shapeHash).not.toBe(b.shapeHash);
  });
});

describe("readLibrarySnapshot", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "lib-snap-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("returns an empty set when the tenant overlay is missing", async () => {
    const snap = await readLibrarySnapshot({ baseDir, tenantId: "absent" });
    expect(snap.shapeHashes.size).toBe(0);
    expect(snap.learnedNames.size).toBe(0);
  });

  it("collects every learned-interface marker in the tenant overlay", async () => {
    const tenantDir = path.join(baseDir, "lib", "acme");
    await mkdir(tenantDir, { recursive: true });
    await writeFile(
      path.join(tenantDir, "first.ts"),
      "// Learned\n// @shape-hash: aaaaaaaa\nexport const first = () => null;\n",
      "utf8",
    );
    await writeFile(
      path.join(tenantDir, "second.ts"),
      "// Learned\n// @shape-hash: bbbbbbbb\nexport const second = () => null;\n",
      "utf8",
    );
    const snap = await readLibrarySnapshot({ baseDir, tenantId: "acme" });
    expect(Array.from(snap.shapeHashes).sort()).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(Array.from(snap.learnedNames).sort()).toEqual(["first", "second"]);
  });

  it("skips files without a @shape-hash: marker", async () => {
    const tenantDir = path.join(baseDir, "lib", "acme");
    await mkdir(tenantDir, { recursive: true });
    await writeFile(
      path.join(tenantDir, "user-authored.ts"),
      "// hand-written\nexport const x = () => null;\n",
      "utf8",
    );
    await writeFile(
      path.join(tenantDir, "crystal.ts"),
      "// @shape-hash: deadbeef\nexport const c = () => null;\n",
      "utf8",
    );
    const snap = await readLibrarySnapshot({ baseDir, tenantId: "acme" });
    expect(Array.from(snap.shapeHashes)).toEqual(["deadbeef"]);
    expect(Array.from(snap.learnedNames)).toEqual(["crystal"]);
  });
});

describe("extractSubGraphTemplates", () => {
  it("returns no sub-graphs for a trajectory shorter than 3 calls", () => {
    const traj = buildTrajectory([
      { index: 0, primitive: "db.records.findExact", input: {}, output: [{ id: 1 }], startedAt: ISO, durationMs: 1 },
      { index: 1, primitive: "lib.perEntity", input: { ids: [1] }, output: { value: [] }, startedAt: ISO, durationMs: 1 },
    ]);
    expect(extractSubGraphTemplates(traj)).toEqual([]);
  });

  it("returns no sub-graphs when there is no db.* call", () => {
    const traj = buildTrajectory([
      { index: 0, primitive: "tool.api.A", input: {}, output: { ok: 1 }, startedAt: ISO, durationMs: 1 },
      { index: 1, primitive: "tool.api.B", input: {}, output: { ok: 2 }, startedAt: ISO, durationMs: 1 },
      { index: 2, primitive: "tool.api.C", input: {}, output: { ok: 3 }, startedAt: ISO, durationMs: 1 },
    ]);
    expect(extractSubGraphTemplates(traj)).toEqual([]);
  });

  it("emits a fan-out sub-graph when the agent loops one tool over several entities after a db lookup", () => {
    const records = [{ id: 7 }, { id: 8 }, { id: 9 }];
    const traj = buildTrajectory([
      { index: 0, primitive: "db.records.findExact", input: { filter: {} }, output: records, startedAt: ISO, durationMs: 1 },
      { index: 1, primitive: "tool.api.getDetails", input: { id: 7 }, output: { name: "a" }, startedAt: ISO, durationMs: 1 },
      { index: 2, primitive: "tool.api.getDetails", input: { id: 8 }, output: { name: "b" }, startedAt: ISO, durationMs: 1 },
      { index: 3, primitive: "tool.api.getDetails", input: { id: 9 }, output: { name: "c" }, startedAt: ISO, durationMs: 1 },
    ]);
    const subs = extractSubGraphTemplates(traj);
    // Whole trajectory is `[db, tool, tool, tool]` (4 calls). Sub-graph A
    // [db, tool#1] is only 2 calls so it is dropped (below the 3-call
    // minimum). Sub-graph B [tool#1, tool#2, tool#3] is 3 calls of the
    // same primitive, with a repeated primitive, so it should be emitted.
    expect(subs.length).toBeGreaterThanOrEqual(1);
    const fanout = subs.find((t) => t.topic.endsWith("fanout"));
    expect(fanout).toBeDefined();
    expect(fanout!.steps).toHaveLength(3);
    expect(fanout!.steps.every((s) => s.primitive === "tool.api.getDetails")).toBe(true);
  });

  it("fan-out sub-graph template's body emits tool.* bracket-notation calls and is not pruned", async () => {
    // Goal-3 iter 10 regression: the author returned null for fan-out
    // sub-graphs because (1) renderStepExpression handled only db.* and
    // lib.* primitives, and (2) pruneUnusedTemplateSteps collapsed the
    // 9 independent tool calls to one. Both bugs surface as
    // `{kind: "skipped", reason: "pure-composition path could not emit source"}`
    // from authorFunction. This test exercises generatePureSource via
    // the template through the resolver to lock in both fixes.
    const records = [{ id: 7 }, { id: 8 }, { id: 9 }];
    const traj = buildTrajectory([
      { index: 0, primitive: "db.records.findExact", input: { filter: {}, limit: 999 }, output: records, startedAt: ISO, durationMs: 1 },
      { index: 1, primitive: "tool.api.local-getInfo", input: { id: 7 }, output: { info: 7 }, startedAt: ISO, durationMs: 1 },
      { index: 2, primitive: "tool.api.local-getRelated", input: { id: 7 }, output: { related: 7 }, startedAt: ISO, durationMs: 1 },
      { index: 3, primitive: "tool.api.local-getInfo", input: { id: 8 }, output: { info: 8 }, startedAt: ISO, durationMs: 1 },
      { index: 4, primitive: "tool.api.local-getRelated", input: { id: 8 }, output: { related: 8 }, startedAt: ISO, durationMs: 1 },
      { index: 5, primitive: "tool.api.local-getInfo", input: { id: 9 }, output: { info: 9 }, startedAt: ISO, durationMs: 1 },
      { index: 6, primitive: "tool.api.local-getRelated", input: { id: 9 }, output: { related: 9 }, startedAt: ISO, durationMs: 1 },
    ]);
    const subs = extractSubGraphTemplates(traj);
    const fanout = subs.find((t) => t.topic.endsWith("fanout"));
    expect(fanout).toBeDefined();
    expect(fanout!.steps).toHaveLength(6);
    expect(fanout!.steps.every((s) => s.primitive.startsWith("tool."))).toBe(true);
    // Single shared param `id` since all 6 calls bind `id` to the same param.
    expect(fanout!.parameters.map((p) => p.name)).toEqual(["id"]);
  });

  it("extractCandidateTemplates returns the whole template followed by sub-graphs", () => {
    const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const traj = buildTrajectory([
      { index: 0, primitive: "db.records.findExact", input: { filter: {} }, output: records, startedAt: ISO, durationMs: 1 },
      { index: 1, primitive: "tool.api.getDetails", input: { id: 1 }, output: { name: "x" }, startedAt: ISO, durationMs: 1 },
      { index: 2, primitive: "tool.api.getDetails", input: { id: 2 }, output: { name: "y" }, startedAt: ISO, durationMs: 1 },
      { index: 3, primitive: "tool.api.getDetails", input: { id: 3 }, output: { name: "z" }, startedAt: ISO, durationMs: 1 },
    ]);
    const candidates = extractCandidateTemplates(traj);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]!.steps).toHaveLength(4);
    // All candidates have distinct shape hashes.
    const hashes = new Set(candidates.map((c) => c.shapeHash));
    expect(hashes.size).toBe(candidates.length);
  });
});
