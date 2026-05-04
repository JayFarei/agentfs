import { describe, expect, it, beforeEach } from "vitest";

import {
  InMemoryMountRuntimeRegistry,
  closeAllMounts,
  closeMount,
  getMountRuntimeRegistry,
  makeMountRuntime,
  setMountRuntimeRegistry,
  type MountRuntime,
} from "../src/adapter/runtime.js";
import type { CollectionHandle, MountAdapter } from "../src/sdk/index.js";

function stubAdapter(opts: { closeCounter?: { n: number } } = {}): MountAdapter & {
  close: () => Promise<void>;
} {
  return {
    id: "stub",
    capabilities: () => ({ vector: false, lex: false, stream: false, compile: false }),
    probe: async () => ({ collections: [] }),
    sample: async () => [],
    collection: <T>() => ({} as CollectionHandle<T>),
    close: async () => {
      if (opts.closeCounter) opts.closeCounter.n += 1;
    },
  };
}

describe("InMemoryMountRuntimeRegistry", () => {
  let reg: InMemoryMountRuntimeRegistry;

  beforeEach(() => {
    reg = new InMemoryMountRuntimeRegistry();
  });

  it("registers, gets, lists, and unregisters", () => {
    const adapter = stubAdapter();
    const rt = makeMountRuntime({ mountId: "m1", adapter, identMap: [] });
    reg.register("m1", rt);

    expect(reg.get("m1")).toBe(rt);
    expect(reg.list()).toEqual([rt]);

    const removed = reg.unregister("m1");
    expect(removed).toBe(rt);
    expect(reg.get("m1")).toBeNull();
    expect(reg.list()).toEqual([]);
  });

  it("returns null when get/unregister miss", () => {
    expect(reg.get("nope")).toBeNull();
    expect(reg.unregister("nope")).toBeNull();
  });

  it("re-registering the same mountId closes the previous runtime", async () => {
    const counter = { n: 0 };
    const a = stubAdapter({ closeCounter: counter });
    const b = stubAdapter();
    reg.register("m1", makeMountRuntime({ mountId: "m1", adapter: a, identMap: [] }));
    reg.register("m1", makeMountRuntime({ mountId: "m1", adapter: b, identMap: [] }));
    // Best-effort close runs async; tick the loop.
    await new Promise((resolve) => setImmediate(resolve));
    expect(counter.n).toBe(1);
  });

  it("closeAll() closes every runtime and clears the registry", async () => {
    const c1 = { n: 0 };
    const c2 = { n: 0 };
    reg.register(
      "m1",
      makeMountRuntime({
        mountId: "m1",
        adapter: stubAdapter({ closeCounter: c1 }),
        identMap: [],
      }),
    );
    reg.register(
      "m2",
      makeMountRuntime({
        mountId: "m2",
        adapter: stubAdapter({ closeCounter: c2 }),
        identMap: [],
      }),
    );
    await reg.closeAll();
    expect(c1.n).toBe(1);
    expect(c2.n).toBe(1);
    expect(reg.list()).toEqual([]);
  });
});

describe("module-level singleton", () => {
  it("getMountRuntimeRegistry returns whatever set...() set", () => {
    const fresh = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(fresh);
    expect(getMountRuntimeRegistry()).toBe(fresh);
  });

  it("closeMount() unregisters + closes; returns false on miss", async () => {
    const fresh = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(fresh);
    const counter = { n: 0 };
    fresh.register(
      "m1",
      makeMountRuntime({
        mountId: "m1",
        adapter: stubAdapter({ closeCounter: counter }),
        identMap: [],
      }),
    );
    expect(await closeMount("m1")).toBe(true);
    expect(counter.n).toBe(1);
    expect(fresh.get("m1")).toBeNull();
    expect(await closeMount("m1")).toBe(false);
  });

  it("closeAllMounts() routes through the registered registry", async () => {
    const fresh = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(fresh);
    const counter = { n: 0 };
    fresh.register(
      "m1",
      makeMountRuntime({
        mountId: "m1",
        adapter: stubAdapter({ closeCounter: counter }),
        identMap: [],
      }),
    );
    await closeAllMounts();
    expect(counter.n).toBe(1);
  });
});

describe("makeMountRuntime", () => {
  it("delegates collection() to the adapter", () => {
    const handle = { findExact: async () => [] } as unknown as CollectionHandle<unknown>;
    const adapter: MountAdapter = {
      id: "stub",
      capabilities: () => ({ vector: false, lex: false, stream: false, compile: false }),
      probe: async () => ({ collections: [] }),
      sample: async () => [],
      collection: <T>() => handle as unknown as CollectionHandle<T>,
    };
    const rt: MountRuntime = makeMountRuntime({
      mountId: "m1",
      adapter,
      identMap: [{ ident: "x", name: "x_substrate" }],
    });
    expect(rt.collection("x_substrate")).toBe(handle);
    expect(rt.identMap[0]).toEqual({ ident: "x", name: "x_substrate" });
  });

  it("close() is a no-op when adapter omits close()", async () => {
    const adapter: MountAdapter = {
      id: "no-close",
      capabilities: () => ({ vector: false, lex: false, stream: false, compile: false }),
      probe: async () => ({ collections: [] }),
      sample: async () => [],
      collection: <T>() => ({} as CollectionHandle<T>),
    };
    const rt = makeMountRuntime({ mountId: "m1", adapter, identMap: [] });
    await expect(rt.close()).resolves.toBeUndefined();
  });
});
