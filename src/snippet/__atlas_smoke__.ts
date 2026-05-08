// Atlas-backed smoke test for the snippet runtime.
//
// Run with:  pnpm tsx src/snippet/__atlas_smoke__.ts
//
// Gates on `ATLAS_URI`; when absent it prints a manual-run notice and
// exits 0 — the in-memory smoke (`__smoke__.ts`) is the always-on path.
//
// Steps:
//   1. installSnippetRuntime({}) — disk LibraryResolver + seed shims.
//   2. installFlueDispatcher({}) — installed for parity (no LLM bodies
//      fire here).
//   3. publishMount({source: atlasMount({uri, db: "finqa"}), id: "finqa-2024"})
//      registers a real MountRuntime via the adapter pipeline.
//   4. snippetRuntime.run({source: "...df.db.<ident>.findSimilar..."})
//      returns plausible filing data; trajectory has substrate +
//      lib boundaries.

import { promises as fsp } from "node:fs";
import path from "node:path";

import { atlasMount } from "../adapter/atlasMount.js";
import { publishMount } from "../adapter/publishMount.js";
import { installFlueDispatcher } from "../flue/install.js";

import { installSnippetRuntime } from "./install.js";

async function main(): Promise<void> {
  const uri = process.env["ATLAS_URI"];
  if (!uri) {
    console.log(
      "ATLAS_URI not set — skipping Atlas-backed smoke. " +
        "Set ATLAS_URI and re-run to exercise the live mount path.",
    );
    return;
  }

  const baseDir = path.join(
    "/tmp",
    `df-snippet-atlas-smoke-${process.pid}-${Date.now()}`,
  );
  await fsp.mkdir(baseDir, { recursive: true });

  const { snippetRuntime } = await installSnippetRuntime({
    baseDir,
    seedDomains: ["finqa"],
  });
  await installFlueDispatcher({ baseDir, skipSeedMirror: true });

  const handle = await publishMount({
    id: "finqa-2024",
    source: atlasMount({ uri, db: "finqa" }),
    baseDir,
    warmup: "eager",
  });

  // Drain the warm-up stream so the MountRuntime registers.
  for await (const ev of handle.status()) {
    console.log(`[mount] ${JSON.stringify(ev)}`);
  }

  // Use the first inferred ident from the inventory.
  const inv = await handle.inventory();
  if (inv.identMap.length === 0) {
    console.error("publishMount returned no idents; aborting");
    process.exit(1);
  }
  const ident = inv.identMap[0]!.ident;

  const source = `
const cands = await df.db.${ident}.findSimilar("Visa 2017 operating revenues", 5);
console.log("candidates=" + cands.length);
if (cands.length === 0) {
  console.log("no candidates — substrate may be empty or unreachable");
} else {
  const filing = (await df.lib.pickFiling({
    question: "Visa 2017 operating revenues",
    candidates: cands,
    priorTickers: ["V"],
  })).value;
  console.log("picked=" + filing.filename);
}
`;

  const result = await snippetRuntime.run({
    source,
    sessionCtx: {
      tenantId: "atlas-smoke",
      mountIds: ["finqa-2024"],
      baseDir,
    },
  });

  console.log("--- atlas snippet stdout ---\n" + result.stdout);
  if (result.stderr) console.log("--- atlas snippet stderr ---\n" + result.stderr);
  console.log(
    `exitCode=${result.exitCode} trajectoryId=${result.trajectoryId} cost=${JSON.stringify(result.cost)}`,
  );

  await handle.close();
  if (result.exitCode !== 0) process.exit(1);
}

main().catch((err) => {
  console.error("atlas smoke crashed:", err);
  process.exit(1);
});
