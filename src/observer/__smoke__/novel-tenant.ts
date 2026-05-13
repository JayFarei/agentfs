// Goal-3 iter 13 — novel-tenant smoke test.
//
// The substrate ships ZERO tenant-specific code or data. This smoke
// proves it: mount a small generic dataset under a tenantId the
// substrate has never seen, run two episodes of code-mode work against
// it, and require the substrate's learning loop to (a) crystallise at
// least one helper into <baseDir>/lib/<new-tenant-id>/ from the first
// passing episode and (b) the second episode's recorded trajectory
// contains a `lib.<crystallised-name>` call. No edits to substrate code
// (src/observer, src/hooks, src/snippet, src/sdk, src/adapter) are
// required to make any of this work.
//
// Pattern mirrors src/observer/__smoke__/finqa.ts; the difference is
// the dataset (a synthetic "library catalogue" of 5 books, not FinQA
// filings) and the tenant id ("novel-tenant-smoke"). The composition
// the agent's snippet executes is the same shape the observer's gate is
// designed to recognise: `df.db.records.<method>` → `df.lib.<helper>`
// with the helper consuming the db output.
//
// Run with:  pnpm tsx src/observer/__smoke__/novel-tenant.ts
// (the canonical `pnpm test` runs this before vitest).

import { promises as fsp } from "node:fs";
import path from "node:path";

import {
  getMountRuntimeRegistry,
  type MountRuntime,
} from "../../adapter/runtime.js";
import { installFlueDispatcher } from "../../flue/install.js";
import {
  type CollectionHandle,
  type MountAdapter,
  type MountInventory,
  type SampleOpts,
  type SourceCapabilities,
} from "../../sdk/index.js";
import { installSnippetRuntime } from "../../snippet/install.js";

import { installObserver } from "../install.js";

// --- Stub dataset (no FinQA, no SkillCraft) --------------------------------

interface BookRecord {
  id: string;
  title: string;
  author: string;
  publishedYear: number;
  pageCount: number;
  keywords: string[];
}

const STUB_BOOKS: BookRecord[] = [
  {
    id: "book:1",
    title: "The Pragmatic Programmer",
    author: "Andrew Hunt",
    publishedYear: 1999,
    pageCount: 320,
    keywords: ["software", "craftsmanship"],
  },
  {
    id: "book:2",
    title: "Designing Data-Intensive Applications",
    author: "Martin Kleppmann",
    publishedYear: 2017,
    pageCount: 616,
    keywords: ["systems", "data", "distributed"],
  },
  {
    id: "book:3",
    title: "Crafting Interpreters",
    author: "Robert Nystrom",
    publishedYear: 2021,
    pageCount: 640,
    keywords: ["interpreters", "compilers"],
  },
  {
    id: "book:4",
    title: "Operating Systems: Three Easy Pieces",
    author: "Remzi Arpaci-Dusseau",
    publishedYear: 2018,
    pageCount: 670,
    keywords: ["operating-systems", "concurrency"],
  },
  {
    id: "book:5",
    title: "Computer Networking: A Top-Down Approach",
    author: "James Kurose",
    publishedYear: 2017,
    pageCount: 900,
    keywords: ["networking", "protocols"],
  },
];

class StubBooksCollection implements CollectionHandle<BookRecord> {
  async findExact(filter: Partial<BookRecord>, limit?: number): Promise<BookRecord[]> {
    const entries = Object.entries(filter).filter(
      ([, v]) => v !== undefined && v !== null,
    );
    const matched = entries.length === 0
      ? STUB_BOOKS.slice()
      : STUB_BOOKS.filter((row) =>
          entries.every(
            ([k, v]) =>
              (row as unknown as Record<string, unknown>)[k] === (v as unknown),
          ),
        );
    return limit !== undefined ? matched.slice(0, limit) : matched;
  }
  async search(query: string, opts?: { limit?: number }): Promise<BookRecord[]> {
    return rankBooks(query, opts?.limit ?? 5);
  }
  async findSimilar(query: string, limit?: number): Promise<BookRecord[]> {
    return rankBooks(query, limit ?? 5);
  }
  async hybrid(query: string, opts?: { limit?: number }): Promise<BookRecord[]> {
    return rankBooks(query, opts?.limit ?? 5);
  }
}

function rankBooks(query: string, limit: number): BookRecord[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return STUB_BOOKS.map((row) => {
    const haystack = [row.title, row.author, ...row.keywords]
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const t of tokens) if (haystack.includes(t)) score += 1;
    return { row, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.row);
}

class StubBooksMount implements MountAdapter {
  readonly id = "novel-tenant-books";
  capabilities(): SourceCapabilities {
    return { vector: false, lex: true, stream: false, compile: false };
  }
  async probe(): Promise<MountInventory> {
    return { collections: [{ name: "records", rows: STUB_BOOKS.length }] };
  }
  async sample(_collection: string, _opts: SampleOpts): Promise<unknown[]> {
    return STUB_BOOKS.slice(0, 3);
  }
  collection<T>(name: string): CollectionHandle<T> {
    if (name !== "records") {
      throw new Error(`StubBooksMount: unknown collection ${name}`);
    }
    return new StubBooksCollection() as unknown as CollectionHandle<T>;
  }
}

function makeBookRuntime(): MountRuntime {
  const adapter = new StubBooksMount();
  return {
    mountId: "novel-tenant-books",
    adapter,
    identMap: [{ ident: "records", name: "records" }],
    collection<T>(name: string): CollectionHandle<T> {
      return adapter.collection<T>(name);
    },
    async close(): Promise<void> {
      // no-op for stub
    },
  };
}

// --- Substrate-level seed: per_entity (already shipped by the substrate) ---
//
// The substrate ships ONE generic helper per_entity under
// <baseDir>/lib/__seed__/per_entity.ts. It is NOT tenant-specific; the
// agent provides toolBundle/toolNames/paramName at call time. For this
// smoke we don't exercise per_entity (no tool bundle); instead we
// crystallise a fresh helper from a substrate-rooted trajectory shape
// the observer's gate already accepts: `db.records.findExact` followed
// by a `lib.*` call that consumes the db output.
//
// To get a substrate-rooted `lib.*` call the gate will accept, we drop
// a single "seed" helper into <baseDir>/lib/__seed__/ that takes a list
// of records and returns a summary. The seed lives outside the per-
// tenant prohibition (which targets <baseDir>/lib/<tenantId>/) and the
// body is family-agnostic; this matches the same `__seed__/` convention
// the SkillCraft harness uses.

async function writeSummariseSeed(baseDir: string): Promise<void> {
  const seedDir = path.join(baseDir, "lib", "__seed__");
  await fsp.mkdir(seedDir, { recursive: true });
  const sdkIndex = path.resolve(
    process.cwd(),
    "src",
    "sdk",
    "index.ts",
  );
  const valibotIndex = path.resolve(
    process.cwd(),
    "node_modules",
    "valibot",
    "dist",
    "index.mjs",
  );
  const body = `import { fn } from "${pathToFileUrlString(sdkIndex)}";
import * as v from "${pathToFileUrlString(valibotIndex)}";

type Record = { id: string; title?: string; pageCount?: number };
type Input = { rows: Record[] };

export const summariseRecords = fn<Input, unknown>({
  intent: "Summarise a list of records by counting and taking the first title.",
  examples: [],
  input: v.object({
    rows: v.array(v.object({
      id: v.string(),
      title: v.optional(v.string()),
      pageCount: v.optional(v.number()),
    })),
  }),
  output: v.unknown(),
  async body(input) {
    const rows = (input as Input).rows;
    return {
      value: {
        count: rows.length,
        firstTitle: rows[0]?.title ?? null,
        totalPages: rows.reduce((s, r) => s + (r.pageCount ?? 0), 0),
      },
    };
  },
});
`;
  await fsp.writeFile(path.join(seedDir, "summariseRecords.ts"), body, "utf8");
}

function pathToFileUrlString(absolute: string): string {
  return `file://${absolute}`;
}

// --- Smoke harness ---------------------------------------------------------

type CheckResult = { name: string; pass: boolean; detail?: string };

const TENANT = "novel-tenant-smoke";

const FIRST_SNIPPET = `
const rows = await df.db.records.findExact({}, 10);
const summary = (await df.lib.summariseRecords({ rows })).value;
console.log("answer=" + JSON.stringify(summary));
`;

async function main(): Promise<void> {
  if (!process.env["DATAFETCH_INTERFACE_MODE"]) {
    process.env["DATAFETCH_INTERFACE_MODE"] = "legacy";
  }

  const baseDir = path.join(
    "/tmp",
    `df-novel-tenant-smoke-${process.pid}-${Date.now()}`,
  );
  await fsp.mkdir(baseDir, { recursive: true });

  const checks: CheckResult[] = [];

  // 1. Seed the substrate-level helper (lib/__seed__/, NOT tenant-scoped).
  //    This is the only "seed" the substrate ships; everything else under
  //    lib/<tenantId>/ must be observer-crystallised.
  await writeSummariseSeed(baseDir);
  checks.push({
    name: "substrate-level seed dropped under lib/__seed__/",
    pass: true,
  });

  // 2. Install runtime + flue + observer for the novel tenant.
  const { snippetRuntime, libraryResolver } = await installSnippetRuntime({
    baseDir,
    skipSeedMirror: true,
  });
  await installFlueDispatcher({ baseDir, skipSeedMirror: true });
  const { observer } = installObserver({
    baseDir,
    tenantId: TENANT,
    snippetRuntime,
  });

  // 3. Register the books mount.
  const reg = getMountRuntimeRegistry();
  reg.register("novel-tenant-books", makeBookRuntime());

  // 4. Run the first snippet. Expected trajectory shape:
  //    [db.records.findExact, lib.summariseRecords]. Both calls are
  //    substrate-rooted, so the gate should accept and crystallise.
  const result1 = await snippetRuntime.run({
    source: FIRST_SNIPPET,
    sessionCtx: {
      tenantId: TENANT,
      mountIds: ["novel-tenant-books"],
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

  if (!result1.trajectoryId) {
    checks.push({
      name: "first snippet recorded trajectory id",
      pass: false,
      detail: "no trajectoryId on RunResult",
    });
    finalizeAndExit(checks);
    return;
  }
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
    name: "observer returned learned interface",
    pass: observeResult.kind === "crystallised",
    detail:
      observeResult.kind === "crystallised"
        ? `name=${observeResult.name} path=${observeResult.path}`
        : `skipped: ${observeResult.reason}`,
  });
  if (observeResult.kind !== "crystallised") {
    finalizeAndExit(checks);
    return;
  }

  // 5. The crystallised helper must live under <baseDir>/lib/<TENANT>/,
  //    NOT under <baseDir>/lib/__seed__/ — the proof that per-tenant
  //    adaptation accrued from this tenant's observed usage.
  const expectedDir = path.join(baseDir, "lib", TENANT);
  checks.push({
    name: `learned interface written under lib/${TENANT}/`,
    pass: observeResult.path.startsWith(expectedDir + path.sep),
    detail: `path=${observeResult.path}, expected dir prefix=${expectedDir}`,
  });
  let crystallisedSource = "";
  try {
    crystallisedSource = await fsp.readFile(observeResult.path, "utf8");
    checks.push({ name: "learned interface file readable", pass: true });
  } catch (err) {
    checks.push({
      name: "learned interface file readable",
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  checks.push({
    name: "learned interface body invokes df.db.records.findExact",
    pass: crystallisedSource.includes("df.db.records.findExact"),
  });
  checks.push({
    name: "learned interface body invokes df.lib.summariseRecords",
    pass: crystallisedSource.includes("df.lib.summariseRecords"),
  });

  // 6. Confirm the resolver loads the crystallised helper.
  const resolved = await libraryResolver.resolve(TENANT, observeResult.name);
  checks.push({
    name: "DiskLibraryResolver loads the learned interface",
    pass: resolved !== null,
    detail: resolved === null ? "resolve returned null" : `intent=${resolved.spec.intent}`,
  });

  // 7. Second snippet: call the crystallised helper directly. Required
  //    for the spirit of "the substrate's per-tenant interface improves
  //    from observed usage": the second episode REUSES the helper. The
  //    crystallised helper's public input shape mirrors the originating
  //    trajectory's external parameters (the template extractor binds
  //    derived values internally), so we pass `{filter, limit}` here —
  //    the same external params the db.records.findExact call carried.
  const SECOND_SNIPPET = `
const out = await df.lib.${observeResult.name}({
  filter: {},
  limit: 10,
});
console.log("learned-interface-result=" + JSON.stringify(out.value));
`;
  const result2 = await snippetRuntime.run({
    source: SECOND_SNIPPET,
    sessionCtx: {
      tenantId: TENANT,
      mountIds: ["novel-tenant-books"],
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

  if (result2.trajectoryId) {
    const traj2File = path.join(
      baseDir,
      "trajectories",
      `${result2.trajectoryId}.json`,
    );
    try {
      const traj2 = JSON.parse(await fsp.readFile(traj2File, "utf8")) as {
        calls: Array<{ primitive: string }>;
        mode?: string;
        cost?: { llmCalls?: number };
      };
      const primitives = traj2.calls.map((c) => c.primitive);
      checks.push({
        name: `second trajectory calls lib.${observeResult.name}`,
        pass: primitives.includes(`lib.${observeResult.name}`),
        detail: JSON.stringify(primitives),
      });
      checks.push({
        name: "second trajectory makes no LLM calls",
        pass: (traj2.cost?.llmCalls ?? 0) === 0,
        detail: `llmCalls=${traj2.cost?.llmCalls}`,
      });
    } catch (err) {
      checks.push({
        name: "second trajectory readable",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  finalizeAndExit(checks, {
    snippetStdout: result1.stdout,
    snippetStderr: result1.stderr,
    secondStdout: result2.stdout,
    secondStderr: result2.stderr,
    crystallised: {
      name: observeResult.name,
      path: observeResult.path,
      firstLines: crystallisedSource.split("\n").slice(0, 40).join("\n"),
    },
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
      `--- learned interface file (first 40 lines) ${debug.crystallised.path} ---\n` +
        debug.crystallised.firstLines,
    );
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("novel-tenant smoke crashed:", err);
  process.exit(1);
});
