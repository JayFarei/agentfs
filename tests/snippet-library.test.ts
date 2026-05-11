import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DiskLibraryResolver } from "../src/snippet/library.js";

describe("DiskLibraryResolver", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "snippet-library-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("does not let a case-only tenant overlay shadow a seed function", async () => {
    const tenantDir = path.join(baseDir, "lib", "acme");
    const seedDir = path.join(baseDir, "lib", "__seed__");
    await mkdir(tenantDir, { recursive: true });
    await mkdir(seedDir, { recursive: true });

    await writeFile(
      path.join(seedDir, "metricLookup.ts"),
      fnSource("metricLookup", "seed"),
      "utf8",
    );
    await writeFile(
      path.join(tenantDir, "metriclookup.ts"),
      fnSource("metriclookup", "overlay"),
      "utf8",
    );

    const resolver = new DiskLibraryResolver({ baseDir });
    const exactSeed = await resolver.resolve("acme", "metricLookup");
    const exactOverlay = await resolver.resolve("acme", "metriclookup");

    expect(exactSeed).not.toBeNull();
    await expect(exactSeed!({})).resolves.toMatchObject({
      value: { source: "seed" },
    });
    expect(exactOverlay).not.toBeNull();
    await expect(exactOverlay!({})).resolves.toMatchObject({
      value: { source: "overlay" },
    });
  });
});

function fnSource(name: string, source: string): string {
  return [
    'import { fn } from "@datafetch/sdk";',
    'import * as v from "valibot";',
    `export const ${name} = fn({`,
    `  intent: ${JSON.stringify(`${source} function`)},`,
    "  examples: [{ input: {}, output: { source: " + JSON.stringify(source) + " } }],",
    "  input: v.object({}),",
    "  output: v.object({ source: v.string() }),",
    `  body: () => ({ source: ${JSON.stringify(source)} }),`,
    "});",
    "",
  ].join("\n");
}
