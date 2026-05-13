// df.d.ts manifest and apropos honour hook callability.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HookRegistry } from "../../src/hooks/registry.js";
import { DiskLibraryResolver } from "../../src/snippet/library.js";
import { regenerateManifest } from "../../src/server/manifest.js";
import { searchLibrary } from "../../src/discovery/librarySearch.js";

const FN_OK = (name: string): string =>
  [
    'import { fn } from "@datafetch/sdk";',
    'import * as v from "valibot";',
    `export const ${name} = fn({`,
    `  intent: "${name} intent — counts double",`,
    `  examples: [{ input: {}, output: { value: 42 } }],`,
    "  input: v.object({}),",
    "  output: v.object({ value: v.number() }),",
    "  body: () => ({ value: 42 }),",
    "});",
    "",
  ].join("\n");

const FN_BROKEN = `import { fn } from "@datafetch/sdk";
export const broken = fn({
  intent: "broken
});
`;

const tenant = "skillcraft-full";

describe("df.d.ts hides quarantined hooks", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "manifest-hide-quar-"));
    await mkdir(path.join(baseDir, "lib", tenant), { recursive: true });
  });

  afterEach(async () => {
    delete process.env["DATAFETCH_INTERFACE_MODE"];
    await rm(baseDir, { recursive: true, force: true });
  });

  it("renderManifest omits quarantined entries when hooks are enabled", async () => {
    await writeFile(path.join(baseDir, "lib", tenant, "ok.ts"), FN_OK("ok"), "utf8");
    await writeFile(path.join(baseDir, "lib", tenant, "broken.ts"), FN_BROKEN, "utf8");

    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.ingestTenant(tenant);

    await regenerateManifest({ baseDir, tenantId: tenant });
    const dts = await readFile(path.join(baseDir, "df.d.ts"), "utf8");

    expect(dts).toContain("ok(");
    expect(dts).not.toContain("broken(");
  });

  it("ranks validated-typescript helpers above candidate-typescript ones in df.d.ts", async () => {
    await writeFile(path.join(baseDir, "lib", tenant, "alpha.ts"), FN_OK("alpha"), "utf8");
    await writeFile(path.join(baseDir, "lib", tenant, "bravo.ts"), FN_OK("bravo"), "utf8");

    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.ingestTenant(tenant);

    // Promote alpha to validated-typescript; bravo stays candidate.
    const { writeManifest, readManifest } = await import(
      "../../src/hooks/manifest.js"
    );
    const alpha = await readManifest(baseDir, tenant, "alpha");
    if (alpha) {
      alpha.maturity = "validated-typescript";
      await writeManifest(baseDir, alpha);
    }

    await regenerateManifest({ baseDir, tenantId: tenant });
    const dts = await readFile(path.join(baseDir, "df.d.ts"), "utf8");
    const alphaIdx = dts.indexOf("alpha(");
    const bravoIdx = dts.indexOf("bravo(");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(bravoIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(bravoIdx);
  });

  it("orders same-maturity helpers by success count then recency", async () => {
    await writeFile(path.join(baseDir, "lib", tenant, "hot.ts"), FN_OK("hot"), "utf8");
    await writeFile(path.join(baseDir, "lib", tenant, "cold.ts"), FN_OK("cold"), "utf8");

    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.ingestTenant(tenant);

    const { writeManifest, readManifest } = await import(
      "../../src/hooks/manifest.js"
    );
    const hot = await readManifest(baseDir, tenant, "hot");
    if (hot) {
      hot.stats.successes = 25;
      await writeManifest(baseDir, hot);
    }
    const cold = await readManifest(baseDir, tenant, "cold");
    if (cold) {
      cold.stats.successes = 1;
      await writeManifest(baseDir, cold);
    }

    await regenerateManifest({ baseDir, tenantId: tenant });
    const dts = await readFile(path.join(baseDir, "df.d.ts"), "utf8");
    const hotIdx = dts.indexOf("hot(");
    const coldIdx = dts.indexOf("cold(");
    expect(hotIdx).toBeLessThan(coldIdx);
  });

  it("apropos can hide quarantined hooks (default) and surface them with the diagnostic flag", async () => {
    await writeFile(path.join(baseDir, "lib", tenant, "ok.ts"), FN_OK("ok"), "utf8");
    await writeFile(path.join(baseDir, "lib", tenant, "broken.ts"), FN_BROKEN, "utf8");

    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.ingestTenant(tenant);

    delete process.env["DATAFETCH_HOOKS_SHOW_QUARANTINED"];
    const hiddenMatches = await searchLibrary({
      baseDir,
      tenantId: tenant,
      resolver,
      query: "learned ok broken",
    });
    expect(hiddenMatches.map((m) => m.name).sort()).toEqual(["ok"]);

    process.env["DATAFETCH_HOOKS_SHOW_QUARANTINED"] = "1";
    const allMatches = await searchLibrary({
      baseDir,
      tenantId: tenant,
      resolver,
      query: "learned ok broken",
    });
    expect(allMatches.map((m) => m.name).sort()).toEqual(["broken", "ok"].sort());
    delete process.env["DATAFETCH_HOOKS_SHOW_QUARANTINED"];
  });
});
