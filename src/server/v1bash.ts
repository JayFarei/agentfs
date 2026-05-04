// POST /v1/bash — run one bash command in a persistent BashSession.
//
// Per kb/plans/004-datafetch-bash-mvp.md Phase 1 acceptance:
//   "HTTP POST /v1/bash accepts {sessionId, command} and returns
//    {stdout, stderr, exitCode}."
//
// We additionally take {tenantId, mountIds} on the FIRST call for a given
// sessionId so the data plane can construct the appropriate BashSession.
// Subsequent calls with the same sessionId reuse the cached session and
// ignore the tenantId / mountIds (a mismatch is currently silent;
// hardening is Wave 5's concern).
//
// This file does NOT touch `src/server/server.ts` or `src/server/routes.ts`.
// Wave 5 wires `createBashApp` into the top-level server.

import { Hono } from "hono";
import * as v from "valibot";

import { BashSession } from "../bash/session.js";
import type { MountReader } from "../bash/mountReader.js";
import type { SnippetRuntime } from "../bash/snippetRuntime.js";
import type { LibraryResolver } from "../sdk/index.js";

// --- App factory inputs -----------------------------------------------------

export type BashAppDeps = {
  mountReader: MountReader;
  snippetRuntime: SnippetRuntime;
  libraryResolver: LibraryResolver | null;
  // Optional baseDir override for tests.
  baseDir?: string;
  // Optional. Defaults to 30 minutes.
  sessionTtlMs?: number;
};

// --- Request/response schemas ----------------------------------------------

const bashRequestSchema = v.object({
  sessionId: v.pipe(v.string(), v.minLength(1)),
  tenantId: v.pipe(v.string(), v.minLength(1)),
  mountIds: v.array(v.string()),
  command: v.pipe(v.string(), v.minLength(1)),
});

type BashRequest = v.InferOutput<typeof bashRequestSchema>;

// --- Session cache ----------------------------------------------------------

type CachedSession = {
  session: BashSession;
  lastTouched: number;
  tenantId: string;
};

// --- App factory ------------------------------------------------------------

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function createBashApp(deps: BashAppDeps): Hono {
  const ttl = deps.sessionTtlMs ?? DEFAULT_TTL_MS;
  const sessions = new Map<string, CachedSession>();

  // Drop expired sessions from the cache. Before forgetting a session,
  // flush its /lib/ overlay so an agent that authored a function and
  // then went silent for >TTL doesn't lose the work — flushLib() is
  // mtime-tracked, so this is a no-op when nothing changed. The flush
  // runs in the background; we deliberately don't await it so HTTP
  // latency for the next call stays bounded. flushLib() has no shared
  // mutable state with other sessions and any error is swallowed (the
  // session is being dropped anyway).
  function evictExpired(): void {
    const now = Date.now();
    for (const [id, cached] of sessions) {
      if (now - cached.lastTouched > ttl) {
        sessions.delete(id);
        void cached.session.flushLib().catch(() => {
          // Logging surface lands later; for the MVP we accept that an
          // eviction-time flush failure is silent. The agent's last
          // active flush (the one before the most recent npx tsx) has
          // already persisted the bulk of the work.
        });
      }
    }
  }

  function getOrCreateSession(req: BashRequest): BashSession {
    evictExpired();
    const cached = sessions.get(req.sessionId);
    if (cached) {
      cached.lastTouched = Date.now();
      return cached.session;
    }
    const sessionInit: ConstructorParameters<typeof BashSession>[0] = {
      tenantId: req.tenantId,
      mountIds: req.mountIds,
      mountReader: deps.mountReader,
      snippetRuntime: deps.snippetRuntime,
      libraryResolver: deps.libraryResolver,
    };
    if (deps.baseDir !== undefined) sessionInit.baseDir = deps.baseDir;
    const session = new BashSession(sessionInit);
    sessions.set(req.sessionId, {
      session,
      lastTouched: Date.now(),
      tenantId: req.tenantId,
    });
    return session;
  }

  const app = new Hono();

  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = v.safeParse(bashRequestSchema, body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", issues: parsed.issues },
        400,
      );
    }
    const session = getOrCreateSession(parsed.output);
    try {
      const result = await session.exec(parsed.output.command);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "exec_failed", message }, 500);
    }
  });

  return app;
}
