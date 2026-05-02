import { performance } from "node:perf_hooks";
import { runQuery, loadLocalDemoCases } from "../runner.js";
import { extractCompany } from "../procedures/matcher.js";
import type { RunRequest, RunResponse, ApiRunStep, ApiCall, PipelineStageKey, TenantId } from "./types.js";

// Lazy cache for local demo cases
let _localCases: Awaited<ReturnType<typeof loadLocalDemoCases>> | undefined;
async function getLocalCases() {
  if (!_localCases) {
    _localCases = await loadLocalDemoCases();
  }
  return _localCases;
}

function clusterLabel(backend: "local" | "atlas"): string {
  return backend === "atlas" ? "mongodb · atlas-prod-eu" : "local fixture · finqa-dev";
}

function buildProcedureSteps(procedureName: string, backend: "local" | "atlas"): ApiRunStep[] {
  return [
    { k: "parse", l: "parsing intent · binding params", ms: 180, ok: true },
    { k: "match", l: `hook hit · ${procedureName}`, ms: 200, ok: true },
    { k: "plan", l: "compiling aggregation pipeline", ms: 180, ok: true },
    { k: "cluster", l: clusterLabel(backend), ms: 220, ok: true },
    { k: "cursor", l: "streaming cursor · 1 doc · 1 link", ms: 200, ok: true },
    { k: "render", l: "projecting typed result", ms: 120, ok: true }
  ] satisfies Array<{ k: PipelineStageKey; l: string; ms: number; ok: boolean }>;
}

function buildNovelSteps(callCount: number, backend: "local" | "atlas"): ApiRunStep[] {
  return [
    { k: "parse", l: "parsing intent · no procedure match", ms: 320, ok: true },
    { k: "match", l: `compiling primitive chain · ${callCount} calls`, ms: 480, ok: true },
    { k: "plan", l: "resolving filing from similarity search", ms: 540, ok: true },
    { k: "cluster", l: `querying ${clusterLabel(backend)}`, ms: 720, ok: true },
    { k: "cursor", l: "streaming cursor · extracting figures", ms: 480, ok: true },
    { k: "render", l: "projecting typed result", ms: 280, ok: true }
  ] satisfies Array<{ k: PipelineStageKey; l: string; ms: number; ok: boolean }>;
}

function extractTitle(question: string, procedureName?: string): string {
  try {
    const company = extractCompany(question);
    if (company) {
      return company.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {
    // ignore
  }
  return procedureName ?? "Result";
}

function extractCite(evidence: unknown[]): string {
  if (evidence.length === 0) return "data/finqa_cases";
  const first = evidence[0] as Record<string, unknown> | null;
  if (!first) return "data/finqa_cases";
  const filename =
    (first["evidence"] as Record<string, unknown> | undefined)?.["filename"] ??
    first["filename"];
  return typeof filename === "string" ? filename : "data/finqa_cases";
}

function buildErrorResponse(message: string): RunResponse {
  return {
    mode: "novel",
    answer: "—",
    steps: [],
    calls: [],
    evidence: [],
    result: { title: "Error", answer: "—", detail: message, cite: "—", procedure: "(error)" },
    wallMs: 0,
    error: message
  };
}

function defaultBackendKind(): "local" | "atlas" {
  return process.env.MONGODB_URI || process.env.ATLAS_URI ? "atlas" : "local";
}

export async function runQuestion(
  req: RunRequest,
  opts?: { backend?: "local" | "atlas"; tenantId?: TenantId }
): Promise<RunResponse> {
  const backendKind = opts?.backend ?? defaultBackendKind();
  const tenantId = opts?.tenantId ?? "alice";

  const t0 = performance.now();

  let rawResult: Awaited<ReturnType<typeof runQuery>>;
  try {
    const backend =
      backendKind === "local"
        ? { kind: "local" as const, cases: await getLocalCases() }
        : { kind: "atlas" as const };

    rawResult = await runQuery({
      question: req.question,
      tenantId,
      backend
    });
  } catch (err) {
    return buildErrorResponse(err instanceof Error ? err.message : String(err));
  }

  const wallMs = Math.round(performance.now() - t0);

  const { mode, answer, roundedAnswer, trajectoryId, procedureName, calls, evidence } = rawResult;

  const steps: ApiRunStep[] =
    mode === "procedure"
      ? buildProcedureSteps(procedureName ?? "unknown", backendKind)
      : buildNovelSteps(calls.length, backendKind);

  const typedCalls: ApiCall[] = (calls as Array<{ primitive: string; input: unknown; output: unknown }>).map(
    (c) => ({ primitive: c.primitive, input: c.input, output: c.output })
  );

  const title = extractTitle(req.question, procedureName);
  const answerStr = String(roundedAnswer ?? answer);
  const cite = extractCite(evidence as unknown[]);

  const detail =
    mode === "novel"
      ? `${calls.length} primitive calls · ${trajectoryId ?? "—"}`
      : `via ${procedureName}`;

  const procedure = procedureName ?? "(novel · trajectory recorded)";

  return {
    mode,
    trajectoryId,
    procedureName,
    answer,
    roundedAnswer,
    steps,
    calls: typedCalls,
    evidence: evidence as unknown[],
    result: { title, answer: answerStr, detail, cite, procedure },
    wallMs
  };
}
