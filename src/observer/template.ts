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

  const params: TemplateParameter[] = [];
  const steps: TemplateStep[] = [];
  // Track outputs by step index so later steps' `derivedFromCallIndex`
  // detection works.
  const outputs = new Map<number, unknown>();
  // Literal-value -> param name dedup. Lets two different field names
  // carrying the same value across calls collapse onto one param.
  const literalDedup = new Map<string, string>();

  trajectory.calls.forEach((call, idx) => {
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
  const topic = pickTopic(trajectory);
  const name = semanticName(topic);

  return {
    parameters: params,
    steps,
    finalOutputBinding,
    name,
    topic,
    shapeHash,
  };
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
