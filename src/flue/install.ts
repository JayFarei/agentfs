// Install entry point for the in-process Flue runtime.
//
// Wave 5's server rewrite calls `installFlueDispatcher({...})` once at boot,
// after `setLibraryResolver(...)` and before the first request handler runs.
// The dispatcher is registered into the SDK runtime via `setBodyDispatcher`,
// so every `fn({...})` callable with an `llm({...})` or `agent({...})` body
// flows through it.
//
// Idempotent: subsequent calls replace the existing dispatcher (with a
// warning log) — useful for tests that want to re-install with a fake pool.
//
// Seed-bundle copy: at install time we mirror the seed skills shipped with
// the SDK from `<repo>/seeds/skills/*.md` into
// `<baseDir>/lib/__seed__/skills/<name>.md` so the disk skill loader can
// find them. `__seed__` is a reserved tenant id (the bash agent's library
// listing excludes tenant ids matching `^__\w+__$`). The mirror is
// best-effort; missing seeds are warned-but-tolerated.

import { promises as fs } from "node:fs";
import path from "node:path";

import { defaultBaseDir, locateRepoSubdir } from "../paths.js";

import {
  getBodyDispatcher,
  setBodyDispatcher,
} from "../sdk/runtime.js";

import { FlueBodyDispatcher } from "./dispatcher.js";
import { FlueSessionPool } from "./session.js";
import type { SkillLoader } from "./skill.js";

export type InstallFlueDispatcherOpts = {
  /** Reuse an existing pool (e.g. from a test harness) instead of constructing one. */
  pool?: FlueSessionPool;
  /** Override the disk skill loader (e.g. with an in-memory fixture). */
  skills?: SkillLoader;
  /**
   * Datafetch home for the disk skill loader. Falls back to
   * `DATAFETCH_HOME`/`ATLASFS_HOME`/`./.datafetch`.
   */
  baseDir?: string;
  /**
   * Skip the seed-skill mirror step. Default false; tests may want to
   * disable it when they're injecting their own SkillLoader.
   */
  skipSeedMirror?: boolean;
};

export type InstallResult = {
  pool: FlueSessionPool;
  dispatcher: FlueBodyDispatcher;
  baseDir: string;
};

export async function installFlueDispatcher(
  opts: InstallFlueDispatcherOpts = {},
): Promise<InstallResult> {
  const baseDir = opts.baseDir ?? defaultBaseDir();

  const pool = opts.pool ?? new FlueSessionPool();
  const dispatcher = new FlueBodyDispatcher({
    pool,
    skills: opts.skills,
    baseDir,
  });

  const previous = getBodyDispatcher();
  if (previous !== null) {
    // eslint-disable-next-line no-console
    console.warn(
      "[flue] installFlueDispatcher: replacing existing BodyDispatcher",
    );
  }
  setBodyDispatcher(dispatcher);

  if (!opts.skipSeedMirror) {
    await mirrorSeedSkills(baseDir);
  }

  return { pool, dispatcher, baseDir };
}

// --- Seed mirror -----------------------------------------------------------

// Copy `<repo>/seeds/skills/*.md` into `<baseDir>/lib/__seed__/skills/`.
// Walks the package tree by following `import.meta.url`. If the seed
// bundle can't be located (e.g. when running from a bundled deployment
// that omits the seeds dir), this becomes a warn-only no-op.
async function mirrorSeedSkills(baseDir: string): Promise<void> {
  const sourceDir = await locateRepoSubdir(path.join("seeds", "skills"));
  if (sourceDir === null) {
    // eslint-disable-next-line no-console
    console.warn(
      "[flue] seed-skill mirror: could not locate seeds/skills/; " +
        "agent({skill}) bodies will require tenant-overlay skills.",
    );
    return;
  }
  const targetDir = path.join(baseDir, "lib", "__seed__", "skills");
  await fs.mkdir(targetDir, { recursive: true });
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    const content = await fs.readFile(src, "utf8");
    await fs.writeFile(dst, content, "utf8");
  }
}
