// Goal 4 iter 1 — artifact walker (metric instrumentation).
//
// The learning-honest rubric R6-R9 (PLAN.md § Goal 4) is not scoreable
// from `episodes.jsonl` alone: those rows carry COUNTS
// (`libFunctionsAvailable`, `libFunctionsUsed`, ...) but not the helper
// NAMES, the called-helper identities, the seed-vs-learned distinction,
// the per-helper origin, or quarantine state.
//
// This pass walks each episode's on-disk artifacts and emits one
// enriched instrumentation row per episode. It is strictly read-only —
// no substrate behaviour change. The output (`helper-instrumentation.jsonl`)
// is consumed by the Goal 4 scoring step (a later iter) to compute:
//   R6 convergence rate   — helpers whose origin cluster has >= 2 trajectories
//   R7 conditional reuse  — warm episodes that call an available learned helper
//   R8 conditional cost   — reuse-episode tokens vs same-intent non-reuse
//   R9 cross-shape xfer   — one intentSignature reused across families
//
// Origin truth source: the persisted hook manifests under
// `hooks/<tenant>/*.json` have EMPTY `origin.trajectoryIds` because they
// are re-created when the lib-cache is hydrated into a fresh episode's
// datafetch-home. The crystallised `.ts` files themselves carry the
// stable provenance in header comments (`@shape-hash:`,
// `@origin-trajectory:`, and — once Goal 4 iter 3 lands — `@intent-signature:`).
// So this walker reads the `.ts` headers, not the JSON manifests, for
// origin.
//
// Usage:
//   tsx eval/skillcraft/scripts/walk-artifacts.ts --run <runDir> [--run <runDir> ...] --out <file>
// A sharded full-126 run has 4 sibling `-g1..-g4` dirs; pass each as a
// separate --run, or pass the un-suffixed base dir to auto-discover them.

import { promises as fsp } from "node:fs";
import path from "node:path";

interface Args {
  runs: string[];
  out: string;
}

// The substrate-level seed. It is shipped under `lib/__seed__/`, not
// crystallised from a trajectory — so it must be excluded from
// "learned-helper" reuse counts (R7). This is the ONE substrate-level
// helper name; it is not a SkillCraft family/tool identifier.
const SEED_HELPER_NAMES = new Set<string>(["per_entity"]);

interface HelperOrigin {
  name: string;
  // Stable shape hash stamped in the crystallised file header.
  shapeHash: string | null;
  // The trajectory the observer authored this helper from.
  originTrajectory: string | null;
  // Goal 4 iter 3 will stamp `@intent-signature:` into authored files;
  // until then this stays null and R6/R9 fall back to shapeHash.
  intentSignature: string | null;
  // True for the substrate seed (per_entity) — excluded from learned
  // reuse metrics.
  isSeed: boolean;
}

interface EpisodeInstrumentation {
  taskKey: string;
  family: string;
  level: string;
  phase: "train" | "warm" | "hard" | "unknown";
  trajectoryId: string | null;
  // Names visible to the agent at episode start (hydrated lib-cache).
  helpersAvailable: string[];
  // Names present after the agent finished (workspace lib snapshot).
  helpersAfterAgent: string[];
  // helpersAfterAgent minus helpersAvailable — newly authored this episode.
  helpersCreatedThisEpisode: string[];
  // Learned-helper lib.* calls in the answer trajectory (seed EXCLUDED).
  helpersCalled: string[];
  // Whether the substrate seed (per_entity) was called.
  seedCalled: boolean;
  libCalls: number;
  toolCalls: number;
  // Helpers whose hook manifest marks them quarantined.
  quarantinedHelpers: string[];
  // Provenance for every helper file seen in this episode's
  // datafetch-home lib overlay + the run-level lib-cache.
  helperOrigins: HelperOrigin[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { runs: [], out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run") args.runs.push(path.resolve(argv[++i]!));
    else if (arg.startsWith("--run=")) args.runs.push(path.resolve(arg.slice("--run=".length)));
    else if (arg === "--out") args.out = path.resolve(argv[++i]!);
    else if (arg.startsWith("--out=")) args.out = path.resolve(arg.slice("--out=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.runs.length === 0) throw new Error("pass at least one --run <dir>");
  if (!args.out) throw new Error("pass --out <file>");
  return args;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

// A sharded run dir like `.../goal3-iter14-full-20260513-113222` has
// siblings `-g1`..`-g4` that hold the actual episodes. Resolve the
// concrete shard dirs (each with its own `episodes.jsonl`).
async function resolveRunDirs(runArg: string): Promise<string[]> {
  if (await exists(path.join(runArg, "episodes.jsonl"))) return [runArg];
  const parent = path.dirname(runArg);
  const base = path.basename(runArg);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  const shards = entries
    .filter((e) => e.isDirectory() && /^.+-g\d+$/.test(e.name) && e.name.startsWith(base))
    .map((e) => path.join(parent, e.name))
    .sort();
  return shards.length > 0 ? shards : [];
}

function phaseForLevel(level: string): EpisodeInstrumentation["phase"] {
  if (level === "e1") return "train";
  if (level === "h1") return "hard";
  if (["e2", "e3", "m1", "m2"].includes(level)) return "warm";
  return "unknown";
}

// Pull the provenance header comments out of a crystallised helper file.
// Authored files (see src/observer/author.ts) carry, e.g.:
//   // @shape-hash: a7f7eb6c
//   // @origin-trajectory: traj_20260513084849_luqe9r
//   // @intent-signature: <added by Goal 4 iter 3>
// Agent-hand-authored helpers and the seed have no @shape-hash; for
// those origin stays null and `isSeed` is decided by name.
function parseHelperHeader(source: string, name: string): HelperOrigin {
  const shapeHash = source.match(/@shape-hash:\s*([0-9a-f]{6,})/)?.[1] ?? null;
  const originTrajectory = source.match(/@origin-trajectory:\s*(\S+)/)?.[1] ?? null;
  const intentSignature = source.match(/@intent-signature:\s*(\S+)/)?.[1] ?? null;
  return {
    name,
    shapeHash,
    originTrajectory,
    intentSignature,
    isSeed: SEED_HELPER_NAMES.has(name),
  };
}

// Read every *.ts helper file under a directory, returning name -> origin.
async function readHelperOrigins(
  dir: string,
): Promise<Map<string, HelperOrigin>> {
  const out = new Map<string, HelperOrigin>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const name = entry.name.slice(0, -3);
    let source: string;
    try {
      source = await fsp.readFile(path.join(dir, entry.name), "utf8");
    } catch {
      continue;
    }
    out.set(name, parseHelperHeader(source, name));
  }
  return out;
}

// Quarantined helper names from the per-tenant hook manifest dir.
async function readQuarantined(hooksTenantDir: string): Promise<string[]> {
  const quarantined: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(hooksTenantDir, { withFileTypes: true });
  } catch {
    return quarantined;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const manifest = await readJson<{ name?: string; callability?: string }>(
      path.join(hooksTenantDir, entry.name),
    );
    if (manifest?.callability === "quarantined") {
      quarantined.push(manifest.name ?? entry.name.slice(0, -5));
    }
  }
  return quarantined;
}

// The single sub-directory under `lib/` or `hooks/` that is the tenant
// overlay (e.g. `skillcraft-full`). Discovered, not hardcoded, so the
// walker stays tenant-agnostic. `__seed__` is skipped.
async function findTenantDir(parent: string): Promise<string | null> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "__seed__") {
      return path.join(parent, entry.name);
    }
  }
  return null;
}

async function walkEpisode(
  episode: Record<string, unknown>,
  runDir: string,
): Promise<EpisodeInstrumentation | null> {
  const family = String(episode["family"] ?? episode["taskFamily"] ?? "");
  const level = String(episode["level"] ?? episode["round"] ?? "");
  const taskKey = String(episode["taskKey"] ?? `scaled_tasks/${family}/${level}`);
  if (!family || !level) return null;

  // artifactPath is repo-root-relative; resolve against the repo root,
  // falling back to <runDir>/episodes/<family>/<level>.
  const artifactRel = typeof episode["artifactPath"] === "string"
    ? (episode["artifactPath"] as string)
    : null;
  const repoRoot = path.resolve(process.cwd());
  let artifactDir = artifactRel
    ? path.resolve(repoRoot, artifactRel)
    : path.join(runDir, "episodes", family, level);
  if (!(await exists(artifactDir))) {
    artifactDir = path.join(runDir, "episodes", family, level);
  }

  const libStatus = await readJson<{
    availableAtStart?: string[];
    functionsAfterAgent?: string[];
    libCalls?: number;
    toolCalls?: number;
  }>(path.join(artifactDir, "lib-status.json"));
  const helpersAvailable = libStatus?.availableAtStart ?? [];
  const helpersAfterAgent = libStatus?.functionsAfterAgent ?? [];
  const availableSet = new Set(helpersAvailable);
  const helpersCreatedThisEpisode = helpersAfterAgent.filter(
    (n) => !availableSet.has(n),
  );

  const snippetResult = await readJson<{ trajectoryId?: string }>(
    path.join(artifactDir, "snippet-result.json"),
  );
  const trajectoryId = snippetResult?.trajectoryId ?? null;

  // Extract the lib.* calls from the answer trajectory.
  let helpersCalled: string[] = [];
  let seedCalled = false;
  if (trajectoryId) {
    const traj = await readJson<{ calls?: Array<{ primitive?: string }> }>(
      path.join(artifactDir, "datafetch-home", "trajectories", `${trajectoryId}.json`),
    );
    const libNames = new Set<string>();
    for (const call of traj?.calls ?? []) {
      const prim = call.primitive ?? "";
      if (!prim.startsWith("lib.")) continue;
      const name = prim.slice("lib.".length);
      if (SEED_HELPER_NAMES.has(name)) {
        seedCalled = true;
      } else {
        libNames.add(name);
      }
    }
    helpersCalled = Array.from(libNames).sort();
  }

  // Helper origins: union of the episode's datafetch-home lib overlay
  // and the run-level lib-cache for this family.
  const dfHomeLibParent = path.join(artifactDir, "datafetch-home", "lib");
  const tenantLibDir = await findTenantDir(dfHomeLibParent);
  const originMap = new Map<string, HelperOrigin>();
  if (tenantLibDir) {
    for (const [k, v] of await readHelperOrigins(tenantLibDir)) originMap.set(k, v);
  }
  const seedDir = path.join(dfHomeLibParent, "__seed__");
  for (const [k, v] of await readHelperOrigins(seedDir)) {
    if (!originMap.has(k)) originMap.set(k, { ...v, isSeed: true });
  }
  const libCacheFamilyDir = path.join(runDir, "lib-cache", family);
  for (const [k, v] of await readHelperOrigins(libCacheFamilyDir)) {
    if (!originMap.has(k)) originMap.set(k, v);
  }

  // Quarantined helpers from the hook manifest dir.
  const dfHomeHooksParent = path.join(artifactDir, "datafetch-home", "hooks");
  const tenantHooksDir = await findTenantDir(dfHomeHooksParent);
  const quarantinedHelpers = tenantHooksDir
    ? await readQuarantined(tenantHooksDir)
    : [];

  return {
    taskKey,
    family,
    level,
    phase: phaseForLevel(level),
    trajectoryId,
    helpersAvailable,
    helpersAfterAgent,
    helpersCreatedThisEpisode,
    helpersCalled,
    seedCalled,
    libCalls: libStatus?.libCalls ?? 0,
    toolCalls: libStatus?.toolCalls ?? 0,
    quarantinedHelpers,
    helperOrigins: Array.from(originMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
}

async function readEpisodes(runDir: string): Promise<Array<Record<string, unknown>>> {
  const file = path.join(runDir, "episodes.jsonl");
  let text: string;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runDirs: string[] = [];
  for (const runArg of args.runs) {
    const resolved = await resolveRunDirs(runArg);
    if (resolved.length === 0) {
      console.warn(`[walk-artifacts] no episodes.jsonl under ${runArg} (or its -g* shards)`);
    }
    runDirs.push(...resolved);
  }

  const rows: EpisodeInstrumentation[] = [];
  for (const runDir of runDirs) {
    const episodes = await readEpisodes(runDir);
    for (const episode of episodes) {
      if (episode["mode"] !== "datafetch") continue;
      const row = await walkEpisode(episode, runDir);
      if (row) rows.push(row);
    }
  }

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(
    args.out,
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  console.log(
    `[walk-artifacts] wrote ${rows.length} instrumentation rows to ${args.out}`,
  );
}

main().catch((err) => {
  console.error("[walk-artifacts] failed:", err);
  process.exit(1);
});
