// Phase-3 smoke test for the snippet runtime.
//
// Exercises the full path:
//   1. installSnippetRuntime({}) — seeds copy to disk, DiskLibraryResolver
//      registered.
//   2. installFlueDispatcher({}) — Flue dispatcher available for parity
//      (no LLM bodies fire during this smoke; we install for symmetry
//      with what the demo CLI will do at boot).
//   3. Hand-construct a tiny in-memory MountAdapter with one collection
//      "cases" of FinQA-shaped rows (filename, question, preText,
//      postText, table, searchableText). Register a MountRuntime.
//   4. Run a multi-line snippet using `df.db.cases.findSimilar` +
//      `df.lib.pickFiling` + `df.lib.locateFigure` + console.log.
//   5. Assert: stdout contains the picked filing's identifier; the
//      trajectory file exists; cost.tier === 2; cost.llmCalls === 0;
//      per-call records include both substrate and lib boundaries.
//
// Prints PASS / FAIL per check and a final summary. Exit code 0 on all
// pass; 1 otherwise.

import { promises as fsp } from "node:fs";
import path from "node:path";

import {
  getMountRuntimeRegistry,
  type MountRuntime,
} from "../adapter/runtime.js";
import { installFlueDispatcher } from "../flue/install.js";
import type {
  CollectionHandle,
  MountAdapter,
  MountInventory,
  SampleOpts,
  SourceCapabilities,
} from "../sdk/index.js";

import { installSnippetRuntime } from "./install.js";

// --- Stub MountAdapter ----------------------------------------------------

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
    preText: [
      "Operating revenues are reported in millions of US dollars.",
    ],
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
  {
    id: "case-unp-2017",
    filename: "UNP/2017/page_3.pdf",
    question: "agricultural products revenue change at union pacific",
    searchableText: "union pacific agricultural products revenue 2017",
    preText: ["Reported in millions of US dollars."],
    postText: [],
    table: {
      headers: ["row", "2016", "2017"],
      headerKeys: ["row", "2016", "2017"],
      rows: [
        {
          index: 0,
          label: "agricultural products",
          labelKey: "agricultural_products",
          cells: [
            { column: "row", columnKey: "row", raw: "agricultural products", value: null },
            { column: "2016", columnKey: "2016", raw: "3625", value: 3625 },
            { column: "2017", columnKey: "2017", raw: "3685", value: 3685 },
          ],
        },
      ],
    },
  },
  {
    id: "case-v-2012",
    filename: "V/2012/page_28.pdf",
    question: "what is visa's positioning vs competitors",
    searchableText: "Visa competitive positioning emerging payment networks",
    preText: ["Competitive considerations described below."],
    postText: [],
    table: {
      headers: ["metric", "2011", "2012"],
      headerKeys: ["metric", "2011", "2012"],
      rows: [
        {
          index: 0,
          label: "operating revenues",
          labelKey: "operating_revenues",
          cells: [
            { column: "metric", columnKey: "metric", raw: "operating revenues", value: null },
            { column: "2011", columnKey: "2011", raw: "9188", value: 9188 },
            { column: "2012", columnKey: "2012", raw: "10421", value: 10421 },
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

type CheckResult = {
  name: string;
  pass: boolean;
  detail?: string;
};

const SNIPPET_SOURCE = `
const cands = await df.db.cases.findSimilar("Visa 2017 operating revenues", 5);
console.log("candidates=" + cands.length);
const filing = (await df.lib.pickFiling({
  question: "Visa 2017 operating revenues",
  candidates: cands,
  priorTickers: ["V"],
})).value;
console.log("picked=" + filing.filename);
const fig = (await df.lib.locateFigure({
  question: "operating revenues 2017",
  filing,
})).value;
console.log("answer=" + JSON.stringify({ value: fig.value, column: fig.column, filename: filing.filename }));
`;

async function main(): Promise<void> {
  const baseDir = path.join("/tmp", `df-snippet-smoke-${process.pid}-${Date.now()}`);
  await fsp.mkdir(baseDir, { recursive: true });

  const { snippetRuntime } = await installSnippetRuntime({ baseDir });
  await installFlueDispatcher({ baseDir, skipSeedMirror: true });

  const reg = getMountRuntimeRegistry();
  reg.register("smoke-mount", makeStubRuntime());

  const checks: CheckResult[] = [];

  const result = await snippetRuntime.run({
    source: SNIPPET_SOURCE,
    sessionCtx: {
      tenantId: "smoke",
      mountIds: ["smoke-mount"],
      baseDir,
    },
  });

  // 1. exit code 0
  checks.push({
    name: "snippet.run exits 0",
    pass: result.exitCode === 0,
    detail:
      result.exitCode === 0
        ? undefined
        : `exitCode=${result.exitCode}, stderr=${result.stderr}`,
  });

  // 2. stdout contains the picked filing's identifier
  checks.push({
    name: "stdout names the picked filing",
    pass:
      result.stdout.includes("V/2017/page_42.pdf") &&
      result.stdout.includes("answer="),
    detail: result.stdout,
  });

  // 3. trajectoryId is non-empty
  checks.push({
    name: "trajectoryId present",
    pass: typeof result.trajectoryId === "string" && result.trajectoryId.length > 0,
    detail: `trajectoryId=${result.trajectoryId ?? "<undef>"}`,
  });

  // 4. trajectory file exists at <baseDir>/trajectories/<id>.json
  let trajectoryRecord: Record<string, unknown> | null = null;
  if (result.trajectoryId) {
    const file = path.join(baseDir, "trajectories", `${result.trajectoryId}.json`);
    try {
      const raw = await fsp.readFile(file, "utf8");
      trajectoryRecord = JSON.parse(raw) as Record<string, unknown>;
      checks.push({ name: "trajectory file written", pass: true });
    } catch (err) {
      checks.push({
        name: "trajectory file written",
        pass: false,
        detail: `${err instanceof Error ? err.message : String(err)} at ${file}`,
      });
    }
  } else {
    checks.push({
      name: "trajectory file written",
      pass: false,
      detail: "no trajectoryId",
    });
  }

  // 5. cost.tier === 2 (substrate touched, no LLM)
  const cost =
    (trajectoryRecord?.["cost"] as
      | { tier: number; llmCalls: number; tokens?: { hot: number; cold: number } }
      | undefined) ??
    (result.cost as
      | { tier: number; llmCalls: number; tokens?: { hot: number; cold: number } }
      | undefined);
  checks.push({
    name: "cost.tier === 2",
    pass: cost?.tier === 2,
    detail: JSON.stringify(cost),
  });

  // 6. cost.llmCalls === 0
  checks.push({
    name: "cost.llmCalls === 0",
    pass: cost?.llmCalls === 0,
    detail: JSON.stringify(cost),
  });

  // 7. trajectory mode is "interpreted"
  checks.push({
    name: 'trajectory.mode === "interpreted"',
    pass: trajectoryRecord?.["mode"] === "interpreted",
    detail: `mode=${trajectoryRecord?.["mode"]}`,
  });

  // 8. trajectory calls include the substrate findSimilar + the lib boundaries
  const calls =
    (trajectoryRecord?.["calls"] as Array<{ primitive: string }> | undefined) ??
    [];
  const primitives = calls.map((c) => c.primitive);
  checks.push({
    name: "trajectory calls include db.cases.findSimilar + lib.pickFiling",
    pass:
      primitives.includes("db.cases.findSimilar") &&
      primitives.includes("lib.pickFiling"),
    detail: JSON.stringify(primitives),
  });

  // --- Print results -------------------------------------------------------

  let failed = 0;
  for (const r of checks) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.name}`);
    if (!r.pass && r.detail) {
      console.log(`  detail: ${r.detail.slice(0, 800)}`);
    }
  }

  console.log("");
  console.log(
    `${checks.length - failed}/${checks.length} passed${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
  for (const r of checks) if (!r.pass) failed += 1;

  // Print stdout/stderr from the snippet for debug context.
  if (result.stdout) console.log("--- snippet stdout ---\n" + result.stdout);
  if (result.stderr) console.log("--- snippet stderr ---\n" + result.stderr);

  // Print the trajectory JSON inline so the agent caller can sanity-check it.
  if (trajectoryRecord) {
    console.log("--- trajectory ---");
    console.log(JSON.stringify(trajectoryRecord, null, 2));
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("smoke harness crashed:", err);
  process.exit(1);
});
