// POST /v1/connect — create a session.
//
// Request: { tenantId, mountIds? }. If mountIds is omitted we default to
// every currently-registered mount via `getMountRuntimeRegistry().list()`.
//
// The session record is persisted to disk BEFORE the response goes out;
// this keeps the contract simple — once the client sees a sessionId, the
// disk file exists.

import { Hono } from "hono";
import * as v from "valibot";

import { getMountRuntimeRegistry } from "../adapter/runtime.js";
import { defaultBaseDir } from "../paths.js";

import { regenerateManifest } from "./manifest.js";
import { SessionStore } from "./sessionStore.js";

export type ConnectAppDeps = {
  baseDir?: string;
  // Allow tests to inject a SessionStore bound to a tmp dir without
  // also setting DATAFETCH_HOME.
  store?: SessionStore;
};

const connectRequestSchema = v.object({
  tenantId: v.pipe(v.string(), v.minLength(1)),
  mountIds: v.optional(v.array(v.string())),
});

export function createConnectApp(deps: ConnectAppDeps = {}): Hono {
  const storeOpts: ConstructorParameters<typeof SessionStore>[0] = {};
  if (deps.baseDir !== undefined) storeOpts.baseDir = deps.baseDir;
  const store = deps.store ?? new SessionStore(storeOpts);

  const app = new Hono();

  app.post("/", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = v.safeParse(connectRequestSchema, raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          issues: parsed.issues.map((i) => i.message),
        },
        400,
      );
    }

    const mountIds =
      parsed.output.mountIds ??
      getMountRuntimeRegistry()
        .list()
        .map((r) => r.mountId);

    const record = await store.createSession({
      tenantId: parsed.output.tenantId,
      mountIds,
    });

    // Regenerate the typed API manifest for this tenant. Best-effort;
    // never blocks the connect response if it fails.
    void regenerateManifest({
      baseDir: deps.baseDir ?? defaultBaseDir(),
      tenantId: parsed.output.tenantId,
    });

    return c.json(record);
  });

  return app;
}
