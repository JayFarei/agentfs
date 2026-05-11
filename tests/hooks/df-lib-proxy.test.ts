// Integration test: df.lib.<name> proxy <-> HookRegistry.
//
// Bakes a tenant lib overlay with one healthy and one broken hook, wires
// the resolver + registry as buildDf expects, and asserts:
//   - hooks-candidate-only: no name is callable; even healthy hooks
//     throw at the proxy.
//   - hooks-draft: healthy hook is callable; broken hook reports
//     not-callable with a quarantine reason.
//   - hooks-draft: a body that throws at runtime is converted to a
//     structured "unsupported" result and the hook is quarantined.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HookRegistry, setHookRegistry } from "../../src/hooks/registry.js";
import { buildDf } from "../../src/snippet/dfBinding.js";
import { DiskLibraryResolver } from "../../src/snippet/library.js";
import { setLibraryResolver } from "../../src/sdk/runtime.js";
import {
  costZero,
  TrajectoryRecorder,
  type DispatchContext,
} from "../../src/sdk/index.js";
import { readManifest } from "../../src/hooks/manifest.js";

const FN_OK = (name: string): string =>
  [
    'import { fn } from "@datafetch/sdk";',
    'import * as v from "valibot";',
    `export const ${name} = fn({`,
    `  intent: "ok",`,
    `  examples: [{ input: {}, output: { value: 42 } }],`,
    "  input: v.object({}),",
    "  output: v.object({ value: v.number() }),",
    "  body: () => ({ value: 42 }),",
    "});",
    "",
  ].join("\n");

const FN_THROWS = (name: string): string =>
  [
    'import { fn } from "@datafetch/sdk";',
    'import * as v from "valibot";',
    `export const ${name} = fn({`,
    `  intent: "throws",`,
    `  examples: [{ input: {}, output: { value: 0 } }],`,
    "  input: v.object({}),",
    "  output: v.object({ value: v.number() }),",
    "  body: () => { throw new ReferenceError(\"x is not defined\"); },",
    "});",
    "",
  ].join("\n");

const FN_BROKEN = `import { fn } from "@datafetch/sdk";
export const broken = fn({
  intent: "broken
  // missing close quote intentional — esbuild transform should fail
});
`;

const tenant = "t-hooks";

function buildDispatchCtx(recorder?: TrajectoryRecorder): DispatchContext {
  return {
    tenant,
    mount: "m",
    pins: {},
    cost: costZero(),
    ...(recorder !== undefined ? { trajectory: recorder } : {}),
  };
}

describe("df.lib proxy + HookRegistry", () => {
  let baseDir: string;
  const tenantLib = (): string => path.join(baseDir, "lib", tenant);

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-lib-hooks-"));
    await mkdir(tenantLib(), { recursive: true });
    delete process.env["DATAFETCH_INTERFACE_MODE"];
  });

  afterEach(async () => {
    setHookRegistry(null);
    setLibraryResolver(null);
    delete process.env["DATAFETCH_INTERFACE_MODE"];
    await rm(baseDir, { recursive: true, force: true });
  });

  it("hooks-candidate-only refuses to expose even healthy hooks via df.lib", async () => {
    await writeFile(path.join(tenantLib(), "healthy.ts"), FN_OK("healthy"), "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    setLibraryResolver(resolver);
    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-candidate-only";
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-candidate-only" });
    setHookRegistry(registry);

    const df = buildDf({
      sessionCtx: { tenantId: tenant, mountIds: [], baseDir },
      dispatchCtx: buildDispatchCtx(),
    });
    await expect(df.lib.healthy!({})).rejects.toThrow(/hook is observed only|not-callable|observed/);
  });

  it("hooks-draft exposes a healthy hook and records a success stat", async () => {
    await writeFile(path.join(tenantLib(), "healthy.ts"), FN_OK("healthy"), "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    setLibraryResolver(resolver);
    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    setHookRegistry(registry);

    const df = buildDf({
      sessionCtx: { tenantId: tenant, mountIds: [], baseDir },
      dispatchCtx: buildDispatchCtx(),
    });
    const out = await df.lib.healthy!({});
    expect(out.value).toMatchObject({ value: 42 });

    const manifest = await readManifest(baseDir, tenant, "healthy");
    expect(manifest?.callability).toBe("callable-with-fallback");
    expect(manifest?.stats.successes).toBe(1);
  });

  it("hooks-draft converts a throwing body into a structured unsupported envelope", async () => {
    await writeFile(path.join(tenantLib(), "boom.ts"), FN_THROWS("boom"), "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    setLibraryResolver(resolver);
    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    setHookRegistry(registry);

    const df = buildDf({
      sessionCtx: { tenantId: tenant, mountIds: [], baseDir },
      dispatchCtx: buildDispatchCtx(),
    });
    const out = await df.lib.boom!({});
    // The envelope reports an unsupported outcome rather than crashing.
    const v = out.value as { unsupported?: boolean; reason?: string; hook?: string };
    expect(v.unsupported).toBe(true);
    expect(v.hook).toBe("boom");
    expect(v.reason).toBe("reference_error");

    const manifest = await readManifest(baseDir, tenant, "boom");
    expect(manifest?.stats.abstentions).toBe(1);
  });

  it("hooks-draft reports not-callable with quarantine reason for a transform-broken hook", async () => {
    await writeFile(path.join(tenantLib(), "broken.ts"), FN_BROKEN, "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    setLibraryResolver(resolver);
    process.env["DATAFETCH_INTERFACE_MODE"] = "hooks-draft";
    const registry = new HookRegistry({ baseDir, resolver, mode: "hooks-draft" });
    setHookRegistry(registry);

    const df = buildDf({
      sessionCtx: { tenantId: tenant, mountIds: [], baseDir },
      dispatchCtx: buildDispatchCtx(),
    });
    await expect(df.lib.broken!({})).rejects.toThrow(/transform_failure|quarantine|missing_export|runtime_error/);

    const manifest = await readManifest(baseDir, tenant, "broken");
    expect(manifest?.callability).toBe("quarantined");
  });

  it("legacy mode bypasses the registry entirely (broken file → legacy not-found error)", async () => {
    await writeFile(path.join(tenantLib(), "broken.ts"), FN_BROKEN, "utf8");
    const resolver = new DiskLibraryResolver({ baseDir });
    setLibraryResolver(resolver);
    process.env["DATAFETCH_INTERFACE_MODE"] = "legacy";
    // Even if a registry is set, mode === "legacy" should make the proxy
    // short-circuit to the resolver directly.
    const registry = new HookRegistry({ baseDir, resolver, mode: "legacy" });
    setHookRegistry(registry);

    const df = buildDf({
      sessionCtx: { tenantId: tenant, mountIds: [], baseDir },
      dispatchCtx: buildDispatchCtx(),
    });
    await expect(df.lib.broken!({})).rejects.toThrow(/function not found/);
  });
});
