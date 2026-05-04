// Synthesise the per-collection TypeScript module for /db/<mount>/<coll>.ts.
//
// Per `kb/prd/design.md` §5.1's example:
//
//   // /db/finqa-2024/cases.ts
//   // generated 2026-05-04 from 8281 sampled documents
//   // fingerprint: sha256:c3f1a8…   substrate: atlas
//
//   export interface Case { /* inferred shape, JSDoc presence frequencies */ }
//   export const SCHEMA_VERSION = "sha256:c3f1a8…" as const;
//   export const cases: CollectionHandle<Case>;
//
// Notes:
//   - We do NOT emit a real `import type { CollectionHandle } from "..."`
//     because the synthesised file lives outside `src/` (under
//     `<baseDir>/mounts/<mountId>/`) and resolving the path at typecheck
//     time is fragile. We document the shape inline as a header comment;
//     the runtime binds the typed handle when the snippet runtime imports
//     the module via the sandboxed `npx tsx`.
//   - The `<coll>` constant is `declare const`; the actual handle is bound
//     at runtime by the SDK runtime when the synthesised module is loaded.
//   - Per design.md §7.3 budgets: target 400 tokens for single-shape;
//     ceiling 1000. We keep the emitted file lean.

import type { MountDescriptor, PolymorphicVariant } from "../sdk/index.js";
import type { InferenceOutput, JsType } from "./infer.js";
import { toIdent } from "./idents.js";

// Re-export so existing callers (and Wave 3's snippet runtime) can import
// the helper from the synthesizer module too. The canonical home is
// `./idents.ts` — both modules MUST use the same rule.
export { toIdent } from "./idents.js";

export type SynthesizeArgs = {
  mountId: string;
  collectionName: string;
  inference: InferenceOutput;
  fingerprint: string;
  substrate: string; // e.g. "atlas"
  sampleSize: number;
};

export type SynthesizedModule = {
  filename: string; // "<coll>.ts"
  source: string;
  interfaceName: string;
};

const REQUIRED_PRESENCE = 0.95;

export function synthesizeCollectionModule(
  args: SynthesizeArgs,
): SynthesizedModule {
  const { collectionName, inference, fingerprint, substrate, sampleSize } = args;
  const interfaceName = capitalise(toIdent(collectionName));
  const lines: string[] = [];

  // --- Header --------------------------------------------------------------
  const generatedAt = new Date().toISOString();
  lines.push(`// /db/${args.mountId}/${collectionName}.ts`);
  lines.push(
    `// generated ${generatedAt} from ${sampleSize} sampled documents`,
  );
  lines.push(`// fingerprint: ${fingerprint}   substrate: ${substrate}`);
  lines.push("//");
  lines.push("// This module is synthesised by the datafetch bootstrap pipeline.");
  lines.push("// Do not edit by hand; regenerate via publishMount().");
  lines.push("//");
  lines.push("// The runtime binds `CollectionHandle<T>` to the exported `declare const`");
  lines.push("// at module-import time inside the snippet runtime. The four-method shape:");
  lines.push("//   findExact(filter, limit?): Promise<T[]>");
  lines.push("//   search(query, opts?):       Promise<T[]>");
  lines.push("//   findSimilar(query, limit?): Promise<T[]>");
  lines.push("//   hybrid(query, opts?):       Promise<T[]>");
  lines.push("");

  // --- Interface ----------------------------------------------------------
  if (
    inference.descriptor.polymorphic_variants &&
    inference.descriptor.polymorphic_variants.length >= 2
  ) {
    emitPolymorphicInterface(lines, interfaceName, inference);
  } else {
    emitSingleShapeInterface(lines, interfaceName, inference);
  }
  lines.push("");

  // --- SCHEMA_VERSION + handle declaration --------------------------------
  lines.push(`export const SCHEMA_VERSION = "${fingerprint}" as const;`);
  lines.push("");
  lines.push("// Bound by the snippet runtime; declared here for typing only.");
  lines.push(
    `export declare const ${toIdent(collectionName)}: {`,
  );
  lines.push(
    `  findExact(filter: Partial<${interfaceName}>, limit?: number): Promise<${interfaceName}[]>;`,
  );
  lines.push(
    `  search(query: string, opts?: { limit?: number }): Promise<${interfaceName}[]>;`,
  );
  lines.push(
    `  findSimilar(query: string, limit?: number): Promise<${interfaceName}[]>;`,
  );
  lines.push(
    `  hybrid(query: string, opts?: { limit?: number }): Promise<${interfaceName}[]>;`,
  );
  lines.push("};");
  lines.push("");

  return {
    filename: `${collectionName}.ts`,
    source: lines.join("\n"),
    interfaceName,
  };
}

function emitSingleShapeInterface(
  lines: string[],
  interfaceName: string,
  inference: InferenceOutput,
): void {
  lines.push(`export interface ${interfaceName} {`);
  for (const [field, descriptor] of sortedEntries(inference.descriptor.fields)) {
    const presence = descriptor.presence;
    const optional = presence < REQUIRED_PRESENCE ? "?" : "";
    const tsType = jsTypeToTs(inference.jsTypes[field] ?? "unknown");
    const cardinality = inference.cardinalityEstimate[field];
    const lenNote = inference.meanLength[field];
    const jsdocBits = [
      `presence: ${presence.toFixed(2)}`,
      `role: ${descriptor.role}`,
      Number.isFinite(cardinality) ? `card: ${cardinality}` : null,
      lenNote && lenNote > 0 ? `~${Math.round(lenNote)} chars` : null,
      descriptor.embeddable ? "embeddable" : null,
    ].filter((x): x is string => Boolean(x));
    lines.push(`  /** ${jsdocBits.join(" · ")} */`);
    lines.push(`  ${quoteIfNeeded(field)}${optional}: ${tsType};`);
  }
  lines.push("}");
}

function emitPolymorphicInterface(
  lines: string[],
  interfaceName: string,
  inference: InferenceOutput,
): void {
  const variants = inference.descriptor.polymorphic_variants ?? [];
  const variantNames: string[] = [];
  for (const variant of variants) {
    const name = `${interfaceName}_${capitalise(toIdent(variant.name))}`;
    variantNames.push(name);
    emitVariantInterface(lines, name, variant);
    lines.push("");
  }
  lines.push(
    `export type ${interfaceName} = ${variantNames.join(" | ")};`,
  );
}

function emitVariantInterface(
  lines: string[],
  name: string,
  variant: PolymorphicVariant,
): void {
  lines.push(`/** Variant: ${variant.name} (presence ${variant.presence.toFixed(2)}) */`);
  lines.push(`export interface ${name} {`);
  for (const [field, fdesc] of sortedEntries(variant.fields)) {
    const optional = fdesc.presence < REQUIRED_PRESENCE ? "?" : "";
    lines.push(`  /** presence: ${fdesc.presence.toFixed(2)} */`);
    lines.push(`  ${quoteIfNeeded(field)}${optional}: unknown;`);
  }
  lines.push("}");
}

// --- Tiny string helpers ----------------------------------------------------

function jsTypeToTs(t: JsType): string {
  switch (t) {
    case "string":
    case "number":
    case "boolean":
    case "Date":
    case "string[]":
    case "number[]":
    case "unknown":
      return t;
  }
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function quoteIfNeeded(field: string): string {
  // Field names that are valid TS identifiers can be unquoted.
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field) ? field : JSON.stringify(field);
}

function sortedEntries<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}
