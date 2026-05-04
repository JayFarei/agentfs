// DiskLibraryResolver — implements `LibraryResolver` from src/sdk/runtime.ts.
//
// Layered lookup (first hit wins):
//   1. <baseDir>/lib/<tenantId>/<name>.ts   (tenant overlay; mutable, on
//      disk where the bash session's `flushLib()` lands heredoc edits.)
//   2. <baseDir>/lib/__seed__/<name>.ts     (seed fallback; populated at
//      install time by `installSnippetRuntime`. Today the seed shim
//      re-exports the canonical `seeds/lib/<name>.ts` file from the repo
//      so its relative imports back into `src/sdk` resolve naturally.)
//
// The resolver returns the typed `Fn<unknown, unknown>` callable. `list()`
// walks both layers and returns `{name, spec}` for each.
//
// Reserved tenant ids (matching `^__\w+__$`, e.g. `__seed__`) are excluded
// from `list(<tenantId>)` when `<tenantId>` itself is not reserved. This
// keeps the seed layer hidden from agent-facing listings while still
// surfacing it as a fallback for resolution.
//
// Loading strategy:
//   - `await import(<absolute-file-url>)` — works because the runtime
//     process is started under tsx (which provides ESM TS support), and
//     because the seed shim file at `<baseDir>/lib/__seed__/<name>.ts`
//     re-exports from the repo's `seeds/lib/<name>.ts` (whose relative
//     `../../src/sdk/index.js` import resolves cleanly).
//   - Compiled-module cache keyed by `<file-path>::<mtime-ms>` so a
//     re-imported file with the same mtime returns the cached module
//     without paying the import cost again. mtime mismatches invalidate.
//   - Malformed files (typecheck errors, missing fn export, schema parse
//     errors at module load) are logged once and skipped, not crashed.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  Fn,
  LibraryEntry,
  LibraryResolver,
} from "../sdk/index.js";
import { defaultBaseDir, isReservedTenantId, locateRepoRoot } from "../paths.js";
import { enforceMapCap } from "../util/bounded.js";

// --- @datafetch/sdk import rewriter ----------------------------------------
//
// User-authored /lib/<tenant>/<name>.ts files use the documented
// `import { fn, llm, agent } from "@datafetch/sdk"` form (per
// /AGENTS.md and personas.md §3 Turn 6). There is no real npm package by
// that name; the resolver rewrites those imports to the absolute
// file:// URL of `<repo>/src/sdk/index.ts` before dynamic import. The
// rewritten source is written into `<repo-root>/.snippet-cache/` (NOT
// `<baseDir>/.snippet-cache/`) so bare imports the user-authored file
// references (e.g. `valibot`) resolve via Node's normal upward walk
// through the repo's `node_modules/`. The mtime is baked into the
// cache filename so freshness piggybacks on the disk file's own mtime.

const SDK_PACKAGE_NAME = "@datafetch/sdk";
const SDK_IMPORT_RE = /(\bfrom\s+|\bimport\s+)(['"])@datafetch\/sdk\2/g;

let sdkIndexUrlCache: string | null = null;

async function locateSdkIndexUrl(): Promise<string> {
  if (sdkIndexUrlCache) return sdkIndexUrlCache;
  const root = await locateRepoRoot();
  sdkIndexUrlCache = pathToFileURL(
    path.join(root, "src", "sdk", "index.ts"),
  ).href;
  return sdkIndexUrlCache;
}

async function rewriteSdkImports(
  source: string,
): Promise<{ rewritten: string; changed: boolean }> {
  if (!source.includes(SDK_PACKAGE_NAME)) {
    return { rewritten: source, changed: false };
  }
  const url = await locateSdkIndexUrl();
  let changed = false;
  const rewritten = source.replace(SDK_IMPORT_RE, (_m, kw, q) => {
    changed = true;
    return `${kw as string}${q as string}${url}${q as string}`;
  });
  return { rewritten, changed };
}

// --- Cache -----------------------------------------------------------------

type CachedFn = {
  mtimeMs: number;
  fn: Fn<unknown, unknown>;
};

// Poison entries record the mtime at which the file last failed to load.
// A different mtime invalidates the poison so heredoc-edited files get a
// fresh attempt rather than being permanently shunned.
type PoisonEntry = { mtimeMs: number };

// --- DiskLibraryResolver ---------------------------------------------------

export type DiskLibraryResolverOpts = {
  baseDir?: string;
};

// Caps on the in-memory caches. Long-lived data planes accumulate one
// resolver entry per /lib/ file ever loaded; without a cap the working
// set grows unboundedly. 512 covers a realistic tenant + seed surface
// with headroom; FIFO eviction is enough since repeated callers re-cache
// on resolve.
const RESOLVER_CACHE_CAP = 512;
const RESOLVER_POISON_CAP = 512;

export class DiskLibraryResolver implements LibraryResolver {
  private readonly baseDir: string;
  private readonly cache = new Map<string, CachedFn>();
  // Files that already failed to load, keyed by mtime. A different mtime
  // (e.g. after a heredoc edit fixes a bug) invalidates the entry so the
  // resolver retries instead of permanently shunning the file.
  private readonly poison = new Map<string, PoisonEntry>();

  constructor(opts: DiskLibraryResolverOpts = {}) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
  }

  async resolve(
    tenant: string,
    name: string,
  ): Promise<Fn<unknown, unknown> | null> {
    const overlay = path.join(this.baseDir, "lib", tenant, `${name}.ts`);
    const seed = path.join(this.baseDir, "lib", "__seed__", `${name}.ts`);

    const overlayHit = await this.tryLoad(overlay, name);
    if (overlayHit) return overlayHit;
    const seedHit = await this.tryLoad(seed, name);
    return seedHit;
  }

  async list(tenant: string): Promise<LibraryEntry[]> {
    const seen = new Set<string>();
    const out: LibraryEntry[] = [];

    const overlayDir = path.join(this.baseDir, "lib", tenant);
    await this.collectDir(overlayDir, tenant, seen, out);

    if (!isReservedTenantId(tenant)) {
      const seedDir = path.join(this.baseDir, "lib", "__seed__");
      await this.collectDir(seedDir, "__seed__", seen, out);
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  // --- internal -----------------------------------------------------------

  private async collectDir(
    dir: string,
    tenant: string,
    seen: Set<string>,
    out: LibraryEntry[],
  ): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const name = entry.name.slice(0, -3);
      if (seen.has(name)) continue;
      const file = path.join(dir, entry.name);
      const fnObj = await this.tryLoad(file, name);
      if (!fnObj) continue;
      seen.add(name);
      out.push({ name, spec: fnObj.spec });
    }
    void tenant;
  }

  private async tryLoad(
    file: string,
    expectedName: string,
  ): Promise<Fn<unknown, unknown> | null> {
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    const mtimeMs = st.mtimeMs;
    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.fn;
    }

    const poisoned = this.poison.get(file);
    if (poisoned && poisoned.mtimeMs === mtimeMs) return null;

    let mod: unknown;
    try {
      const source = await fsp.readFile(file, "utf8");
      const { rewritten, changed } = await rewriteSdkImports(source);
      let url: string;
      if (changed) {
        // The user-authored file referenced `@datafetch/sdk`. Write the
        // rewritten source to a per-mtime cache file under
        // `<repo-root>/.snippet-cache/` (NOT <baseDir>) so that bare
        // imports like `valibot` resolve naturally via Node's module
        // walk through the repo's `node_modules/`. A `.ts` extension
        // keeps tsx's loader in the path so TypeScript syntax compiles.
        const repoRoot = await locateRepoRoot();
        const cacheDir = path.join(repoRoot, ".snippet-cache");
        await fsp.mkdir(cacheDir, { recursive: true });
        const safeBase = file.replace(/[^A-Za-z0-9_.-]+/g, "_");
        const cachePath = path.join(
          cacheDir,
          `${safeBase}.${mtimeMs}.ts`,
        );
        await fsp.writeFile(cachePath, rewritten, "utf8");
        url = pathToFileURL(cachePath).href;
      } else {
        url = `${pathToFileURL(file).href}?mtime=${mtimeMs}`;
      }
      mod = await import(url);
    } catch (err) {
      this.warnPoison(file, mtimeMs, err);
      return null;
    }

    const fnObj = pickExport(mod, expectedName);
    if (!fnObj) {
      this.warnPoison(
        file,
        mtimeMs,
        new Error(
          `module does not export a Fn named "${expectedName}" (or default Fn)`,
        ),
      );
      return null;
    }

    this.cache.set(file, { mtimeMs, fn: fnObj });
    enforceMapCap(this.cache, RESOLVER_CACHE_CAP);
    this.poison.delete(file);
    return fnObj;
  }

  private warnPoison(file: string, mtimeMs: number, err: unknown): void {
    const prior = this.poison.get(file);
    this.poison.set(file, { mtimeMs });
    enforceMapCap(this.poison, RESOLVER_POISON_CAP);
    if (prior && prior.mtimeMs === mtimeMs) return;
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[snippet/library] failed to load ${file}: ${msg}`);
  }
}

// --- Module-level helpers --------------------------------------------------

// A loaded module exports a typed callable named after the file. Accept
// either `<expectedName>` or a `default` export shape (the file may also
// re-export from elsewhere via `export { x } from "..."`).
function pickExport(
  mod: unknown,
  expectedName: string,
): Fn<unknown, unknown> | null {
  if (mod === null || typeof mod !== "object") return null;
  const record = mod as Record<string, unknown>;
  const named = record[expectedName];
  if (isFnCallable(named)) return named;
  const def = record["default"];
  if (isFnCallable(def)) return def;
  // Last resort: scan exports for any Fn-shaped value.
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (isFnCallable(value)) return value;
  }
  return null;
}

function isFnCallable(value: unknown): value is Fn<unknown, unknown> {
  if (typeof value !== "function") return false;
  const candidate = value as Fn<unknown, unknown>;
  return candidate.spec !== undefined && typeof candidate.spec === "object";
}
