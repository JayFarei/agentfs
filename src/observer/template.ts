// Template extraction.
//
// Walks a successful trajectory and reduces the call list to a parameterised
// template the authoring step can emit as a TypeScript composition. The
// template captures:
//   - the ordered primitive labels (`db.cases.findSimilar`, `lib.pickFiling`,
//     `lib.locateFigure`, ...).
//   - for each call, an InputBindings map: which input fields are derived
//     from earlier-call outputs vs. external parameters.
//   - the parameter list the learned interface exposes.
//
// The shape hash is a 32-bit non-cryptographic shape over the canonical step list (NOT the question
// text). The hash collapses any two trajectories that walk the same
// primitives in the same order with the same data-flow shape into a single
// entry; the authoring step uses it as the learned interface's dedupe key.
//
// Naming convention:
//   <semanticTopicName>
// where <semanticTopicName> is a lower-camel intent shape such as
// `rangeTableMetric`. The shape hash stays in file metadata as the stable
// dedupe/provenance key instead of leaking into the user-facing name.

import { promises as fsp } from "node:fs";
import path from "node:path";

import type { PrimitiveCallRecord, TrajectoryRecord } from "../sdk/index.js";

// --- Public types ----------------------------------------------------------

// One parameter the learned interface exposes. `derivedFromCallIndex`
// is set when the parameter's shape is determined by an earlier call's
// output (e.g. `candidates` is the output of the first db.* call). When
// `derivedFromCallIndex` is set, the parameter is internal to the body
// and not exposed in the function's input schema.
export type TemplateParameter = {
  name: string;
  // Loose type label captured from the literal value at extraction time
  // (`"string" | "number" | "boolean" | "array" | "object" | "null" |
  // "unknown"`). The authoring step uses it to generate a valibot schema.
  jsType: TypeLabel;
  // Index of the call whose output is bound to this parameter, if any.
  derivedFromCallIndex?: number;
};

export type TypeLabel =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "null"
  | "unknown";

export type TemplateInputBinding =
  // The field is bound to an external parameter name.
  | { kind: "param"; param: string }
  // The field is bound to the output of an earlier call. The path is
  // `outputName.path.to.field` (or just `outputName` for the whole
  // output).
  | { kind: "ref"; ref: string };

// One step in the learned composition.
export type TemplateStep = {
  primitive: string;
  // Field name -> binding. The authoring step renders these as the call
  // expression at body-emit time.
  inputBindings: Record<string, TemplateInputBinding>;
  // Variable name for this step's output, used by later steps + the
  // final return.
  outputName: string;
  // Optional. Some calls have a flat positional argument shape (e.g.
  // findSimilar(query, limit)) where the recorded input is `{query, opts}`,
  // `{query, limit}`, or `{filter, limit}`. The authoring step inspects
  // this hint to pick the call shape.
  callShape:
    | "positional-query-limit"
    | "positional-query-opts"
    | "positional-filter-limit"
    | "single-arg";
};

export type CallTemplate = {
  // The first non-derived parameter — what the public function takes.
  parameters: TemplateParameter[];
  steps: TemplateStep[];
  // Variable name returned by the function; matches the last step's
  // `outputName`.
  finalOutputBinding: string;
  // Stable user-facing name for the learned interface file.
  name: string;
  // Topic slug derived from the trajectory; surfaces in the function
  // intent string and the file name.
  topic: string;
  // Canonical a 32-bit non-cryptographic shape hex hash of the step list. Used by the gate's
  // de-dup check and stamped into the authored file as `@shape-hash:`.
  shapeHash: string;
  // Goal-4: data-shape-agnostic crystallisation key. The category
  // skeleton (db/lib/tool, concrete names dropped) with consecutive
  // same-category runs collapsed to `FANOUT(category,degreeBucket,
  // cycle<distinctInputShapes>)`. Two trajectories doing structurally
  // identical work over DIFFERENT data shapes share an `intentSignature`
  // even when their `shapeHash` differs. The pinned spec v2 lives in
  // experiments/PLAN.md § Goal 4 Change 1; the offline reference impl
  // is `eval/skillcraft/scripts/intent-cluster-analysis.ts`. iter 3
  // computes this as metadata; iter 4 keys the convergence gate on it.
  intentSignature: string;
};

// Snapshot of a tenant's existing /lib/ overlay used by the gate to avoid
// re-learning the same interface. The observer builds this once per
// `observe()` call by listing files under `<baseDir>/lib/<tenantId>/*.ts` and
// scanning each for the `@shape-hash:` marker.
export type LibrarySnapshot = {
  shapeHashes: Set<string>;
  learnedNames: Set<string>;
};

// --- extractTemplate -------------------------------------------------------

export function extractTemplate(trajectory: TrajectoryRecord): CallTemplate {
  if (trajectory.calls.length === 0) {
    throw new Error("extractTemplate: trajectory has no calls");
  }
  return extractTemplateFromCalls(trajectory.calls, trajectory);
}

// Extract a template from a slice of trajectory calls. The slice must be
// non-empty. When `topicSuffix` is supplied, the topic is decorated with
// the suffix and the helper name's final segment matches the suffix — this
// keeps sibling sub-graph helpers from one trajectory from colliding on
// the same `<tenantId>/<name>.ts` path.
export function extractTemplateFromCalls(
  calls: ReadonlyArray<PrimitiveCallRecord>,
  trajectory: TrajectoryRecord,
  topicSuffix?: string,
): CallTemplate {
  if (calls.length === 0) {
    throw new Error("extractTemplateFromCalls: empty calls slice");
  }
  const params: TemplateParameter[] = [];
  const steps: TemplateStep[] = [];
  const outputs = new Map<number, unknown>();
  const literalDedup = new Map<string, string>();

  calls.forEach((call, idx) => {
    outputs.set(idx, call.output);
    const outputName = `out${idx}`;
    const callShape = inferCallShape(call);
    const bindings = bindInputs({
      call,
      callIndex: idx,
      outputs,
      params,
      literalDedup,
    });
    steps.push({
      primitive: call.primitive,
      inputBindings: bindings,
      outputName,
      callShape,
    });
  });

  const finalOutputBinding = steps[steps.length - 1]!.outputName;
  const shapeHash = shapeHashHex(canonicalShape(steps));
  const intentSignature = computeIntentSignature(calls);
  const baseTopic =
    topicSuffix !== undefined
      ? `${pickTopicForCalls(trajectory, calls)}_${topicSuffix}`
      : pickTopicForCalls(trajectory, calls);
  const name = semanticName(baseTopic);

  return {
    parameters: params,
    steps,
    finalOutputBinding,
    name,
    topic: baseTopic,
    shapeHash,
    intentSignature,
  };
}

// --- intentSignature (Goal-4 Change 1, pinned spec v2) --------------------
//
// Data-shape-agnostic crystallisation key. Validated offline over the
// iter14 full-126 + iter15 subset (146 trajectories → 55 clusters, 22
// multi-trajectory, 17 cross-family, 0 incoherent). Reference impl:
// eval/skillcraft/scripts/intent-cluster-analysis.ts.

type PrimitiveCategory = "db" | "lib" | "tool" | "other";

function categoryOf(primitive: string): PrimitiveCategory {
  if (primitive.startsWith("db.")) return "db";
  if (primitive.startsWith("lib.")) return "lib";
  if (primitive.startsWith("tool.")) return "tool";
  return "other";
}

function intentInputFieldSet(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return "<atom>";
  }
  return Object.keys(input as Record<string, unknown>).sort().join(",");
}

function intentDegreeBucket(n: number): string {
  if (n <= 2) return "2";
  if (n <= 5) return "3-5";
  return "6+";
}

// Compute the data-shape-agnostic intent signature for a call slice.
// Map each call to a category; collapse a maximal run of >= 2
// consecutive same-category calls into
// `FANOUT(category,degreeBucket,cycle<distinctInputShapes>)`. Fan-out
// detection is on category ALONE — keying on input-field-set fragments
// interleaved multi-tool fan-out (A,B,C,A,B,C). The signature is the
// `→`-joined skeleton.
export function computeIntentSignature(
  calls: ReadonlyArray<PrimitiveCallRecord>,
): string {
  const skeleton: string[] = [];
  let i = 0;
  while (i < calls.length) {
    const cat = categoryOf(calls[i]!.primitive);
    if (cat === "other") {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < calls.length && categoryOf(calls[j]!.primitive) === cat) {
      j += 1;
    }
    const runLen = j - i;
    if (runLen >= 2) {
      const distinctShapes = new Set(
        calls.slice(i, j).map((c) => intentInputFieldSet(c.input)),
      ).size;
      skeleton.push(
        `FANOUT(${cat},${intentDegreeBucket(runLen)},cycle${distinctShapes})`,
      );
    } else {
      skeleton.push(cat);
    }
    i = j;
  }
  return skeleton.join("→");
}

// --- nested-call extraction (Goal-4 Change 2) ----------------------------
//
// A trajectory's `calls` array is FLAT — calls made inside a df.lib.*
// body carry `scope.depth >= 1` and `scope.parentPrimitive`. The
// existing extractors only look at the top-level call list, so a
// `lib.per_entity` whose body fans out over tools contributes ONE
// top-level template (the wrapper) and the internal fan-out intent is
// invisible. This walker groups depth>=1 calls by `scope.parentPrimitive`
// (NOT by contiguity — the parent lib.* call is recorded AFTER its
// nested calls) and emits each group as a candidate template.
//
// iter 3 ships this as a standalone export; the observer worker does
// not call it yet. iter 4 wires it into the convergence-gated path.
export function extractNestedTemplates(
  trajectory: TrajectoryRecord,
): CallTemplate[] {
  const byParent = new Map<string, PrimitiveCallRecord[]>();
  for (const call of trajectory.calls) {
    const scope = call.scope;
    if (!scope || scope.depth < 1) continue;
    const parent = scope.parentPrimitive ?? "<unknown-parent>";
    const group = byParent.get(parent) ?? [];
    group.push(call);
    byParent.set(parent, group);
  }
  const out: CallTemplate[] = [];
  for (const [parent, group] of byParent) {
    // Need >= 2 calls for a template (extractTemplateFromCalls requires
    // non-empty; a 1-call nested group is not a reusable pattern).
    if (group.length < 2) continue;
    // Suffix keeps the helper name distinct from the wrapper's own
    // template; derive a short slug from the parent primitive.
    const parentSlug = sanitizeSlug(parent.replace(/^lib\./, "")).slice(0, 24);
    out.push(
      extractTemplateFromCalls(group, trajectory, `nested_${parentSlug}`),
    );
  }
  return out;
}

// Sub-graph candidate proposal. Returns 0+ additional templates extracted
// from contiguous slices of the trajectory in addition to the whole.
//
// Goal-3 iter 10: today the observer crystallises one helper per trajectory
// (via `extractTemplate`). For SkillCraft-shaped trajectories where the
// agent's snippet did `db.records.findExact -> [tool.A, tool.B, ...] -> lib.<seed>`,
// the whole-trajectory shape collapses to a single shape-hash and a single
// authored helper. To lift `avgLearnedInterfacesAvailable` above 1, we also
// propose:
//
//   - A "lookup + first consumer" sub-graph: from the first db.* call to the
//     first downstream lib.* / tool.* that consumes its output. Reusable as
//     "fetch entities + the first transform you apply to them".
//   - A "post-lookup fan-out" sub-graph: the contiguous tail of lib.*/tool.*
//     calls after the db lookup. Reusable as "given a list of entities, do
//     the fan-out work alone, no need to re-lookup".
//
// Sub-graphs whose shape collapses onto the whole-trajectory shape (e.g.
// when the trajectory is exactly two calls) are filtered by the shape-hash
// dedup in the gate, so this function is safe to over-propose.
export function extractSubGraphTemplates(
  trajectory: TrajectoryRecord,
): CallTemplate[] {
  const calls = trajectory.calls;
  if (calls.length < 3) return [];

  const firstDbIdx = calls.findIndex((c) => c.primitive.startsWith("db."));
  if (firstDbIdx < 0) return [];
  const dbCall = calls[firstDbIdx]!;
  const dbOutput = dbCall.output;
  if (!isStructuredValue(dbOutput) && !Array.isArray(dbOutput)) return [];

  // The boundary is the FIRST subsequent lib.* or tool.* call whose input
  // references the db.* output. The reference check uses a signature-based
  // heuristic (same as gate.ts's `consumesEarlierOutput`) so that downstream
  // calls picking out a single entity id from the db output (e.g.
  // `{ id: 7 }` flowing from `[{ id: 7 }, ...]`) are recognised as
  // consumers, not just deep-equal whole-output references.
  const upstreamSignatures = collectOutputSignatures(dbOutput);
  let consumerIdx = -1;
  if (upstreamSignatures.length > 0) {
    for (let i = firstDbIdx + 1; i < calls.length; i += 1) {
      const c = calls[i]!;
      if (
        !c.primitive.startsWith("lib.") &&
        !c.primitive.startsWith("tool.")
      ) {
        continue;
      }
      const downstreamJson = safeJsonString(c.input);
      if (downstreamJson === null) continue;
      if (upstreamSignatures.some((sig) => downstreamJson.includes(sig))) {
        consumerIdx = i;
        break;
      }
    }
  }
  if (consumerIdx < 0) return [];

  const candidates: CallTemplate[] = [];
  const wholeShape = shapeHashHex(canonicalShape(
    extractTemplateFromCalls(calls, trajectory).steps,
  ));

  // Sub-graph A: [db .. first consumer] inclusive. Skip when it equals the
  // whole trajectory or is too short to be a meaningful pattern. The
  // ≥ 3-call minimum keeps the demo's 4-call FinQA trajectory from
  // spawning a noisy `[db, firstHelper]` 2-call sibling while still
  // letting longer SkillCraft fan-out trajectories produce a useful
  // sub-graph helper.
  if (consumerIdx < calls.length - 1) {
    const slice = calls.slice(firstDbIdx, consumerIdx + 1);
    if (slice.length >= 3) {
      const template = extractTemplateFromCalls(slice, trajectory, "lookup_consumer");
      if (template.shapeHash !== wholeShape) candidates.push(template);
    }
  }

  // Sub-graph B: [first consumer .. end]. Skip when it equals the whole
  // trajectory or has < 3 calls. The gate's pure-fan-out check additionally
  // requires a repeated primitive — three distinct lib.* / tool.* calls
  // with no repeat are NOT a reusable pattern.
  if (consumerIdx > firstDbIdx) {
    const slice = calls.slice(consumerIdx);
    if (slice.length >= 3) {
      const template = extractTemplateFromCalls(slice, trajectory, "fanout");
      if (template.shapeHash !== wholeShape) candidates.push(template);
    }
  }

  return candidates;
}

// Returns the whole-trajectory template followed by any sub-graph
// templates the observer should consider. Each candidate is independently
// run through the gate; the order matches a "whole, then narrower slices"
// preference so that when the gate accepts the whole, the sub-graphs add
// breadth without changing the headline crystallisation behaviour for
// existing trajectory shapes.
export function extractCandidateTemplates(
  trajectory: TrajectoryRecord,
): CallTemplate[] {
  if (trajectory.calls.length === 0) return [];
  const whole = extractTemplate(trajectory);
  const subs = extractSubGraphTemplates(trajectory);
  const seenHashes = new Set<string>([whole.shapeHash]);
  const out: CallTemplate[] = [whole];
  for (const sub of subs) {
    if (seenHashes.has(sub.shapeHash)) continue;
    seenHashes.add(sub.shapeHash);
    out.push(sub);
  }
  return out;
}

function safeJsonString(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// Collect distinctive signatures from a db.* call output. The same shape
// as gate.ts's `pickSignatures`, kept in this file to avoid cross-module
// coupling. Used to decide whether a downstream call's input references
// any record in the upstream result set.
function collectOutputSignatures(output: unknown): string[] {
  if (!Array.isArray(output) || output.length === 0) return [];
  const signatures: string[] = [];
  const seen = new Set<string>();
  const addSignature = (raw: string): void => {
    if (!seen.has(raw)) {
      seen.add(raw);
      signatures.push(raw);
    }
  };
  for (const item of output) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      if (typeof item === "string" && item.length >= 3) {
        addSignature(JSON.stringify(item));
      } else if (typeof item === "number" && Number.isFinite(item)) {
        const s = String(item);
        if (s.length >= 1) {
          addSignature(s);
          addSignature(JSON.stringify(s));
        }
      }
      if (signatures.length >= 64) return signatures;
      continue;
    }
    const rec = item as Record<string, unknown>;
    for (const value of Object.values(rec)) {
      if (typeof value === "string" && value.length >= 4) {
        addSignature(JSON.stringify(value));
      } else if (typeof value === "number" && Number.isFinite(value)) {
        const s = String(value);
        if (s.length >= 1) {
          addSignature(s);
          addSignature(JSON.stringify(s));
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const inner of Object.values(value as Record<string, unknown>)) {
          if (typeof inner === "string" && inner.length >= 4) {
            addSignature(JSON.stringify(inner));
          } else if (typeof inner === "number" && Number.isFinite(inner)) {
            const s = String(inner);
            if (s.length >= 1) {
              addSignature(s);
              addSignature(JSON.stringify(s));
            }
          }
        }
      }
      if (signatures.length >= 64) return signatures;
    }
  }
  return signatures;
}

function pickTopicForCalls(
  trajectory: TrajectoryRecord,
  calls: ReadonlyArray<PrimitiveCallRecord>,
): string {
  // Reuse the trajectory-level topic picker but bias toward primitives
  // that are present in this specific slice. If the slice has no lib.*
  // call, the topic falls back to the first call's primitive slug.
  const primitives = new Set(calls.map((c) => c.primitive));
  const fakeTrajectory: TrajectoryRecord = {
    ...trajectory,
    calls: calls.slice() as TrajectoryRecord["calls"],
  };
  if (
    !primitives.has("lib.executeTableMath") &&
    !primitives.has("lib.inferTableMathPlan") &&
    !primitives.has("lib.locateFigure") &&
    !primitives.has("lib.pickFiling")
  ) {
    const firstLib = calls.find((c) => c.primitive.startsWith("lib."));
    if (firstLib) {
      return sanitizeSlug(firstLib.primitive.slice("lib.".length));
    }
    const firstTool = calls.find((c) => c.primitive.startsWith("tool."));
    if (firstTool) {
      return sanitizeSlug(firstTool.primitive.replace(/^tool\./, "").replace(/\./g, "_"));
    }
    return sanitizeSlug(trajectory.question || "snippet");
  }
  return pickTopic(fakeTrajectory);
}

// --- bindInputs ------------------------------------------------------------

type BindArgs = {
  call: PrimitiveCallRecord;
  callIndex: number;
  outputs: Map<number, unknown>;
  params: TemplateParameter[];
  // Map of seenValue -> paramName. Lets two different field names that
  // carry the same literal value across calls collapse onto one
  // parameter. Without this, a snippet that uses the same query string
  // in `db.findSimilar(query)` and the same question in
  // `lib.pickFiling({question})` ends up with two `query` / `question`
  // params (one for each), which confuses the public function signature.
  literalDedup: Map<string, string>;
};

// Reduce a call's input object into a binding map. For each field on the
// input, decide whether it's a parameter (literal value carried in from
// outside) or a reference to an earlier call's output (derived). The
// detection rule for refs: if the field's value matches an earlier call's
// output or object/array subtree structurally (deep-equal), bind to that
// output expression. This keeps intermediate values such as
// `const picked = candidates[0]` inside the learned body instead of
// leaking them into the public input schema.
function bindInputs(args: BindArgs): Record<string, TemplateInputBinding> {
  const { call, callIndex, outputs, params, literalDedup } = args;
  const out: Record<string, TemplateInputBinding> = {};

  if (call.input === null || typeof call.input !== "object") {
    // Atomic input: synthesise a single param `arg<index>`.
    const paramName = ensureParam({
      params,
      seedName: `arg${callIndex}`,
      sample: call.input,
      literalDedup,
    });
    out["__atom"] = { kind: "param", param: paramName };
    return out;
  }

  // Object input. Each field becomes a binding.
  const inputObj = call.input as Record<string, unknown>;
  for (const [field, value] of Object.entries(inputObj)) {
    const ref = matchEarlierOutput(value, outputs, callIndex);
    if (ref !== null) {
      out[field] = { kind: "ref", ref };
      continue;
    }
    const paramName = ensureParam({
      params,
      seedName: field,
      sample: value,
      literalDedup,
    });
    out[field] = { kind: "param", param: paramName };
  }
  return out;
}

type EnsureParamArgs = {
  params: TemplateParameter[];
  seedName: string;
  sample: unknown;
  literalDedup: Map<string, string>;
};

// Allocate a parameter, deduplicating by name AND by literal value. If
// the same literal value has already been seen in another field, reuse
// the existing parameter (collapsing duplicate inputs into one). Falls
// back to name-based dedup if the sample value is null/undefined or not
// JSON-stringifiable.
function ensureParam(args: EnsureParamArgs): string {
  const { params, seedName, sample, literalDedup } = args;
  const jsType = inferTypeLabel(sample);
  const sanitized = sanitizeIdent(seedName);

  // Literal-value dedup: if the same value already maps to a param,
  // reuse it. We key by JSON encoding plus the inferred type so we
  // don't conflate `[]` (array) with `{}` (object) etc.
  const literalKey = literalKeyOf(sample, jsType);
  if (literalKey !== null) {
    const existing = literalDedup.get(literalKey);
    if (existing) return existing;
  }

  // Name-based dedup with type-compatibility check.
  let name = sanitized;
  let suffix = 2;
  while (true) {
    const existing = params.find((p) => p.name === name);
    if (!existing) {
      params.push({ name, jsType });
      if (literalKey !== null) literalDedup.set(literalKey, name);
      return name;
    }
    if (existing.jsType === jsType) {
      // Reuse — same logical input across calls (same name + type).
      if (literalKey !== null) literalDedup.set(literalKey, name);
      return name;
    }
    name = `${sanitized}_${suffix}`;
    suffix += 1;
  }
}

// Build a key for the literal-value dedup map. Returns null when the
// value isn't suitable for value-based dedup (null/undefined, or
// JSON-encoding fails). We intentionally exclude null so that two
// fields that happen to be null don't collapse into the same param.
function literalKeyOf(sample: unknown, jsType: TypeLabel): string | null {
  if (sample === null || sample === undefined) return null;
  try {
    return `${jsType}:${JSON.stringify(sample)}`;
  } catch {
    return null;
  }
}

// Walk the outputs map looking for one that deep-equals `value`. Returns
// the output expression (e.g. `out0` or `out0[0]`) of the matched output
// or structured sub-tree.
function matchEarlierOutput(
  value: unknown,
  outputs: Map<number, unknown>,
  beforeIndex: number,
): string | null {
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const candidate = outputs.get(i);
    const ref = matchOutputRef(value, candidate, `out${i}`);
    if (ref !== null) return ref;
  }
  return null;
}

function matchOutputRef(
  value: unknown,
  candidate: unknown,
  baseRef: string,
): string | null {
  if (deepEqual(value, candidate)) return baseRef;
  if (isArraySubset(value, candidate)) return baseRef;
  if (!isStructuredValue(value)) return null;
  return matchStructuredSubtree(value, candidate, baseRef);
}

function isArraySubset(value: unknown, candidate: unknown): boolean {
  if (!Array.isArray(value) || !Array.isArray(candidate)) return false;
  if (value.length === 0 || value.length >= candidate.length) return false;
  return value.every((item) =>
    candidate.some((candidateItem) => deepEqual(item, candidateItem)),
  );
}

function matchStructuredSubtree(
  value: unknown,
  candidate: unknown,
  baseRef: string,
): string | null {
  if (Array.isArray(candidate)) {
    for (let i = 0; i < candidate.length; i += 1) {
      const childRef = `${baseRef}[${i}]`;
      const child = candidate[i];
      if (deepEqual(value, child)) return childRef;
      const nested = matchStructuredSubtree(value, child, childRef);
      if (nested !== null) return nested;
    }
    return null;
  }

  if (candidate !== null && typeof candidate === "object") {
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      const childRef = `${baseRef}${propertyAccess(key)}`;
      if (deepEqual(value, child)) return childRef;
      const nested = matchStructuredSubtree(value, child, childRef);
      if (nested !== null) return nested;
    }
  }

  return null;
}

function isStructuredValue(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

function propertyAccess(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return `.${key}`;
  return `[${JSON.stringify(key)}]`;
}

// Loose deep-equal that recurses into arrays + plain objects. Sufficient
// for trajectory JSON which is JSON-serialisable.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const av = a as Record<string, unknown>;
    const bv = b as Record<string, unknown>;
    const ak = Object.keys(av);
    const bk = Object.keys(bv);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!deepEqual(av[k], bv[k])) return false;
    }
    return true;
  }
  return false;
}

// --- Type inference --------------------------------------------------------

function inferTypeLabel(value: unknown): TypeLabel {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

// Recognise three common substrate-call shapes:
//   - findSimilar {query, limit?}  -> positional-query-limit
//   - search/hybrid {query, opts?} -> positional-query-opts
//   - findExact {filter, limit?}   -> positional-filter-limit
//   - anything else -> single-arg
//
// The authoring step uses this to pick the right call expression. Lib
// calls always use single-arg shape (the fn() factory takes one input
// object).
function inferCallShape(call: PrimitiveCallRecord): TemplateStep["callShape"] {
  if (!call.primitive.startsWith("db.")) return "single-arg";
  if (call.input === null || typeof call.input !== "object") {
    return "single-arg";
  }
  const obj = call.input as Record<string, unknown>;
  const keys = new Set(Object.keys(obj));
  const method = call.primitive.split(".")[2];
  if (
    method === "findSimilar" &&
    keys.has("query") &&
    (keys.size === 1 || (keys.has("limit") && keys.size === 2))
  ) {
    return "positional-query-limit";
  }
  if (
    (method === "search" || method === "hybrid") &&
    keys.has("query") &&
    (keys.size === 1 || (keys.has("opts") && keys.size === 2))
  ) {
    return "positional-query-opts";
  }
  if (
    method === "findExact" &&
    keys.has("filter") &&
    (keys.size === 1 || (keys.has("limit") && keys.size === 2))
  ) {
    return "positional-filter-limit";
  }
  return "single-arg";
}

// --- Naming + hashing ------------------------------------------------------

// 32-bit non-cryptographic step-list hash, hex-encoded. The shape hash
// is intentionally short because it's a tag for the file name;
// collisions across distinct shapes are tolerated (the gate's de-dup is
// a stale-cache reduction, not a correctness gate). NOTE: this hashes
// the call SHAPE (primitives + field names), NOT the question text —
// the prototype's per-question hash is dead per the Wave 4 plan.
function shapeHashHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Reduce the steps to a canonical string. We hash the step *shape* (the
// list of primitives and their input field names) NOT the literal input
// values. Two trajectories that walk the same primitives with the same
// input-shape hash to the same value, even if the literal values
// (queries, ticker hints, etc.) differ.
function canonicalShape(steps: TemplateStep[]): string {
  return steps
    .map((s) => {
      const fields = Object.entries(s.inputBindings)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([field, binding]) => {
          const target =
            binding.kind === "ref" ? `ref:${binding.ref}` : "param";
          return `${field}=${target}`;
        })
        .join(",");
      return `${s.primitive}(${fields})`;
    })
    .join("|");
}

// Topic slug for the interface name. Prefer user-intent shape over trace
// internals: a call chain ending in executeTableMath should advertise
// table-metric reuse, not the first helper it happened to call. This keeps
// the name useful to `apropos`, grep, and humans while leaving the shape hash
// as metadata.
function pickTopic(trajectory: TrajectoryRecord): string {
  const text = trajectoryIntentText(trajectory);
  const primitives = new Set(trajectory.calls.map((c) => c.primitive));

  if (primitives.has("lib.executeTableMath")) {
    if (/\brange\b/.test(text)) return "range_table_metric";
    if (/\b(change|delta|difference|increase|decrease)\b/.test(text)) {
      return "compare_table_metric";
    }
    if (/\b(ratio|percent|percentage|margin)\b/.test(text)) {
      return "ratio_table_metric";
    }
    return "table_metric";
  }

  if (primitives.has("lib.inferTableMathPlan")) return "table_math_plan";
  if (primitives.has("lib.locateFigure")) return "locate_table_figure";
  if (primitives.has("lib.pickFiling")) return "filing_question";

  const firstLib = trajectory.calls.find((c) => c.primitive.startsWith("lib."));
  if (firstLib) {
    return sanitizeSlug(firstLib.primitive.slice("lib.".length));
  }
  return sanitizeSlug(trajectory.question || "snippet");
}

function trajectoryIntentText(trajectory: TrajectoryRecord): string {
  const parts: string[] = [trajectory.question ?? ""];
  for (const call of trajectory.calls) {
    collectStrings(call.input, parts);
  }
  return parts.join(" ").toLowerCase();
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, into);
    }
  }
}

// Safe identifier. Preserves the input's case (so `priorTickers` stays
// `priorTickers`) but strips characters that aren't valid in JS
// identifiers. Used for both parameter names AND the function's name
// suffix; the function name itself goes through a lowercase pass via
// `pickTopic`.
function sanitizeIdent(input: string): string {
  let out = input.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!out) out = "x";
  if (/^[0-9]/.test(out)) out = `_${out}`;
  return out.slice(0, 40);
}

// Lowercase variant for slug fragments (function name, topic).
function sanitizeSlug(input: string): string {
  return sanitizeIdent(input).toLowerCase();
}

function semanticName(topic: string): string {
  const clean = sanitizeIdent(topic);
  const parts = clean.split(/_+/).filter(Boolean);
  if (parts.length === 0) return "learnedInterface";
  if (parts.length === 1) {
    return lowerFirst(parts[0]!);
  }
  return [
    parts[0]!.toLowerCase(),
    ...parts.slice(1).map((p) => upperFirst(p.toLowerCase())),
  ].join("");
}

function lowerFirst(input: string): string {
  if (input.length === 0) return input;
  return `${input[0]!.toLowerCase()}${input.slice(1)}`;
}

function upperFirst(input: string): string {
  if (input.length === 0) return input;
  return `${input[0]!.toUpperCase()}${input.slice(1)}`;
}

// --- LibrarySnapshot -------------------------------------------------------

// Build a LibrarySnapshot by scanning `<baseDir>/lib/<tenantId>/*.ts`
// for the `@shape-hash:` marker. Files without the marker (e.g. the agent's
// hand-authored functions) are not learned interfaces.
export async function readLibrarySnapshot(args: {
  baseDir: string;
  tenantId: string;
}): Promise<LibrarySnapshot> {
  const dir = path.join(args.baseDir, "lib", args.tenantId);
  const hashes = new Set<string>();
  const names = new Set<string>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { shapeHashes: hashes, learnedNames: names };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const file = path.join(dir, entry.name);
    let content: string;
    try {
      content = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }
    const m = content.match(/@shape-hash:\s*([0-9a-f]{8,})/);
    if (m && m[1]) {
      hashes.add(m[1]);
      names.add(entry.name.slice(0, -3));
    }
  }
  return { shapeHashes: hashes, learnedNames: names };
}
