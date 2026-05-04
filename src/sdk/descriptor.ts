// Bootstrap output types.
//
// These match the shape-uniform descriptor described in `kb/prd/design.md`
// §7.4: every adapter, regardless of substrate, emits this shape so the SDK
// can render an appropriate `CollectionHandle<T>` from it.
//
// Plain JSON-shaped types. The bootstrap pipeline writes them to disk;
// the snippet runtime reads them at mount load time.

// --- Field descriptor -------------------------------------------------------

export type FieldRole =
  | "id"
  | "text"
  | "number"
  | "timestamp"
  | "embedding"
  | "fk"
  | "label"
  | "blob";

export type IndexableAs = "lex" | "vec" | "exact";

export type FieldDescriptor = {
  role: FieldRole;
  presence: number;
  cardinality_estimate?: number;
  embeddable?: boolean;
  indexable_as?: IndexableAs[];
};

// --- Mount descriptor -------------------------------------------------------

export type MountKind =
  | "documents"
  | "table"
  | "graph"
  | "timeseries"
  | "vectors"
  | "files";

export type Cardinality = {
  rows: number;
  unique_keys?: Record<string, number>;
};

// The locked four-method retrieval contract. Mirrors the methods on
// `CollectionHandle<T>` in `./adapter.ts`. The descriptor's `affordances`
// field is typed against this enum so adapters cannot drift.
export type Affordance = "findExact" | "search" | "findSimilar" | "hybrid";

// A single polymorphic variant within a collection. Kept loose; the bootstrap
// pipeline narrows this based on observed shapes.
export type PolymorphicVariant = {
  name: string;
  presence: number;
  fields: Record<string, FieldDescriptor>;
};

export type MountDescriptor = {
  // Optional. Populated in later phases when content-addressable pins land.
  "@sha256"?: string;
  kind: MountKind;
  cardinality: Cardinality;
  fields: Record<string, FieldDescriptor>;
  affordances: Affordance[];
  polymorphic_variants: null | PolymorphicVariant[];
  // Shape-specific extensions. Graph adjacency stats, timeseries tick
  // intervals, etc. Opaque at this layer.
  shape_specific?: unknown;
};

// --- Stats ------------------------------------------------------------------

// Minimal stats block. Bootstrap may add more fields; this shape is the
// floor.
export type MountStats = {
  rows: number;
  presence?: Record<string, number>;
  cardinality?: Record<string, number>;
};

// --- Samples ----------------------------------------------------------------

// _samples.json is just an array of representative documents. Typing it as
// `unknown[]` keeps the contract honest: each adapter knows the shape; the
// bootstrap doesn't impose one.
export type MountSamples = unknown[];
