// BashSession — the per-conversation bash workspace.
//
// Wraps just-bash's `Bash` instance with a `MountableFs` configured for
// this tenant + mounts. Handles seeding orientation files, mounting the
// `/db/<mount-id>/` read-only views from the injected MountReader,
// mounting the `/lib/<tenant>/` overlay (in-memory, synced to disk under
// `<baseDir>/lib/<tenantId>/`), and registering the three custom
// commands (`npx tsx`, `man`, `apropos`).
//
// IMPORTANT QUIRK (just-bash 2.x): each `bash.exec(...)` call starts a
// fresh shell state. Filesystem state PERSISTS across calls; environment
// variables, cwd changes, and shell-defined functions DO NOT. This is the
// `/AGENTS.md`-documented quirk; agents work around it by using absolute
// paths and inlining env vars on the command line. Callers of
// BashSession.exec do NOT need to handle this — they just submit one
// command at a time.
//
// /lib/ flush contract (Wave 2 review fix, P0):
//   The /lib/ overlay lives in an InMemoryFs during a session so that
//   heredoc edits are cheap. The snippet runtime (Wave 3) reads
//   /lib/<tenant>/*.ts from DISK, so before any `npx tsx` call we MUST
//   flush in-memory writes back to `<baseDir>/lib/<tenantId>/`. The
//   `npx tsx` custom command calls `flushLib()` on the live session
//   before delegating; the v1bash route also flushes on TTL eviction.
//   `flushLib()` is mtime-tracked: a file whose in-memory mtime hasn't
//   advanced since its last flush is skipped, so the per-snippet cost
//   is effectively zero when the agent isn't authoring.
//
// Skill on-disk path (Wave 2 review fix, P1):
//   Skill markdown files written to the in-VFS path
//   `/lib/skills/<name>.md` land on disk at
//   `<baseDir>/lib/<tenantId>/skills/<name>.md`. This is the canonical
//   location the in-process Flue dispatcher (Wave 3, post-fix) reads
//   from. The orientation files (`/AGENTS.md` and the SDK `SKILL.md`)
//   spell the path out so agents writing skills via heredoc know where
//   they will be picked up.

import { promises as fsp } from "node:fs";
import path from "node:path";

import {
  Bash,
  InMemoryFs,
  MountableFs,
  type Command,
  type IFileSystem,
} from "just-bash";

import { createAproposCommand } from "./commands/apropos.js";
import { createManCommand } from "./commands/man.js";
import {
  createNpxCommand,
  createPnpmCommand,
  createYarnCommand,
} from "./commands/npx.js";
import {
  renderAgentsMd,
  renderPackageJson,
  renderRootReadme,
  renderSkillMd,
  type OrientationContext,
} from "./orientation.js";
import type { MountReader } from "./mountReader.js";
import type { SessionCtx, SnippetRuntime } from "./snippetRuntime.js";
import type { LibraryResolver } from "../sdk/index.js";
import { defaultBaseDir, isReservedTenantId } from "../paths.js";

export { isReservedTenantId };

// --- Public types ----------------------------------------------------------

export type BashSessionInit = {
  tenantId: string;
  mountIds: string[];
  mountReader: MountReader;
  snippetRuntime: SnippetRuntime;
  libraryResolver: LibraryResolver | null;
  // Optional. Defaults to $DATAFETCH_HOME / $ATLASFS_HOME / .atlasfs.
  baseDir?: string;
  // Optional. If supplied, propagated through SessionCtx.trajectoryId.
  trajectoryId?: string;
};

export type BashExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// --- Helpers ---------------------------------------------------------------

// Seed an InMemoryFs with the per-mount /db/ tree. We pull README,
// per-collection module, descriptor, samples, stats up front through
// MountReader, then write them into a fresh InMemoryFs which the
// MountableFs mounts at /db/<mountId>/. This is intentionally eager —
// MVP datasets are small (FinQA's 8281 docs); the `/db/<mount>/<coll>.ts`
// modules are 400-1000 tokens each, so this is bounded and avoids
// async-readdir hooks inside the FS.
async function buildMountFs(
  reader: MountReader,
  mountId: string,
): Promise<IFileSystem> {
  const fs = new InMemoryFs();

  // README at the mount root. Best-effort.
  try {
    const readme = await reader.readReadme(mountId);
    await fs.writeFile("/README.md", readme);
  } catch {
    // No README. Continue.
  }

  // Collections.
  let collections: string[];
  try {
    collections = await reader.listCollections(mountId);
  } catch {
    collections = [];
  }

  for (const coll of collections) {
    // <coll>.ts at the mount root.
    try {
      const module = await reader.readModule(mountId, coll);
      await fs.writeFile(`/${coll}.ts`, module);
    } catch {
      // Module not present. Skip.
    }

    // Per-collection introspection sub-files.
    try {
      const descriptor = await reader.readDescriptor(mountId, coll);
      await fs.mkdir(`/${coll}`, { recursive: true });
      await fs.writeFile(
        `/${coll}/_descriptor.json`,
        `${JSON.stringify(descriptor, null, 2)}\n`,
      );
    } catch {
      // No descriptor. Continue.
    }
    try {
      const samples = await reader.readSamples(mountId, coll);
      await fs.mkdir(`/${coll}`, { recursive: true });
      await fs.writeFile(
        `/${coll}/_samples.json`,
        `${JSON.stringify(samples, null, 2)}\n`,
      );
    } catch {
      // No samples. Continue.
    }
    try {
      const stats = await reader.readStats(mountId, coll);
      await fs.mkdir(`/${coll}`, { recursive: true });
      await fs.writeFile(
        `/${coll}/_stats.json`,
        `${JSON.stringify(stats, null, 2)}\n`,
      );
    } catch {
      // No stats. Continue.
    }
  }

  return fs;
}

// Build the /lib/<tenant>/ overlay. Reads any existing TS files under
// `<baseDir>/lib/<tenantId>/` into an InMemoryFs at session start. Writes
// during the session live in memory only (the agent's heredoc edits land
// here); the snippet runtime sees them through the disk flush in
// `BashSession.flushLib()`, which the `npx tsx` command calls before
// every snippet.
//
// Also returns the initial mtime per VFS path so `flushLib()` can skip
// re-writing files that haven't been touched since session start.
async function buildLibFs(
  baseDir: string,
  tenantId: string,
): Promise<{
  fs: InMemoryFs;
  libDir: string;
  initialMtimes: Map<string, number>;
}> {
  const libDir = path.join(baseDir, "lib", tenantId);
  const fs = new InMemoryFs();
  const initialMtimes = new Map<string, number>();

  async function loadInto(vfsPath: string, diskPath: string): Promise<void> {
    const contents = await fsp.readFile(diskPath, "utf8");
    await fs.writeFile(vfsPath, contents);
    const st = await fs.stat(vfsPath);
    initialMtimes.set(vfsPath, st.mtime.getTime());
  }

  try {
    const entries = await fsp.readdir(libDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        await loadInto(`/${entry.name}`, path.join(libDir, entry.name));
      } else if (entry.isDirectory() && entry.name === "skills") {
        await fs.mkdir("/skills", { recursive: true });
        const skillsDir = path.join(libDir, "skills");
        const skills = await fsp.readdir(skillsDir, { withFileTypes: true });
        for (const skill of skills) {
          if (skill.isFile() && skill.name.endsWith(".md")) {
            await loadInto(
              `/skills/${skill.name}`,
              path.join(skillsDir, skill.name),
            );
          }
        }
      }
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
  return { fs, libDir, initialMtimes };
}

// --- BashSession -----------------------------------------------------------

export class BashSession {
  readonly tenantId: string;
  readonly mountIds: string[];
  readonly baseDir: string;
  readonly trajectoryId?: string;

  private readonly snippetRuntime: SnippetRuntime;
  private readonly libraryResolver: LibraryResolver | null;
  private readonly mountReader: MountReader;
  private libFs: InMemoryFs | null = null;
  private libDir: string | null = null;
  private bash: Bash | null = null;
  private ready: Promise<void>;
  // Per-VFS-path -> last flushed mtime (ms epoch). Skips re-writing files
  // whose in-memory mtime has not advanced since the last flush. Files
  // not present in this map fall through and get written. This makes
  // pre-snippet flushes effectively free when the agent isn't authoring.
  private flushedMtimes: Map<string, number> = new Map();

  constructor(init: BashSessionInit) {
    this.tenantId = init.tenantId;
    this.mountIds = init.mountIds;
    this.baseDir = init.baseDir ?? defaultBaseDir();
    if (init.trajectoryId !== undefined) {
      this.trajectoryId = init.trajectoryId;
    }
    this.mountReader = init.mountReader;
    this.snippetRuntime = init.snippetRuntime;
    this.libraryResolver = init.libraryResolver;
    this.ready = this.initialise();
  }

  // Run one bash command in this session. Filesystem persists; shell state
  // resets per just-bash semantics. Returns stdout/stderr/exitCode.
  async exec(command: string): Promise<BashExecResult> {
    await this.ready;
    if (!this.bash) {
      throw new Error("BashSession: not initialised");
    }
    const result = await this.bash.exec(command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  // Flush /lib/ in-memory contents back to disk under
  // `<baseDir>/lib/<tenantId>/`. Idempotent: per-file mtime is tracked,
  // and files whose in-memory mtime has not advanced since the last
  // flush are skipped. Cheap when nothing changed (no disk writes, only
  // an mtime stat per VFS file).
  //
  // Called automatically before every `npx tsx` snippet so the snippet
  // runtime sees the agent's latest /lib/ writes. Also called on TTL
  // eviction in v1bash.ts so authored work isn't lost when a session
  // expires.
  //
  // Skill markdown files at the in-VFS path `/lib/skills/<name>.md`
  // land on disk at `<baseDir>/lib/<tenantId>/skills/<name>.md` — the
  // canonical path the in-process Flue dispatcher reads from.
  async flushLib(): Promise<void> {
    await this.ready;
    if (!this.libFs || !this.libDir) return;

    const allPaths = this.libFs.getAllPaths();
    // Collect work first so we don't mkdir the libDir when there's
    // nothing to write.
    const toWrite: Array<{ vfsPath: string; onDisk: string; mtimeMs: number }> = [];
    for (const p of allPaths) {
      if (!p.endsWith(".ts") && !p.endsWith(".md")) continue;
      let st;
      try {
        st = await this.libFs.stat(p);
      } catch {
        continue;
      }
      if (!st.isFile) continue;
      const mtimeMs = st.mtime.getTime();
      const lastFlushed = this.flushedMtimes.get(p);
      if (lastFlushed !== undefined && lastFlushed >= mtimeMs) {
        // Already on disk at this version; skip.
        continue;
      }
      const rel = p.replace(/^\/+/, "");
      toWrite.push({
        vfsPath: p,
        onDisk: path.join(this.libDir, rel),
        mtimeMs,
      });
    }

    if (toWrite.length === 0) return;

    await fsp.mkdir(this.libDir, { recursive: true });
    for (const job of toWrite) {
      const content = await this.libFs.readFile(job.vfsPath);
      await fsp.mkdir(path.dirname(job.onDisk), { recursive: true });
      await fsp.writeFile(job.onDisk, content, "utf8");
      this.flushedMtimes.set(job.vfsPath, job.mtimeMs);
    }
  }

  // Build the SessionCtx threaded through `npx tsx` snippet executions.
  sessionCtx(): SessionCtx {
    const ctx: SessionCtx = {
      tenantId: this.tenantId,
      mountIds: this.mountIds,
      baseDir: this.baseDir,
    };
    if (this.trajectoryId !== undefined) {
      ctx.trajectoryId = this.trajectoryId;
    }
    return ctx;
  }

  // --- internal -----------------------------------------------------------

  private async initialise(): Promise<void> {
    // 1. Build the per-mount filesystems.
    const mounts: Array<{ mountPoint: string; filesystem: IFileSystem }> = [];
    for (const mountId of this.mountIds) {
      const mfs = await buildMountFs(this.mountReader, mountId);
      mounts.push({ mountPoint: `/db/${mountId}`, filesystem: mfs });
    }

    // 2. Build the /lib/ overlay.
    const lib = await buildLibFs(this.baseDir, this.tenantId);
    this.libFs = lib.fs;
    this.libDir = lib.libDir;
    // Files just loaded from disk are already on disk at this version;
    // record their mtimes so `flushLib()` doesn't write them back
    // immediately on the first `npx tsx` call.
    for (const [vfsPath, mtimeMs] of lib.initialMtimes) {
      this.flushedMtimes.set(vfsPath, mtimeMs);
    }
    mounts.push({ mountPoint: `/lib`, filesystem: lib.fs });

    // 3. Ephemeral /tmp/.
    mounts.push({ mountPoint: `/tmp`, filesystem: new InMemoryFs() });

    // 4. Compose the MountableFs. Base is an InMemoryFs that holds
    //    orientation files at the root (/AGENTS.md, /CLAUDE.md,
    //    /README.md, /package.json) and the SDK skill bundle.
    const base = new InMemoryFs();
    const orientationCtx: OrientationContext = {
      tenantId: this.tenantId,
      mountIds: this.mountIds,
      libFunctions: await this.snapshotLibFunctions(lib.fs),
    };
    const agentsMd = await this.readWorkspaceAgentsMd(orientationCtx);
    await base.writeFile("/AGENTS.md", agentsMd);
    await base.writeFile("/CLAUDE.md", agentsMd);
    await base.writeFile("/README.md", renderRootReadme());
    await base.writeFile("/package.json", renderPackageJson(orientationCtx));
    await base.mkdir("/usr/share/datafetch/skill", { recursive: true });
    await base.writeFile(
      "/usr/share/datafetch/skill/SKILL.md",
      renderSkillMd(),
    );
    // /db/ root dir so `ls /db /lib` works even before any mount registers.
    await base.mkdir("/db", { recursive: true });

    const fs = new MountableFs({ base, mounts });

    // 5. Custom commands. The npx-family commands receive a
    //    `beforeRun` hook bound to `this.flushLib()` so the snippet
    //    runtime always sees the agent's latest /lib/ writes.
    const beforeRun = (): Promise<void> => this.flushLib();
    const customCommands: Command[] = [
      createNpxCommand({
        resolveSessionCtx: () => this.sessionCtx(),
        resolveRuntime: () => this.snippetRuntime,
        beforeRun,
      }),
      createPnpmCommand({
        resolveSessionCtx: () => this.sessionCtx(),
        resolveRuntime: () => this.snippetRuntime,
        beforeRun,
      }),
      createYarnCommand({
        resolveSessionCtx: () => this.sessionCtx(),
        resolveRuntime: () => this.snippetRuntime,
        beforeRun,
      }),
      createManCommand({
        resolveTenant: () => this.tenantId,
        resolveLibrary: () => this.libraryResolver,
      }),
      createAproposCommand({
        resolveTenant: () => this.tenantId,
        resolveLibrary: () => this.libraryResolver,
      }),
    ];

    // 6. Construct the Bash instance.
    this.bash = new Bash({
      fs,
      cwd: "/",
      customCommands,
    });
  }

  // Snapshot /lib/<tenant>/ TS file basenames at session start, used to
  // populate the orientation /AGENTS.md function list.
  private async snapshotLibFunctions(libFs: InMemoryFs): Promise<string[]> {
    try {
      const names = await libFs.readdir("/");
      return names
        .filter((n) => n.endsWith(".ts"))
        .map((n) => n.slice(0, -3))
        .sort();
    } catch {
      return [];
    }
  }

  private async readWorkspaceAgentsMd(
    orientationCtx: OrientationContext,
  ): Promise<string> {
    try {
      return await fsp.readFile(path.join(this.baseDir, "AGENTS.md"), "utf8");
    } catch {
      return renderAgentsMd(orientationCtx);
    }
  }
}
