export type PrimitiveImplementationKind = "atlas" | "local" | "pure" | "future-flue";

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
    name: "finqa_resolve.pickFiling",
    module: "/datafetch/db/finqa_resolve",
    signature: "pickFiling(args: { question: string; candidates: FinqaCase[]; priorTickers?: string[] }): Promise<FinqaCase>",
    implementation: "future-flue",
    description: "Select the most likely filing/case from retrieval candidates. Deterministic now, replaceable by a Flue sub-agent later."
  },
  {
    name: "finqa_resolve.locateFigure",
    module: "/datafetch/db/finqa_resolve",
    signature: "locateFigure(args: { question: string; filing: FinqaCase; role?: 'numerator' | 'denominator'; columnHint?: string }): Promise<LocatedFigure>",
    implementation: "future-flue",
    description: "Locate a numeric table cell needed by the current derivation. Deterministic now, replaceable by a Flue sub-agent later."
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
  }
];
