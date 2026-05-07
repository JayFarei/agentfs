// POST /v1/snippets — run a TS snippet against a persisted session.
//
// Request: { sessionId, source, phase?, sourcePath? }.
//
// Resolves the session from disk (rehydrating tenantId + mountIds),
// invokes `snippetRuntime.run({source, sessionCtx})`, then reads the
// just-written trajectory back to harvest mode + provenance for the
// response. Bumps lastActiveAt on the session record after each call.
//
// We do NOT cache an in-memory BashSession here — the snippet runtime
// is stateless across calls; each `run()` builds its own DispatchContext
// and TrajectoryRecorder. The BashSession cache (with /lib/ overlay) is
// owned by createBashApp; /v1/snippets writes /lib/ via the snippet
// runtime's disk path directly, so no overlay flush is required.

import { Hono } from "hono";
import * as v from "valibot";

import { readTrajectory } from "../sdk/index.js";
import type { SessionCtx, SnippetRuntime } from "../bash/snippetRuntime.js";
import { summarizeCallScopes } from "../trajectory/callScope.js";

import { SessionStore } from "./sessionStore.js";
import { telemetryEnabled, writeTelemetryEvent } from "./telemetry.js";

export type SnippetsAppDeps = {
  snippetRuntime: SnippetRuntime;
  baseDir: string;
  store?: SessionStore;
};

const snippetsRequestSchema = v.object({
  sessionId: v.pipe(v.string(), v.minLength(1)),
  source: v.pipe(v.string(), v.minLength(1)),
  phase: v.optional(v.picklist(["plan", "execute", "run", "commit"])),
  sourcePath: v.optional(v.pipe(v.string(), v.minLength(1))),
  telemetry: v.optional(v.boolean()),
});

export function createSnippetsApp(deps: SnippetsAppDeps): Hono {
  const store = deps.store ?? new SessionStore({ baseDir: deps.baseDir });

  const app = new Hono();

  app.post("/", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = v.safeParse(snippetsRequestSchema, raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          issues: parsed.issues.map((i) => i.message),
        },
        400,
      );
    }

    const record = await store.loadSession(parsed.output.sessionId);
    if (!record) {
      return c.json(
        { error: "not_found", sessionId: parsed.output.sessionId },
        404,
      );
    }

    const sessionCtx: SessionCtx = {
      sessionId: record.sessionId,
      tenantId: record.tenantId,
      mountIds: record.mountIds,
      baseDir: deps.baseDir,
    };

    let runResult;
    try {
      runResult = await deps.snippetRuntime.run({
        source: parsed.output.source,
        phase: parsed.output.phase,
        sourcePath: parsed.output.sourcePath,
        sessionCtx,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "snippet_failed", message }, 500);
    }

    // Bump lastActiveAt fire-and-forget; HTTP latency shouldn't depend
    // on the touch.
    void store.touchSession(parsed.output.sessionId).catch(() => undefined);

    // Harvest trajectory mode + provenance for the response. Best-effort
    // — if the trajectory file is missing or unreadable we still return
    // the snippet's stdout/stderr/exitCode.
    let mode: string | undefined;
    let functionName: string | undefined;
    let callPrimitives: string[] | undefined;
    let clientCallPrimitives: string[] | undefined;
    let nestedCallPrimitives: string[] | undefined;
    let nestedCalls: ReturnType<
      typeof summarizeCallScopes
    >["nestedCalls"] | undefined;
    let nestedByRoot: ReturnType<
      typeof summarizeCallScopes
    >["nestedByRoot"] | undefined;
    let trajectoryRecord: unknown;
    let phase = runResult.phase;
    let crystallisable = runResult.crystallisable;
    let artifactDir = runResult.artifactDir;
    if (runResult.trajectoryId) {
      try {
        const traj = await readTrajectory(runResult.trajectoryId, deps.baseDir);
        trajectoryRecord = traj;
        mode = traj.mode;
        functionName = traj.provenance?.functionName;
        callPrimitives = traj.calls.map((call) => call.primitive);
        const scopeSummary = summarizeCallScopes(traj.calls);
        clientCallPrimitives = scopeSummary.clientCallPrimitives;
        nestedCallPrimitives = scopeSummary.nestedCallPrimitives;
        nestedCalls = scopeSummary.nestedCalls;
        nestedByRoot = scopeSummary.nestedByRoot;
        phase = phase ?? traj.phase;
        crystallisable = crystallisable ?? traj.crystallisable;
        artifactDir = artifactDir ?? traj.artifactDir;
      } catch {
        // Leave best-effort trajectory-derived fields undefined.
      }
    }

    if (telemetryEnabled(parsed.output.telemetry)) {
      await writeTelemetryEvent({
        baseDir: deps.baseDir,
        event: {
          kind: "snippet-run",
          session: {
            sessionId: record.sessionId,
            tenantId: record.tenantId,
            mountIds: record.mountIds,
          },
          request: {
            phase: parsed.output.phase ?? null,
            sourcePath: parsed.output.sourcePath ?? null,
            source: parsed.output.source,
          },
          response: {
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            exitCode: runResult.exitCode,
            trajectoryId: runResult.trajectoryId,
            cost: runResult.cost,
            mode,
            functionName,
            callPrimitives,
            clientCallPrimitives,
            nestedCallPrimitives,
            nestedCalls,
            nestedByRoot,
            phase,
            crystallisable,
            artifactDir,
            answer: runResult.answer,
            validation: runResult.validation,
          },
          trajectory: trajectoryRecord ?? null,
        },
      });
    }

    return c.json({
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      trajectoryId: runResult.trajectoryId,
      cost: runResult.cost,
      mode,
      functionName,
      callPrimitives,
      clientCallPrimitives,
      nestedCallPrimitives,
      nestedCalls,
      nestedByRoot,
      phase,
      crystallisable,
      artifactDir,
      answer: runResult.answer,
      validation: runResult.validation,
    });
  });

  return app;
}
