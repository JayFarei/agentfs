// POST /v1/mounts — provider publishes a mount.
// DELETE /v1/mounts/:id — explicit teardown of a published mount.
//
// Per kb/plans/004-datafetch-bash-mvp.md Phase 2 architecture:
//   "/v1/mounts          provider publishes a mount; SSE stream of warm-up"
//
// Request shape mirrors `publishMount({...})` from personas.md §1. We
// validate with valibot, run the bootstrap pipeline, and stream stage
// events over SSE. Once the pipeline reaches the "ready" stage we emit a
// final `inventory` event carrying the mount inventory.
//
// LIFETIME — the mount runtime stays registered after publish so the
// snippet runtime can call `df.db.<ident>.findExact(...)` against the
// live Atlas connection. The HTTP route is the publish action, NOT a
// scoped session: closing the SSE stream does not close the mount.
// Use `DELETE /v1/mounts/:id` for explicit teardown. On server shutdown,
// the host should wire `closeAllMounts()` into its SIGINT/SIGTERM hook.
//
// This file does NOT touch `src/server/server.ts` or `src/server/routes.ts`.
// Wave 5 wires `createMountsApp` into the top-level server under
// `/v1/mounts`.

import { Hono } from "hono";
import * as v from "valibot";

import {
  publishMount,
  type PublishMountArgs,
  type WarmupMode,
  type MountPolicy,
} from "../adapter/publishMount.js";
import { closeMount, getMountRuntimeRegistry } from "../adapter/runtime.js";

// --- App factory inputs ----------------------------------------------------

export type MountsAppDeps = {
  // Optional baseDir override for tests; defaults to the resolver in
  // bootstrap/emit.ts.
  baseDir?: string;
};

// --- Request schema --------------------------------------------------------

const atlasSourceSchema = v.object({
  kind: v.literal("atlas"),
  uri: v.pipe(v.string(), v.minLength(1)),
  db: v.pipe(v.string(), v.minLength(1)),
});

const huggingFaceSourceSchema = v.object({
  kind: v.literal("huggingface"),
  dataset: v.pipe(v.string(), v.minLength(1)),
  config: v.optional(v.string()),
  split: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  endpoint: v.optional(v.string()),
});

const policySchema = v.object({
  access: v.optional(
    v.union([
      v.literal("open"),
      v.object({ allow: v.array(v.string()) }),
    ]),
  ),
  write: v.optional(v.boolean()),
});

const publishMountRequestSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  source: v.union([atlasSourceSchema, huggingFaceSourceSchema]),
  warmup: v.optional(v.union([v.literal("lazy"), v.literal("eager")])),
  policy: v.optional(policySchema),
});

// --- App factory -----------------------------------------------------------

export function createMountsApp(deps: MountsAppDeps = {}): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = v.safeParse(publishMountRequestSchema, raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          issues: parsed.issues.map((i) => i.message),
        },
        400,
      );
    }

    const args: PublishMountArgs = {
      id: parsed.output.id,
      source: parsed.output.source,
      warmup: (parsed.output.warmup ?? "lazy") as WarmupMode,
      policy: parsed.output.policy as MountPolicy | undefined,
      baseDir: deps.baseDir,
    };

    let handle;
    try {
      // We always pass warmup: "lazy" to the publishMount call so the SSE
      // stream can show progress, then await the inventory at the end.
      handle = await publishMount({ ...args, warmup: "lazy" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: "publish_failed", message: msg }, 500);
    }

    // Stream events as Server-Sent Events.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const writeEvent = (event: string, data: unknown): void => {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        };

        try {
          for await (const evt of handle.status()) {
            writeEvent("stage", evt);
          }
          // After the stream completes the bootstrap is done; surface the
          // inventory as a final event.
          const inventory = await handle.inventory();
          writeEvent("inventory", inventory);
          writeEvent("done", { id: handle.id });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          writeEvent("error", { message: msg });
        } finally {
          // Do NOT call handle.close() here. The mount runtime stays
          // registered so subsequent /v1/snippets calls can query it.
          // Explicit teardown happens through DELETE /v1/mounts/:id
          // (or closeAllMounts() on server shutdown). See the LIFETIME
          // note in publishMount.ts and the route doc above.
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // DELETE /v1/mounts/:id — explicit teardown. Unregisters the mount and
  // closes its underlying substrate client. Returns 404 when the mount
  // isn't currently registered (already torn down or never published).
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "missing_mount_id" }, 400);
    }
    const closed = await closeMount(id);
    if (!closed) {
      return c.json({ error: "not_found", mountId: id }, 404);
    }
    return c.json({ ok: true, mountId: id });
  });

  // GET /v1/mounts — list currently registered mounts. Useful for the
  // demo CLI and for debugging; not strictly required by the plan but
  // costs ~10 lines and exercises the registry's `list()` shape.
  app.get("/", async (c) => {
    const runtimes = getMountRuntimeRegistry().list();
    return c.json({
      mounts: runtimes.map((r) => ({
        mountId: r.mountId,
        adapterId: r.adapter.id,
        collections: r.identMap.map((m) => ({ ident: m.ident, name: m.name })),
      })),
    });
  });

  return app;
}
