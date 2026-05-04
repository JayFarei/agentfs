// `publishMount({...})` — the provider-SDK facade.
//
// Per `kb/prd/personas.md` §1's mock and `kb/prd/design.md` §11.1.
// Constructs the right MountAdapter for the given source, drives the
// bootstrap pipeline (sample → infer → synthesise → write), and returns a
// MountHandle exposing `status()`, `inventory()`, `read()`, and `on()`.
//
// MVP scope:
//   - `source.kind === "atlas"` is the only supported substrate.
//   - `warmup: "lazy"` (default) returns immediately; bootstrap runs in the
//     background and stage events stream out of `status()`.
//   - `warmup: "eager"` blocks until the bootstrap completes.
//   - `policy` is accepted but unenforced in MVP (no allow-listing yet).
//   - `on("drift" | "family-promoted")` registers handlers but they never
//     fire in MVP — drift detection and cross-tenant promotion are deferred.
//
// LIFETIME CONTRACT:
//   The mount runtime is registered with `MountRuntimeRegistry` once
//   `emit()` finishes and lives for as long as the dataset is published.
//   `MountHandle.close()` is the EXPLICIT teardown path — calling it
//   unregisters the mount AND closes the underlying substrate client.
//
//   In-process callers (tests, the Wave 6 demo CLI) call `close()`
//   themselves when they want teardown. HTTP callers via `/v1/mounts`
//   MUST NOT call `close()` automatically when the SSE stream completes
//   (the route is the publish action; the registry owns lifetime). The
//   server-side equivalent of `close()` is `DELETE /v1/mounts/:id`,
//   which routes to `closeMount(id)` from `./runtime.js`.
//
//   On server shutdown, wire `closeAllMounts()` (also from `./runtime.js`)
//   into the SIGINT/SIGTERM handler so every registered mount releases
//   its Mongo client.

import path from "node:path";
import { promises as fs } from "node:fs";

import type { MountInventory } from "../sdk/index.js";
import { AtlasMountAdapter } from "./atlas/AtlasMountAdapter.js";
import type { AtlasSource } from "./atlasMount.js";
import {
  emitMount,
  resolveBaseDir,
  type EmitResult,
  type EmitStageEvent,
} from "../bootstrap/emit.js";
import type { CollectionIdent } from "../bootstrap/idents.js";
import {
  getMountRuntimeRegistry,
  makeMountRuntime,
} from "./runtime.js";

// --- Public types ----------------------------------------------------------

export type MountSource = AtlasSource;

export type WarmupMode = "lazy" | "eager";

export type MountPolicy = {
  // "open" (any tenant) or {allow: ["acme-*"]}-shaped allowlist. MVP accepts
  // both shapes for contract stability; enforcement is deferred.
  access?: "open" | { allow: string[] };
  // Read-only by default. Tenant overlays handle writable bits.
  write?: boolean;
};

export type PublishMountArgs = {
  id: string;
  source: MountSource;
  warmup?: WarmupMode;
  policy?: MountPolicy;
  // Overrides the resolved base directory. Defaults to
  // $DATAFETCH_HOME / $ATLASFS_HOME / cwd/.atlasfs.
  baseDir?: string;
};

export type MountStatusEvent = EmitStageEvent;

// Drift / family-promotion never fire in MVP, but the API surface lives.
export type DriftEvent = {
  collection: string;
  oldFingerprint?: string;
  newFingerprint: string;
  staleDependents: string[];
};

export type FamilyPromotedEvent = {
  name: string;
  contributingTenants: number;
};

export type MountHandleEvents = {
  drift: (e: DriftEvent) => void;
  "family-promoted": (e: FamilyPromotedEvent) => void;
};

// Inventory returned from `MountHandle.inventory()`. Extends the SDK's
// `MountInventory` (which only carries `collections: CollectionInventoryEntry[]`)
// with the `identMap` field the snippet runtime needs to resolve
// `df.db.<ident>` back to the substrate's collection name. The same data
// is also persisted to `<baseDir>/mounts/<mountId>/_inventory.json` so an
// off-disk reader can boot without going through publishMount.
export type PublishedMountInventory = MountInventory & {
  identMap: CollectionIdent[];
};

export type MountHandle = {
  readonly id: string;
  status(): AsyncIterable<MountStatusEvent>;
  inventory(): Promise<PublishedMountInventory>;
  read(relativePath: string): Promise<string>;
  on<K extends keyof MountHandleEvents>(
    event: K,
    handler: MountHandleEvents[K],
  ): void;
  // Adapter exit: closes the underlying substrate connection. Not part of
  // the personas.md spec but the MVP plumbing needs it for clean shutdown.
  // Also unregisters the mount from the global MountRuntimeRegistry.
  close(): Promise<void>;
};

// --- Implementation --------------------------------------------------------

export async function publishMount(
  args: PublishMountArgs,
): Promise<MountHandle> {
  if (args.source.kind !== "atlas") {
    // Exhaustiveness guard: when more adapters land, switch on `kind` here.
    throw new Error(
      `publishMount: unsupported source.kind "${
        (args.source as { kind: string }).kind
      }". MVP supports "atlas" only.`,
    );
  }

  const baseDir = args.baseDir ?? resolveBaseDir();
  const adapter = new AtlasMountAdapter({
    uri: args.source.uri,
    db: args.source.db,
    mountId: args.id,
  });

  const stream = emitMount({ adapter, mountId: args.id, baseDir });

  // The status stream is a one-shot async iterable. We tee it so callers can
  // iterate `status()` and the publishMount call itself can await `done()`
  // when warmup === "eager".
  let cachedResult: EmitResult | null = null;
  let resultError: Error | null = null;
  let registered = false;

  const ensureDone = async (): Promise<EmitResult> => {
    if (cachedResult) return cachedResult;
    if (resultError) throw resultError;
    try {
      cachedResult = await stream.done();
      // Register the live MountRuntime so the snippet runtime can bind
      // `df.db.<ident>` against this adapter from inside `npx tsx`. The
      // adapter stays open until `MountHandle.close()` is called.
      if (!registered) {
        const registry = getMountRuntimeRegistry();
        registry.register(
          args.id,
          makeMountRuntime({
            mountId: args.id,
            adapter,
            identMap: cachedResult.identMap,
          }),
        );
        registered = true;
      }
      return cachedResult;
    } catch (err) {
      resultError = err instanceof Error ? err : new Error(String(err));
      throw resultError;
    }
  };

  // Track event handlers (drift / family-promoted are no-ops in MVP). We
  // store as `unknown[]` keyed by event name and re-narrow on dispatch
  // (which never happens in MVP). The compile-time check on `on()` is
  // what enforces handler shape.
  const handlers = new Map<keyof MountHandleEvents, unknown[]>();

  const handle: MountHandle = {
    id: args.id,
    status(): AsyncIterable<MountStatusEvent> {
      return stream.events();
    },
    async inventory(): Promise<PublishedMountInventory> {
      const result = await ensureDone();
      return {
        collections: result.inventory.collections,
        identMap: result.identMap,
      };
    },
    async read(relativePath: string): Promise<string> {
      // Resolve relative to the mount root. Caller-relative paths (no
      // leading "/") are joined directly; absolute-looking paths are
      // stripped of their leading slash and treated as mount-relative.
      const cleaned = relativePath.replace(/^\/+/, "");
      const full = path.join(baseDir, "mounts", args.id, cleaned);
      return fs.readFile(full, "utf8");
    },
    on<K extends keyof MountHandleEvents>(
      event: K,
      handler: MountHandleEvents[K],
    ): void {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      // MVP: drift and family-promoted never fire. The handlers are stored
      // for forward compatibility so user code doesn't have to special-case
      // MVP vs full SDK.
    },
    async close(): Promise<void> {
      // Unregister first so any in-flight resolve calls fail fast rather
      // than racing on a closing client. The registry's `unregister`
      // returns the runtime; closing it closes the adapter exactly once.
      if (registered) {
        const registry = getMountRuntimeRegistry();
        const removed = registry.unregister(args.id);
        registered = false;
        if (removed) {
          await removed.close();
          return;
        }
      }
      await adapter.close();
    },
  };

  if (args.warmup === "eager") {
    await ensureDone();
  } else {
    // Lazy: kick off the run without awaiting. The status() stream lazily
    // starts the run on first iteration; we trigger it here so events flow
    // even if the caller never iterates status().
    void ensureDone().catch(() => {
      /* surfaced when the caller awaits inventory() / read() */
    });
  }

  return handle;
}
