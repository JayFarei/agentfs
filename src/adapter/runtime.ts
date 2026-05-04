// Mount runtime registry — the live binding from a published mountId to a
// long-lived MountAdapter that the snippet runtime can call into from
// inside an `npx tsx` snippet.
//
// Per Codex review of Wave 2: `publishMount` builds the on-disk surface
// (synthesised <coll>.ts + descriptor + samples + stats + README), but
// without a registry the snippet runtime has nothing to bind `df.db.<ident>`
// to at call time. This module provides:
//
//   1. `MountRuntime` — adapter + collection accessor that keeps the
//      substrate connection alive across calls.
//   2. `MountRuntimeRegistry` interface + `InMemoryMountRuntimeRegistry`
//      default implementation.
//   3. Module-level singleton (`get/setMountRuntimeRegistry`) following
//      the same pattern as `get/setBodyDispatcher` in `src/sdk/runtime.ts`.
//      The singleton lives HERE (not in `src/sdk/runtime.ts`) because the
//      registry is an adapter-runtime concern; the SDK contracts stay
//      adapter-agnostic.
//
// Wave 3's `SnippetRuntime` resolves `df.db.<ident>` like:
//
//   const reg = getMountRuntimeRegistry();
//   const runtime = reg.get(mountId);
//   if (!runtime) throw new Error(`mount ${mountId} not registered`);
//   const collName = runtime.identMap.find(c => c.ident === ident)?.name;
//   const handle = runtime.collection<T>(collName);
//   await handle.findExact(filter, limit);

import type {
  CollectionHandle,
  MountAdapter,
} from "../sdk/index.js";
import type { CollectionIdent } from "../bootstrap/idents.js";

// --- Public types ----------------------------------------------------------

export type MountRuntime = {
  readonly mountId: string;
  readonly adapter: MountAdapter;
  // The {ident, name} pairs the snippet runtime uses to translate
  // `df.db.<ident>` calls back to the substrate's collection name. Same
  // shape as the on-disk inventory record so a serialised inventory and a
  // live runtime are interchangeable.
  readonly identMap: readonly CollectionIdent[];
  // Returns a CollectionHandle bound to the live adapter. Calling this
  // does NOT close the underlying client between calls — the runtime is
  // long-lived for as long as the mount is registered.
  collection<T>(name: string): CollectionHandle<T>;
  // Drop the runtime and close its underlying adapter. Called by
  // `MountHandle.close()`.
  close(): Promise<void>;
};

export interface MountRuntimeRegistry {
  register(mountId: string, runtime: MountRuntime): void;
  get(mountId: string): MountRuntime | null;
  list(): MountRuntime[];
  unregister(mountId: string): MountRuntime | null;
  closeAll(): Promise<void>;
}

// --- Default in-memory implementation -------------------------------------

export class InMemoryMountRuntimeRegistry implements MountRuntimeRegistry {
  private readonly runtimes = new Map<string, MountRuntime>();

  register(mountId: string, runtime: MountRuntime): void {
    if (this.runtimes.has(mountId)) {
      // Replace silently — re-publish should be idempotent. Close the old
      // one to release the substrate client.
      const prev = this.runtimes.get(mountId);
      if (prev) {
        // Best-effort; do not block register on a closing peer.
        void prev.close().catch(() => undefined);
      }
    }
    this.runtimes.set(mountId, runtime);
  }

  get(mountId: string): MountRuntime | null {
    return this.runtimes.get(mountId) ?? null;
  }

  list(): MountRuntime[] {
    return Array.from(this.runtimes.values());
  }

  unregister(mountId: string): MountRuntime | null {
    const runtime = this.runtimes.get(mountId);
    if (!runtime) return null;
    this.runtimes.delete(mountId);
    return runtime;
  }

  async closeAll(): Promise<void> {
    const all = Array.from(this.runtimes.values());
    this.runtimes.clear();
    await Promise.allSettled(all.map((r) => r.close()));
  }
}

// --- Module-level singleton ------------------------------------------------

// Default instance: an empty in-memory registry. Tests can swap in a fresh
// one via `setMountRuntimeRegistry(new InMemoryMountRuntimeRegistry())`.
let _registry: MountRuntimeRegistry = new InMemoryMountRuntimeRegistry();

export function setMountRuntimeRegistry(registry: MountRuntimeRegistry): void {
  _registry = registry;
}

export function getMountRuntimeRegistry(): MountRuntimeRegistry {
  return _registry;
}

// Convenience for server-shutdown wiring (Wave 5 owns SIGINT). Closes
// every registered mount runtime, releasing its substrate client. Safe to
// call multiple times (the registry is empty after the first call).
export async function closeAllMounts(): Promise<void> {
  await _registry.closeAll();
}

// Unregister + close one mount by id. Returns true if the mount was
// registered, false if not. Used by the `DELETE /v1/mounts/:id` route
// to provide explicit teardown without closing the in-process handle.
export async function closeMount(mountId: string): Promise<boolean> {
  const runtime = _registry.unregister(mountId);
  if (!runtime) return false;
  await runtime.close();
  return true;
}

// --- Helper: build a MountRuntime from an adapter -------------------------

// Constructor used by `publishMount` after `emit()` finishes. The runtime
// holds onto the adapter; closing it closes the adapter, which closes the
// substrate client.
export function makeMountRuntime(args: {
  mountId: string;
  adapter: MountAdapter & { close?: () => Promise<void> };
  identMap: readonly CollectionIdent[];
}): MountRuntime {
  const { mountId, adapter, identMap } = args;
  return {
    mountId,
    adapter,
    identMap,
    collection<T>(name: string): CollectionHandle<T> {
      return adapter.collection<T>(name);
    },
    async close(): Promise<void> {
      // Adapter's `close()` is optional on the contract but every concrete
      // adapter (today: AtlasMountAdapter) implements it. Guard for the
      // contract's optionality so future adapters without a close() still
      // work.
      if (typeof adapter.close === "function") {
        await adapter.close();
      }
    },
  };
}
