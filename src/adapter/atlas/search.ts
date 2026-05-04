// Atlas Search helpers for AtlasMountAdapter.collection<T>().
//
// Ports the compound-query shape from the prototype's
// `src/datafetch/db/finqa_search.ts` into an adapter-generic form: the
// boost weights come from probing the descriptor's field roles
// (high-cardinality short text → "title-like", role:"text" → body, etc.)
// rather than hardcoded FinQA paths. If no descriptor is supplied the
// helpers fall back to a single dynamic-field text query so a fresh mount
// still works before bootstrap completes.
//
// Atlas Search idiom borrowed from the prototype:
//   should = [
//     {text: {query, path: <title-like>, score: {boost: 8}}},
//     {text: {query, path: <id-like>,    score: {boost: 4}}},
//     {text: {query, path: <text-body>,  score: {boost: 3}}},
//     {text: {query, path: <table-like>, score: {boost: 2}}},
//   ]
//
// We pick paths by field role; the prototype's question×8 / filename×4 /
// surroundingText×3 / table×2 boosting is the FinQA-shaped instance of
// this generic recipe.

import type { Collection, Document, Filter } from "mongodb";
import type { FieldRole, MountDescriptor } from "../../sdk/index.js";

export type SearchPaths = {
  title: string[]; // boost 8: short, high-cardinality, query-bearing fields
  id: string[]; // boost 4: id-like fields (filename, slug)
  body: string[]; // boost 3: long-form text content
  table: string[]; // boost 2: structured fields (label, fk, table-shaped blobs)
};

// Boost weights used when emitting Atlas Search compound queries. The values
// come from the FinQA prototype's hand-tuned weights and are reused unchanged
// because the role-based path selection above already substitutes for the
// FinQA-specific paths.
const BOOST_TITLE = 8;
const BOOST_ID = 4;
const BOOST_BODY = 3;
const BOOST_TABLE = 2;

// Pick search paths from a descriptor's field roles + cardinality. The output
// is purely role-driven, so the adapter contains no FinQA shape knowledge.
export function pickSearchPathsFromDescriptor(
  descriptor: MountDescriptor | null,
): SearchPaths {
  if (!descriptor) {
    return { title: [], id: [], body: [], table: [] };
  }

  const title: string[] = [];
  const id: string[] = [];
  const body: string[] = [];
  const table: string[] = [];

  const entries = Object.entries(descriptor.fields);

  // Heuristic: short-but-useful text fields with moderate cardinality (e.g.,
  // "question", "title", "headline") get the title boost. We pick text fields
  // whose cardinality_estimate is high enough to be discriminative
  // (>= ~50 distinct values across the sample) but not embedding-shaped.
  for (const [name, f] of entries) {
    const role: FieldRole = f.role;
    if (role === "text") {
      const card = f.cardinality_estimate ?? Number.POSITIVE_INFINITY;
      // Heuristic split: low-medium cardinality short text → title; high
      // cardinality long-form → body. Both go in the should clauses.
      if (card >= 50 && card <= 50_000) {
        title.push(name);
      } else {
        body.push(name);
      }
    } else if (role === "id" || role === "fk") {
      id.push(name);
    } else if (role === "label" || role === "blob") {
      table.push(name);
    }
  }

  // If all text fell into "body", promote the first one to "title" so the
  // boost ladder still has a top rung.
  if (title.length === 0 && body.length > 0) {
    const promoted = body.shift();
    if (promoted) {
      title.push(promoted);
    }
  }

  return { title, id, body, table };
}

// Find the first existing Atlas Search index on a collection, if any.
// Returns the index name or null.
export async function detectSearchIndex(
  collection: Collection<Document>,
): Promise<string | null> {
  try {
    const indexes = (await collection
      .listSearchIndexes()
      .toArray()) as Array<Record<string, unknown>>;
    if (indexes.length === 0) {
      return null;
    }
    const ready = indexes.find(
      (i) => i.queryable === true || i.status === "READY",
    );
    const pick = ready ?? indexes[0];
    return typeof pick.name === "string" ? pick.name : null;
  } catch {
    // Atlas Search may be unavailable on free clusters or self-hosted Mongo.
    return null;
  }
}

export type CompoundSearchOpts = {
  query: string;
  paths: SearchPaths;
  limit: number;
  indexName: string;
  // When true, keep `_id` on the projected docs so the caller can rename
  // it to `_mongoId`. Default false (strip-by-default; matches the
  // existing FinQA behaviour).
  preserveId?: boolean;
};

// Build the $search compound block. Mirrors the structure of
// finqa_search.ts's `caseSearchCompound` but without the FinQA path names.
function buildCompound(opts: CompoundSearchOpts): Document {
  const should: Document[] = [];

  if (opts.paths.title.length > 0) {
    should.push({
      text: {
        query: opts.query,
        path: opts.paths.title.length === 1 ? opts.paths.title[0] : opts.paths.title,
        score: { boost: { value: BOOST_TITLE } },
      },
    });
  }
  if (opts.paths.id.length > 0) {
    should.push({
      text: {
        query: opts.query,
        path: opts.paths.id.length === 1 ? opts.paths.id[0] : opts.paths.id,
        score: { boost: { value: BOOST_ID } },
      },
    });
  }
  if (opts.paths.body.length > 0) {
    should.push({
      text: {
        query: opts.query,
        path: opts.paths.body.length === 1 ? opts.paths.body[0] : opts.paths.body,
        score: { boost: { value: BOOST_BODY } },
      },
    });
  }
  if (opts.paths.table.length > 0) {
    should.push({
      text: {
        query: opts.query,
        path: opts.paths.table.length === 1 ? opts.paths.table[0] : opts.paths.table,
        score: { boost: { value: BOOST_TABLE } },
      },
    });
  }

  return { should, minimumShouldMatch: 1 };
}

// Run a compound $search over the collection. If no index is available, we
// throw — callers are expected to fall back to client-side filtering or to
// `findExact` style queries.
export async function runCompoundSearch<T extends Document>(
  collection: Collection<T>,
  opts: CompoundSearchOpts,
): Promise<T[]> {
  const compound = buildCompound(opts);
  const pipeline: Document[] = [
    {
      $search: {
        index: opts.indexName,
        compound,
      },
    },
    { $limit: opts.limit },
  ];
  if (!opts.preserveId) {
    // Strip Mongo's internal _id; downstream consumers assume plain JSON.
    pipeline.push({ $project: { _id: 0 } });
  }
  return collection.aggregate<T>(pipeline).toArray();
}

// Lightweight client-side fallback when no Atlas Search index exists. Builds
// a regex-OR over text-typed fields and ranks by token overlap. Slow on
// large collections but keeps the API contract honest during warm-up.
export async function fallbackTextSearch<T extends Document>(
  collection: Collection<T>,
  opts: {
    query: string;
    limit: number;
    textFields: string[];
    preserveId?: boolean;
  },
): Promise<T[]> {
  if (opts.textFields.length === 0) {
    return [];
  }
  const tokens = tokenize(opts.query);
  if (tokens.length === 0) {
    return [];
  }
  const orClauses = opts.textFields.flatMap((field) =>
    tokens.map((tok) => ({
      [field]: { $regex: escapeRegex(tok), $options: "i" },
    })),
  );
  const projection = opts.preserveId ? {} : { _id: 0 };
  const docs = (await collection
    .find({ $or: orClauses } as Filter<T>)
    .project(projection)
    .limit(opts.limit * 4)
    .toArray()) as T[];

  const scored = docs.map((doc) => ({ doc, score: scoreDoc(doc, tokens, opts.textFields) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit).map((s) => s.doc);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreDoc(doc: Document, tokens: string[], fields: string[]): number {
  let score = 0;
  for (const field of fields) {
    const value = (doc as Record<string, unknown>)[field];
    if (typeof value !== "string") continue;
    const lower = value.toLowerCase();
    for (const tok of tokens) {
      if (lower.includes(tok)) score += 1;
    }
  }
  return score;
}
