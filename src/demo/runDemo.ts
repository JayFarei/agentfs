// runDemo — the headline two-question scenario.
//
// Wave 5 / Phase 6. Implements R7 (the two-question acceptance) and
// Verification 7+8+10 of `kb/plans/004-datafetch-bash-mvp.md`.
//
// Path:
//   1. Boot installSnippetRuntime → installFlueDispatcher → installObserver.
//   2. Publish the FinQA mount (live Atlas if ATLAS_URI is set; otherwise
//      register an in-memory stub MountRuntime so the demo runs offline).
//   3. Q1: a multi-step novel composition over chemicals revenue. Streams
//      to stdout, waits for the observer to crystallise a /lib/<name>.ts.
//   4. Q2: a snippet that calls the crystallised df.lib.<name> directly
//      with the same intent shape but different params (coal revenue).
//   5. Print a side-by-side cost panel comparing both envelopes.
//   6. If --no-cache, delete the crystallised file before Q2 and re-run
//      Q2 as a fresh composition — shows the cold path always works.
//
// The composition Q1 builds is:
//   df.db.cases.findSimilar → df.lib.pickFiling → df.lib.inferTableMathPlan
//   → df.lib.executeTableMath
//
// The crystallised file is the same shape the observer's __smoke__ smokes;
// Q2 invokes it through `df.lib.<name>(input)`.

import { promises as fsp } from "node:fs";
import path from "node:path";

import {
  getMountRuntimeRegistry,
  type MountRuntime,
} from "../adapter/runtime.js";
import { atlasMount } from "../adapter/atlasMount.js";
import { publishMount, type MountHandle } from "../adapter/publishMount.js";
import { installFlueDispatcher } from "../flue/install.js";
import { installObserver, type InstallObserverResult } from "../observer/install.js";
import { installSnippetRuntime } from "../snippet/install.js";
import type {
  CollectionHandle,
  Cost,
  MountAdapter,
  MountInventory,
  SampleOpts,
  SourceCapabilities,
} from "../sdk/index.js";

// --- Public ----------------------------------------------------------------

export type RunDemoOpts = {
  mount?: string;
  tenant?: string;
  atlasUri?: string;
  atlasDb?: string;
  noCache?: boolean;
  baseDir?: string;
};

export type RunDemoResult = {
  q1: SnippetSummary;
  q2: SnippetSummary;
  crystallisedFunction: string | null;
  crystallisedPath: string | null;
};

export type SnippetSummary = {
  question: string;
  exitCode: number;
  trajectoryId: string | undefined;
  cost: Cost | undefined;
  mode: string | undefined;
  functionName: string | undefined;
  stdout: string;
  stderr: string;
};

// --- Implementation --------------------------------------------------------

const Q1_QUESTION =
  "what is the range of chemicals revenue between 2014 and 2018";
const Q2_QUESTION = "what is the range of coal revenue between 2014 and 2018";

export async function runDemo(opts: RunDemoOpts = {}): Promise<RunDemoResult> {
  const tenant = opts.tenant ?? "demo-tenant";
  const mountId = opts.mount ?? "finqa-2024";
  const atlasUri = opts.atlasUri ?? process.env["ATLAS_URI"];
  const atlasDb =
    opts.atlasDb ??
    process.env["ATLAS_DB_NAME"] ??
    process.env["MONGODB_DB_NAME"] ??
    "finqa";
  const baseDir =
    opts.baseDir ??
    path.join("/tmp", `df-demo-${process.pid}-${Date.now()}`);
  const noCache = Boolean(opts.noCache);

  await fsp.mkdir(baseDir, { recursive: true });

  println(`[demo] baseDir=${baseDir}`);
  println(`[demo] tenant=${tenant} mount=${mountId}`);
  println(`[demo] mode=${atlasUri ? "atlas" : "in-memory"}`);

  // 1. Install runtimes in dependency order.
  const { snippetRuntime } = await installSnippetRuntime({ baseDir });
  await installFlueDispatcher({ baseDir });
  const observer: InstallObserverResult = installObserver({
    baseDir,
    tenantId: tenant,
    snippetRuntime,
  });

  // 2. Publish the mount (or register the in-memory stub).
  let mountHandle: MountHandle | null = null;
  try {
    if (atlasUri) {
      mountHandle = await publishLiveMount({
        atlasUri,
        atlasDb,
        mountId,
        baseDir,
      });
    } else {
      registerInMemoryMount(mountId);
    }

    // Resolve the cases ident from the registered mount runtime. Atlas
    // publishes `finqa_cases` as `finqaCases`; the in-memory stub uses
    // `cases`. Either works as long as the snippet uses the ident.
    const casesIdent = pickCasesIdent(mountId);
    println(`[demo] casesIdent=${casesIdent}`);

    // 3. Q1.
    println("");
    println("=== Q1 (novel) ==============================================");
    println(`> ${Q1_QUESTION}`);
    const q1 = await runSnippet({
      runtime: snippetRuntime,
      sessionCtx: {
        tenantId: tenant,
        mountIds: [mountId],
        baseDir,
      },
      source: q1Snippet({ question: Q1_QUESTION, mountIdent: casesIdent }),
      label: "Q1",
    });

    // 4. Wait for the observer's async crystallisation to land.
    let crystallised:
      | { name: string; path: string }
      | null = null;
    if (q1.trajectoryId) {
      crystallised = await awaitCrystallisation({
        observer: observer.observer,
        trajectoryId: q1.trajectoryId,
      });
      if (crystallised) {
        println(
          `[demo] observer crystallised ${crystallised.name} at ${crystallised.path}`,
        );
      } else {
        println("[demo] observer did not crystallise (see warnings above)");
      }
    }

    // 5. Q2 — invoke the crystallised function directly.
    if (noCache && crystallised) {
      println(`[demo] --no-cache: deleting ${crystallised.path}`);
      await fsp.rm(crystallised.path, { force: true });
    }

    println("");
    println("=== Q2 (interpreted) ========================================");
    println(`> ${Q2_QUESTION}`);
    const q2 = await runSnippet({
      runtime: snippetRuntime,
      sessionCtx: {
        tenantId: tenant,
        mountIds: [mountId],
        baseDir,
      },
      source: q2Snippet({
        question: Q2_QUESTION,
        mountIdent: casesIdent,
        crystallisedName:
          noCache || !crystallised ? null : crystallised.name,
      }),
      label: "Q2",
    });

    // 6. Cost panel.
    println("");
    printCostPanel({ q1, q2, crystallised });

    return {
      q1,
      q2,
      crystallisedFunction: crystallised ? crystallised.name : null,
      crystallisedPath: crystallised ? crystallised.path : null,
    };
  } finally {
    if (mountHandle) {
      try {
        await mountHandle.close();
      } catch {
        // best-effort
      }
    } else {
      // In-memory stub: drop it so a re-run isn't held by a stale registry.
      const reg = getMountRuntimeRegistry();
      const removed = reg.unregister(mountId);
      if (removed) {
        await removed.close().catch(() => undefined);
      }
    }
  }
}

// --- Mount ident resolution ------------------------------------------------

// Pick the collection ident that looks like the FinQA cases collection. In
// the AtlasMountAdapter case we get `finqaCases`; the in-memory stub uses
// `cases`. Anything containing "case" wins; otherwise fall back to the
// first registered ident.
function pickCasesIdent(mountId: string): string {
  const reg = getMountRuntimeRegistry();
  const runtime = reg.get(mountId);
  if (!runtime) {
    throw new Error(
      `mount "${mountId}" was not registered after publish/in-memory setup`,
    );
  }
  const idents = runtime.identMap.map((m) => m.ident);
  if (idents.length === 0) {
    throw new Error(
      `mount "${mountId}" has no collections; bootstrap may have failed (check ATLAS_DB_NAME)`,
    );
  }
  const cases = idents.find((i) => /case/i.test(i));
  return cases ?? idents[0]!;
}

// --- Snippet sources -------------------------------------------------------

function q1Snippet(args: { question: string; mountIdent: string }): string {
  // The demo's job is to compose findSimilar + pickFiling + inferTableMathPlan
  // + executeTableMath into a multi-step novel trajectory the observer can
  // crystallise. Q1 records the pickFiling sub-call as the topic so the
  // crystallised slug becomes `crystallise_pickfiling_<hash>`.
  return [
    `const cands = await df.db.${args.mountIdent}.findSimilar(${JSON.stringify(args.question)}, 5);`,
    `console.log("[Q1] candidates=" + cands.length);`,
    `if (cands.length === 0) { throw new Error("no candidates returned"); }`,
    `const filing = (await df.lib.pickFiling({`,
    `  question: ${JSON.stringify(args.question)},`,
    `  candidates: cands,`,
    `  priorTickers: [],`,
    `})).value;`,
    `console.log("[Q1] picked=" + filing.filename);`,
    `const plan = (await df.lib.inferTableMathPlan({`,
    `  question: ${JSON.stringify(args.question)},`,
    `  filing,`,
    `})).value;`,
    `const result = (await df.lib.executeTableMath({ filing, plan })).value;`,
    `console.log("[Q1] answer=" + JSON.stringify({ value: result.roundedAnswer, operation: result.operation, filename: filing.filename }));`,
  ].join("\n");
}

function q2Snippet(args: {
  question: string;
  mountIdent: string;
  crystallisedName: string | null;
}): string {
  if (args.crystallisedName) {
    // Crystallised path — invoke the function the observer wrote. The
    // crystallised composition's input shape mirrors the originating
    // trajectory's external parameters (see template.ts param dedup).
    // Q1 carried a single dedup'd `query` parameter (the shared question
    // string across findSimilar+pickFiling+inferTableMathPlan) plus a
    // `priorTickers` array.
    return [
      `const out = await df.lib.${args.crystallisedName}({`,
      `  query: ${JSON.stringify(args.question)},`,
      `  limit: 5,`,
      `  priorTickers: [],`,
      `});`,
      `console.log("[Q2] mode=" + out.mode + " tier=" + out.cost.tier + " llmCalls=" + out.cost.llmCalls);`,
      `console.log("[Q2] function=" + (out.provenance.functionName ?? "(none)"));`,
      `const v = out.value;`,
      `if (v && typeof v === "object" && "roundedAnswer" in v) {`,
      `  console.log("[Q2] answer=" + JSON.stringify({ value: v.roundedAnswer, operation: v.operation }));`,
      `} else {`,
      `  console.log("[Q2] answer=" + JSON.stringify(v));`,
      `}`,
    ].join("\n");
  }
  // Fallback: same composition as Q1, different question string. Used
  // when --no-cache deletes the crystallised file or when crystallisation
  // skipped (e.g. the trajectory shape didn't qualify).
  return q1Snippet({ question: args.question, mountIdent: args.mountIdent }).replace(
    /\[Q1\]/g,
    "[Q2]",
  );
}

// --- Runtime helpers -------------------------------------------------------

type RunSnippetArgs = {
  runtime: import("../snippet/runtime.js").DiskSnippetRuntime;
  sessionCtx: {
    tenantId: string;
    mountIds: string[];
    baseDir: string;
  };
  source: string;
  label: string;
};

async function runSnippet(args: RunSnippetArgs): Promise<SnippetSummary> {
  const result = await args.runtime.run({
    source: args.source,
    sessionCtx: args.sessionCtx,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // Read the trajectory back to harvest mode + functionName (the demo
  // reports both in the cost panel).
  let mode: string | undefined;
  let functionName: string | undefined;
  if (result.trajectoryId) {
    const traj = await readTrajectoryRecord({
      trajectoryId: result.trajectoryId,
      baseDir: args.sessionCtx.baseDir,
    });
    if (traj) {
      mode = typeof traj["mode"] === "string" ? traj["mode"] : undefined;
      const prov = traj["provenance"] as
        | { functionName?: string }
        | undefined;
      functionName = prov?.functionName;
      // Walk the call list — when no provenance.functionName was set,
      // the LAST lib.* call is the outermost df.lib invocation (nested
      // sub-calls complete first per TrajectoryRecorder.call's
      // post-await push). For a novel composition this is the leaf
      // primitive (e.g. `executeTableMath`); for an interpreted replay
      // this is the crystallised wrapper.
      if (!functionName) {
        const calls = traj["calls"] as
          | Array<{ primitive: string }>
          | undefined;
        const libCalls = calls?.filter((c) => c.primitive.startsWith("lib.")) ?? [];
        const lastLib = libCalls[libCalls.length - 1];
        if (lastLib) {
          functionName = lastLib.primitive.slice("lib.".length);
        }
      }
    }
  }

  return {
    question: args.label,
    exitCode: result.exitCode,
    trajectoryId: result.trajectoryId,
    cost: result.cost,
    mode,
    functionName,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function readTrajectoryRecord(args: {
  trajectoryId: string;
  baseDir: string;
}): Promise<Record<string, unknown> | null> {
  const file = path.join(
    args.baseDir,
    "trajectories",
    `${args.trajectoryId}.json`,
  );
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function awaitCrystallisation(args: {
  observer: InstallObserverResult["observer"];
  trajectoryId: string;
}): Promise<{ name: string; path: string } | null> {
  // The observer's onTrajectorySaved callback is fire-and-forget; poll
  // briefly for the in-flight promise to appear, then await it.
  let inFlight: Promise<unknown> | undefined;
  for (let i = 0; i < 100; i += 1) {
    inFlight = args.observer.observerPromise.get(args.trajectoryId);
    if (inFlight) break;
    await sleep(20);
  }
  if (!inFlight) return null;
  const result = (await inFlight) as
    | { kind: "crystallised"; name: string; path: string }
    | { kind: "skipped"; reason: string };
  if (result.kind === "crystallised") {
    return { name: result.name, path: result.path };
  }
  println(`[demo] crystallisation skipped: ${result.reason}`);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Cost panel ------------------------------------------------------------

function printCostPanel(args: {
  q1: SnippetSummary;
  q2: SnippetSummary;
  crystallised: { name: string; path: string } | null;
}): void {
  const rows: Array<[string, string, string]> = [];
  rows.push(["", "Q1 (novel)", "Q2 (interpreted)"]);
  rows.push(["mode", str(args.q1.mode), str(args.q2.mode)]);
  rows.push([
    "tier",
    str(args.q1.cost?.tier),
    str(args.q2.cost?.tier),
  ]);
  rows.push([
    "tokens.cold",
    str(args.q1.cost?.tokens.cold),
    str(args.q2.cost?.tokens.cold),
  ]);
  rows.push([
    "tokens.hot",
    str(args.q1.cost?.tokens.hot),
    str(args.q2.cost?.tokens.hot),
  ]);
  rows.push([
    "ms.cold",
    str(args.q1.cost?.ms.cold),
    str(args.q2.cost?.ms.cold),
  ]);
  rows.push([
    "ms.hot",
    str(args.q1.cost?.ms.hot),
    str(args.q2.cost?.ms.hot),
  ]);
  rows.push([
    "llmCalls",
    str(args.q1.cost?.llmCalls),
    str(args.q2.cost?.llmCalls),
  ]);
  rows.push([
    "function",
    str(args.q1.functionName ?? "(none)"),
    str(args.q2.functionName ?? "(none)"),
  ]);

  const widths = [
    Math.max(...rows.map((r) => r[0].length)),
    Math.max(...rows.map((r) => r[1].length)),
    Math.max(...rows.map((r) => r[2].length)),
  ];

  println("=== Cost Panel ==============================================");
  for (const r of rows) {
    println(
      `${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${pad(r[2], widths[2])}`,
    );
  }
  if (args.crystallised) {
    println("");
    println(`Crystallised: ${args.crystallised.name}`);
    println(`             ${args.crystallised.path}`);
  }
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "—";
  return String(v);
}

function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - s.length));
}

function println(s: string): void {
  process.stdout.write(`${s}\n`);
}

// --- Mount publishing ------------------------------------------------------

async function publishLiveMount(args: {
  atlasUri: string;
  atlasDb: string;
  mountId: string;
  baseDir: string;
}): Promise<MountHandle> {
  const handle = await publishMount({
    id: args.mountId,
    source: atlasMount({ uri: args.atlasUri, db: args.atlasDb }),
    baseDir: args.baseDir,
    warmup: "lazy",
  });

  // Drain the SSE-equivalent stage events to stdout. publishMount returns
  // immediately under warmup="lazy"; the status iterable lazily starts the
  // bootstrap on first iteration.
  for await (const evt of handle.status()) {
    const { stage, ...rest } = evt as { stage: string; [k: string]: unknown };
    const tail = Object.keys(rest).length > 0 ? " " + JSON.stringify(rest) : "";
    println(`[mount] ${stage}${tail}`);
  }
  await handle.inventory(); // ensures bootstrap completed
  return handle;
}

// --- In-memory stub mount --------------------------------------------------

// Synthetic FinQA-shaped fixtures for the offline demo path. Includes both
// chemicals and coal filings so the two-question shape works end-to-end.
type StubFiling = {
  id: string;
  filename: string;
  question: string;
  searchableText: string;
  preText: string[];
  postText: string[];
  table: {
    headers: string[];
    headerKeys: string[];
    rows: Array<{
      index: number;
      label: string;
      labelKey: string;
      cells: Array<{
        column: string;
        columnKey: string;
        raw: string;
        value: number | null;
      }>;
    }>;
  };
};

const STUB_FILINGS: StubFiling[] = [
  {
    id: "case-dow-2018",
    filename: "DOW/2018/page_22.pdf",
    question: "what was the range of chemicals revenue 2014 to 2018",
    searchableText:
      "Dow Chemical chemicals revenue range 2014 2015 2016 2017 2018",
    preText: ["Chemicals revenue, in millions of US dollars."],
    postText: [],
    table: {
      headers: ["row", "2014", "2015", "2016", "2017", "2018"],
      headerKeys: ["row", "2014", "2015", "2016", "2017", "2018"],
      rows: [
        {
          index: 0,
          label: "chemicals revenue",
          labelKey: "chemicals_revenue",
          cells: [
            { column: "row", columnKey: "row", raw: "chemicals revenue", value: null },
            { column: "2014", columnKey: "2014", raw: "16100", value: 16100 },
            { column: "2015", columnKey: "2015", raw: "13500", value: 13500 },
            { column: "2016", columnKey: "2016", raw: "12900", value: 12900 },
            { column: "2017", columnKey: "2017", raw: "14200", value: 14200 },
            { column: "2018", columnKey: "2018", raw: "16800", value: 16800 },
          ],
        },
      ],
    },
  },
  {
    id: "case-btu-2018",
    filename: "BTU/2018/page_30.pdf",
    question: "what was the range of coal revenue 2014 to 2018",
    searchableText: "Peabody coal revenue range 2014 2015 2016 2017 2018",
    preText: ["Coal revenue, in millions of US dollars."],
    postText: [],
    table: {
      headers: ["row", "2014", "2015", "2016", "2017", "2018"],
      headerKeys: ["row", "2014", "2015", "2016", "2017", "2018"],
      rows: [
        {
          index: 0,
          label: "coal revenue",
          labelKey: "coal_revenue",
          cells: [
            { column: "row", columnKey: "row", raw: "coal revenue", value: null },
            { column: "2014", columnKey: "2014", raw: "6800", value: 6800 },
            { column: "2015", columnKey: "2015", raw: "5600", value: 5600 },
            { column: "2016", columnKey: "2016", raw: "4700", value: 4700 },
            { column: "2017", columnKey: "2017", raw: "5500", value: 5500 },
            { column: "2018", columnKey: "2018", raw: "5800", value: 5800 },
          ],
        },
      ],
    },
  },
];

class StubCases implements CollectionHandle<StubFiling> {
  async findExact(filter: Partial<StubFiling>, limit?: number): Promise<StubFiling[]> {
    const matched = STUB_FILINGS.filter((row) =>
      Object.entries(filter).every(
        ([k, v]) =>
          (row as unknown as Record<string, unknown>)[k] === (v as unknown),
      ),
    );
    return limit !== undefined ? matched.slice(0, limit) : matched;
  }
  async search(query: string, opts?: { limit?: number }): Promise<StubFiling[]> {
    return rankByQuery(query, opts?.limit ?? 5);
  }
  async findSimilar(query: string, limit?: number): Promise<StubFiling[]> {
    return rankByQuery(query, limit ?? 5);
  }
  async hybrid(query: string, opts?: { limit?: number }): Promise<StubFiling[]> {
    return rankByQuery(query, opts?.limit ?? 5);
  }
}

function rankByQuery(query: string, limit: number): StubFiling[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const scored = STUB_FILINGS.map((row) => {
    const haystack = row.searchableText.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1;
    }
    return { row, score };
  })
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0);
  return scored.slice(0, limit).map((s) => s.row);
}

class StubMountAdapter implements MountAdapter {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  capabilities(): SourceCapabilities {
    return { vector: false, lex: true, stream: false, compile: false };
  }
  async probe(): Promise<MountInventory> {
    return { collections: [{ name: "cases", rows: STUB_FILINGS.length }] };
  }
  async sample(_collection: string, _opts: SampleOpts): Promise<unknown[]> {
    return STUB_FILINGS.slice(0, 3);
  }
  collection<T>(name: string): CollectionHandle<T> {
    if (name !== "cases") {
      throw new Error(`StubMountAdapter: unknown collection ${name}`);
    }
    return new StubCases() as unknown as CollectionHandle<T>;
  }
  async close(): Promise<void> {
    // no-op
  }
}

function registerInMemoryMount(mountId: string): void {
  const adapter = new StubMountAdapter(mountId);
  const runtime: MountRuntime = {
    mountId,
    adapter,
    identMap: [{ ident: "cases", name: "cases" }],
    collection<T>(name: string): CollectionHandle<T> {
      return adapter.collection<T>(name);
    },
    async close(): Promise<void> {
      await adapter.close();
    },
  };
  getMountRuntimeRegistry().register(mountId, runtime);
}
