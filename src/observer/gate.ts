// Crystallisation gate.
//
// Conservative heuristic deciding whether a saved trajectory should be
// crystallised into a /lib/<tenant>/<name>.ts file. Phase 5 (R6) wants
// the observer to "only propose crystallisation when the trajectory looks
// complete and the call graph is plausible".
//
// The gate is intentionally simple — it errs on the side of skipping. A
// permissive observer would write garbage /lib/ files; a strict one only
// crystallises shapes the runtime can mechanically replay. Per the plan's
// Architecture and design.md §8.3, the production form requires N >= 3
// convergent trajectories before promotion. The MVP collapses N to 1
// (every qualifying trajectory crystallises immediately) so the demo
// shows turn 5 of personas.md §3 ("Coming back the next day"). The
// shape-hash de-dup below means re-running the same snippet doesn't
// produce a second crystallised copy.
//
// Heuristics applied (all must pass):
//   1. Phase metadata, when present, must identify a committed execute
//      artifact. Plan attempts are exploration and cannot crystallise.
//   2. >= 2 distinct primitive calls in the trajectory.
//   3. The trajectory's `errored` flag is false AND no call has a
//      thrown-error output (no `error`/`errors`/`stack` key on its
//      output). Error-path detection lives on the trajectory's `errored`
//      field, NOT on `mode` — per PRD §8.1, `mode: "novel"` means
//      "first-time successful ad-hoc composition" (tier 4).
//   4. Mode is "novel" (first-time composition we want to crystallise)
//      or "interpreted" (already-composed; usually filtered by the
//      shape-hash dedup below). LLM-backed / cache trajectories are
//      excluded per D-015 — the observer crystallises composition
//      patterns, not standalone LLM functions or cached results.
//   5. The first call is a substrate retrieval (`db.*`) returning a list,
//      and at least one subsequent call is a `lib.*` whose input
//      references the first call's output (data-flow check).
//   6. The shape-hash isn't already represented in the on-disk
//      /lib/<tenant>/ overlay (avoid re-crystallising).

import type { TrajectoryRecord } from "../sdk/index.js";

import type { LibrarySnapshot } from "./template.js";

export type GateOutcome =
  | { ok: true }
  | { ok: false; reason: string };

export type ShouldCrystalliseArgs = {
  trajectory: TrajectoryRecord;
  // Pre-computed shape hash from the template extractor. Used to check
  // against `existingHashes` so we don't re-crystallise the same shape.
  shapeHash: string;
  existing: LibrarySnapshot;
};

export function shouldCrystallise(args: ShouldCrystalliseArgs): GateOutcome {
  const { trajectory, shapeHash, existing } = args;

  // 1. Phase-aware execution: legacy trajectories had no phase field, so
  //    keep them eligible. Once a run declares a phase, only committed
  //    execute artifacts are learnable.
  if (trajectory.phase !== undefined && trajectory.phase !== "execute") {
    return {
      ok: false,
      reason: `trajectory.phase is "${trajectory.phase}"; only execute artifacts can crystallise`,
    };
  }
  if (trajectory.crystallisable === false) {
    return {
      ok: false,
      reason: "trajectory.crystallisable=false; only execute artifacts can crystallise",
    };
  }

  // 2. >= 2 distinct primitive calls.
  if (trajectory.calls.length < 2) {
    return {
      ok: false,
      reason: `trajectory has ${trajectory.calls.length} call(s); need at least 2`,
    };
  }
  const distinctPrimitives = new Set(trajectory.calls.map((c) => c.primitive));
  if (distinctPrimitives.size < 2) {
    return {
      ok: false,
      reason: `trajectory has ${distinctPrimitives.size} distinct primitive(s); need at least 2`,
    };
  }

  // 3. The snippet didn't error AND no recorded call has an error-shaped
  //    output. Error-path detection is on `trajectory.errored`, NOT on
  //    `mode` — per PRD §8.1 a successful first-time composition is
  //    `mode: "novel"`, tier 4.
  if (trajectory.errored === true) {
    return {
      ok: false,
      reason: "trajectory.errored=true (snippet threw or no body executed)",
    };
  }
  for (const call of trajectory.calls) {
    if (looksLikeErrorOutput(call.output)) {
      return {
        ok: false,
        reason: `call #${call.index} (${call.primitive}) output looks like an error`,
      };
    }
  }

  // 4. Mode must be a composition pattern. "novel" (first-time successful
  //    ad-hoc composition) is the headline crystallisation target;
  //    "interpreted" trajectories are also accepted but the shape-hash
  //    dedup below typically filters them. LLM-backed / cache /compiled
  //    are excluded per D-015.
  if (trajectory.mode !== "novel" && trajectory.mode !== "interpreted") {
    return {
      ok: false,
      reason: `trajectory.mode is "${trajectory.mode}"; observer only crystallises composition patterns (mode "novel" or "interpreted"). Per D-015 the agent authors LLM-backed functions directly.`,
    };
  }

  // Interpreted trajectories that already dispatched through a crystallised
  // wrapper should reinforce that wrapper, not crystallise a second wrapper
  // around it. The current generated names use `crystallise_*`; once names
  // become fully semantic this check should move to the library metadata
  // layer, but this protects the observed nested-wrapper failure now.
  const crystallisedCall = trajectory.calls.find((c) =>
    /^lib\.crystallise_/.test(c.primitive),
  );
  if (crystallisedCall) {
    return {
      ok: false,
      reason: `trajectory already calls crystallised tool ${crystallisedCall.primitive}; treat as reuse evidence, not a new template`,
    };
  }

  // 5. db.* call producing a list; at least one lib.* call after it whose
  //    input cites the prior call's output (loose data-flow heuristic).
  const firstDbIdx = trajectory.calls.findIndex((c) =>
    c.primitive.startsWith("db."),
  );
  if (firstDbIdx === -1) {
    return {
      ok: false,
      reason: "no db.* call present; observer requires a substrate-rooted chain",
    };
  }
  if (!Array.isArray(trajectory.calls[firstDbIdx]?.output)) {
    return {
      ok: false,
      reason: `first db.* call (#${firstDbIdx}) did not return a list`,
    };
  }
  const downstreamLib = trajectory.calls.slice(firstDbIdx + 1).find((c) =>
    c.primitive.startsWith("lib."),
  );
  if (!downstreamLib) {
    return {
      ok: false,
      reason: "no lib.* call after the first db.* call",
    };
  }
  if (!consumesEarlierOutput(trajectory.calls, firstDbIdx)) {
    return {
      ok: false,
      reason: "no downstream call appears to consume the substrate output (data-flow check failed)",
    };
  }

  // 6. Shape-hash de-dup. The existing snapshot is built from the on-disk
  //    /lib/<tenant>/*.ts files; any file whose body comment carries the
  //    same `@shape-hash:` tag means we already crystallised this shape.
  if (existing.shapeHashes.has(shapeHash)) {
    return {
      ok: false,
      reason: `call shape already crystallised (shapeHash=${shapeHash})`,
    };
  }

  return { ok: true };
}

// --- Helpers ---------------------------------------------------------------

// A call's output shape that "looks like an error" — defensive check; the
// trajectory recorder doesn't store thrown exceptions per se (it bubbles
// them up to the snippet runtime which records mode "novel"), but a
// pure-TS body that returns `{error: "..."}` is something the gate
// should refuse.
function looksLikeErrorOutput(output: unknown): boolean {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return false;
  }
  const rec = output as Record<string, unknown>;
  if (typeof rec["error"] === "string") return true;
  if (Array.isArray(rec["errors"]) && rec["errors"].length > 0) return true;
  if (typeof rec["stack"] === "string") return true;
  return false;
}

// Returns true if any call after `firstDbIdx` has an input that
// references a value present somewhere in an earlier call's output.
// "References" is checked structurally: serialise both, walk the
// downstream input looking for any object/array whose JSON encoding
// matches any sub-tree of the upstream output.
function consumesEarlierOutput(
  calls: TrajectoryRecord["calls"],
  firstDbIdx: number,
): boolean {
  const upstream = calls[firstDbIdx]?.output;
  if (!Array.isArray(upstream) || upstream.length === 0) return false;
  // Quick serialise-and-substring check. This is a loose heuristic but
  // covers the common case where the output of findSimilar(...) flows in
  // as `{candidates: cands}` to pickFiling.
  const upstreamJson = safeJson(upstream);
  if (upstreamJson === null) return false;
  // Use a feature of the upstream payload that is unlikely to collide
  // with literal arguments: pick the first element's first string-valued
  // field as a signature.
  const signature = pickSignature(upstream);
  if (signature === null) return false;
  for (let i = firstDbIdx + 1; i < calls.length; i += 1) {
    const downstream = calls[i];
    if (!downstream) continue;
    const downstreamJson = safeJson(downstream.input);
    if (downstreamJson === null) continue;
    if (downstreamJson.includes(signature)) return true;
  }
  return false;
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function pickSignature(arr: unknown[]): string | null {
  for (const item of arr) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      const v = rec[key];
      if (typeof v === "string" && v.length >= 4) {
        // Plain string that's distinctive enough.
        return JSON.stringify(v);
      }
    }
  }
  return null;
}
