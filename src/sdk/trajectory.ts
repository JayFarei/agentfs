// Trajectory recorder re-export.
//
// The recorder lives at `src/trajectory/recorder.ts` (the original location;
// kept there to avoid breaking other imports during the rewrite). This
// module re-exports the extended types and class under the public SDK
// surface so other agents can import them from `src/sdk/`.
//
// Per `kb/prd/design.md` §12.1: the per-call record format is unchanged
// in shape; it gains an optional `pin?: string`. The per-trajectory
// envelope absorbs `mode`, `cost`, `provenance.functionName?`.

export {
  TrajectoryRecorder,
  atlasfsHome,
  trajectoryId,
  readTrajectory,
} from "../trajectory/recorder.js";

export type {
  PrimitiveCallRecord,
  TrajectoryRecord,
  TrajectoryProvenance,
} from "../trajectory/recorder.js";
