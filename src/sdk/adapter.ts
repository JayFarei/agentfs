// MountAdapter and CollectionHandle interfaces.
//
// Per `kb/prd/design.md` §9.1 and decisions D-002 (adapters per source) +
// D-007 (two regions). One adapter per substrate; the bootstrap layer
// (sample → infer → emit) is generic.
//
// Type definitions only. Concrete implementations live under
// `src/adapter/<substrate>/`.

// --- Capabilities -----------------------------------------------------------

export type SourceCapabilities = {
  // Substrate supports vector / semantic search natively.
  vector: boolean;
  // Substrate supports lexical / BM25-style search natively.
  lex: boolean;
  // Substrate exposes a real-time change stream for collections.
  stream: boolean;
  // Substrate supports compiled native plans (Atlas pipeline, SQL, etc.).
  compile: boolean;
};

// --- Inventory --------------------------------------------------------------

export type CollectionInventoryEntry = {
  name: string;
  rows: number;
  fingerprint?: string;
  indexes?: string[];
};

export type MountInventory = {
  collections: CollectionInventoryEntry[];
};

// --- Sampling ---------------------------------------------------------------

export type SampleOpts = {
  size: number;
  seed?: number;
};

// --- Compiled plans ---------------------------------------------------------

// MVP: opaque adapter-specific plan. Concrete adapters narrow this further.
export type CompiledPlan = {
  kind: string;
  plan: unknown;
};

// --- Index hints ------------------------------------------------------------

export type IndexHint = {
  kind: "lex" | "vec" | "exact";
  fields: string[];
};

// --- Schema-change events ---------------------------------------------------

export type SchemaChangeEvent = {
  collection: string;
  oldFingerprint?: string;
  newFingerprint: string;
};

// --- Collection handle ------------------------------------------------------

// The four-method retrieval contract every CollectionHandle exposes.
// Per design.md §5.1 and §7.4 ("affordances": ["findExact", "search",
// "findSimilar", "hybrid"]).
export type CollectionHandle<T> = {
  findExact(filter: Partial<T>, limit?: number): Promise<T[]>;
  search(query: string, opts?: { limit?: number }): Promise<T[]>;
  findSimilar(query: string, limit?: number): Promise<T[]>;
  hybrid(query: string, opts?: { limit?: number }): Promise<T[]>;
};

// --- Mount adapter ----------------------------------------------------------

export type MountAdapter = {
  readonly id: string;
  capabilities(): SourceCapabilities;
  probe(): Promise<MountInventory>;
  sample(collection: string, opts: SampleOpts): Promise<unknown[]>;
  collection<T>(name: string): CollectionHandle<T>;
  // Optional in the MVP. Declared on the interface so the contract is stable
  // when later phases land compiled / drift / index work.
  runCompiled?(
    plan: CompiledPlan,
    params: Record<string, unknown>,
  ): Promise<unknown>;
  watch?(collection: string): AsyncIterable<SchemaChangeEvent>;
  ensureIndex?(collection: string, hint: IndexHint): Promise<void>;
};
