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
import { createMountsApp } from "./v1mounts.js";

loadProjectEnv();

async function bootstrap(): Promise<void> {
  // Boot the in-process runtimes in dependency order.
  const { snippetRuntime, baseDir } = await installSnippetRuntime({});
  await installFlueDispatcher({ baseDir });
  installObserver({
    baseDir,
    tenantId: process.env["DATAFETCH_TENANT"] ?? "demo-tenant",
    snippetRuntime,
  });

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

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[server] bootstrap failed:", err);
  process.exit(1);
});
