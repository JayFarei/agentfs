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

// --- Defaults --------------------------------------------------------------

const RESERVED_TENANT_RE = /^__\w+__$/;

function isReservedTenantId(tenantId: string): boolean {
  return RESERVED_TENANT_RE.test(tenantId);
}

function defaultBaseDir(): string {
  return (
    process.env["DATAFETCH_HOME"] ??
    process.env["ATLASFS_HOME"] ??
    path.join(process.cwd(), ".atlasfs")
  );
}

// --- Cache -----------------------------------------------------------------

type CachedFn = {
  mtimeMs: number;
  fn: Fn<unknown, unknown>;
};

// --- DiskLibraryResolver ---------------------------------------------------

export type DiskLibraryResolverOpts = {
  baseDir?: string;
};

export class DiskLibraryResolver implements LibraryResolver {
  private readonly baseDir: string;
  private readonly cache = new Map<string, CachedFn>();
  // Files that already failed to load. Logged once; subsequent attempts are
  // silent so we don't spam the logs when a malformed file is repeatedly
  // resolved during a snippet run.
  private readonly poison = new Set<string>();

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

    if (this.poison.has(file)) return null;

    let mod: unknown;
    try {
      // Cache-buster query so re-imports after a heredoc edit pick up the
      // new file content under Node's ESM loader.
      const url = `${pathToFileURL(file).href}?mtime=${mtimeMs}`;
      mod = await import(url);
    } catch (err) {
      this.warnPoison(file, err);
      return null;
    }

    const fnObj = pickExport(mod, expectedName);
    if (!fnObj) {
      this.warnPoison(
        file,
        new Error(
          `module does not export a Fn named "${expectedName}" (or default Fn)`,
        ),
      );
      return null;
    }

    this.cache.set(file, { mtimeMs, fn: fnObj });
    return fnObj;
  }

  private warnPoison(file: string, err: unknown): void {
    if (this.poison.has(file)) return;
    this.poison.add(file);
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
