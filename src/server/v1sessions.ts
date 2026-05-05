// /v1/sessions — list / get / delete persisted sessions.
//
//   GET /v1/sessions       → { sessions: [...] }
//   GET /v1/sessions/:id   → SessionRecord | 404
//   DELETE /v1/sessions/:id → { ok: true } | 404
//
// DELETE removes the disk file. If a BashSession or snippet-cache entry
// is held in memory for that id, the route invokes the optional
// `onSessionDeleted` callback so the per-route cache can drop it.

import { Hono } from "hono";

import { SessionStore } from "./sessionStore.js";

export type SessionsAppDeps = {
  baseDir?: string;
  store?: SessionStore;
  // Called after the disk record is removed. Lets callers (the parent
  // server) drop any in-memory BashSession / snippet caches keyed on
  // this sessionId. Errors are swallowed; the HTTP response only
  // depends on the disk delete succeeding.
  onSessionDeleted?: (sessionId: string) => void | Promise<void>;
};

export function createSessionsApp(deps: SessionsAppDeps = {}): Hono {
  const storeOpts: ConstructorParameters<typeof SessionStore>[0] = {};
  if (deps.baseDir !== undefined) storeOpts.baseDir = deps.baseDir;
  const store = deps.store ?? new SessionStore(storeOpts);

  const app = new Hono();

  app.get("/", async (c) => {
    const sessions = await store.listSessions();
    return c.json({ sessions });
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "missing_session_id" }, 400);
    const record = await store.loadSession(id);
    if (!record) return c.json({ error: "not_found", sessionId: id }, 404);
    return c.json(record);
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "missing_session_id" }, 400);
    const removed = await store.deleteSession(id);
    if (!removed) return c.json({ error: "not_found", sessionId: id }, 404);
    if (deps.onSessionDeleted) {
      try {
        await deps.onSessionDeleted(id);
      } catch {
        // Best-effort cleanup; the disk file is already gone.
      }
    }
    return c.json({ ok: true, sessionId: id });
  });

  return app;
}
