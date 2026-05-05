import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionStore } from "../src/server/sessionStore.js";

describe("SessionStore", () => {
  let baseDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-sessionstore-"));
    store = new SessionStore({ baseDir });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("createSession persists a JSON record on disk", async () => {
    const record = await store.createSession({
      tenantId: "t1",
      mountIds: ["m1", "m2"],
    });
    expect(record.sessionId).toMatch(/^sess_/);
    expect(record.tenantId).toBe("t1");
    expect(record.mountIds).toEqual(["m1", "m2"]);
    expect(record.createdAt).toBe(record.lastActiveAt);

    const file = path.join(baseDir, "sessions", `${record.sessionId}.json`);
    const onDisk = JSON.parse(await readFile(file, "utf8")) as unknown;
    expect(onDisk).toEqual(record);
  });

  it("loadSession returns null for missing ids", async () => {
    expect(await store.loadSession("missing")).toBeNull();
  });

  it("listSessions returns all sessions, sorted by createdAt", async () => {
    const a = await store.createSession({ tenantId: "t", mountIds: [] });
    // Force a different createdAt by sleeping a tick. The ISO timestamp
    // has ms precision so a tiny delay is enough.
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createSession({ tenantId: "t", mountIds: [] });

    const sessions = await store.listSessions();
    expect(sessions.map((s) => s.sessionId)).toEqual([a.sessionId, b.sessionId]);
  });

  it("deleteSession removes the file and returns true", async () => {
    const r = await store.createSession({ tenantId: "t", mountIds: [] });
    expect(await store.deleteSession(r.sessionId)).toBe(true);
    expect(await store.loadSession(r.sessionId)).toBeNull();
    expect(await store.deleteSession(r.sessionId)).toBe(false);
  });

  it("touchSession bumps lastActiveAt without changing createdAt", async () => {
    const r = await store.createSession({ tenantId: "t", mountIds: [] });
    await new Promise((res) => setTimeout(res, 5));
    const touched = await store.touchSession(r.sessionId);
    expect(touched).not.toBeNull();
    expect(touched!.createdAt).toBe(r.createdAt);
    expect(touched!.lastActiveAt > r.lastActiveAt).toBe(true);
  });

  it("touchSession returns null for missing ids", async () => {
    expect(await store.touchSession("nope")).toBeNull();
  });

  it("listSessions returns [] when the dir does not exist", async () => {
    // Fresh tmp dir without ever calling createSession.
    const fresh = await mkdtemp(path.join(os.tmpdir(), "df-sessionstore-empty-"));
    try {
      const empty = new SessionStore({ baseDir: fresh });
      expect(await empty.listSessions()).toEqual([]);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
