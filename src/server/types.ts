export type TenantId = "alice" | "bob" | "financial-analyst";

export type ApiCall = {
  primitive: string;
};

export type ApiDataCollection = {
  name: string;
  docs: number;
  kind: string;
};

export type ApiSearchIndex = {
  collection: string;
  name: string;
  queryable: boolean;
  status: string;
};

export type ApiClusterStatus = {
  name: string;
  dbName: string;
  backend: string;
  tier: string;
  region: string;
  collections: ApiDataCollection[];
  searchIndexes?: ApiSearchIndex[];
};

export type ApiSuggestedQuestion = {
  label: string;
  question: string;
  hint?: string;
};

export type ApiPrimitive = {
  name: string;
  signature: string;
  description: string;
  implementation: "flue" | "future-flue" | "atlas" | "local" | "pure";
  isAgent?: boolean;
};

export type ApiStoredAgent = {
  agentName: string;
  capability: string;
  description?: string;
};

export type ApiLearnedFunction = {
  name: string;
  observer: string;
  createdAt: string;
  description: string;
  signature: string;
  source: string;
};

export type ApiHook = {
  name: string;
  intent: string;
  collections: string[];
  description: string;
  route: string[];
};

export type ApiEvalMetric = {
  baseline: string;
  L_n: number;
};

export type ApiProcedure = {
  name: string;
  sig: string;
  hits: number;
  stage: string;
  source: string;
};

export type ApiIntent = {
  name: string;
  desc: string;
  params: string[];
  sourceTs?: string;
};

export type RunResult = {
  title: string;
  answer: string;
  detail: string;
  cite: string;
  procedure: string;
};

export type RunRequest = {
  question: string;
  suggestedProcedure?: string;
};

export type RunResponse = {
  result: RunResult;
  mode: "novel" | "procedure";
  calls: ApiCall[];
  trajectoryId?: string;
  procedureName?: string;
};

export type EndorseRequest = {
  trajectoryId: string;
};

export type EndorseResponse = {
  ok: boolean;
};

export type ResetResponse = {
  ok: boolean;
};

export type StateResponse = {
  agent: {
    name: string;
    role: string;
    tenant: string;
    pathLabel?: string;
  };
  cluster: ApiClusterStatus;
  procedures: ApiProcedure[];
  intents: ApiIntent[];
  suggested: ApiSuggestedQuestion[];
  primitives?: ApiPrimitive[];
  agents?: ApiStoredAgent[];
  learnedFunctions?: ApiLearnedFunction[];
  hooks?: ApiHook[];
  drift?: Array<{ name: string; drift: string }>;
  evalMetrics?: ApiEvalMetric[];
};
