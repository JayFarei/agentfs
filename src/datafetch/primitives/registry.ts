export type PrimitiveImplementationKind = "atlas" | "local" | "pure" | "future-flue" | "flue";

export type PrimitiveDefinition = {
  name: string;
  module: string;
  signature: string;
  implementation: PrimitiveImplementationKind;
  description: string;
};

export const primitiveRegistry: PrimitiveDefinition[] = [
  {
    name: "finqa_cases.findExact",
    module: "/datafetch/db/finqa_cases",
    signature: "findExact(filter: Partial<FinqaCase>, limit?: number): Promise<FinqaCase[]>",
    implementation: "atlas",
    description: "Exact lookup over normalized FinQA cases stored in MongoDB Atlas."
  },
  {
    name: "finqa_cases.search",
    module: "/datafetch/db/finqa_cases",
    signature: "search(query: string, opts?: { limit?: number }): Promise<FinqaCase[]>",
    implementation: "atlas",
    description: "Lexical search over FinQA question, text, and table content. This wraps Atlas text search now and can become Atlas Search later."
  },
  {
    name: "finqa_cases.findSimilar",
    module: "/datafetch/db/finqa_cases",
    signature: "findSimilar(query: string, limit?: number): Promise<FinqaCase[]>",
    implementation: "atlas",
    description: "Similarity-style retrieval primitive. It currently delegates to lexical search while preserving the future vector-search contract."
  },
  {
    name: "finqa_cases.hybrid",
    module: "/datafetch/db/finqa_cases",
    signature: "hybrid(query: string, opts?: { limit?: number }): Promise<FinqaCase[]>",
    implementation: "atlas",
    description: "Hybrid retrieval contract. It starts as text search and is the stable call site for future $rankFusion over vector and lexical search."
  },
  {
    name: "finqa_cases.runRevenueShare",
    module: "/datafetch/db/finqa_cases",
    signature:
      "runRevenueShare(args: { filename: string; segment: string; denominator: string; years: string[]; includeChange?: boolean }): Promise<RevenueShareResult>",
    implementation: "atlas",
    description:
      "Atlas-backed primitive for computing a revenue segment as a percentage of a selected denominator row across one or more years."
  },
  {
    name: "finqa_resolve.pickFiling",
    module: "/datafetch/db/finqa_resolve",
    signature: "pickFiling(args: { question: string; candidates: FinqaCase[]; priorTickers?: string[] }): Promise<FinqaCase>",
    implementation: "future-flue",
    description: "Select the most likely filing/case from retrieval candidates. Deterministic now, replaceable by a Flue sub-agent later."
  },
  {
    name: "document_units.sentences",
    module: "/datafetch/db/document_units",
    signature: "sentences(filing: FinqaCase): DocumentUnit[]",
    implementation: "local",
    description: "Splits filing pre/post text into reusable sentence units for agent scoring."
  },
  {
    name: "document_units.titleOrQuoteUnits",
    module: "/datafetch/db/document_units",
    signature: "titleOrQuoteUnits(filing: FinqaCase): DocumentUnit[]",
    implementation: "local",
    description: "Extracts quote-like or heading-like units so the same scorer agent can run over a different evidence surface."
  },
  {
    name: "finqa_resolve.locateFigure",
    module: "/datafetch/db/finqa_resolve",
    signature: "locateFigure(args: { question: string; filing: FinqaCase; role?: 'numerator' | 'denominator'; columnHint?: string }): Promise<LocatedFigure>",
    implementation: "future-flue",
    description: "Locate a numeric table cell needed by the current derivation. Deterministic now, replaceable by a Flue sub-agent later."
  },
  {
    name: "finqa_table_math.inferPlan",
    module: "/datafetch/db/finqa_table_math",
    signature:
      "inferPlan(args: { question: string; filing: FinqaCase }): TableMathPlan",
    implementation: "local",
    description:
      "Generic execute helper that infers a small table operation plan from retrieved data and the question, without source-specific rules."
  },
  {
    name: "finqa_table_math.execute",
    module: "/datafetch/db/finqa_table_math",
    signature:
      "execute(args: { filing: FinqaCase; plan: TableMathPlan }): TableMathResult",
    implementation: "local",
    description:
      "Executes generic table operations such as share, range, and difference over a normalized filing table."
  },
  {
    name: "arithmetic.divide",
    module: "/datafetch/db/arithmetic",
    signature: "divide(numerator: number, denominator: number): number",
    implementation: "pure",
    description: "Pure TypeScript arithmetic primitive used by crystallized FinQA procedures."
  },
  {
    name: "finqa_observe.codifyTableFunction",
    module: "/datafetch/db/finqa_observe",
    signature: "codifyTableFunction(args: { question: string; filing: FinqaCase }): Promise<CodifiedTableFunction>",
    implementation: "future-flue",
    description:
      "Observer-agent primitive that turns an LLM-needed table reasoning step into a reusable TypeScript function."
  },
  {
    name: "finqa_observe.executeCodifiedFunction",
    module: "/datafetch/db/finqa_observe",
    signature: "executeCodifiedFunction(codified: CodifiedTableFunction, filing: FinqaCase): ObserverResult",
    implementation: "local",
    description: "Executes a codified observer function against a normalized FinQA filing."
  },
  {
    name: "finqa_agent.createSentimentAgentSpec",
    module: "/datafetch/db/finqa_agent",
    signature: "createSentimentAgentSpec(args: { question: string; filing: FinqaCase; documentText?: string }): Promise<SentimentAgentSpec>",
    implementation: "future-flue",
    description:
      "Observer primitive that creates a task-specific typed LLM agent interface for sentiment extraction."
  },
  {
    name: "finqa_agent.runSentimentAgent",
    module: "/datafetch/db/finqa_agent",
    signature: "runSentimentAgent(args: { spec: SentimentAgentSpec; question: string; documentText: string }): Promise<SentimentResult>",
    implementation: "future-flue",
    description: "Runs the generated typed sentiment agent over a document excerpt."
  },
  {
    name: "finqa_outlook.createOutlookScorerAgentSpec",
    module: "/datafetch/db/finqa_outlook",
    signature:
      "createOutlookScorerAgentSpec(args: { question: string; filing: FinqaCase; units: DocumentUnit[] }): Promise<OutlookScorerAgentSpec>",
    implementation: "flue",
    description:
      "Observer-created reusable specialized agent interface for scoring short units as negative competitive-outlook references."
  },
  {
    name: "finqa_outlook.scoreUnits",
    module: "/datafetch/db/finqa_outlook",
    signature:
      "scoreUnits(args: { spec: OutlookScorerAgentSpec; units: DocumentUnit[]; target: string; lens: 'competitive_outlook' }): Promise<OutlookScore[]>",
    implementation: "flue",
    description: "Runs a persisted reusable outlook scorer over document units."
  }
];
