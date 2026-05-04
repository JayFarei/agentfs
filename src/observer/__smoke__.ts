// Phase 5 smoke test for the asynchronous observer.
//
// End-to-end:
//   1. installSnippetRuntime({}) — DiskLibraryResolver + DiskSnippetRuntime
//      registered.
//   2. installFlueDispatcher({}) — skill loader available (codifier
//      fallback path needs it; the pure-composition path doesn't).
//   3. installObserver({tenantId: "smoke-tenant"}) — sets the snippet
//      runtime's onTrajectorySaved hook so observe() fires after every
//      `runtime.run`.
//   4. Construct an in-memory MountAdapter + register a MountRuntime
//      (same shape as Wave 3's smoke test).
//   5. Run a snippet that does `df.db.cases.findSimilar` →
//      `df.lib.pickFiling` → `df.lib.locateFigure`.
//   6. Await the observer's in-flight promise. Assert: a new
//      `<baseDir>/lib/smoke-tenant/<name>.ts` exists; it contains
//      `fn({` and the same primitive calls; importing it via
//      DiskLibraryResolver.resolve("smoke-tenant", name) returns a Fn.
//   7. Run a SECOND snippet that calls `df.lib.<name>(...)` directly.
//      Assert: mode = "interpreted"; cost.tier <= 2; cost.llmCalls = 0;
//      the call chain shows lib.<name> at the top.
//
// PASS / FAIL printed per check; exit 0 on all-pass, 1 otherwise.

import { promises as fsp } from "node:fs";
import path from "node:path";

import {
  getMountRuntimeRegistry,
  type MountRuntime,
} from "../adapter/runtime.js";
import { installFlueDispatcher } from "../flue/install.js";
import {
  type CollectionHandle,
  type MountAdapter,
  type MountInventory,
  type SampleOpts,
  type SourceCapabilities,
} from "../sdk/index.js";
import { installSnippetRuntime } from "../snippet/install.js";

import { installObserver } from "./install.js";

// --- Stub MountAdapter (mirrors src/snippet/__smoke__.ts) -----------------

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
    id: "case-v-2017",
    filename: "V/2017/page_42.pdf",
    question: "what were operating revenues for visa in 2017",
    searchableText: "Visa Inc. operating revenues 2017 18358",
    preText: ["Operating revenues are reported in millions of US dollars."],
    postText: [],
    table: {
      headers: ["metric", "2016", "2017"],
      headerKeys: ["metric", "2016", "2017"],
      rows: [
        {
          index: 0,
          label: "operating revenues",
          labelKey: "operating_revenues",
          cells: [
            { column: "metric", columnKey: "metric", raw: "operating revenues", value: null },
            { column: "2016", columnKey: "2016", raw: "15082", value: 15082 },
            { column: "2017", columnKey: "2017", raw: "18358", value: 18358 },
          ],
        },
      ],
    },
  },
  {
    id: "case-ma-2017",
    filename: "MA/2017/page_31.pdf",
    question: "what were total revenues for mastercard in 2017",
    searchableText: "Mastercard total revenues 2017 12497",
    preText: ["Net revenue figures, in millions."],
    postText: [],
    table: {
      headers: ["metric", "2016", "2017"],
      headerKeys: ["metric", "2016", "2017"],
      rows: [
        {
          index: 0,
          label: "net revenues",
          labelKey: "net_revenues",
          cells: [
            { column: "metric", columnKey: "metric", raw: "net revenues", value: null },
            { column: "2016", columnKey: "2016", raw: "10776", value: 10776 },
            { column: "2017", columnKey: "2017", raw: "12497", value: 12497 },
          ],
        },
      ],
    },
  },
  {
    id: "case-axp-2018",
    filename: "AXP/2018/page_10.pdf",
    question: "what was the range of operating revenues 2014 2018",
    searchableText: "American Express operating revenues range 2014 2018",
    preText: ["Operating revenues, in millions of US dollars."],
    postText: [],
    table: {
      headers: ["metric", "2014", "2018"],
      headerKeys: ["metric", "2014", "2018"],
      rows: [
        {
          index: 0,
          label: "operating revenues",
          labelKey: "operating_revenues",
          cells: [
            { column: "metric", columnKey: "metric", raw: "operating revenues", value: null },
            { column: "2014", columnKey: "2014", raw: "34292", value: 34292 },
            { column: "2018", columnKey: "2018", raw: "37334", value: 37334 },
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
  readonly id = "smoke-mount";
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
}

function makeStubRuntime(): MountRuntime {
  const adapter = new StubMountAdapter();
  return {
    mountId: "smoke-mount",
    adapter,
    identMap: [{ ident: "cases", name: "cases" }],
    collection<T>(name: string): CollectionHandle<T> {
      return adapter.collection<T>(name);
    },
    async close(): Promise<void> {
      // no-op for stub
    },
  };
}

// --- Smoke harness ---------------------------------------------------------

type CheckResult = { name: string; pass: boolean; detail?: string };

const TENANT = "smoke-tenant";

const FIRST_SNIPPET = `
const cands = await df.db.cases.findSimilar("Visa 2017 operating revenues", 5);
const filing = (await df.lib.pickFiling({
  question: "Visa 2017 operating revenues",
  candidates: cands,
  priorTickers: ["V"],
})).value;
const fig = (await df.lib.locateFigure({
  question: "operating revenues 2017",
  filing,
})).value;
console.log("answer=" + JSON.stringify({ value: fig.value, column: fig.column, filename: filing.filename }));
`;

async function main(): Promise<void> {
  const baseDir = path.join(
    "/tmp",
    `df-observer-smoke-${process.pid}-${Date.now()}`,
  );
  await fsp.mkdir(baseDir, { recursive: true });

  const checks: CheckResult[] = [];

  // 1. Install runtime + flue + observer.
  const { snippetRuntime, libraryResolver } = await installSnippetRuntime({
    baseDir,
  });
  await installFlueDispatcher({ baseDir, skipSeedMirror: true });
  const { observer } = installObserver({
    baseDir,
    tenantId: TENANT,
    snippetRuntime,
  });

  // 2. Register stub mount.
  const reg = getMountRuntimeRegistry();
  reg.register("smoke-mount", makeStubRuntime());

  // 3. Run the first snippet.
  const result1 = await snippetRuntime.run({
    source: FIRST_SNIPPET,
    sessionCtx: {
      tenantId: TENANT,
      mountIds: ["smoke-mount"],
      baseDir,
    },
  });

  checks.push({
    name: "first snippet exits 0",
    pass: result1.exitCode === 0,
    detail:
      result1.exitCode === 0
        ? undefined
        : `exitCode=${result1.exitCode}, stderr=${result1.stderr}`,
  });

  // 4. Wait for the observer's async observe to complete.
  if (!result1.trajectoryId) {
    checks.push({
      name: "first snippet recorded trajectory id",
      pass: false,
      detail: "no trajectoryId on RunResult",
    });
    finalizeAndExit(checks);
    return;
  }
  // The snippet runtime fires the callback fire-and-forget. The observer
  // records its in-flight promise on `observerPromise`. We poll briefly
  // for the entry to appear, then await it.
  let observePromise: Promise<unknown> | undefined;
  for (let i = 0; i < 50; i += 1) {
    observePromise = observer.observerPromise.get(result1.trajectoryId);
    if (observePromise) break;
    await sleep(20);
  }
  if (!observePromise) {
    checks.push({
      name: "observer fired on trajectory save",
      pass: false,
      detail: "observerPromise map never populated",
    });
    finalizeAndExit(checks);
    return;
  }
  const observeResult = (await observePromise) as
    | { kind: "crystallised"; name: string; path: string }
    | { kind: "skipped"; reason: string };

  checks.push({
    name: "observer returned crystallised",
    pass: observeResult.kind === "crystallised",
    detail:
      observeResult.kind === "crystallised"
        ? `name=${observeResult.name}`
        : `skipped: ${observeResult.reason}`,
  });

  if (observeResult.kind !== "crystallised") {
    finalizeAndExit(checks);
    return;
  }

  // 5. Inspect the crystallised file.
  let crystallisedSource = "";
  try {
    crystallisedSource = await fsp.readFile(observeResult.path, "utf8");
    checks.push({ name: "crystallised file written", pass: true });
  } catch (err) {
    checks.push({
      name: "crystallised file written",
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  checks.push({
    name: "crystallised file uses fn({ factory",
    pass: crystallisedSource.includes("fn<"),
    detail: crystallisedSource.slice(0, 400),
  });
  checks.push({
    name: "crystallised file calls df.db.cases.findSimilar",
    pass: crystallisedSource.includes("df.db.cases.findSimilar"),
  });
  checks.push({
    name: "crystallised file calls df.lib.pickFiling and df.lib.locateFigure",
    pass:
      crystallisedSource.includes("df.lib.pickFiling") &&
      crystallisedSource.includes("df.lib.locateFigure"),
  });
  checks.push({
    name: "crystallised file carries @shape-hash header",
    pass: /@shape-hash:\s*[0-9a-f]{8,}/.test(crystallisedSource),
  });

  // 6. Resolve via the LibraryResolver to confirm it loads.
  const resolved = await libraryResolver.resolve(TENANT, observeResult.name);
  checks.push({
    name: "DiskLibraryResolver loads the crystallised function",
    pass: resolved !== null,
    detail: resolved === null ? "resolve returned null" : `spec.intent=${resolved.spec.intent}`,
  });

  // 7. Run the second snippet that calls the new function directly.
  // The crystallised function exposes all the external parameters the
  // originating trajectory carried (see template.ts param dedup); we
  // pass each one. For the demo's "same intent shape, different params"
  // story (personas.md §2), agents will read `man <fn>` to see this
  // signature; here we mirror the spec.examples[0].input shape.
  const SECOND_SNIPPET = `
const out = await df.lib.${observeResult.name}({
  query: "Mastercard 2017 net revenues",
  limit: 5,
  question: "net revenues 2017",
  priorTickers: ["MA"],
});
console.log("crystallised-result=" + JSON.stringify(out.value));
`;

  const result2 = await snippetRuntime.run({
    source: SECOND_SNIPPET,
    sessionCtx: {
      tenantId: TENANT,
      mountIds: ["smoke-mount"],
      baseDir,
    },
  });

  checks.push({
    name: "second snippet exits 0",
    pass: result2.exitCode === 0,
    detail:
      result2.exitCode === 0
        ? undefined
        : `exitCode=${result2.exitCode}, stderr=${result2.stderr}`,
  });

  // 8. Inspect the second trajectory: mode interpreted, no LLM calls,
  //    tier <= 2, top-level call list shows `lib.<name>`.
  if (!result2.trajectoryId) {
    checks.push({
      name: "second snippet recorded trajectory id",
      pass: false,
      detail: "no trajectoryId on RunResult",
    });
    finalizeAndExit(checks);
    return;
  }
  const traj2File = path.join(
    baseDir,
    "trajectories",
    `${result2.trajectoryId}.json`,
  );
  let traj2: Record<string, unknown> | null = null;
  try {
    traj2 = JSON.parse(await fsp.readFile(traj2File, "utf8")) as Record<
      string,
      unknown
    >;
  } catch (err) {
    checks.push({
      name: "second trajectory file readable",
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  if (traj2) {
    checks.push({
      name: 'second trajectory.mode === "interpreted"',
      pass: traj2["mode"] === "interpreted",
      detail: `mode=${traj2["mode"]}`,
    });
    const cost2 = traj2["cost"] as
      | { tier: number; llmCalls: number }
      | undefined;
    checks.push({
      name: "second trajectory cost.tier <= 2",
      pass: typeof cost2?.tier === "number" && cost2.tier <= 2,
      detail: JSON.stringify(cost2),
    });
    checks.push({
      name: "second trajectory cost.llmCalls === 0",
      pass: cost2?.llmCalls === 0,
      detail: JSON.stringify(cost2),
    });
    const calls2 =
      (traj2["calls"] as Array<{ primitive: string }> | undefined) ?? [];
    const primitives2 = calls2.map((c) => c.primitive);
    checks.push({
      name: `second trajectory call list includes lib.${observeResult.name}`,
      pass: primitives2.includes(`lib.${observeResult.name}`),
      detail: JSON.stringify(primitives2),
    });
  }

  finalizeAndExit(checks, {
    snippetStdout: result1.stdout,
    snippetStderr: result1.stderr,
    secondStdout: result2.stdout,
    secondStderr: result2.stderr,
    crystallised:
      observeResult.kind === "crystallised"
        ? {
            name: observeResult.name,
            path: observeResult.path,
            firstLines: crystallisedSource.split("\n").slice(0, 40).join("\n"),
          }
        : null,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finalizeAndExit(
  checks: CheckResult[],
  debug?: {
    snippetStdout?: string;
    snippetStderr?: string;
    secondStdout?: string;
    secondStderr?: string;
    crystallised?: { name: string; path: string; firstLines: string } | null;
  },
): void {
  let failed = 0;
  for (const r of checks) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.name}`);
    if (!r.pass && r.detail) {
      console.log(`  detail: ${r.detail.slice(0, 800)}`);
    }
    if (!r.pass) failed += 1;
  }
  console.log("");
  console.log(
    `${checks.length - failed}/${checks.length} passed${
      failed > 0 ? ` (${failed} failed)` : ""
    }`,
  );
  if (debug?.snippetStdout) console.log("--- 1st snippet stdout ---\n" + debug.snippetStdout);
  if (debug?.snippetStderr) console.log("--- 1st snippet stderr ---\n" + debug.snippetStderr);
  if (debug?.secondStdout) console.log("--- 2nd snippet stdout ---\n" + debug.secondStdout);
  if (debug?.secondStderr) console.log("--- 2nd snippet stderr ---\n" + debug.secondStderr);
  if (debug?.crystallised) {
    console.log(
      `--- crystallised file (first 40 lines) ${debug.crystallised.path} ---\n` +
        debug.crystallised.firstLines,
    );
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("smoke harness crashed:", err);
  process.exit(1);
});
