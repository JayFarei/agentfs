// Hook registry unit tests.
//
// Each test bakes a tenant lib overlay on disk, instantiates a
// HookRegistry on top of it, and asserts the manifest + callability that
// fall out. We never go through installSnippetRuntime because that's
// integration territory; the registry's input/output is exercised
// directly.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HookRegistry,
  extractAuthoredPrimitives,
} from "../../src/hooks/registry.js";
import { listManifests, readManifest } from "../../src/hooks/manifest.js";
import { DiskLibraryResolver } from "../../src/snippet/library.js";

const FN_SOURCE_OK = (name: string, value: string): string =>
  [
    'import { fn } from "@datafetch/sdk";',
    'import * as v from "valibot";',
    `export const ${name} = fn({`,
    `  intent: ${JSON.stringify(`learned ${name}`)},`,
    `  examples: [{ input: {}, output: { value: ${JSON.stringify(value)} } }],`,
    "  input: v.object({}),",
    "  output: v.object({ value: v.string() }),",
    `  body: () => ({ value: ${JSON.stringify(value)} }),`,
    "});",
    "",
  ].join("\n");

// A module that loads cleanly but exposes NO Fn-shaped exports. The
// DiskLibraryResolver falls back to scanning for any Fn-shaped value
// when the named export is missing, so a real "missing export"
// quarantine reproduces only when the module truly has no Fn export.
const FN_SOURCE_MISSING_EXPORT = (filename: string): string =>
  [
    `// ${filename}.ts: exports no Fn — the resolver should report missing export.`,
    'export const notAFn = { thisIs: "not a Fn" };',
    "export default 42;",
    "",
  ].join("\n");

const FN_SOURCE_TRANSFORM_FAIL = `import { fn } from "@datafetch/sdk";
export const bad = fn({
  // Broken: stray closing brace, unterminated string
  intent: "broken
  examples: []
  body: () => ({}),
});
`;

const FN_SOURCE_RUNTIME_THROWS = (name: string): string =>
  [
    'import { fn } from "@datafetch/sdk";',
    'import * as v from "valibot";',
    `export const ${name} = fn({`,
    `  intent: "throws at runtime",`,
    `  examples: [{ input: {}, output: { value: "ok" } }],`,
    "  input: v.object({}),",
    "  output: v.object({ value: v.string() }),",
    `  body: () => { throw new TypeError("Cannot read properties of undefined (reading 'foo')"); },`,
    "});",
    "",
  ].join("\n");

describe("HookRegistry.ingestTenant", () => {
  let baseDir: string;
  const tenant = "test-tenant";
  const tenantLib = (): string => path.join(baseDir, "lib", tenant);

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "hook-registry-ingest-"));
    await mkdir(tenantLib(), { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("creates a callable manifest for a healthy implementation under hooks-draft", async () => {
    await writeFile(path.join(tenantLib(), "doubler.ts"), FN_SOURCE_OK("doubler", "42"), "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    const out = await registry.ingestTenant(tenant);

    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("doubler");
    expect(out[0]!.maturity).toBe("candidate-typescript");
    // hooks-draft → callable-with-fallback for candidate-typescript
    expect(out[0]!.callability).toBe("callable-with-fallback");
    expect(out[0]!.quarantine).toBeUndefined();

    const persisted = await readManifest(baseDir, tenant, "doubler");
    expect(persisted?.callability).toBe("callable-with-fallback");
  });

  it("quarantines a broken transform; .ts file is preserved", async () => {
    await writeFile(path.join(tenantLib(), "bad.ts"), FN_SOURCE_TRANSFORM_FAIL, "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    const out = await registry.ingestTenant(tenant);

    expect(out).toHaveLength(1);
    const m = out[0]!;
    expect(m.callability).toBe("quarantined");
    expect(m.quarantine?.reason).toMatch(/transform_failure|missing_export|runtime_error/);

    // The .ts file should still be on disk — quarantine doesn't delete the body.
    const filePath = path.join(tenantLib(), "bad.ts");
    const stillThere = await readFile(filePath, "utf8");
    expect(stillThere.length).toBeGreaterThan(0);
  });

  it("quarantines a file whose exported fn name does not match the filename", async () => {
    await writeFile(
      path.join(tenantLib(), "expectedName.ts"),
      FN_SOURCE_MISSING_EXPORT("expectedName"),
      "utf8",
    );
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    const out = await registry.ingestTenant(tenant);

    expect(out).toHaveLength(1);
    expect(out[0]!.callability).toBe("quarantined");
    expect(out[0]!.quarantine?.reason).toBe("missing_export");
  });

  it("hooks-candidate-only never exposes a callable, even for a healthy file", async () => {
    await writeFile(path.join(tenantLib(), "healthy.ts"), FN_SOURCE_OK("healthy", "ok"), "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-candidate-only" });
    const out = await registry.ingestTenant(tenant);

    expect(out).toHaveLength(1);
    expect(out[0]!.maturity).toBe("candidate-typescript");
    expect(out[0]!.callability).toBe("not-callable");
  });

  it("hooks-validated-only refuses to expose candidate-typescript hooks", async () => {
    await writeFile(path.join(tenantLib(), "healthy.ts"), FN_SOURCE_OK("healthy", "ok"), "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-validated-only" });
    const out = await registry.ingestTenant(tenant);

    expect(out[0]!.callability).toBe("not-callable");
  });
});

describe("HookRegistry.lookup", () => {
  let baseDir: string;
  const tenant = "test-tenant";
  const tenantLib = (): string => path.join(baseDir, "lib", tenant);

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "hook-registry-lookup-"));
    await mkdir(tenantLib(), { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("returns callable for a healthy hook under hooks-draft", async () => {
    await writeFile(path.join(tenantLib(), "doubler.ts"), FN_SOURCE_OK("doubler", "42"), "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    const lookup = await registry.lookup(tenant, "doubler");
    expect(lookup.kind).toBe("callable");
    if (lookup.kind === "callable") {
      expect(lookup.withFallback).toBe(true);
    }
  });

  it("returns not-callable with quarantine reason for a broken file", async () => {
    await writeFile(path.join(tenantLib(), "bad.ts"), FN_SOURCE_TRANSFORM_FAIL, "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    const lookup = await registry.lookup(tenant, "bad");
    expect(lookup.kind).toBe("not-callable");
    if (lookup.kind === "not-callable") {
      expect(lookup.manifest.callability).toBe("quarantined");
    }
  });

  it("returns absent for an unknown name (resolver falls back to legacy lookup)", async () => {
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    const lookup = await registry.lookup(tenant, "nobody");
    expect(lookup.kind).toBe("absent");
  });
});

describe("HookRegistry.recordInvocation", () => {
  let baseDir: string;
  const tenant = "test-tenant";
  const tenantLib = (): string => path.join(baseDir, "lib", tenant);

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "hook-registry-record-"));
    await mkdir(tenantLib(), { recursive: true });
    await writeFile(path.join(tenantLib(), "doubler.ts"), FN_SOURCE_OK("doubler", "42"), "utf8");
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("increments stats on success and failure", async () => {
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.ingestTenant(tenant);

    await registry.recordInvocation({ tenantId: tenant, name: "doubler", outcome: "success" });
    await registry.recordInvocation({
      tenantId: tenant,
      name: "doubler",
      outcome: "unsupported",
      errorClass: "type_error",
      errorMessage: "x is not a function",
    });
    await registry.recordInvocation({
      tenantId: tenant,
      name: "doubler",
      outcome: "failure",
      errorClass: "reference_error",
      errorMessage: "y is not defined",
      quarantineOnFailure: true,
    });

    const manifest = await readManifest(baseDir, tenant, "doubler");
    expect(manifest).toBeTruthy();
    expect(manifest!.stats.attempts).toBe(3);
    expect(manifest!.stats.successes).toBe(1);
    expect(manifest!.stats.abstentions).toBe(1);
    expect(manifest!.stats.runtimeErrors).toBe(1);
    expect(manifest!.callability).toBe("quarantined");
    expect(manifest!.quarantine?.reason).toBe("reference_error");
  });
});

describe("HookRegistry persistence", () => {
  let baseDir: string;
  const tenant = "test-tenant";
  const tenantLib = (): string => path.join(baseDir, "lib", tenant);

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "hook-registry-persist-"));
    await mkdir(tenantLib(), { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("listManifests sees every persisted hook for the tenant", async () => {
    await writeFile(path.join(tenantLib(), "ok.ts"), FN_SOURCE_OK("ok", "yes"), "utf8");
    await writeFile(path.join(tenantLib(), "bad.ts"), FN_SOURCE_TRANSFORM_FAIL, "utf8");

    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.ingestTenant(tenant);

    const persisted = await listManifests(baseDir, tenant);
    expect(persisted.map((m) => m.name).sort()).toEqual(["bad", "ok"]);
    const ok = persisted.find((m) => m.name === "ok")!;
    const bad = persisted.find((m) => m.name === "bad")!;
    expect(ok.callability).toBe("callable-with-fallback");
    expect(bad.callability).toBe("quarantined");
  });

  it("does NOT delete the underlying .ts file when quarantining", async () => {
    await writeFile(path.join(tenantLib(), "throws.ts"), FN_SOURCE_RUNTIME_THROWS("throws"), "utf8");

    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    // Loading throws.ts succeeds (the throw is inside body, not at module
    // top-level). Validate would mark it candidate-typescript / callable.
    await registry.ingestTenant(tenant);

    // Simulate a runtime crash invocation
    await registry.recordInvocation({
      tenantId: tenant,
      name: "throws",
      outcome: "failure",
      errorClass: "type_error",
      errorMessage: "Cannot read properties of undefined (reading 'foo')",
      quarantineOnFailure: true,
    });

    // .ts file still present
    const content = await readFile(path.join(tenantLib(), "throws.ts"), "utf8");
    expect(content).toContain("throws at runtime");

    // Manifest now quarantined
    const persisted = await readManifest(baseDir, tenant, "throws");
    expect(persisted?.callability).toBe("quarantined");
    expect(persisted?.quarantine?.reason).toBe("type_error");
  });
});

describe("extractAuthoredPrimitives", () => {
  it("collects db.*, lib.*, and tool.* calls in source order", () => {
    const src = [
      'const rows = await df.db.cases.findSimilar("q", 5);',
      'const filing = (await df.lib.pickFiling({ rows })).value;',
      'const out = await df.tool.tvmaze_api["local-tvmaze_get_show_info"]({ show_id: 1 });',
      'const more = await df.tool.tvmaze_api.local_tvmaze_get_show_cast({ show_id: 1 });',
    ].join("\n");
    expect(extractAuthoredPrimitives(src)).toEqual([
      "db.cases.findSimilar",
      "lib.pickFiling",
      "tool.tvmaze_api.local-tvmaze_get_show_info",
      "tool.tvmaze_api.local_tvmaze_get_show_cast",
    ]);
  });

  it("ignores df.* calls inside comments", () => {
    const src = [
      "// const rows = await df.db.cases.findSimilar(\"x\", 1);",
      "/* await df.lib.shouldBeIgnored({}); */",
      'const real = await df.lib.actual({});',
    ].join("\n");
    expect(extractAuthoredPrimitives(src)).toEqual(["lib.actual"]);
  });
});

describe("smokeReplayAndPromote", () => {
  let baseDir: string;
  const tenant = "tenant-x";
  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-hooks-smoke-"));
    await mkdir(path.join(baseDir, "lib", tenant), { recursive: true });
  });
  afterEach(async () => {
    delete process.env["DATAFETCH_INTERFACE_MODE"];
    await rm(baseDir, { recursive: true, force: true });
  });

  it("promotes a candidate to validated-typescript when the body's primitives match the trajectory", async () => {
    const source = [
      'import { fn } from "@datafetch/sdk";',
      'import * as v from "valibot";',
      "declare const df: any;",
      "export const matches = fn({",
      '  intent: "matches",',
      "  examples: [],",
      "  input: v.object({}),",
      "  output: v.unknown(),",
      "  body: async () => {",
      '    const rows = await df.db.cases.findSimilar("q", 1);',
      '    return (await df.lib.pickFiling({ rows })).value;',
      "  },",
      "});",
      "",
    ].join("\n");
    const filePath = path.join(baseDir, "lib", tenant, "matches.ts");
    await writeFile(filePath, source, "utf8");

    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.validateImplementation({
      tenantId: tenant,
      name: "matches",
      filePath,
      implementationKind: "typescript",
    });
    const out = await registry.smokeReplayAndPromote({
      tenantId: tenant,
      name: "matches",
      filePath,
      expectedPrimitives: ["db.cases.findSimilar", "lib.pickFiling"],
    });
    expect(out.matched).toBe(true);
    expect(out.manifest?.maturity).toBe("validated-typescript");
    expect(out.manifest?.callability).toBe("callable");
    expect(out.manifest?.stats.replaysPassed).toBe(1);
  });

  it("leaves the candidate at callable-with-fallback when the primitive sequence diverges", async () => {
    const source = [
      'import { fn } from "@datafetch/sdk";',
      'import * as v from "valibot";',
      "declare const df: any;",
      "export const diverges = fn({",
      '  intent: "diverges",',
      "  examples: [],",
      "  input: v.object({}),",
      "  output: v.unknown(),",
      "  body: async () => {",
      "    // Only the db call; forgot the lib.* call the trajectory had.",
      '    return await df.db.cases.findSimilar("q", 1);',
      "  },",
      "});",
      "",
    ].join("\n");
    const filePath = path.join(baseDir, "lib", tenant, "diverges.ts");
    await writeFile(filePath, source, "utf8");

    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const resolver = new DiskLibraryResolver({ baseDir });
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    await registry.validateImplementation({
      tenantId: tenant,
      name: "diverges",
      filePath,
      implementationKind: "typescript",
    });
    const out = await registry.smokeReplayAndPromote({
      tenantId: tenant,
      name: "diverges",
      filePath,
      expectedPrimitives: ["db.cases.findSimilar", "lib.pickFiling"],
    });
    expect(out.matched).toBe(false);
    expect(out.manifest?.maturity).toBe("candidate-typescript");
    expect(out.manifest?.callability).toBe("callable-with-fallback");
    expect(out.manifest?.stats.replaysFailed).toBe(1);
  });
});
