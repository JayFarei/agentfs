import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  InMemoryMountRuntimeRegistry,
  makeMountRuntime,
  setMountRuntimeRegistry,
} from "../src/adapter/runtime.js";
import { createConnectApp } from "../src/server/v1connect.js";
import { createSessionsApp } from "../src/server/v1sessions.js";
import { SessionStore } from "../src/server/sessionStore.js";
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

describe("createConnectApp — POST /", () => {
  let baseDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-connect-"));
    store = new SessionStore({ baseDir });
    setMountRuntimeRegistry(new InMemoryMountRuntimeRegistry());
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function postConnect(app: ReturnType<typeof createConnectApp>, body: unknown) {
    return app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("rejects invalid JSON with 400", async () => {
    const app = createConnectApp({ baseDir, store });
    const res = await postConnect(app, "not json{");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
  });

  it("rejects missing tenantId with 400", async () => {
    const app = createConnectApp({ baseDir, store });
    const res = await postConnect(app, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown };
    expect(body.error).toBe("invalid_request");
  });

  it("returns a session record and persists it on disk", async () => {
    const app = createConnectApp({ baseDir, store });
    const res = await postConnect(app, { tenantId: "t1", mountIds: ["m1"] });
    expect(res.status).toBe(200);
    const record = (await res.json()) as {
      sessionId: string;
      tenantId: string;
      mountIds: string[];
      createdAt: string;
      lastActiveAt: string;
    };
    expect(record.tenantId).toBe("t1");
    expect(record.mountIds).toEqual(["m1"]);
    expect(record.sessionId).toMatch(/^sess_/);

    // Persisted to disk before response.
    const onDisk = await store.loadSession(record.sessionId);
    expect(onDisk).toEqual(record);
  });

  it("defaults mountIds to all currently registered mounts when omitted", async () => {
    const reg = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(reg);
    reg.register(
      "m-default",
      makeMountRuntime({
        mountId: "m-default",
        adapter: stubAdapter("atlas"),
        identMap: [],
      }),
    );

    const app = createConnectApp({ baseDir, store });
    const res = await postConnect(app, { tenantId: "t" });
    expect(res.status).toBe(200);
    const record = (await res.json()) as { mountIds: string[] };
    expect(record.mountIds).toEqual(["m-default"]);
  });
});

describe("createSessionsApp", () => {
  let baseDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-sessions-"));
    store = new SessionStore({ baseDir });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("GET / returns the empty list when no sessions exist", async () => {
    const app = createSessionsApp({ baseDir, store });
    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [] });
  });

  it("GET / lists persisted sessions", async () => {
    const a = await store.createSession({ tenantId: "t", mountIds: [] });
    const app = createSessionsApp({ baseDir, store });
    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string }>;
    };
    expect(body.sessions.map((s) => s.sessionId)).toContain(a.sessionId);
  });

  it("GET /:id returns 404 for missing", async () => {
    const app = createSessionsApp({ baseDir, store });
    const res = await app.request("/missing", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id removes the session and invokes onSessionDeleted", async () => {
    const r = await store.createSession({ tenantId: "t", mountIds: [] });
    const dropped: string[] = [];
    const app = createSessionsApp({
      baseDir,
      store,
      onSessionDeleted: (id) => {
        dropped.push(id);
      },
    });
    const res = await app.request(`/${r.sessionId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sessionId: r.sessionId });
    expect(dropped).toEqual([r.sessionId]);
    expect(await store.loadSession(r.sessionId)).toBeNull();
  });

  it("DELETE /:id returns 404 when nothing to delete", async () => {
    const app = createSessionsApp({ baseDir, store });
    const res = await app.request("/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
