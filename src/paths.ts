// Shared path helpers used by every data-plane module that needs to
// resolve the on-disk workspace root or walk up to the repo root.
//
// Centralising these eliminates two classes of drift:
//   1. Inconsistent base-dir fallbacks. Modules that fell back to
//      `.datafetch` while everyone else fell back to `.atlasfs` would
//      silently land artefacts in the wrong directory and the snippet
//      runtime would not see them.
//   2. Repeated upward-walk loops looking for `seeds/...`,
//      `node_modules/...`, or `package.json`. Each implementation had
//      its own bound (3, 5, 6 levels) and slightly different
//      termination logic.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESERVED_TENANT_RE = /^__\w+__$/;

const DEFAULT_BASE_DIR_NAME = ".atlasfs";

const REPO_WALK_LEVELS = 6;

let repoRootCache: string | null = null;

/**
 * Resolve the on-disk workspace root.
 *
 * The chain is `DATAFETCH_HOME` → `ATLASFS_HOME` → `<cwd>/.atlasfs`.
 * `ATLASFS_HOME` is honoured for backward compatibility with the
 * prototype's fixture trees; the canonical name is `DATAFETCH_HOME`.
 */
export function defaultBaseDir(): string {
  return (
    process.env["DATAFETCH_HOME"] ??
    process.env["ATLASFS_HOME"] ??
    path.join(process.cwd(), DEFAULT_BASE_DIR_NAME)
  );
}

/**
 * Walk up from the given `from` path looking for a directory whose
 * predicate returns `true`. Returns that directory's absolute path, or
 * `null` if the walk hits the filesystem root without a hit.
 *
 * Used by the repo-root and seed-dir lookups; the bound matches
 * pnpm/git monorepo conventions where the dir-of-interest is rarely
 * more than a handful of levels deep from any source file.
 */
export async function walkUpFor(
  from: string,
  predicate: (dir: string) => Promise<boolean>,
  levels: number = REPO_WALK_LEVELS,
): Promise<string | null> {
  let cursor = from;
  for (let i = 0; i < levels; i += 1) {
    if (await predicate(cursor)) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

/**
 * Resolve the repo root containing `src/sdk/index.ts` and `package.json`.
 * Cached after first lookup; stable across the process lifetime.
 *
 * Falls back to `process.cwd()` if the walk fails — useful in test
 * environments where the runtime ran from an unexpected directory.
 */
export async function locateRepoRoot(): Promise<string> {
  if (repoRootCache) return repoRootCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = await walkUpFor(here, async (dir) => {
    try {
      const sdkStat = await fsp.stat(path.join(dir, "src", "sdk", "index.ts"));
      const pkgStat = await fsp.stat(path.join(dir, "package.json"));
      return sdkStat.isFile() && pkgStat.isFile();
    } catch {
      return false;
    }
  });
  repoRootCache = found ?? process.cwd();
  return repoRootCache;
}

/**
 * Locate a directory relative to the repo root, e.g.
 * `locateRepoSubdir("seeds/lib")` → `<repo>/seeds/lib`. Returns null if
 * the subdir does not exist.
 */
export async function locateRepoSubdir(rel: string): Promise<string | null> {
  const root = await locateRepoRoot();
  const candidate = path.join(root, rel);
  try {
    const stat = await fsp.stat(candidate);
    if (stat.isDirectory()) return candidate;
  } catch {
    // missing
  }
  return null;
}

/**
 * Predicate for the reserved-tenant-id namespace (e.g. `__seed__`).
 * Reserved ids are excluded from agent-facing tenant listings even
 * though they participate in the layered `/lib/` lookup as a fallback.
 */
export function isReservedTenantId(tenantId: string): boolean {
  return RESERVED_TENANT_RE.test(tenantId);
}
