---
title: "feat: MongoDB Atlas Search Milestone"
summary: "Use MongoDB Atlas as the FinQA data plane and Atlas Search behind the search-shaped interfaces in the search / execute / observe frame."
type: feat
status: implemented
date: 2026-05-02
related_research:
  - kb/resources/mongodb/README.md
  - kb/resources/mongodb/01-key-resources/atlas-vector-search.md
  - kb/resources/mongodb/02-quickstarts/semantic-search-tutorial.md
  - kb/resources/mongodb/05-rag-and-memory/mongodb-rag-npm.md
  - kb/br/02-mongodb-fit-and-adjacent-projects.md
---

# MongoDB Search Milestone

## Overview

This milestone makes MongoDB Atlas the retrieval substrate, not just the durable
document store. The top-level product frame stays `search / execute / observe`.
Under `search`, the typed `finqa_cases` interfaces stay stable: `findExact`,
`search`, `findSimilar`, and `hybrid` remain the calls the runner knows about,
but the Atlas implementation uses MongoDB Search indexes and aggregation stages
instead of regex or legacy text-search fallbacks.

The demo outcome is simple: the same evolution tests should pass against local
fixtures and against live Atlas, with trajectories showing that MongoDB Search is
the retrieval engine for novel runs.

## Problem Frame

The current app has Atlas connectivity and loaded FinQA data, but the Mongo path
is still too close to "MongoDB as storage." For the adaptive retrieval topic, we
need the live data plane to visibly use MongoDB's search layer:

- `search()` should be `$search` over indexed case and unit text.
- `findSimilar()` should be backed by a search-specific retrieval strategy, first
  lexical Search, then vector search when embeddings are present.
- `hybrid()` remains a durable wrapper. In this milestone it delegates to the
  same Atlas Search-backed unit retrieval as `findSimilar()`; vector and
  `$rankFusion` stay next-slice work.

The reason to keep the previous stubs is architectural: procedures and agents
must compose stable typed primitives. MongoDB implementation details can improve
without changing the agent/user composition surface.

## Requirements Trace

- R1. Atlas setup creates or verifies MongoDB Search indexes for `finqa_cases`
  and `finqa_search_units` without manual Atlas UI steps.
- R2. `createAtlasFinqaCasesPrimitive().search(query)` uses `$search` when the
  configured search index exists, and returns ranked results with numeric
  `score` metadata.
- R3. `findSimilar(query, limit)` uses the search-unit collection as its primary
  retrieval surface, resolves units back to unique `FinqaCase` documents, and
  preserves the existing return type.
- R4. `hybrid(query, opts)` is implemented behind the existing primitive name.
  In this milestone it reuses the Atlas Search-backed retrieval path; embeddings
  and `$rankFusion` are explicit follow-on work, not hidden requirements.
- R5. The local backend remains deterministic and keeps the current tests fast.
- R6. The live Atlas test path proves the three demo families still resolve to
  the expected filing and answer:
  - average payment volume for American Express, answer `127.4`
  - agricultural products revenue share, answer `18.18`
  - negative Visa competitive outlook sentence references, answer `4`
  - negative Visa competitive outlook title/quote references, answer `1`
- R7. Search configuration is observable from the CLI: one command can report
  indexes, document counts, search-unit counts, and whether each Atlas retrieval
  mode is ready.
- R8. Failure mode is explicit. If Atlas Search indexes are absent or still
  building, the CLI should say so and either wait, fall back only when requested,
  or fail with setup instructions.

## Scope Boundaries

- No Next.js UI in this milestone. The output is backend readiness for the app.
- No Durable Object migration. Tenant evolution can remain local `.atlasfs`.
- No procedure-store redesign.
- Broad ingestion of the available FinQA splits is in scope for this milestone,
  because the demo must prove retrieval against non-fixture corpus noise.
- No dependence on a specific LLM provider for basic search. Vector embeddings
  can use an explicit provider adapter, but lexical `$search` must work without
  embeddings.
- No new user-facing primitive names. We can add internal modules, but the agent
  still sees the same `search / execute / observe` framing and the same
  search-shaped `finqa_cases.*` functions.

## Context & Research

- `kb/resources/mongodb/README.md` says the most relevant folders for this
  hackathon are chatbots/agents, RAG/memory, and memory/caching. For this
  milestone, the decisive pieces are Atlas Search, Vector Search, and hybrid
  retrieval.
- `kb/resources/mongodb/01-key-resources/atlas-vector-search.md` frames the key
  MongoDB value proposition: embeddings live next to operational data, so we
  avoid a separate vector database and sync layer.
- `kb/resources/mongodb/02-quickstarts/semantic-search-tutorial.md` is a thin
  capture, but points to the official semantic-search path: create embeddings,
  create a vector index, then query with `$vectorSearch`.
- `kb/resources/mongodb/05-rag-and-memory/mongodb-rag-npm.md` is useful as a
  reference for chunking, embedding, and vector-index defaults, but we should not
  wrap the whole app in that library because our primitive contract is already
  the product.
- Official MongoDB docs confirm that `$search` performs full-text search over
  fields covered by a MongoDB Search index, that static mappings are preferred
  when fields are known, that Node driver `createSearchIndex()` can manage Atlas
  Search and Vector Search indexes, and that `$vectorSearch` performs semantic
  search over vectors stored in Atlas. `$rankFusion` is available only on
  MongoDB 8.0+ and is a preview feature, so it should be optional in this slice.

## Architecture

```text
USER / TEST / NEXT API
        |
        | query
        v
  runQuery()
        |
        | stable primitive call
        v
  finqa_cases.findSimilar()
        |
        | Atlas backend
        v
  +----------------------------+
  | MongoSearchFinqaRetriever  |
  | - exact lookup             |
  | - case text search         |
  | - search-unit search       |
  | - vector search, optional  |
  | - hybrid merge, optional   |
  +-------------+--------------+
                |
                v
         MongoDB Atlas
  +-----------------------------+
  | finqa_cases                 |
  |   Search index: cases_text  |
  |                             |
  | finqa_search_units          |
  |   Search index: units_text  |
  |   Vector index: units_vec   |
  |   (next slice)              |
  +-----------------------------+
```

### Collection Responsibilities

| Collection | Role | Search shape |
|------------|------|--------------|
| `finqa_cases` | Full normalized filing/case record used for exact lookup, procedure execution, table arithmetic, and final evidence | `$search` over `filename`, `question`, `program`, `preText`, `postText`, `table.rows.label`, `table.rows.cells.raw`, `searchableText` |
| `finqa_search_units` | Retrieval units for adaptive search, row/text level recall, and future vector embeddings | `$search` over `text`, `filename`, `kind`, row/cell metadata; `$vectorSearch` over `embedding` when present |

### Primitive Mapping

| Primitive | Local implementation | Atlas implementation after milestone |
|-----------|----------------------|--------------------------------------|
| `findExact(filter, limit)` | Array filter | Normal indexed MongoDB `find` |
| `search(query, opts)` | Deterministic lexical score over cases | `$search` on `finqa_cases` with score projection |
| `findSimilar(query, limit)` | Alias to local lexical search | `$search` on `finqa_search_units`, grouped by case, then hydrate `finqa_cases` |
| `hybrid(query, opts)` | Alias to local lexical search | Reuses the Atlas Search-backed `findSimilar()` retrieval path for now |
| `runRevenueShare()` | Local table compute | MongoDB exact filing load plus same deterministic compute |
| `runAveragePaymentVolumePerTransaction()` | Local table compute | Aggregation over nested table rows |

## Index Design

### `finqa_cases` Search Index

Name: `finqa_cases_text`

Initial static mapping:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "filename": { "type": "string" },
      "question": { "type": "string" },
      "program": { "type": "string" },
      "preText": { "type": "string" },
      "postText": { "type": "string" },
      "searchableText": { "type": "string" },
      "table": {
        "type": "document",
        "dynamic": true
      }
    }
  }
}
```

Rationale: we know the top-level fields, but table shape is semi-structured and
benefits from dynamic indexing inside the `table` document.

### `finqa_search_units` Search Index

Name: `finqa_units_text`

Initial static mapping:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "caseId": { "type": "string" },
      "filename": { "type": "string" },
      "kind": { "type": "string" },
      "text": { "type": "string" },
      "rowIndex": { "type": "number" }
    }
  }
}
```

### `finqa_search_units` Vector Index

Name: `finqa_units_vector`

Add only after embeddings are generated:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1024,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "filename"
    },
    {
      "type": "filter",
      "path": "kind"
    }
  ]
}
```

The exact dimensions must match the embedding model selected in the next slice.
If we use a Voyage model through MongoDB's AI/Voyage path, lock the dimensions in
code and in the index definition together.

## Milestones

1. **Index bootstrap and health command**: Add `src/loader/setupAtlasSearch.ts`
   and a CLI command, likely `pnpm atlasfs setup-search`, that creates or
   verifies `finqa_cases_text` and `finqa_units_text` using the Node driver.
   Add `pnpm atlasfs atlas-status` to print db name, counts, and search-index
   states. *Effort: Quick (< 1h)*

2. **Atlas `$search` for cases**: Replace the Atlas `search()` implementation in
   `finqa_cases.ts` with an aggregation pipeline using `$search`, `compound`,
   field boosts, `$project`, `score: { $meta: "searchScore" }`, and `$limit`.
   Keep the local backend unchanged. *Effort: Short (< 4h)*

3. **Search-unit retrieval for `findSimilar()`**: Query
   `finqa_search_units` with `$search`, group by `caseId`, keep the best unit
   score/evidence, hydrate `finqa_cases`, and return unique cases in ranked
   order. This is the key adaptive retrieval improvement. *Effort: Short (< 4h)*

4. **Strict Atlas evolution tests**: Add a live-test file gated by
   `RUN_ATLAS_TESTS=1`. It should load or verify demo data, setup search, run the
   three core intents in a temporary `ATLASFS_HOME`, and assert answers plus
   trajectory call names. *Effort: Short (< 4h)*

5. **Next: embedding adapter and vector index**: Add an embedding provider boundary,
   `embedText(text): Promise<number[]>`, plus an idempotent backfill for
   `finqa_search_units.embedding`. Create `finqa_units_vector`. Do not change
   `findSimilar()` yet until the lexical tests are stable. *Effort: Medium (< 1d)*

6. **Next: vector-aware hybrid primitive**: Extend `hybrid()` as a typed wrapper
   that returns the same `FinqaCase[]` but internally records component scores.
   Prefer `$rankFusion` if the cluster supports it; otherwise use deterministic
   reciprocal-rank fusion in TypeScript over lexical and vector result sets.
   *Effort: Medium (< 1d)*

7. **Procedure trajectory proof**: Re-run the existing evolution scenarios
   against Atlas with `findSimilar()` and `hybrid()` as the first calls. The proof
   should show MongoDB Search driving retrieval while procedures still replay
   through one intent-interface call. *Effort: Short (< 4h)*

## Files To Modify

| File | Changes |
|------|---------|
| `src/datafetch/db/finqa_cases.ts` | Add Atlas Search pipelines for `search`, `findSimilar`, and later `hybrid` |
| `src/datafetch/db/finqa_search.ts` | New internal module for query builders, index names, and result shaping |
| `src/loader/setupAtlasSearch.ts` | New idempotent index creation and readiness checks |
| `src/loader/loadFinqaToAtlas.ts` | Optionally call setup or report missing search indexes after load |
| `src/cli.ts` | Add `setup-search`, `atlas-status`, and possibly `backfill-embeddings` |
| `src/datafetch/db/embeddings.ts` | Future provider boundary for query/document embeddings |
| `tests/atlas-search-live.test.ts` | New gated live Atlas tests |
| `tests/helpers/evolution.ts` | Reuse existing clean-home assertions for live Atlas tests |
| `README.md` | Add commands for search setup and live Atlas proof |
| `kb/scenario.md` | Update once the live retrieval milestone is proven |

## Verification

1. `pnpm typecheck` passes.
2. `pnpm test` passes with local deterministic tests unchanged.
3. `pnpm atlasfs setup-search` creates or verifies `finqa_cases_text` and
   `finqa_units_text`.
4. `pnpm atlasfs atlas-status` reports:
   - database `atlasfs_hackathon`
   - nonzero `finqa_cases`
   - nonzero `finqa_search_units`
   - both text indexes queryable or ready
5. With `RUN_ATLAS_TESTS=1`, live tests prove:
   - American Express payment-volume query returns `127.4`
   - agricultural revenue-share query returns `18.18`
   - Visa negative-outlook sentence query returns `4`
   - Visa negative-outlook title/quote query returns `1`
6. A manual live query trajectory includes `finqa_cases.findSimilar` backed by
   `$search`, not regex fallback.
7. If the search index is removed or unavailable, the CLI produces a clear
   setup error and does not silently pretend MongoDB Search was used.

## Implementation Result

Completed on 2026-05-02:

- `pnpm atlasfs load-finqa --all --reset` loaded `8474` unique normalized cases
  and `243234` search units into `atlasfs_hackathon`.
- `pnpm atlasfs setup-search --timeout-ms=240000` created and waited for
  `finqa_cases_text` and `finqa_units_text`.
- `pnpm atlasfs atlas-status` reported both indexes `READY` and queryable, with
  `8474` cases and `243236` search units after the gated live test refreshed
  the three demo filings.
- `RUN_ATLAS_TESTS=1 pnpm exec vitest run tests/atlas-search-live.test.ts`
  passed all three live Atlas tests.

One strict-test failure improved the design: full-corpus search initially found
plausible but wrong Visa filings because the resolver discarded Atlas Search
scores. The implemented fix keeps Atlas relevance metadata in `pickFiling()` and
adds target-aware query shaping inside the Atlas Search wrapper.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | Scope | Keep `findExact`, `search`, `findSimilar`, `hybrid` as the external primitive names | Architecture | Stable surface | The product thesis is that implementation evolves behind typed primitives, not that agents learn new API names every time storage improves |
| 2 | Search | Use `finqa_search_units` as the primary retrieval surface for `findSimilar()` | Architecture | Retrieval quality | Adaptive retrieval needs row/text-unit recall, not only whole filing recall |
| 3 | Indexing | Use static top-level mappings with dynamic mapping only under semi-structured table fields | Architecture | Predictability | We know the FinQA schema and should avoid broad dynamic indexing, but tables remain polymorphic enough to justify nested dynamic indexing |
| 4 | Hybrid | Treat `$rankFusion` as optional capability, not a required first slice | Scope | Demo reliability | MongoDB documents it as preview and MongoDB 8.0+ only, so a deterministic TypeScript fallback protects the milestone |
| 5 | Testing | Gate Atlas tests behind `RUN_ATLAS_TESTS=1` | Operations | Repeatability | Local tests must stay fast and deterministic, live Atlas proof should run intentionally |
| 6 | App | Defer Next.js until Atlas Search is proven behind the runner | Scope | Critical path | The app should display a real MongoDB Search-backed loop, not hide another fallback behind UI work |
