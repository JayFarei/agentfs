import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { LocalProcedureStore } from "../procedures/store.js";
import { LocalAgentStore } from "../agents/store.js";
import { primitiveRegistry } from "../datafetch/primitives/registry.js";
import { atlasfsHome } from "../trajectory/recorder.js";
import type {
  StateResponse,
  ApiProcedureSummary,
  ApiIntent,
  ApiClusterStatus,
  ApiAgent,
  ApiSuggestedQuestion,
  ApiTrajectorySummary,
  ApiPrimitive,
  ApiStoredAgent,
  ProcedureStage,
  TenantId
} from "./types.js";
import type { StoredProcedure } from "../procedures/types.js";
import type { TrajectoryRecord } from "../trajectory/recorder.js";

const HARDCODED_INTENTS: ApiIntent[] = [
  { name: "average_payment_volume_per_transaction", desc: "Average payment volume per transaction for a named company", params: ["company"] },
  { name: "largest_average_payment_volume_per_transaction", desc: "Find the company with the highest average payment volume per transaction", params: [] },
  { name: "document_sentiment", desc: "Sentiment of a target's competitive positioning in a filing", params: ["target", "filename"] },
  { name: "revenue_share", desc: "Share of revenue contributed by a segment, optionally year-over-year", params: ["segment", "denominator", "years"] },
  { name: "table_math", desc: "Generic table arithmetic — difference, range, share over rows/years", params: ["rowLabel", "operation", "years"] },
  { name: "negative_outlook_references", desc: "Negative competitive-outlook references about a target, with evidence", params: ["target"] },
  { name: "negative_outlook_title_or_quote_references", desc: "Same as above, but only titles or quoted phrases", params: ["target"] }
];

const AGENT_DESCRIPTORS: Record<TenantId, ApiAgent> = {
  alice: {
    id: "alice",
    name: "Alice",
    role: "Equity research analyst",
    tenant: "alice",
    pathLabel: "Path A · table-math"
  },
  bob: {
    id: "bob",
    name: "Bob",
    role: "Competitive intelligence analyst",
    tenant: "bob",
    pathLabel: "Path B · agent + glue"
  },
  "financial-analyst": {
    id: "financial-analyst" as TenantId,
    name: "Alice",
    role: "Equity research analyst",
    tenant: "financial-analyst" as TenantId,
    pathLabel: "Path A · table-math"
  }
};

const SUGGESTED_PER_TENANT: Record<TenantId, ApiSuggestedQuestion[]> = {
  alice: [
    {
      label: "1 · novel · chemical revenue range",
      question: "what is the mathematical range for chemical revenue from 2014-2016, in millions?",
      hint:
        "PROVES: AtlasFS composes primitives at runtime to answer a novel question and crystallises the working sequence into a reusable chain. WATCH: 5 calls stream, last one is procedure_store.save, learned chains gains table_math (answer 190)."
    },
    {
      label: "2 · replay · coal revenue range",
      question: "what is the mathematical range for coal revenue from 2014-2016, in millions?",
      hint:
        "PROVES: the same intent shape replays as one procedure call — sub-second, deterministic. WATCH: mode flips to procedure, exactly 1 call (procedures.table_math), no new artifacts (answer 1687)."
    },
    {
      label: "3 · novel · amex payment volume",
      question: "what is the average payment volume per transaction for american express?",
      hint:
        "PROVES: not every novel run auto-crystallises — some require human endorsement before they become a stored chain. WATCH: novel mode, 'endorse this run' button appears, click it to mint the chain."
    },
    {
      label: "4 · replay · jcb payment volume",
      question: "what is the average payment volume per transaction for jcb?",
      hint:
        "PROVES: once endorsed, the chain replays just like an auto-crystallised one. WATCH: mode flips to procedure, 1 call."
    }
  ],
  bob: [
    {
      label: "1 · novel · Visa outlook · sentences",
      question: "Find the negative competitive outlook references about Visa, count them, and show evidence sentences.",
      hint:
        "PROVES: AtlasFS detects a question that needs LLM judgement, the observer spawns a typed scorer agent via Flue, saves it as a reusable primitive, and codifies deterministic glue around it. WATCH: NEW entry appears in 'learned primitives' (right) AND 'learned chains' (left). Look for finqa_observe.createAgentPrimitive and agent_store.save in the call list."
    },
    {
      label: "2 · reuse · Visa outlook · titles/quotes",
      question: "Find the negative competitive outlook references about Visa, but only from titles or quotes.",
      hint:
        "PROVES: the saved agent is reusable across query shapes — the system finds it instead of recreating. WATCH: agent_store.findReusable in the call list (no finqa_observe.createAgentPrimitive, no agent_store.save). Only a NEW chain appears on the left, no new agent on the right."
    },
    {
      label: "3 · replay · Visa outlook · titles/quotes",
      question: "Find the negative competitive outlook references about Visa, but only from titles or quotes.",
      hint:
        "PROVES: once both chain + agent exist, the second-asking is one procedure call. WATCH: mode = procedure, 1 call (procedures.negative_outlook_title_or_quote_references), no new artifacts."
    }
  ],
  "financial-analyst": [
    {
      label: "novel · endorse to crystallise",
      question: "what is the average payment volume per transaction for american express?",
      hint:
        "PROVES: novel runs require human endorsement before the trajectory becomes a stored chain. WATCH: endorse button appears after the run."
    }
  ]
};

const PRIMITIVES_PER_TENANT: Record<TenantId, string[]> = {
  alice: [
    "finqa_cases.findSimilar",
    "finqa_cases.runRevenueShare",
    "finqa_table_math.inferPlan",
    "finqa_table_math.execute",
    "finqa_resolve.locateFigure",
    "arithmetic.divide"
  ],
  bob: [
    "finqa_cases.findSimilar",
    "document_units.sentences",
    "document_units.titleOrQuoteUnits",
    "finqa_observe.createAgentPrimitive",
    "finqa_observe.codifyTableFunction",
    "finqa_outlook.scoreUnits"
  ],
  "financial-analyst": [
    "finqa_cases.findSimilar",
    "finqa_cases.runRevenueShare",
    "finqa_table_math.inferPlan",
    "finqa_table_math.execute",
    "arithmetic.divide"
  ]
};

function buildPrimitives(tenantId: TenantId): ApiPrimitive[] {
  const allow = new Set(PRIMITIVES_PER_TENANT[tenantId] ?? PRIMITIVES_PER_TENANT.alice);
  return primitiveRegistry
    .filter((p) => allow.has(p.name))
    .map((p) => ({
      name: p.name,
      signature: p.signature,
      description: p.description,
      implementation: p.implementation,
      isAgent: p.implementation === "flue" || p.implementation === "future-flue"
    }));
}

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
  }
}

function synthSig(procedure: StoredProcedure): string {
  const paramKeys = Object.keys(procedure.params);
  return `${procedure.name}(${paramKeys.join(", ")}): number | string`;
}

async function readTsSource(baseDir: string, tenantId: string, name: string): Promise<string> {
  const tsPath = path.join(baseDir, "procedures", tenantId, `${name}.ts`);
  try {
    return await readFile(tsPath, "utf8");
  } catch {
    return "";
  }
}

async function listTrajectories(baseDir: string, tenantId: string): Promise<ApiTrajectorySummary[]> {
  const dir = path.join(baseDir, "trajectories");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: ApiTrajectorySummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(await readFile(path.join(dir, entry), "utf8")) as TrajectoryRecord;
      if (rec.tenantId !== tenantId) continue;
      out.push({
        id: rec.id,
        question: rec.question,
        createdAt: rec.createdAt,
        callCount: rec.calls.length
      });
    } catch {
      // ignore malformed
    }
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

async function buildClusterStatus(): Promise<ApiClusterStatus> {
  const mongoUri = process.env.MONGODB_URI ?? process.env.ATLAS_URI;
  if (mongoUri) {
    try {
      const { getAtlasSearchStatus } = await import("../loader/setupAtlasSearch.js");
      const status = await Promise.race([
        getAtlasSearchStatus(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
      ]);
      const { counts, dbName, indexes } = status;
      return {
        backend: "atlas",
        dbName,
        region: "eu-west-1",
        tier: "M40 · 3-node",
        name: "atlas-prod-eu",
        connected: true,
        collections: [
          { name: "finqa_cases", docs: counts.cases.toLocaleString(), size: "—", kind: "filings" },
          { name: "finqa_search_units", docs: counts.searchUnits.toLocaleString(), size: "—", kind: "fragments" }
        ],
        searchIndexes: indexes.map((idx) => ({
          name: idx.name,
          collection: idx.collection,
          status: idx.status ?? (idx.exists ? "exists" : "missing"),
          queryable: idx.queryable
        }))
      };
    } catch {
      // fall through to local
    }
  }
  return {
    backend: "local",
    dbName: "atlasfs_hackathon (local fixture)",
    connected: true,
    collections: [{ name: "finqa_cases", docs: "3", size: "—", kind: "fixture" }]
  };
}

export function resolveTenant(raw: string | undefined): TenantId {
  if (raw === "alice" || raw === "bob") return raw;
  if (raw === "financial-analyst") return "financial-analyst" as TenantId;
  return "alice";
}

export async function buildState(tenantId: TenantId): Promise<StateResponse> {
  const baseDir = atlasfsHome();
  const store = new LocalProcedureStore(baseDir);

  let rawProcedures: StoredProcedure[];
  try {
    rawProcedures = await store.list(tenantId);
  } catch {
    rawProcedures = [];
  }

  const procedures: ApiProcedureSummary[] = await Promise.all(
    rawProcedures.map(async (p): Promise<ApiProcedureSummary> => ({
      name: p.name,
      description: p.description,
      intent: p.matcher.intent,
      sig: synthSig(p),
      stage: kindToStage(p.implementation.kind),
      hits: 0,
      implementationKind: p.implementation.kind,
      source: await readTsSource(baseDir, tenantId, p.name),
      createdAt: p.createdAt
    }))
  );

  const trajectories = await listTrajectories(baseDir, tenantId);
  const cluster = await buildClusterStatus();

  const agentStore = new LocalAgentStore(baseDir);
  let storedAgents: ApiStoredAgent[] = [];
  try {
    const list = await agentStore.list(tenantId);
    storedAgents = list.map((a) => ({
      agentName: a.agentName,
      capability: a.capability,
      description: a.description ?? ""
    }));
  } catch {
    storedAgents = [];
  }

  return {
    agent: AGENT_DESCRIPTORS[tenantId] ?? AGENT_DESCRIPTORS.alice,
    procedures,
    intents: HARDCODED_INTENTS,
    cluster,
    suggested: SUGGESTED_PER_TENANT[tenantId] ?? SUGGESTED_PER_TENANT.alice,
    trajectories,
    primitives: buildPrimitives(tenantId),
    agents: storedAgents
  };
}
