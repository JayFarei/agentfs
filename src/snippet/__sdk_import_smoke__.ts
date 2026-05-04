// Verifies that user-authored /lib/<tenant>/<name>.ts files using the
// documented `import { fn } from "@datafetch/sdk"` form load correctly
// through DiskLibraryResolver (the `@datafetch/sdk` rewriter).
//
// Run via: `pnpm tsx src/snippet/__sdk_import_smoke__.ts`.

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DiskLibraryResolver } from "./library.js";

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "datafetch-sdk-import-"));
  const tenant = "smoke-tenant";
  const tenantDir = path.join(root, "lib", tenant);
  await mkdir(tenantDir, { recursive: true });

  const fnFile = path.join(tenantDir, "tripleIt.ts");
  await writeFile(
    fnFile,
    [
      `import { fn } from "@datafetch/sdk";`,
      `import * as v from "valibot";`,
      ``,
      `export const tripleIt = fn({`,
      `  intent: "triple a number",`,
      `  examples: [{ input: { n: 1 }, output: { n: 3 } }],`,
      `  input: v.object({ n: v.number() }),`,
      `  output: v.object({ n: v.number() }),`,
      `  body: ({ n }) => ({ n: n * 3 }),`,
      `});`,
      ``,
    ].join("\n"),
    "utf8",
  );

  const resolver = new DiskLibraryResolver({ baseDir: root });
  const fnObj = await resolver.resolve(tenant, "tripleIt");
  if (!fnObj) {
    throw new Error(
      `[FAIL] resolver returned null — @datafetch/sdk rewrite path failed.`,
    );
  }
  console.log("[PASS] resolver loaded user-authored /lib/<tenant>/tripleIt.ts");

  const result = await fnObj({ n: 7 });
  const value = result.value as { n: number };
  if (value.n !== 21) {
    throw new Error(
      `[FAIL] tripleIt({n:7}) returned ${JSON.stringify(value)}, expected {n:21}`,
    );
  }
  console.log("[PASS] tripleIt({n:7}) === {n:21}");

  if (result.mode !== "interpreted") {
    throw new Error(
      `[FAIL] result.mode is "${result.mode}", expected "interpreted"`,
    );
  }
  console.log('[PASS] result.mode === "interpreted"');

  await rm(root, { recursive: true, force: true });
  console.log("\n3/3 passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
