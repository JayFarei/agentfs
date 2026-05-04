import { describe, expect, it, beforeEach } from "vitest";

import { createMountsApp } from "../src/server/v1mounts.js";
import {
  InMemoryMountRuntimeRegistry,
  makeMountRuntime,
  setMountRuntimeRegistry,
} from "../src/adapter/runtime.js";
import type { CollectionHandle, MountAdapter } from "../src/sdk/index.js";

function stubAdapter(id: string): MountAdapter & { close: () => Promise<void> } {
  return {
    id,
    capabilities: () => ({ vector: false, lex: false, stream: false, compile: false }),
    probe: async () => ({ collections: [] }),
    sample: async () => [],
    collection: <T>() => ({} as CollectionHandle<T>),
    close: async () => {},
  };
}

describe("createMountsApp — POST /", () => {
  it("rejects invalid JSON with 400", async () => {
    setMountRuntimeRegistry(new InMemoryMountRuntimeRegistry());
    const app = createMountsApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
  });

  it("rejects body missing required fields with 400 + issues array", async () => {
    setMountRuntimeRegistry(new InMemoryMountRuntimeRegistry());
    const app = createMountsApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid_request");
    expect(Array.isArray(body.issues)).toBe(true);
  });
});

describe("createMountsApp — DELETE /:id", () => {
  let registry: InMemoryMountRuntimeRegistry;

  beforeEach(() => {
    registry = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(registry);
  });

  it("returns 404 when the mount isn't registered", async () => {
    const app = createMountsApp();
    const res = await app.request("/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found", mountId: "missing" });
  });

  it("returns 200 + closes the runtime when the mount is registered", async () => {
    let closed = false;
    const adapter = stubAdapter("stub");
    const original = adapter.close;
    adapter.close = async () => {
      closed = true;
      await original();
    };
    registry.register(
      "demo-mount",
      makeMountRuntime({ mountId: "demo-mount", adapter, identMap: [] }),
    );

    const app = createMountsApp();
    const res = await app.request("/demo-mount", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mountId: "demo-mount" });
    expect(closed).toBe(true);
    expect(registry.get("demo-mount")).toBeNull();
  });
});

describe("createMountsApp — GET /", () => {
  it("returns the empty list when no mounts are registered", async () => {
    setMountRuntimeRegistry(new InMemoryMountRuntimeRegistry());
    const app = createMountsApp();
    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mounts: [] });
  });

  it("lists registered mounts with their identMap", async () => {
    const registry = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(registry);
    registry.register(
      "m1",
      makeMountRuntime({
        mountId: "m1",
        adapter: stubAdapter("atlas"),
        identMap: [
          { ident: "cases", name: "finqa_cases" },
          { ident: "units", name: "finqa_search_units" },
        ],
      }),
    );

    const app = createMountsApp();
    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mounts: Array<{
        mountId: string;
        adapterId: string;
        collections: Array<{ ident: string; name: string }>;
      }>;
    };
    expect(body.mounts).toHaveLength(1);
    expect(body.mounts[0]).toEqual({
      mountId: "m1",
      adapterId: "atlas",
      collections: [
        { ident: "cases", name: "finqa_cases" },
        { ident: "units", name: "finqa_search_units" },
      ],
    });
  });
});
