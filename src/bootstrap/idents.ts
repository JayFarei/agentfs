// Identifier helpers shared by the synthesizer (emits the typed module's
// exported `declare const <ident>`) and the snippet runtime (binds
// `df.db.<ident>` back to the substrate's collection name).
//
// Both layers MUST use the same rule, otherwise a snippet that calls
// `df.db.finqaCases.findExact(...)` in TypeScript wouldn't resolve to the
// Mongo collection `finqa_cases`.
//
// Rule (canonical): substrate-collection-name → TypeScript identifier
//   - non-alphanumeric runs collapse to `_` (so `finqa-cases` and
//     `finqa.cases` both behave like `finqa_cases`).
//   - subsequent characters after `_` upper-case; the `_` is dropped
//     (snake_case → camelCase).
//   - leading `_`s are stripped.
//   - if the result is empty, fall back to `"item"`.
//   - if the result starts with a digit, prefix `_` to make a valid TS
//     identifier (e.g. `2024_revenue` → `_2024Revenue`).

export function toIdent(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase())
    .replace(/^_+/, "");
  if (cleaned.length === 0) return "item";
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

// A {ident, name} pair: the TypeScript identifier the synthesised module
// exports + the underlying substrate collection name. The bootstrap writes
// one record per collection into the on-disk inventory; the snippet
// runtime reads it back to bind `df.db.<ident>` → `adapter.collection(name)`.
export type CollectionIdent = {
  ident: string;
  name: string;
};

// Build the ident map from a list of substrate collection names. Stable
// over input ordering so the same set of collections always produces the
// same map, regardless of how `probe()` ordered them.
export function buildIdentMap(names: readonly string[]): CollectionIdent[] {
  const seen = new Map<string, string>(); // ident → original name
  const out: CollectionIdent[] = [];
  for (const name of names) {
    let ident = toIdent(name);
    // Disambiguate collisions (e.g. `foo_bar` and `foo-bar` both yield
    // `fooBar`). Append a numeric suffix to the second occurrence onward.
    if (seen.has(ident) && seen.get(ident) !== name) {
      let n = 2;
      while (seen.has(`${ident}${n}`)) n += 1;
      ident = `${ident}${n}`;
    }
    seen.set(ident, name);
    out.push({ ident, name });
  }
  return out;
}
