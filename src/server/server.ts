// Data-plane HTTP entry point.
//
// Boot order matters:
//   1. installSnippetRuntime — registers the LibraryResolver singleton.
//   2. installFlueDispatcher — registers the BodyDispatcher singleton.
//      Runs after the LibraryResolver so any LLM-backed body dispatched
//      during boot can resolve seed lib functions.
//   3. installObserver — hooks the snippet runtime's `onTrajectorySaved`
//      so successful trajectories crystallise into /lib/<tenant>/.
//
// Routes:
//   POST /v1/mounts          provider publishes a mount (SSE stream).
//   DELETE /v1/mounts/:id    explicit teardown.
//   GET /v1/mounts           list registered mounts.
//   POST /v1/bash            run one bash command in a persistent session.
//   POST /v1/connect         create a session; persists to disk.
//   GET /v1/sessions         list persisted sessions.
//   GET /v1/sessions/:id     fetch one session record.
//   DELETE /v1/sessions/:id  delete one session record.
//   POST /v1/snippets        run a TS snippet against a session.
//
// Graceful shutdown closes every published mount via `closeAllMounts()`.

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { closeAllMounts } from "../adapter/runtime.js";
import { DiskMountReader } from "../bash/mountReader.js";
import { loadProjectEnv } from "../env.js";
import { installFlueDispatcher } from "../flue/install.js";
import { installObserver } from "../observer/install.js";
import { getLibraryResolver } from "../sdk/index.js";
import { installSnippetRuntime } from "../snippet/install.js";

import { createBashApp } from "./v1bash.js";
import { createConnectApp } from "./v1connect.js";
import { createMountsApp } from "./v1mounts.js";
import { createSessionsApp } from "./v1sessions.js";
import { createSnippetsApp } from "./v1snippets.js";
import { SessionStore } from "./sessionStore.js";

// --- Public factory --------------------------------------------------------

export type CreateServerOpts = {
  // Override the on-disk workspace root. Defaults to defaultBaseDir().
  baseDir?: string;
  // Tenant id for the observer (controls where crystallised /lib/ files
  // land for trajectories driven by /v1/bash and /v1/snippets that don't
  // pin a session-bound tenant).
  tenantId?: string;
};

export type CreateServerResult = {
  app: Hono;
  baseDir: string;
};

// Boot the in-process runtimes and assemble the Hono app. Does NOT
// start an HTTP listener — the caller does that with `serve()` or
// `app.fetch` directly. Idempotent across calls within one process is
// NOT guaranteed; the SDK singletons (LibraryResolver, BodyDispatcher,
// snippet runtime onTrajectorySaved) are replaced on each call.
export async function createServer(
  opts: CreateServerOpts = {},
): Promise<CreateServerResult> {
  const { snippetRuntime, baseDir } = await installSnippetRuntime(
    opts.baseDir !== undefined ? { baseDir: opts.baseDir } : {},
  );
  await installFlueDispatcher({ baseDir });
  installObserver({
    baseDir,
    tenantId: opts.tenantId ?? process.env["DATAFETCH_TENANT"] ?? "demo-tenant",
    snippetRuntime,
  });

  const store = new SessionStore({ baseDir });

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, baseDir }));

  app.route("/v1/mounts", createMountsApp({ baseDir }));
  app.route(
    "/v1/bash",
    createBashApp({
      mountReader: new DiskMountReader({ baseDir }),
      snippetRuntime,
      libraryResolver: getLibraryResolver(),
      baseDir,
    }),
  );
  app.route("/v1/connect", createConnectApp({ baseDir, store }));
  app.route("/v1/sessions", createSessionsApp({ baseDir, store }));
  app.route(
    "/v1/snippets",
    createSnippetsApp({ snippetRuntime, baseDir, store }),
  );

  return { app, baseDir };
}

// --- Standalone bootstrap --------------------------------------------------

// Used when this file is invoked as the entry point (e.g. `tsx
// src/server/server.ts` or the `pnpm api` script). The CLI's `server`
// subcommand drives its own `createServer()` + `serve()` loop.
async function bootstrap(): Promise<void> {
  loadProjectEnv();
  const { app, baseDir } = await createServer();

  const port = Number(process.env["PORT"] ?? 5174);
  const server = serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`datafetch api · http://localhost:${port} · baseDir=${baseDir}`);

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received; closing mounts and shutting down`);
    try {
      await closeAllMounts();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[server] closeAllMounts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Only run bootstrap when this file is the entry point. Importing
// `createServer` from a sibling module (e.g. cli.ts) must NOT trigger
// the standalone listener.
const isEntry = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  // import.meta.url: `file:///abs/path/to/server.ts`. argv[1] under tsx
  // is the absolute path of the entry script. Match by suffix to
  // tolerate symlinks / drive-letter case differences.
  const argvBase = argv1.split(/[\\/]/).pop() ?? "";
  const urlBase = import.meta.url.split(/[\\/]/).pop() ?? "";
  return argvBase === urlBase;
})();

if (isEntry) {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[server] bootstrap failed:", err);
    process.exit(1);
  });
}
