// Schema inference from sampled documents.
//
// Per `kb/prd/design.md` §9.2 stage 3 ("Infer: run schema inference, detect
// polymorphism, classify fields by role") and §7.4 (descriptor shape).
//
// Output is a `MountDescriptor` plus a deterministic sha256 fingerprint
// over the canonical (sorted) shape. Fingerprint is the input to the
// `SCHEMA_VERSION` constant emitted in the synthesised `<coll>.ts` module.
//
// Heuristics are deliberately simple and source-agnostic. The bootstrap is
// not meant to "understand" the dataset; it lays down a defensible default
// shape that the agent + observer iterate on.

import { createHash } from "node:crypto";

import type {
  FieldDescriptor,
  FieldRole,
  IndexableAs,
  MountDescriptor,
  MountKind,
  PolymorphicVariant,
} from "../sdk/index.js";

export type InferenceInput = {
  collection: string;
  samples: unknown[];
};

export type InferenceOutput = {
  descriptor: MountDescriptor;
  // Per-field presence frequency (0..1). Re-exposed alongside the descriptor
  // so the synthesizer can drop JSDoc presence markers on each field.
  presence: Record<string, number>;
  // Per-field example shape (used to type-emit `string | number | unknown`).
  jsTypes: Record<string, JsType>;
  // Sample-derived cardinality estimates per field (informational; the same
  // values feed FieldDescriptor.cardinality_estimate).
  cardinalityEstimate: Record<string, number>;
  // Mean string length per text field; used for the "embeddable" mark.
  meanLength: Record<string, number>;
};

export type JsType =
  | "string"
  | "number"
  | "boolean"
  | "Date"
  | "string[]"
  | "number[]"
  | "unknown";

export function inferShape(input: InferenceInput): InferenceOutput {
  const { samples } = input;
  const total = samples.length;

  const presenceCount = new Map<string, number>();
  const valuesByField = new Map<string, unknown[]>();

  for (const doc of samples) {
    if (!isRecord(doc)) continue;
    for (const [field, value] of Object.entries(doc)) {
      presenceCount.set(field, (presenceCount.get(field) ?? 0) + 1);
      const bucket = valuesByField.get(field) ?? [];
      bucket.push(value);
      valuesByField.set(field, bucket);
    }
  }

  const presence: Record<string, number> = {};
  const jsTypes: Record<string, JsType> = {};
  const cardinalityEstimate: Record<string, number> = {};
  const meanLength: Record<string, number> = {};
  const fields: Record<string, FieldDescriptor> = {};

  for (const [field, count] of presenceCount.entries()) {
    const values = valuesByField.get(field) ?? [];
    const p = total === 0 ? 0 : count / total;
    presence[field] = round4(p);

    const t = inferJsType(values);
    jsTypes[field] = t;

    const card = uniqueCount(values);
    cardinalityEstimate[field] = card;

    const meanLen = meanStringLength(values);
    meanLength[field] = round2(meanLen);

    const role = classifyRole({ field, t, values, cardinality: card, total });
    const indexableAs = pickIndexableAs(role);
    const embeddable = role === "text" && meanLen > 200;

    const desc: FieldDescriptor = {
      role,
      presence: round4(p),
    };
    if (Number.isFinite(card)) {
      desc.cardinality_estimate = card;
    }
    if (embeddable) {
      desc.embeddable = true;
    }
    if (indexableAs.length > 0) {
      desc.indexable_as = indexableAs;
    }
    fields[field] = desc;
  }

  // Polymorphism detection. We look for a low-cardinality string field
  // whose values strongly correlate with the *presence* of other fields.
  // Common name hints: kind, type, _t.
  const polymorphicVariants = detectPolymorphism({
    samples,
    presenceCount,
    valuesByField,
    total,
  });

  const descriptor: MountDescriptor = {
    kind: classifyMountKind(fields),
    cardinality: { rows: total },
    fields,
    affordances: ["findExact", "search", "findSimilar", "hybrid"],
    polymorphic_variants: polymorphicVariants,
  };

  return {
    descriptor,
    presence,
    jsTypes,
    cardinalityEstimate,
    meanLength,
  };
}

// Deterministic sha256 fingerprint over the canonical (sorted) descriptor.
// Excludes presence numbers (which jitter sample-to-sample) and locks on
// the shape: field names, roles, polymorphism, kind.
export function fingerprintDescriptor(descriptor: MountDescriptor): string {
  const canonical = {
    kind: descriptor.kind,
    fields: sortRecord(
      Object.fromEntries(
        Object.entries(descriptor.fields).map(([k, f]) => [
          k,
          {
            role: f.role,
            // bucket presence at 0.05 to avoid jitter
            presence_bucket: Math.round((f.presence ?? 0) * 20),
            indexable_as: [...(f.indexable_as ?? [])].sort(),
          },
        ]),
      ),
    ),
    polymorphism: descriptor.polymorphic_variants
      ? descriptor.polymorphic_variants
          .map((v) => ({
            name: v.name,
            fields: Object.keys(v.fields).sort(),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : null,
  };
  const json = JSON.stringify(canonical);
  return "sha256:" + createHash("sha256").update(json).digest("hex");
}

// --- Heuristics -------------------------------------------------------------

function inferJsType(values: unknown[]): JsType {
  let kind: JsType | null = null;

  for (const v of values) {
    if (v === null || v === undefined) continue;
    const k = jsTypeOf(v);
    if (kind === null) {
      kind = k;
    } else if (kind !== k) {
      return "unknown";
    }
  }
  return kind ?? "unknown";
}

function jsTypeOf(v: unknown): JsType {
  if (typeof v === "string") {
    // ISO-ish date detection — keep cautious; only when it round-trips.
    if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) {
      return "Date";
    }
    return "string";
  }
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (v instanceof Date) return "Date";
  if (Array.isArray(v)) {
    if (v.length === 0) return "unknown";
    const inner = jsTypeOf(v[0]);
    if (inner === "string") return "string[]";
    if (inner === "number") return "number[]";
    return "unknown";
  }
  return "unknown";
}

type RoleArgs = {
  field: string;
  t: JsType;
  values: unknown[];
  cardinality: number;
  total: number;
};

function classifyRole(args: RoleArgs): FieldRole {
  const { field, t, values, cardinality, total } = args;
  const lowerName = field.toLowerCase();

  // ID heuristic: name hints + high cardinality strings.
  if (
    t === "string" &&
    cardinality / Math.max(1, total) > 0.9 &&
    (lowerName === "_id" ||
      lowerName === "id" ||
      lowerName === "uuid" ||
      lowerName.endsWith("id"))
  ) {
    return "id";
  }

  // Embedding heuristic: long numeric arrays.
  if (t === "number[]") {
    const sample = values.find((v) => Array.isArray(v) && v.length > 0) as
      | unknown[]
      | undefined;
    if (sample && sample.length > 64) {
      return "embedding";
    }
  }

  if (t === "Date") return "timestamp";
  if (t === "number") return "number";

  if (t === "string") {
    const meanLen = meanStringLength(values);
    if (meanLen > 80) {
      return "text";
    }
    // Low-cardinality strings → label.
    if (cardinality > 0 && cardinality <= Math.max(20, total * 0.05)) {
      return "label";
    }
    // Mid-cardinality short strings → text (e.g., "question").
    return "text";
  }

  return "blob";
}

function pickIndexableAs(role: FieldRole): IndexableAs[] {
  switch (role) {
    case "id":
    case "fk":
      return ["exact"];
    case "text":
      return ["lex"];
    case "embedding":
      return ["vec"];
    case "label":
      return ["exact"];
    default:
      return [];
  }
}

function classifyMountKind(fields: Record<string, FieldDescriptor>): MountKind {
  const roles = Object.values(fields).map((f) => f.role);
  if (roles.includes("embedding")) return "vectors";
  if (roles.includes("timestamp")) return "timeseries";
  // Default: documents. The MVP only ever bootstraps `documents`-shaped
  // collections from FinQA-on-Atlas; other kinds are post-MVP.
  return "documents";
}

// --- Polymorphism -----------------------------------------------------------

type PolyArgs = {
  samples: unknown[];
  presenceCount: Map<string, number>;
  valuesByField: Map<string, unknown[]>;
  total: number;
};

function detectPolymorphism(args: PolyArgs): PolymorphicVariant[] | null {
  const { samples, valuesByField, total } = args;
  if (total === 0) return null;

  const HINT_NAMES = new Set(["kind", "type", "_t", "category", "variant"]);
  // Look for a low-cardinality discriminator candidate.
  const candidates: Array<{ field: string; values: string[] }> = [];
  for (const [field, values] of valuesByField.entries()) {
    if (!HINT_NAMES.has(field.toLowerCase())) continue;
    const stringValues = values.filter((v): v is string => typeof v === "string");
    if (stringValues.length < total * 0.8) continue;
    const unique = Array.from(new Set(stringValues));
    if (unique.length === 0 || unique.length > 20) continue;
    candidates.push({ field, values: unique });
  }

  if (candidates.length === 0) return null;

  // Pick the first candidate (deterministic on insertion order).
  const candidate = candidates[0];

  // For each variant value, what fields are present in those documents?
  const variants: PolymorphicVariant[] = [];
  for (const variant of candidate.values) {
    const matching = samples.filter(
      (doc) =>
        isRecord(doc) &&
        (doc as Record<string, unknown>)[candidate.field] === variant,
    );
    if (matching.length === 0) continue;
    const fieldStats = new Map<string, number>();
    for (const doc of matching) {
      if (!isRecord(doc)) continue;
      for (const f of Object.keys(doc)) {
        fieldStats.set(f, (fieldStats.get(f) ?? 0) + 1);
      }
    }
    const fieldsForVariant: Record<string, FieldDescriptor> = {};
    for (const [f, count] of fieldStats.entries()) {
      const p = count / matching.length;
      // Only include fields present > 0.5 in this variant; otherwise it's noise.
      if (p < 0.5) continue;
      fieldsForVariant[f] = {
        role: "blob", // role detail per variant not computed in MVP
        presence: round4(p),
      };
    }
    variants.push({
      name: variant,
      presence: round4(matching.length / total),
      fields: fieldsForVariant,
    });
  }

  return variants.length >= 2 ? variants : null;
}

// --- Tiny helpers -----------------------------------------------------------

function uniqueCount(values: unknown[]): number {
  // Non-primitive values are summarised by JSON; cheap, OK for sample sizes.
  const set = new Set<string>();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") {
      try {
        set.add(JSON.stringify(v));
      } catch {
        set.add("[unserialisable]");
      }
    } else {
      set.add(String(v));
    }
  }
  return set.size;
}

function meanStringLength(values: unknown[]): number {
  let total = 0;
  let count = 0;
  for (const v of values) {
    if (typeof v === "string") {
      total += v.length;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(record).sort()) {
    out[k] = record[k];
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
