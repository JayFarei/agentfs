import { Hono } from "hono";
import { cors } from "hono/cors";
import { endorseTrajectory } from "../runner.js";
import { LocalProcedureStore } from "../procedures/store.js";
import { atlasfsHome } from "../trajectory/recorder.js";
import { buildState, resolveTenant } from "./state.js";
import { runQuestion } from "./runWrapper.js";
import { resetTenant } from "./reset.js";
import type {
  RunRequest,
  EndorseRequest,
  EndorseResponse,
  ApiProcedureSummary,
  ProcedureStage
} from "./types.js";
import type { StoredProcedure } from "../procedures/types.js";

function kindToStage(kind: StoredProcedure["implementation"]["kind"]): ProcedureStage {
  switch (kind) {
    case "atlas_aggregation_template":
    case "table_math":
    case "ts_function":
      return "compiled";
    case "agentic_ts_function":
      return "family";
    case "task_agent":
      return "endorsed";
    case "planned_chain":
      return "endorsed";
  }
}

function synthSig(procedure: StoredProcedure): string {
  const paramKeys = Object.keys(procedure.params);
  return `${procedure.name}(${paramKeys.join(", ")}): number | string`;
}

export const app = new Hono();

app.use("*", cors({ origin: "*" }));

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/state", async (c) => {
  const tenantId = resolveTenant(c.req.query("tenant"));
  const state = await buildState(tenantId);
  return c.json(state);
});

app.post("/api/run", async (c) => {
  const body = await c.req.json<RunRequest>();
  const tenantId = resolveTenant(c.req.query("tenant"));
  const backendParam = c.req.query("backend");
  const backend: "atlas" | "local" | undefined =
    backendParam === "atlas" ? "atlas" : backendParam === "local" ? "local" : undefined;
  const response = await runQuestion(body, { backend, tenantId });
  return c.json(response);
});

app.post("/api/endorse", async (c) => {
  const body = await c.req.json<EndorseRequest>();
  const tenantId = resolveTenant(c.req.query("tenant"));
  const baseDir = atlasfsHome();

  const { jsonPath, tsPath } = await endorseTrajectory({
    trajectoryIdOrPath: body.trajectoryId,
    baseDir
  });

  const store = new LocalProcedureStore(baseDir);
  const procedures = await store.list(tenantId);
  const found = procedures.find((p) => p.sourceTrajectoryId === body.trajectoryId);

  let procedureSummary: ApiProcedureSummary;
  if (found) {
    let source = "";
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      source = await readFile(join(baseDir, "procedures", tenantId, `${found.name}.ts`), "utf8");
    } catch {
      source = "";
    }
    procedureSummary = {
      name: found.name,
      description: found.description,
      intent: found.matcher.intent,
      sig: synthSig(found),
      stage: kindToStage(found.implementation.kind),
      hits: 0,
      implementationKind: found.implementation.kind,
      source,
      createdAt: found.createdAt
    };
  } else {
    const name = jsonPath.replace(/.*\//, "").replace(/\.json$/, "");
    procedureSummary = {
      name,
      description: "Endorsed from trajectory",
      intent: name,
      sig: `${name}(): number | string`,
      stage: "endorsed",
      hits: 0,
      implementationKind: "ts_function",
      source: "",
      createdAt: new Date().toISOString()
    };
  }

  const response: EndorseResponse = {
    procedureName: procedureSummary.name,
    jsonPath,
    tsPath,
    procedure: procedureSummary
  };

  return c.json(response);
});

app.post("/api/reset", async (c) => {
  const tenantId = resolveTenant(c.req.query("tenant"));
  const removed = await resetTenant(tenantId);
  return c.json(removed);
});
