// Crystallisation gate.
//
// Conservative heuristic deciding whether a saved trajectory should be learned
// into a /lib/<tenant>/<name>.ts interface. Phase 5 (R6) wants the observer to
// "only propose crystallisation when the trajectory looks complete and the call
// graph is plausible".
//
// The gate is intentionally simple — it errs on the side of skipping. A
// permissive observer would write garbage /lib/ files; a strict one only
// learns shapes the runtime can mechanically replay. Per the plan's
// Architecture and design.md §8.3, the production form requires N >= 3
// convergent trajectories before promotion. The MVP collapses N to 1
// (every qualifying trajectory is learned immediately) so the demo
// shows turn 5 of personas.md §3 ("Coming back the next day"). The
// shape-hash de-dup below means re-running the same snippet doesn't
// produce a second learned-interface copy.
//
// Heuristics applied (all must pass):
//   1. Phase metadata, when present, must identify a committed execute
//      artifact. Plan attempts are exploration and cannot be learned from.
//   2. >= 2 distinct primitive calls in the trajectory.
//   3. The trajectory's `errored` flag is false AND no call has a
//      thrown-error output (no `error`/`errors`/`stack` key on its
//      output). Error-path detection lives on the trajectory's `errored`
//      field, NOT on `mode` — per PRD §8.1, `mode: "novel"` means
//      "first-time successful ad-hoc composition" (tier 4).
//   4. Mode is "novel" (first-time composition we want to learn)
//      or "interpreted" (already-composed; usually filtered by the
//      shape-hash dedup below). LLM-backed / cache trajectories are
//      excluded per D-015 — the observer learns composition
//      patterns, not standalone LLM functions or cached results.
//   5. The first call is a substrate retrieval (`db.*`) returning a list,
//      and at least one subsequent call is a `lib.*` whose input
//      references the first call's output (data-flow check).
//   6. The shape-hash isn't already represented in the on-disk
//      /lib/<tenant>/ overlay (avoid re-learning the same shape).

import type { TrajectoryRecord } from "../sdk/index.js";

import type { LibrarySnapshot } from "./template.js";

export type GateOutcome =
  | { ok: true }
  | { ok: false; reason: string };

export type ShouldCrystalliseArgs = {
  trajectory: TrajectoryRecord;
  // Pre-computed shape hash from the template extractor. Used to check against
  // `existing.shapeHashes` so we don't re-learn the same shape.
  shapeHash: string;
  existing: LibrarySnapshot;
};

export function shouldCrystallise(args: ShouldCrystalliseArgs): GateOutcome {
  const { trajectory, shapeHash, existing } = args;

  // 1. Phase-aware execution: legacy trajectories had no phase field, so
  //    keep them eligible. Once a run declares a phase, only committed
  //    artifacts are learnable. `execute` remains as the legacy committed
  //    phase; `commit` is the intent-workspace answer gate.
  if (
    trajectory.phase !== undefined &&
    trajectory.phase !== "execute" &&
    trajectory.phase !== "commit"
  ) {
    return {
      ok: false,
      reason: `trajectory.phase is "${trajectory.phase}"; only committed artifacts can be learned from`,
    };
  }
  if (
    trajectory.phase === "commit" &&
    !answerValidationAccepted(trajectory.answerValidation)
  ) {
    return {
      ok: false,
      reason: "commit answer validation did not accept the trajectory",
    };
  }
  if (trajectory.crystallisable === false) {
    return {
      ok: false,
      reason: "trajectory.crystallisable=false; only committed artifacts can be learned from",
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
      reason: `trajectory.mode is "${trajectory.mode}"; observer only learns composition patterns (mode "novel" or "interpreted"). Per D-015 the agent authors agent-backed functions directly.`,
    };
  }

  // Interpreted trajectories that already dispatched through a learned
  // interface should reinforce that interface, not learn a second wrapper
  // around it. Semantic names are recognised through the library metadata
  // snapshot; the old `crystallise_*` prefix remains supported for legacy
  // files already present on disk.
  const learnedCall = trajectory.calls.find((c) =>
    callsKnownLearnedInterface(c.primitive, existing),
  );
  if (learnedCall) {
    return {
      ok: false,
      reason: `trajectory already calls learned interface ${learnedCall.primitive}; treat as reuse evidence, not a new template`,
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
  //    same `@shape-hash:` tag means we already learned this shape.
  if (existing.shapeHashes.has(shapeHash)) {
    return {
      ok: false,
      reason: `call shape already learned (shapeHash=${shapeHash})`,
    };
  }

  return { ok: true };
}

function answerValidationAccepted(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return (value as { accepted?: unknown }).accepted === true;
}

// --- Helpers ---------------------------------------------------------------

function callsKnownLearnedInterface(
  primitive: string,
  existing: LibrarySnapshot,
): boolean {
  if (!primitive.startsWith("lib.")) return false;
  const name = primitive.slice("lib.".length);
  return existing.learnedNames.has(name) || name.startsWith("crystallise_");
}

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
  // as `{candidates: cands}` to pickFiling. Agents often filter/rerank the
  // candidate list before the next primitive call, so checking only the
  // first upstream row creates false negatives. Treat any distinctive row
  // signature from the upstream result set as evidence of substrate flow.
  const signatures = pickSignatures(upstream);
  if (signatures.length === 0) return false;
  for (let i = firstDbIdx + 1; i < calls.length; i += 1) {
    const downstream = calls[i];
    if (!downstream) continue;
    const downstreamJson = safeJson(downstream.input);
    if (downstreamJson === null) continue;
    if (signatures.some((signature) => downstreamJson.includes(signature))) {
      return true;
    }
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

function pickSignatures(arr: unknown[]): string[] {
  const preferredKeys = [
    "id",
    "caseId",
    "filename",
    "question",
    "searchableText",
    "program",
  ];
  const signatures: string[] = [];
  const seen = new Set<string>();

  const addSignature = (raw: string): void => {
    if (!seen.has(raw)) {
      seen.add(raw);
      signatures.push(raw);
    }
  };

  for (const item of arr) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      // Treat numeric and string primitives as their own signatures.
      // Common when df.db.records returns a list of ids or labels.
      if (typeof item === "string" && item.length >= 3) {
        addSignature(JSON.stringify(item));
        if (signatures.length >= 64) return signatures;
      } else if (typeof item === "number" && Number.isFinite(item)) {
        const numStr = String(item);
        if (numStr.length >= 2) {
          addSignature(numStr);
          addSignature(JSON.stringify(numStr));
          if (signatures.length >= 64) return signatures;
        }
      }
      continue;
    }
    const rec = item as Record<string, unknown>;
    const keys = [
      ...preferredKeys.filter((key) => Object.prototype.hasOwnProperty.call(rec, key)),
      ...Object.keys(rec).filter((key) => !preferredKeys.includes(key)),
    ];
    for (const key of keys) {
      const v = rec[key];
      if (typeof v === "string" && v.length >= 4) {
        addSignature(JSON.stringify(v));
        if (signatures.length >= 64) return signatures;
      } else if (typeof v === "number" && Number.isFinite(v)) {
        // Numeric identifier-like values (>=2 digits) are common
        // signatures for tool inputs like `{show_id: 169}` or
        // `{user_id: 42}`. Emit both bare and quoted forms so the
        // substring check matches whether downstream JSON carries
        // the value as a number or a string.
        const numStr = String(v);
        if (numStr.length >= 2) {
          addSignature(numStr);
          addSignature(JSON.stringify(numStr));
          if (signatures.length >= 64) return signatures;
        }
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        // One level deep into nested object values (covers
        // `attributes: {tvmaze_id: 169}` style records). Don't
        // recurse further; we just want distinctive identifiers.
        for (const inner of Object.values(v as Record<string, unknown>)) {
          if (typeof inner === "number" && Number.isFinite(inner)) {
            const numStr = String(inner);
            if (numStr.length >= 2) {
              addSignature(numStr);
              addSignature(JSON.stringify(numStr));
              if (signatures.length >= 64) return signatures;
            }
          } else if (typeof inner === "string" && inner.length >= 4) {
            addSignature(JSON.stringify(inner));
            if (signatures.length >= 64) return signatures;
          }
        }
      }
    }
  }
  return signatures;
}
