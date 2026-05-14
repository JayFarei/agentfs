// Goal 4 iter 2 — offline intentSignature analyzer (the critical de-risk).
//
// Before touching the observer gate, prove that a data-shape-agnostic
// `intentSignature` actually clusters trajectories cleanly. The
// architect's biggest-risk call: an over-coarse signature merges
// unrelated workflows; an over-fine one fragments one intent into many.
// This script computes a CANDIDATE signature over the existing iter14/15
// trajectory artifacts, clusters by it, and reports:
//   - cluster count + sizes
//   - cross-shape spread (distinct families per cluster — HIGH is good:
//     it means one signature spans different data shapes, which is R9)
//   - within-cluster coherence (do the member trajectories share the
//     same primitive-category skeleton? a cluster with mixed skeletons
//     is a signature bug)
//   - varying-vs-constant input fields per cluster (what parameterised
//     authoring would have to promote to inputs)
//   - a dry-run helper schema sketch per cluster
//
// Strictly offline + read-only. No substrate code touched. The decision
// gate: if the top clusters do not look like stable, sensible intents,
// Goal 4 stops here and the signature spec is reconsidered.
//
// Usage:
//   tsx eval/skillcraft/scripts/intent-cluster-analysis.ts --run <dir> [--run <dir> ...] --out <file>

import { promises as fsp } from "node:fs";
import path from "node:path";

interface Args {
  runs: string[];
  out: string;
}

interface TrajectoryCall {
  primitive?: string;
  input?: unknown;
  output?: unknown;
  scope?: { depth?: number; parentPrimitive?: string } | null;
}

interface Trajectory {
  id: string;
  tenantId?: string;
  calls: TrajectoryCall[];
  errored?: boolean;
}

interface AnalyzedTrajectory {
  trajectoryId: string;
  family: string;
  level: string;
  intentSignature: string;
  // The category skeleton, e.g. ["db", "FANOUT(tool,3)", "lib"].
  skeleton: string[];
  // Per-step: the input field names (the "capability slots" candidate
  // parameters), and which fields' values vary vs are constant across
  // the fan-out runs.
  callShapes: Array<{
    label: string; // e.g. "db.findExact", "FANOUT(tool,3)", "lib"
    inputFields: string[];
  }>;
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
  return entries
    .filter((e) => e.isDirectory() && /^.+-g\d+$/.test(e.name) && e.name.startsWith(base))
    .map((e) => path.join(parent, e.name))
    .sort();
}

// --- intentSignature -------------------------------------------------------
//
// CANDIDATE SPEC v2 (iter 2 — refined from the v1 cluster-purity report).
//
// v1 keyed fan-out runs on (category + input-field-set). Two problems
// surfaced in the v1 report:
//   A. Capability slots became a noisy UNION of every family's concrete
//      field names (breed_name, monster_name, user_id, ...) — 18 slots
//      on the top cluster. A generic helper cannot take 18 disjoint
//      params. The slot abstraction has to be STRUCTURAL (counts/roles),
//      not nominal.
//   B. Interleaved multi-tool fan-out (A,B,C,A,B,C per entity) did not
//      collapse, because A's input fields != B's input fields broke the
//      consecutive run.
//
// v2 fixes both:
//   1. Map each call to a CATEGORY: db / lib / tool. Concrete names
//      dropped — data-shape-agnostic.
//   2. Collapse a maximal run of >= 2 consecutive SAME-CATEGORY calls
//      into FANOUT(category, degreeBucket). No input-field-set
//      constraint — so interleaved A,B,C,A,B,C collapses too (fix B).
//   3. The signature carries STRUCTURE, not names: per FANOUT node,
//      `distinctShapes` (how many distinct input-field-sets appear in
//      the run = the "tool cycle width") and, across the run,
//      `varyingFieldCount` / `sharedFieldCount` (fix A). Concrete field
//      names are kept only as `exampleFields` for the human report,
//      never in the signature key.
//   4. signature = "→"-joined skeleton, where a FANOUT node is
//      `FANOUT(cat,degreeBucket,cycle<distinctShapes>)`.
//
// Example: db.records.findExact → tool.A(name)×1 tool.B(class)×1
//   tool.C(race)×1 repeated 3× (9 tool calls) → lib
//   skeleton = ["db", "FANOUT(tool,6+,cycle3)", "lib"]
// A different tenant: db.cases.search → tool.X(case_id)×5 → lib
//   skeleton = ["db", "FANOUT(tool,3-5,cycle1)", "lib"]
// They differ only in degree/cycle buckets — both are recognisably
// "retrieve-then-fan-out-then-aggregate", and the cross-family report
// shows how widely each skeleton spreads.

function categoryOf(primitive: string): "db" | "lib" | "tool" | "other" {
  if (primitive.startsWith("db.")) return "db";
  if (primitive.startsWith("lib.")) return "lib";
  if (primitive.startsWith("tool.")) return "tool";
  return "other";
}

function inputFieldSet(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return "<atom>";
  }
  return Object.keys(input as Record<string, unknown>).sort().join(",");
}

function bucketDegree(n: number): string {
  if (n <= 2) return "2";
  if (n <= 5) return "3-5";
  return "6+";
}

// Within a fan-out run, partition input fields into VARYING (value
// differs across at least two calls) and SHARED (same value everywhere
// it appears). Returns structural counts + a few example field names.
function analyzeFanoutFields(run: TrajectoryCall[]): {
  varyingFieldCount: number;
  sharedFieldCount: number;
  distinctShapes: number;
  exampleVaryingFields: string[];
  exampleSharedFields: string[];
} {
  const fieldValues = new Map<string, Set<string>>();
  const shapes = new Set<string>();
  for (const call of run) {
    shapes.add(inputFieldSet(call.input));
    const input = call.input;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      continue;
    }
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const set = fieldValues.get(k) ?? new Set<string>();
      try {
        set.add(JSON.stringify(v));
      } catch {
        set.add(String(v));
      }
      fieldValues.set(k, set);
    }
  }
  const varying: string[] = [];
  const shared: string[] = [];
  for (const [k, vals] of fieldValues) {
    if (vals.size > 1) varying.push(k);
    else shared.push(k);
  }
  return {
    varyingFieldCount: varying.length,
    sharedFieldCount: shared.length,
    distinctShapes: shapes.size,
    exampleVaryingFields: varying.sort().slice(0, 6),
    exampleSharedFields: shared.sort().slice(0, 6),
  };
}

function computeIntentSignature(calls: TrajectoryCall[]): {
  signature: string;
  skeleton: string[];
  callShapes: AnalyzedTrajectory["callShapes"];
} {
  const skeleton: string[] = [];
  const callShapes: AnalyzedTrajectory["callShapes"] = [];
  let i = 0;
  while (i < calls.length) {
    const call = calls[i]!;
    const cat = categoryOf(call.primitive ?? "");
    if (cat === "other") {
      i += 1;
      continue;
    }
    // Extend a fan-out run: maximal run of >= 2 consecutive SAME-CATEGORY
    // calls (no input-field-set constraint — fix B).
    let j = i + 1;
    while (j < calls.length && categoryOf(calls[j]!.primitive ?? "") === cat) {
      j += 1;
    }
    const runLen = j - i;
    if (runLen >= 2) {
      const run = calls.slice(i, j);
      const fields = analyzeFanoutFields(run);
      const node = `FANOUT(${cat},${bucketDegree(runLen)},cycle${fields.distinctShapes})`;
      skeleton.push(node);
      callShapes.push({
        label:
          `${node} varying=${fields.varyingFieldCount} shared=${fields.sharedFieldCount}` +
          ` [${fields.exampleVaryingFields.join("/")}|${fields.exampleSharedFields.join("/")}]`,
        // Structural: the count of varying + shared fields, NOT the
        // union of concrete names. exampleFields stay in the label only.
        inputFields: [
          `varying:${fields.varyingFieldCount}`,
          `shared:${fields.sharedFieldCount}`,
        ],
      });
    } else {
      skeleton.push(cat);
      const method = (call.primitive ?? "").split(".").slice(-1)[0] ?? "";
      const fieldSet = inputFieldSet(call.input);
      callShapes.push({
        label: `${cat}.${method}`,
        inputFields: fieldSet === "<atom>" ? [] : [`fields:${fieldSet.split(",").length}`],
      });
    }
    i = j;
  }
  return { signature: skeleton.join("→"), skeleton, callShapes };
}

// --- walk + cluster --------------------------------------------------------

async function readEpisodes(runDir: string): Promise<Array<Record<string, unknown>>> {
  let text: string;
  try {
    text = await fsp.readFile(path.join(runDir, "episodes.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function analyzeRun(runDir: string): Promise<AnalyzedTrajectory[]> {
  const out: AnalyzedTrajectory[] = [];
  const episodes = await readEpisodes(runDir);
  for (const episode of episodes) {
    if (episode["mode"] !== "datafetch") continue;
    const family = String(episode["family"] ?? episode["taskFamily"] ?? "");
    const level = String(episode["level"] ?? episode["round"] ?? "");
    if (!family || !level) continue;
    const artifactRel = typeof episode["artifactPath"] === "string"
      ? (episode["artifactPath"] as string)
      : null;
    let artifactDir = artifactRel
      ? path.resolve(process.cwd(), artifactRel)
      : path.join(runDir, "episodes", family, level);
    if (!(await exists(artifactDir))) {
      artifactDir = path.join(runDir, "episodes", family, level);
    }
    const snippetResult = await readJson<{ trajectoryId?: string }>(
      path.join(artifactDir, "snippet-result.json"),
    );
    const trajectoryId = snippetResult?.trajectoryId;
    if (!trajectoryId) continue;
    const traj = await readJson<Trajectory>(
      path.join(artifactDir, "datafetch-home", "trajectories", `${trajectoryId}.json`),
    );
    if (!traj || !Array.isArray(traj.calls) || traj.calls.length === 0) continue;
    const { signature, skeleton, callShapes } = computeIntentSignature(traj.calls);
    if (skeleton.length === 0) continue;
    out.push({
      trajectoryId,
      family,
      level,
      intentSignature: signature,
      skeleton,
      callShapes,
    });
  }
  return out;
}

interface ClusterReport {
  intentSignature: string;
  count: number;
  families: string[];
  // cross-shape spread: distinct families. >1 is the R9 signal.
  familyCount: number;
  // within-cluster coherence: do all members share the exact skeleton?
  // (they must, since the signature IS the skeleton — so this is 1.0 by
  // construction; kept as an explicit assertion the report can verify.)
  skeletonCoherent: boolean;
  // capability slots: the union of input field names across the
  // cluster's call shapes — these are the candidate parameters a
  // generic helper would expose.
  capabilitySlots: string[];
  members: Array<{ family: string; level: string; trajectoryId: string }>;
}

function buildClusters(rows: AnalyzedTrajectory[]): ClusterReport[] {
  const bySig = new Map<string, AnalyzedTrajectory[]>();
  for (const row of rows) {
    const list = bySig.get(row.intentSignature) ?? [];
    list.push(row);
    bySig.set(row.intentSignature, list);
  }
  const clusters: ClusterReport[] = [];
  for (const [signature, members] of bySig) {
    const families = Array.from(new Set(members.map((m) => m.family))).sort();
    const skeletonStr = members[0]!.skeleton.join("→");
    const skeletonCoherent = members.every(
      (m) => m.skeleton.join("→") === skeletonStr,
    );
    const slots = new Set<string>();
    for (const m of members) {
      for (const cs of m.callShapes) {
        for (const f of cs.inputFields) slots.add(f);
      }
    }
    clusters.push({
      intentSignature: signature,
      count: members.length,
      families,
      familyCount: families.length,
      skeletonCoherent,
      capabilitySlots: Array.from(slots).sort(),
      members: members.map((m) => ({
        family: m.family,
        level: m.level,
        trajectoryId: m.trajectoryId,
      })),
    });
  }
  return clusters.sort((a, b) => b.count - a.count);
}

// A dry-run helper schema sketch for a cluster — what parameterised
// authoring (Goal 4 iter 5) would emit. NOT a real helper; a shape.
// Skeleton-driven: the param surface is determined by the intent
// skeleton, not by the (now-structural) capability-slot tokens. A
// FANOUT node contributes the per_entity-shaped param surface
// (entityValues + paramName + optional sharedInput); db/lib nodes
// contribute a generic retrieval/aggregation input.
function drySchemaForCluster(cluster: ClusterReport): string {
  const skeleton = cluster.intentSignature.split("→");
  const params = new Set<string>();
  for (const node of skeleton) {
    if (node.startsWith("FANOUT(")) {
      params.add("entityValues: Array<string|number>");
      params.add("paramName: string");
      params.add("toolNames: string[]");
      params.add("sharedInput?: Record<string, unknown>");
    } else if (node === "db") {
      params.add("filter?: Record<string, unknown>");
      params.add("limit?: number");
    } else if (node === "lib") {
      params.add("aggregateInput?: Record<string, unknown>");
    }
  }
  const paramStr = Array.from(params).join("; ");
  return `fn({ intent: "${cluster.intentSignature}", input: { ${paramStr} }, body: replays ${cluster.intentSignature} })`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runDirs: string[] = [];
  for (const runArg of args.runs) {
    runDirs.push(...(await resolveRunDirs(runArg)));
  }
  const rows: AnalyzedTrajectory[] = [];
  for (const runDir of runDirs) {
    rows.push(...(await analyzeRun(runDir)));
  }
  const clusters = buildClusters(rows);

  const multiTrajectory = clusters.filter((c) => c.count >= 2);
  const crossFamily = clusters.filter((c) => c.familyCount >= 2);
  const incoherent = clusters.filter((c) => !c.skeletonCoherent);

  const report = {
    generatedAt: new Date().toISOString(),
    runs: runDirs,
    trajectoryCount: rows.length,
    clusterCount: clusters.length,
    // Convergence: clusters with >= 2 trajectories (the gate's N>=2).
    multiTrajectoryClusters: multiTrajectory.length,
    // Cross-shape spread: clusters spanning >= 2 families. THE R9 signal.
    crossFamilyClusters: crossFamily.length,
    // Signature bug detector: any cluster whose members disagree on
    // skeleton means the signature key is unstable. Must be 0.
    incoherentClusters: incoherent.length,
    clusters: clusters.map((c) => ({
      ...c,
      drySchema: drySchemaForCluster(c),
    })),
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(`[intent-cluster] ${rows.length} trajectories → ${clusters.length} intentSignature clusters`);
  console.log(`[intent-cluster] multi-trajectory (>=2) clusters: ${multiTrajectory.length}`);
  console.log(`[intent-cluster] cross-family (>=2 families) clusters: ${crossFamily.length}`);
  console.log(`[intent-cluster] incoherent clusters (signature bug): ${incoherent.length}`);
  console.log(`[intent-cluster] top clusters:`);
  for (const c of clusters.slice(0, 12)) {
    console.log(
      `  ${c.intentSignature.padEnd(34)} n=${String(c.count).padStart(3)} families=${c.familyCount} slots=[${c.capabilitySlots.join(",")}]`,
    );
  }
  console.log(`[intent-cluster] full report → ${args.out}`);
}

main().catch((err) => {
  console.error("[intent-cluster] failed:", err);
  process.exit(1);
});
