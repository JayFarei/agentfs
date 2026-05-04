// Bootstrap orchestrator: probe → sample → infer → synthesize → write.
//
// Per `kb/prd/design.md` §9.2 (warm-up stages). Streams stage events through
// an AsyncIterable so the provider's `for await (const event of finqa.status())`
// pattern from personas.md §1 works.
//
// Output layout (per the plan's "Storage layout" block):
//   <baseDir>/mounts/<mountId>/<coll>.ts
//   <baseDir>/mounts/<mountId>/<coll>/_descriptor.json
//   <baseDir>/mounts/<mountId>/<coll>/_samples.json
//   <baseDir>/mounts/<mountId>/<coll>/_stats.json
//   <baseDir>/mounts/<mountId>/README.md
//
// The DiskMountReader consumed by the bash workspace agent globs against
// these exact paths.

import path from "node:path";
import { promises as fs } from "node:fs";

import type {
  MountAdapter,
  MountInventory,
  MountDescriptor,
  MountStats,
  MountSamples,
} from "../sdk/index.js";
import { fingerprintDescriptor, inferShape } from "./infer.js";
import { sampleCollection } from "./sample.js";
import { synthesizeCollectionModule } from "./synthesize.js";
import { synthesizeReadme } from "./readme.js";
import { buildIdentMap, type CollectionIdent } from "./idents.js";

// --- Stage events ----------------------------------------------------------

export type EmitStageEvent =
  | { stage: "probing" }
  | { stage: "sampling"; collection: string; progress: number }
  | { stage: "inferring"; collection: string }
  | { stage: "synthesising"; collection: string }
  | { stage: "writing"; collection: string }
  | { stage: "applying-meta-harness" }
  | { stage: "ready" };

// --- Public types ----------------------------------------------------------

export type EmitArgs = {
  adapter: MountAdapter;
  mountId: string;
  baseDir?: string;
  // Per-collection sample size cap (the adaptive sampler still scales to
  // 1000 on high variance). Default 100.
  sampleSize?: number;
  // Number of representative samples to materialise into _samples.json.
  // Default 8 (within the 5–10 band).
  representativeSamples?: number;
};

export type EmitResult = {
  mountId: string;
  baseDir: string;
  inventory: MountInventory;
  // {ident, name} pairs in inventory order, one per collection. The snippet
  // runtime uses this to map `df.db.<ident>` calls back to the substrate
  // collection name. Persisted to `<baseDir>/mounts/<mountId>/_inventory.json`.
  identMap: CollectionIdent[];
  collections: Array<{
    name: string;
    ident: string;
    rows: number;
    fingerprint: string;
    sampleSize: number;
    descriptor: MountDescriptor;
    paths: {
      module: string;
      descriptor: string;
      samples: string;
      stats: string;
    };
  }>;
  readmePath: string;
  inventoryPath: string;
};

// Shape of the on-disk inventory record.
// Path: `<baseDir>/mounts/<mountId>/_inventory.json`.
// Wave 3's snippet runtime reads this when binding `df.db.<ident>`.
export type OnDiskInventory = {
  mountId: string;
  substrate: string;
  generatedAt: string;
  collections: Array<{
    ident: string;
    name: string;
    rows: number;
    fingerprint: string;
  }>;
};

// --- Default base directory ------------------------------------------------

// Re-exported for callers that historically imported the helper from this
// module; the canonical implementation now lives in `src/paths.ts`.
export { defaultBaseDir as resolveBaseDir } from "../paths.js";
import { defaultBaseDir as resolveBaseDir } from "../paths.js";

// --- Orchestrator ----------------------------------------------------------

// Drives the bootstrap end-to-end. Yields stage events as it goes, then
// returns the final EmitResult. Callers consume it like:
//
//   const stream = emitMount({adapter, mountId});
//   for await (const evt of stream.events()) console.log(evt);
//   const result = await stream.done();
//
export type EmitStream = {
  events(): AsyncIterable<EmitStageEvent>;
  done(): Promise<EmitResult>;
};

export function emitMount(args: EmitArgs): EmitStream {
  const baseDir = args.baseDir ?? resolveBaseDir();
  const events: EmitStageEvent[] = [];
  let resolveEvent: ((ok: boolean) => void) | null = null;
  let finished = false;
  let error: Error | null = null;
  let resultPromise: Promise<EmitResult> | null = null;

  const emit = (e: EmitStageEvent): void => {
    events.push(e);
    if (resolveEvent) {
      const r = resolveEvent;
      resolveEvent = null;
      r(true);
    }
  };

  const run = async (): Promise<EmitResult> => {
    try {
      // --- Stage 1: probe -----------------------------------------------
      emit({ stage: "probing" });
      const inventory = await args.adapter.probe();

      const identMap = buildIdentMap(
        inventory.collections.map((c) => c.name),
      );
      const identByName = new Map(identMap.map((c) => [c.name, c.ident]));

      const collectionResults: EmitResult["collections"] = [];

      for (let i = 0; i < inventory.collections.length; i++) {
        const entry = inventory.collections[i];
        const progress = (i + 1) / inventory.collections.length;

        // --- Stage 2: sample --------------------------------------------
        emit({
          stage: "sampling",
          collection: entry.name,
          progress: round2(progress),
        });
        const sampleResult = await sampleCollection(args.adapter, entry.name, {
          initialSize: args.sampleSize ?? 100,
        });

        // --- Stage 3: infer ---------------------------------------------
        emit({ stage: "inferring", collection: entry.name });
        const inference = inferShape({
          collection: entry.name,
          samples: sampleResult.samples,
        });
        const fingerprint = fingerprintDescriptor(inference.descriptor);

        // --- Stage 4: synthesise + write --------------------------------
        emit({ stage: "synthesising", collection: entry.name });
        const tsModule = synthesizeCollectionModule({
          mountId: args.mountId,
          collectionName: entry.name,
          // Pass the canonical ident from the precomputed ident map so
          // the synthesised module's `export declare const <ident>` is
          // the same string that `_inventory.json` records. Guarantees
          // alignment when collisions disambiguate (e.g. `foo_bar` and
          // `foo-bar` both raw-collapse to `fooBar`).
          ident: identByName.get(entry.name),
          inference,
          fingerprint,
          substrate: args.adapter.id,
          sampleSize: sampleResult.samples.length,
        });

        emit({ stage: "writing", collection: entry.name });
        const paths = await writeCollectionArtefacts({
          baseDir,
          mountId: args.mountId,
          collectionName: entry.name,
          moduleSource: tsModule.source,
          descriptor: { ...inference.descriptor, "@sha256": fingerprint },
          samples: pickRepresentativeSamples(
            sampleResult.samples,
            args.representativeSamples ?? 8,
          ),
          stats: buildStats({
            rows: entry.rows,
            sampledRows: sampleResult.samples.length,
            inference,
          }),
        });

        // Wire the descriptor back into the adapter so subsequent search
        // queries can pick paths by field role (rather than fall back).
        if (
          "setDescriptor" in args.adapter &&
          typeof (args.adapter as { setDescriptor?: unknown }).setDescriptor ===
            "function"
        ) {
          (
            args.adapter as {
              setDescriptor: (n: string, d: MountDescriptor) => void;
            }
          ).setDescriptor(entry.name, inference.descriptor);
        }

        collectionResults.push({
          name: entry.name,
          ident: identByName.get(entry.name) ?? entry.name,
          rows: entry.rows,
          fingerprint,
          sampleSize: sampleResult.samples.length,
          descriptor: inference.descriptor,
          paths,
        });
      }

      // --- Stage 5: README + meta-harness apply -------------------------
      emit({ stage: "applying-meta-harness" });
      const readme = synthesizeReadme({
        mountId: args.mountId,
        substrate: args.adapter.id,
        collections: collectionResults.map((c) => ({
          name: c.name,
          rows: c.rows,
          descriptor: c.descriptor,
          fingerprint: c.fingerprint,
          sampleSize: c.sampleSize,
        })),
      });
      const mountRoot = path.join(baseDir, "mounts", args.mountId);
      await fs.mkdir(mountRoot, { recursive: true });
      const readmePath = path.join(mountRoot, "README.md");
      await fs.writeFile(readmePath, readme, "utf8");

      // Persist the on-disk inventory so the snippet runtime can boot
      // off-disk after a server restart without re-publishing the mount.
      // Wave 3 reads this via `MountReader` to populate `df.db.*`.
      const onDiskInventory: OnDiskInventory = {
        mountId: args.mountId,
        substrate: args.adapter.id,
        generatedAt: new Date().toISOString(),
        collections: collectionResults.map((c) => ({
          ident: c.ident,
          name: c.name,
          rows: c.rows,
          fingerprint: c.fingerprint,
        })),
      };
      const inventoryPath = path.join(mountRoot, "_inventory.json");
      await fs.writeFile(
        inventoryPath,
        JSON.stringify(onDiskInventory, null, 2),
        "utf8",
      );

      emit({ stage: "ready" });

      finished = true;
      if (resolveEvent) {
        const r = resolveEvent;
        resolveEvent = null;
        r(true);
      }

      return {
        mountId: args.mountId,
        baseDir,
        inventory,
        identMap,
        collections: collectionResults,
        readmePath,
        inventoryPath,
      };
    } catch (err) {
      finished = true;
      error = err instanceof Error ? err : new Error(String(err));
      if (resolveEvent) {
        const r = resolveEvent;
        resolveEvent = null;
        r(false);
      }
      throw error;
    }
  };

  const start = (): Promise<EmitResult> => {
    if (!resultPromise) {
      resultPromise = run();
    }
    return resultPromise;
  };

  return {
    events(): AsyncIterable<EmitStageEvent> {
      // Lazy-start: events() being iterated kicks off run() if not already.
      const promise = start();
      // Suppress unhandled rejection until the consumer awaits done().
      promise.catch(() => {
        /* surfaced via done() */
      });
      let cursor = 0;
      return {
        [Symbol.asyncIterator](): AsyncIterator<EmitStageEvent> {
          return {
            async next(): Promise<IteratorResult<EmitStageEvent>> {
              while (true) {
                if (cursor < events.length) {
                  return { value: events[cursor++], done: false };
                }
                if (finished) {
                  if (error) throw error;
                  return { value: undefined, done: true };
                }
                await new Promise<boolean>((resolve) => {
                  resolveEvent = resolve;
                });
              }
            },
          };
        },
      };
    },
    done(): Promise<EmitResult> {
      return start();
    },
  };
}

// --- Artefact writing ------------------------------------------------------

type WriteArgs = {
  baseDir: string;
  mountId: string;
  collectionName: string;
  moduleSource: string;
  descriptor: MountDescriptor;
  samples: MountSamples;
  stats: MountStats;
};

async function writeCollectionArtefacts(
  args: WriteArgs,
): Promise<EmitResult["collections"][number]["paths"]> {
  const mountDir = path.join(args.baseDir, "mounts", args.mountId);
  const collDir = path.join(mountDir, args.collectionName);
  const modulePath = path.join(mountDir, `${args.collectionName}.ts`);
  const descriptorPath = path.join(collDir, "_descriptor.json");
  const samplesPath = path.join(collDir, "_samples.json");
  const statsPath = path.join(collDir, "_stats.json");

  await fs.mkdir(collDir, { recursive: true });
  await fs.writeFile(modulePath, args.moduleSource, "utf8");
  await fs.writeFile(
    descriptorPath,
    JSON.stringify(args.descriptor, null, 2),
    "utf8",
  );
  await fs.writeFile(
    samplesPath,
    JSON.stringify(args.samples, null, 2),
    "utf8",
  );
  await fs.writeFile(statsPath, JSON.stringify(args.stats, null, 2), "utf8");

  return {
    module: modulePath,
    descriptor: descriptorPath,
    samples: samplesPath,
    stats: statsPath,
  };
}

// Pick a small, representative slice of the sample for `_samples.json`.
// Per design.md §7.3 budget: 5–10 docs.
function pickRepresentativeSamples(samples: unknown[], n: number): unknown[] {
  if (samples.length <= n) return samples;
  // Spread the sample evenly so we don't always get the head.
  const step = samples.length / n;
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(i * step);
    out.push(samples[idx]);
  }
  return out;
}

function buildStats(args: {
  rows: number;
  sampledRows: number;
  inference: ReturnType<typeof inferShape>;
}): MountStats {
  return {
    rows: args.rows,
    presence: args.inference.presence,
    cardinality: args.inference.cardinalityEstimate,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
