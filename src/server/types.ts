export type ProcedureStage = "novel" | "endorsed" | "compiled" | "family";
export type PipelineStageKey = "parse" | "match" | "plan" | "cluster" | "cursor" | "render";

export type TenantId = string;

export type ApiProcedureSummary = {
  name: string;
  description: string;
  intent: string;
  sig: string;
  stage: ProcedureStage;
  hits: number;
  implementationKind: "atlas_aggregation_template" | "ts_function" | "task_agent" | "agentic_ts_function" | "table_math" | "planned_chain";
  source: string;
  createdAt: string;
};

export type ApiDataCollection = { name: string; docs: string; size: string; kind: string };

export type ApiIntent = {
  name: string;
  desc: string;
  params: string[];
  sourceTs?: string;
};

export type ApiClusterStatus = {
  backend: "atlas" | "local";
  dbName?: string;
  region?: string;
  tier?: string;
  name?: string;
  connected: boolean;
  collections: ApiDataCollection[];
  searchIndexes?: { name: string; collection: string; status: string; queryable: boolean }[];
};

export type ApiAgent = {
  id: TenantId;
  name: string;
  role: string;
  tenant: TenantId;
  pathLabel: string;
};

export type ApiSuggestedQuestion = {
  label: string;
  question: string;
  hint: string;
};

export type ApiPrimitive = {
  name: string;
  signature: string;
  description: string;
  implementation: "atlas" | "local" | "pure" | "future-flue" | "flue";
  isAgent: boolean;
};

export type ApiStoredAgent = {
  agentName: string;
  capability: string;
  description: string;
  createdAt?: string;
};

export type ApiLearnedFunction = {
  name: string;
  description: string;
  signature: string;
  source: string;
  observer: "fixture" | "anthropic" | "flue";
  createdAt: string;
};

export type StateResponse = {
  agent: ApiAgent;
  procedures: ApiProcedureSummary[];
  intents: ApiIntent[];
  cluster: ApiClusterStatus;
  suggested?: ApiSuggestedQuestion[];
  trajectories?: ApiTrajectorySummary[];
  primitives?: ApiPrimitive[];
  agents?: ApiStoredAgent[];
  learnedFunctions?: ApiLearnedFunction[];
  hooks?: ApiHook[];
  drift?: Array<{ name: string; tenantId: string; drift: "current" | "drifted" }>;
  evalMetrics?: ApiEvalMetric[];
  demo?: { showBob: boolean };
};

export type ApiHook = {
  name: string;
  intent: string;
  description: string;
  collections: string[];
  route: string[];
};

export type ApiEvalMetric = {
  baseline: "vanilla_rag" | "static_typed" | "atlasfs";
  round: number;
  tenant: string;
  T_n: number;
  D_n: number;
  R_n: number;
  I_n: number;
  L_n: number;
  correctness: boolean;
  evidenceCompleteness: number;
};

export type ApiTrajectorySummary = {
  id: string;
  question: string;
  createdAt: string;
  callCount: number;
};

export type ApiRunStep = { k: PipelineStageKey; l: string; ms: number; ok: boolean };
export type ApiCall = { primitive: string; input: unknown; output: unknown };

export type RunRequest = { question: string; suggestedProcedure?: string };

export type RunResponse = {
  mode: "novel" | "procedure";
  trajectoryId?: string;
  procedureName?: string;
  answer: number | string;
  roundedAnswer?: number;
  steps: ApiRunStep[];
  calls: ApiCall[];
  evidence: unknown[];
  result: { title: string; answer: string; detail: string; cite: string; procedure: string };
  wallMs: number;
  error?: string;
};

export type EndorseRequest = { trajectoryId: string };
export type EndorseResponse = {
  procedureName: string;
  jsonPath: string;
  tsPath: string;
  procedure: ApiProcedureSummary;
};

export type ResetResponse = {
  tenant: TenantId;
  removed: { procedures: number; trajectories: number; agents: number; drafts: number; learnedFunctions: number };
};
