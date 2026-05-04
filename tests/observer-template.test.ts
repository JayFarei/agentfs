import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import {
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

  it("produces a deterministic shapeHash and crystallise_<topic>_<hash> name", () => {
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
    expect(a.name).toMatch(/^crystallise_[a-zA-Z0-9_]+_[0-9a-f]{8}$/);
    // Topic should be derived from the lib.* primitive name.
    expect(a.topic).toContain("pickfiling");
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
  });

  it("collects every @shape-hash: marker in the tenant overlay", async () => {
    const tenantDir = path.join(baseDir, "lib", "acme");
    await mkdir(tenantDir, { recursive: true });
    await writeFile(
      path.join(tenantDir, "first.ts"),
      "// Crystallised\n// @shape-hash: aaaaaaaa\nexport const first = () => null;\n",
      "utf8",
    );
    await writeFile(
      path.join(tenantDir, "second.ts"),
      "// Crystallised\n// @shape-hash: bbbbbbbb\nexport const second = () => null;\n",
      "utf8",
    );
    const snap = await readLibrarySnapshot({ baseDir, tenantId: "acme" });
    expect(Array.from(snap.shapeHashes).sort()).toEqual(["aaaaaaaa", "bbbbbbbb"]);
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
  });
});
