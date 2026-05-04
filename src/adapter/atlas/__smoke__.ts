// Smoke test for AtlasMountAdapter + bootstrap pipeline.
//
// Runs end-to-end against MongoDB Atlas when ATLAS_URI is set. If unset,
// logs a notice and exits 0 so CI can call this safely; the run is a
// manual/local smoke test in that case.
//
// Invocation:
//   ATLAS_URI=... ATLAS_DB_NAME=finqa pnpm tsx src/adapter/atlas/__smoke__.ts
//
// Asserts:
//   (a) all five output files materialise
//   (b) the synthesised <coll>.ts contains an `interface` and SCHEMA_VERSION
//   (c) _descriptor.json parses and matches MountDescriptor's shape
//   (d) _samples.json has at least 5 docs

import path from "node:path";
import { promises as fs } from "node:fs";

import { atlasMount } from "../atlasMount.js";
import { publishMount } from "../publishMount.js";
import { resolveBaseDir } from "../../bootstrap/emit.js";
import { getMountRuntimeRegistry } from "../runtime.js";

async function main(): Promise<void> {
  const uri = process.env.ATLAS_URI ?? process.env.MONGODB_URI;
  if (!uri) {
    console.log(
      "[smoke] ATLAS_URI not set — skipping live smoke test. (manual smoke only)",
    );
    return;
  }

  const dbName = process.env.ATLAS_DB_NAME ?? process.env.MONGODB_DB_NAME ?? "finqa";
  const mountId = process.env.SMOKE_MOUNT_ID ?? "finqa-2024";
  const baseDir = process.env.SMOKE_BASE_DIR ?? resolveBaseDir();

  console.log(
    `[smoke] publishMount id=${mountId} db=${dbName} baseDir=${baseDir}`,
  );

  const handle = await publishMount({
    id: mountId,
    source: atlasMount({ uri, db: dbName }),
    warmup: "eager",
    baseDir,
  });

  // Drain any queued events for visibility.
  for await (const evt of handle.status()) {
    console.log(`[smoke] stage`, evt);
  }

  const inventory = await handle.inventory();
  console.log(
    `[smoke] inventory: ${inventory.collections
      .map((c) => `${c.name}(${c.rows})`)
      .join(", ")}`,
  );

  // Pick a collection to assert against. Prefer "cases" if present (FinQA),
  // else the first inventoried collection.
  const target =
    inventory.collections.find((c) => c.name === "finqa_cases") ??
    inventory.collections.find((c) => c.name === "cases") ??
    inventory.collections[0];
  if (!target) {
    throw new Error("[smoke] no collections in inventory");
  }

  const mountRoot = path.join(baseDir, "mounts", mountId);
  const collDir = path.join(mountRoot, target.name);
  const moduleFile = path.join(mountRoot, `${target.name}.ts`);
  const descriptorFile = path.join(collDir, "_descriptor.json");
  const samplesFile = path.join(collDir, "_samples.json");
  const statsFile = path.join(collDir, "_stats.json");
  const readmeFile = path.join(mountRoot, "README.md");

  const files = [moduleFile, descriptorFile, samplesFile, statsFile, readmeFile];
  for (const f of files) {
    await fs.access(f);
    console.log(`[smoke] ok: ${f}`);
  }

  // (b) module contains interface + SCHEMA_VERSION
  const moduleSrc = await fs.readFile(moduleFile, "utf8");
  if (!/export interface \w+/.test(moduleSrc)) {
    throw new Error(`[smoke] missing 'export interface' in ${moduleFile}`);
  }
  if (!/export const SCHEMA_VERSION = "sha256:/.test(moduleSrc)) {
    throw new Error(`[smoke] missing SCHEMA_VERSION in ${moduleFile}`);
  }

  // (c) descriptor parses and looks like MountDescriptor
  const descriptor = JSON.parse(await fs.readFile(descriptorFile, "utf8")) as Record<
    string,
    unknown
  >;
  if (!descriptor.kind || !descriptor.fields || !descriptor.affordances) {
    throw new Error(`[smoke] descriptor missing required keys: ${descriptorFile}`);
  }

  // (d) at least 5 sample docs
  const samples = JSON.parse(await fs.readFile(samplesFile, "utf8")) as unknown[];
  if (!Array.isArray(samples) || samples.length < 5) {
    throw new Error(
      `[smoke] expected >=5 samples in ${samplesFile}, got ${samples.length}`,
    );
  }

  // (e) on-disk inventory present and well-formed
  const inventoryFile = path.join(mountRoot, "_inventory.json");
  await fs.access(inventoryFile);
  const inventoryDisk = JSON.parse(
    await fs.readFile(inventoryFile, "utf8"),
  ) as { mountId: string; collections: Array<{ ident: string; name: string }> };
  if (
    inventoryDisk.mountId !== mountId ||
    !Array.isArray(inventoryDisk.collections) ||
    inventoryDisk.collections.length === 0
  ) {
    throw new Error(`[smoke] malformed _inventory.json at ${inventoryFile}`);
  }
  if (!inventoryDisk.collections.every((c) => c.ident && c.name)) {
    throw new Error(`[smoke] _inventory.json entries missing {ident,name}`);
  }
  console.log(
    `[smoke] ok: _inventory.json (${inventoryDisk.collections.length} collections, idents: ${inventoryDisk.collections.map((c) => `${c.ident}→${c.name}`).join(", ")})`,
  );

  // (f) `inventory()` returns the same identMap shape
  const inventoryHandle = await handle.inventory();
  if (
    !Array.isArray(inventoryHandle.identMap) ||
    inventoryHandle.identMap.length !== inventoryDisk.collections.length
  ) {
    throw new Error(`[smoke] inventory().identMap mismatch with on-disk record`);
  }

  // (g) the registry returns a live MountRuntime; calling
  //     `runtime.collection(name).findExact({}, 3)` returns rows.
  const registry = getMountRuntimeRegistry();
  const runtime = registry.get(mountId);
  if (!runtime) {
    throw new Error(`[smoke] MountRuntimeRegistry.get(${mountId}) returned null`);
  }
  if (runtime.identMap.length !== inventoryDisk.collections.length) {
    throw new Error(`[smoke] runtime.identMap length mismatch`);
  }
  const liveColl = runtime.collection<Record<string, unknown>>(target.name);
  const liveDocs = await liveColl.findExact({}, 3);
  if (!Array.isArray(liveDocs) || liveDocs.length === 0) {
    throw new Error(`[smoke] live runtime findExact returned no rows`);
  }
  console.log(
    `[smoke] ok: registry.get(${mountId}).collection(${target.name}).findExact({}, 3) → ${liveDocs.length} rows`,
  );

  console.log("[smoke] all assertions passed.");
  await handle.close();
  // After close, the registry should no longer have the mount.
  if (getMountRuntimeRegistry().get(mountId) !== null) {
    throw new Error(`[smoke] expected unregister-on-close; mount still in registry`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
