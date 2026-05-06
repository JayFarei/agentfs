import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  describeLibraryFunction,
  renderManPage,
  searchLibrary,
} from "../src/discovery/librarySearch.js";
import { DiskLibraryResolver } from "../src/snippet/library.js";

describe("librarySearch", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "library-search-"));
    const tenantDir = path.join(baseDir, "lib", "acme");
    await mkdir(tenantDir, { recursive: true });
    await writeFile(
      path.join(tenantDir, "rangeTableMetric.ts"),
      [
        "/* ---",
        "name: rangeTableMetric",
        "description: |",
        "  Use when the user asks for a revenue metric range across years.",
        "  Prefer this learned tool before composing table primitives.",
        "trajectory: traj_1",
        "shape-hash: deadbeef",
        "--- */",
        'import { fn } from "@datafetch/sdk";',
        'import * as v from "valibot";',
        "export const rangeTableMetric = fn({",
        '  intent: "answer filing table questions that compare a metric across periods",',
        "  examples: [",
        "    {",
        '      input: { query: "What is the range of chemicals revenue between 2014 and 2018?", limit: 5 },',
        "      output: { answer: 700 },",
        "    },",
        "  ],",
        "  input: v.object({ query: v.string(), limit: v.number() }),",
        "  output: v.object({ answer: v.number() }),",
        "  body: ({ limit }) => ({ answer: limit }),",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(tenantDir, "pickFiling.ts"),
      [
        'import { fn } from "@datafetch/sdk";',
        'import * as v from "valibot";',
        "export const pickFiling = fn({",
        '  intent: "choose the filing that best matches a question",',
        "  examples: [{ input: { question: \"Which filing?\" }, output: { id: \"x\" } }],",
        "  input: v.object({ question: v.string() }),",
        "  output: v.object({ id: v.string() }),",
        "  body: () => ({ id: \"x\" }),",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("ranks learned tools by frontmatter and example string values", async () => {
    const resolver = new DiskLibraryResolver({ baseDir });
    const matches = await searchLibrary({
      baseDir,
      tenantId: "acme",
      resolver,
      query: "coal revenue range 2014 2018",
    });

    expect(matches[0]).toMatchObject({
      name: "rangeTableMetric",
      kind: "tool",
    });
    expect(matches[0]!.invocation).toContain("df.lib.rangeTableMetric");
    expect(matches[0]!.why.join(" ")).toContain("examples");
    expect(matches.find((m) => m.name === "pickFiling")).toBeUndefined();
  });

  it("does not blindly rank a weak learned tool above a stronger primitive", async () => {
    const tenantDir = path.join(baseDir, "lib", "acme");
    await writeFile(
      path.join(tenantDir, "genericLookupTool.ts"),
      [
        "/* ---",
        "name: genericLookupTool",
        "description: |",
        "  Learned helper for generic lookup requests.",
        "trajectory: traj_2",
        "shape-hash: cafebabe",
        "--- */",
        'import { fn } from "@datafetch/sdk";',
        'import * as v from "valibot";',
        "export const genericLookupTool = fn({",
        '  intent: "generic lookup helper",',
        '  examples: [{ input: { query: "lookup" }, output: { ok: true } }],',
        "  input: v.object({ query: v.string() }),",
        "  output: v.object({ ok: v.boolean() }),",
        "  body: () => ({ ok: true }),",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(tenantDir, "companyLookup.ts"),
      [
        'import { fn } from "@datafetch/sdk";',
        'import * as v from "valibot";',
        "export const companyLookup = fn({",
        '  intent: "exact company lookup",',
        '  examples: [{ input: { query: "exact company lookup" }, output: { ok: true } }],',
        "  input: v.object({ query: v.string() }),",
        "  output: v.object({ ok: v.boolean() }),",
        "  body: () => ({ ok: true }),",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    const resolver = new DiskLibraryResolver({ baseDir });
    const matches = await searchLibrary({
      baseDir,
      tenantId: "acme",
      resolver,
      query: "exact company lookup",
    });

    expect(matches[0]).toMatchObject({
      name: "companyLookup",
      kind: "primitive",
    });
    expect(matches.find((m) => m.name === "genericLookupTool")).toBeDefined();
  });

  it("renders executable man-page documentation from the same metadata", async () => {
    const resolver = new DiskLibraryResolver({ baseDir });
    const desc = await describeLibraryFunction({
      baseDir,
      tenantId: "acme",
      resolver,
      name: "rangeTableMetric",
    });

    expect(desc).not.toBeNull();
    const page = renderManPage(desc!);
    expect(page).toContain("KIND\n       tool");
    expect(page).toContain("Use when the user asks for a revenue metric range");
    expect(page).toContain("INVOCATION");
    expect(page).toContain("df.lib.rangeTableMetric");
    expect(page).toContain(path.join(baseDir, "lib", "acme", "rangeTableMetric.ts"));
  });
});
