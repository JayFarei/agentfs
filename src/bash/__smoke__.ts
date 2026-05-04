// Phase 1 smoke test for the bash workspace.
//
// Constructs a BashSession with a stub MountReader (one mount "demo" with
// one collection "rows"), the StubSnippetRuntime, and an in-memory
// LibraryResolver containing one trivial fn({...}). Exercises:
//
//   - cat /AGENTS.md
//   - ls /db /lib
//   - man <stub-fn>           expects structured man-page output
//   - apropos <keyword>       expects the stub to surface
//   - npx tsx -e "..."        expects the stub-runtime stderr to surface
//
// Prints PASS / FAIL per check and a final summary. Exit code 0 on all
// pass; 1 otherwise.

import * as v from "valibot";

import { BashSession } from "./session.js";
import type { MountReader } from "./mountReader.js";
import { StubSnippetRuntime } from "./snippetRuntime.js";
import {
  fn,
  setLibraryResolver,
  type Fn,
  type LibraryEntry,
  type LibraryResolver,
} from "../sdk/index.js";

// --- Stub MountReader -----------------------------------------------------

const STUB_README = `# demo mount

Stub mount used by the bash workspace smoke test.
One collection: \`rows\`.
`;

const STUB_MODULE = `// /db/demo/rows.ts (stub)
export interface Row { id: string; value: number; }
export const SCHEMA_VERSION = "stub" as const;
`;

const STUB_DESCRIPTOR = {
  kind: "documents" as const,
  cardinality: { rows: 3 },
  fields: {
    id: { role: "id" as const, presence: 1 },
    value: { role: "number" as const, presence: 1 },
  },
  affordances: ["findExact", "search", "findSimilar", "hybrid"] as const,
  polymorphic_variants: null,
};

const STUB_SAMPLES = [
  { id: "a", value: 1 },
  { id: "b", value: 2 },
  { id: "c", value: 3 },
];

const STUB_STATS = { rows: 3 };

const stubMountReader: MountReader = {
  async readModule(_mountId, _coll) {
    return STUB_MODULE;
  },
  async readReadme(_mountId) {
    return STUB_README;
  },
  async readDescriptor(_mountId, _coll) {
    return STUB_DESCRIPTOR;
  },
  async readSamples(_mountId, _coll) {
    return STUB_SAMPLES;
  },
  async readStats(_mountId, _coll) {
    return STUB_STATS;
  },
  async listCollections(_mountId) {
    return ["rows"];
  },
};

// --- Stub fn ---------------------------------------------------------------

const stubFn = fn({
  intent: "double a number for smoke-test purposes",
  examples: [{ input: { n: 2 }, output: { doubled: 4 } }],
  input: v.object({ n: v.number() }),
  output: v.object({ doubled: v.number() }),
  body: ({ n }: { n: number }) => ({ doubled: n * 2 }),
});

const STUB_FN_NAME = "smokeDouble";

// In-memory LibraryResolver bound to the stub fn.
function makeStubResolver(): LibraryResolver {
  const entries: LibraryEntry[] = [
    {
      name: STUB_FN_NAME,
      spec: stubFn.spec as LibraryEntry["spec"],
    },
  ];
  return {
    async resolve(_tenant, name) {
      if (name === STUB_FN_NAME) return stubFn as unknown as Fn<unknown, unknown>;
      return null;
    },
    async list(_tenant) {
      return entries;
    },
  };
}

// --- Smoke harness --------------------------------------------------------

type CheckResult = {
  name: string;
  pass: boolean;
  detail?: string;
  stdout?: string;
  stderr?: string;
};

async function main(): Promise<void> {
  const resolver = makeStubResolver();
  setLibraryResolver(resolver);
  const baseDir = `/tmp/df-bash-smoke-${process.pid}-${Date.now()}`;
  const session = new BashSession({
    tenantId: "smoke-tenant",
    mountIds: ["demo"],
    mountReader: stubMountReader,
    snippetRuntime: new StubSnippetRuntime(),
    libraryResolver: resolver,
    baseDir,
  });

  const results: CheckResult[] = [];

  // 1. cat /AGENTS.md
  {
    const r = await session.exec("cat /AGENTS.md");
    const ok =
      r.exitCode === 0 &&
      r.stdout.includes("Datafetch workspace") &&
      r.stdout.includes("/db/demo/");
    results.push({
      name: "cat /AGENTS.md",
      pass: ok,
      stdout: r.stdout,
      stderr: r.stderr,
    });
  }

  // 2. ls /db /lib
  {
    const r = await session.exec("ls /db /lib");
    const ok =
      r.exitCode === 0 &&
      r.stdout.includes("demo");
    results.push({
      name: "ls /db /lib",
      pass: ok,
      stdout: r.stdout,
      stderr: r.stderr,
    });
  }

  // 3. man <stub-fn>
  {
    const r = await session.exec(`man ${STUB_FN_NAME}`);
    const ok =
      r.exitCode === 0 &&
      r.stdout.includes("NAME") &&
      r.stdout.includes(STUB_FN_NAME) &&
      r.stdout.includes("SYNOPSIS") &&
      r.stdout.includes(`df.lib.${STUB_FN_NAME}`) &&
      r.stdout.includes("INPUT SCHEMA") &&
      r.stdout.includes("OUTPUT") &&
      r.stdout.includes("EXAMPLES");
    results.push({
      name: `man ${STUB_FN_NAME}`,
      pass: ok,
      stdout: r.stdout,
      stderr: r.stderr,
    });
  }

  // 4. apropos using a keyword from the intent ("double")
  {
    const r = await session.exec("apropos double smoke");
    const ok =
      r.exitCode === 0 &&
      r.stdout.includes(STUB_FN_NAME) &&
      r.stdout.includes("(df.lib)");
    results.push({
      name: "apropos double smoke",
      pass: ok,
      stdout: r.stdout,
      stderr: r.stderr,
    });
  }

  // 5. npx tsx -e — should hit the StubSnippetRuntime and surface its
  //    stderr+exitCode.
  {
    const r = await session.exec(`npx tsx -e "console.log('hi')"`);
    const ok =
      r.exitCode === 1 &&
      r.stderr.includes("snippet runtime not yet wired");
    results.push({
      name: 'npx tsx -e "console.log(\'hi\')"',
      pass: ok,
      stdout: r.stdout,
      stderr: r.stderr,
    });
  }

  // --- Print results ------------------------------------------------------

  let failed = 0;
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.name}`);
    if (!r.pass) {
      failed += 1;
      if (r.stdout && r.stdout.length > 0) {
        console.log(`  stdout:\n${indent(r.stdout)}`);
      }
      if (r.stderr && r.stderr.length > 0) {
        console.log(`  stderr:\n${indent(r.stderr)}`);
      }
      if (r.detail) console.log(`  detail: ${r.detail}`);
    }
  }
  console.log("");
  console.log(
    `${results.length - failed}/${results.length} passed${failed > 0 ? ` (${failed} failed)` : ""}`,
  );
  if (failed > 0) process.exit(1);
}

function indent(s: string, prefix = "    "): string {
  return s
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

main().catch((err) => {
  console.error("smoke harness crashed:", err);
  process.exit(1);
});
