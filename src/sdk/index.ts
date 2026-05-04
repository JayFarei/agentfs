// Public SDK barrel.
//
// Other team agents (snippet runtime, observer, AtlasMountAdapter, server,
// CLI) import from this module. The internal layout under src/sdk/ is
// allowed to evolve; this barrel is the stable surface.

// --- fn factory + body shapes ---
export { fn, SchemaValidationError, NoBodyDispatcherError } from "./fn.js";
export type { FnInit, FnSpec, Fn, FnExample } from "./fn.js";

export { llm, agent, normaliseBody, isPureFn } from "./body.js";
export type {
  Body,
  PureTSBody,
  LlmBody,
  AgentBody,
  RawBody,
} from "./body.js";

// --- Result envelope ---
export { makeResult, costZero } from "./result.js";
export type {
  Result,
  ResultMode,
  CostTier,
  Cost,
  Provenance,
  Warning,
  MakeResultArgs,
} from "./result.js";

// --- Mount adapter + collection handle + descriptor types ---
export type {
  MountAdapter,
  CollectionHandle,
  SourceCapabilities,
  MountInventory,
  CollectionInventoryEntry,
  SampleOpts,
  CompiledPlan,
  IndexHint,
  SchemaChangeEvent,
} from "./adapter.js";

export type {
  MountDescriptor,
  MountKind,
  Cardinality,
  FieldDescriptor,
  FieldRole,
  IndexableAs,
  PolymorphicVariant,
  MountStats,
  MountSamples,
} from "./descriptor.js";

// --- Runtime injection points ---
export {
  setBodyDispatcher,
  getBodyDispatcher,
  setLibraryResolver,
  getLibraryResolver,
} from "./runtime.js";
export type {
  BodyDispatcher,
  LibraryResolver,
  LibraryEntry,
  DispatchContext,
} from "./runtime.js";

// --- Trajectory recorder (extended types) ---
export {
  TrajectoryRecorder,
  atlasfsHome,
  trajectoryId,
  readTrajectory,
} from "./trajectory.js";
export type {
  PrimitiveCallRecord,
  TrajectoryRecord,
  TrajectoryProvenance,
} from "./trajectory.js";
