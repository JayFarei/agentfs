---
title: "MongoDB Search Overview - Atlas"
source: https://www.mongodb.com/docs/atlas/atlas-search/
type: documentation
captured: 2026-05-01
---

## TL;DR

Atlas Search (now called MongoDB Search) is full-text search embedded in the database, exposed through the `$search` and `$searchMeta` aggregation stages. Reach for this when you want relevance ranking, autocomplete, faceting, or fuzzy matching without standing up Elasticsearch.

## Key Takeaways

- Search queries are aggregation pipeline stages: `$search` for results, `$searchMeta` for metadata (counts, facet buckets). Composable with the rest of the pipeline.
- Search indexes are a separate index type from regular MongoDB indexes. They map terms to documents and store positional metadata for relevance scoring.
- Two index field-mapping modes: static (you declare each field and analyzer) or dynamic (auto-index every indexable field, simpler but coarser).
- Built-in operators cover the common needs: `autocomplete`, `text`, `phrase`, `compound`, `range`, `regex`, `wildcard`, plus `facet` collector for grouped result counts.
- Pagination beyond the basics uses `searchSequenceToken` with `searchAfter`/`searchBefore` for in-order page traversal.
- Each result gets a relevance score, customizable via boosting, decaying, or function score expressions to fit a domain.
- Analyzers handle tokenization, normalization (lowercase, stopwords), and stemming. Choice is language- and use-case-specific. Custom analyzers and per-field multi-analyzers are supported.

## What's Covered

### Why a search index is different

A regular MongoDB index helps point queries; a search index supports relevance, partial matching, and analysis. The doc explicitly contrasts these. Search indexes are inverted indexes mapping tokens to documents, with positional metadata enabling phrase queries and proximity scoring.

### Pipeline integration

`$search` returns documents ranked by relevance. `$searchMeta` returns counts and facet aggregations. Either can be followed by standard stages (`$match`, `$project`, `$lookup`, etc.), making it easy to mix relevance search with structured filters or joins.

### Analyzers, tokens, terms

Analyzers transform raw text into tokens through three phases: tokenization (splitting on whitespace/punctuation), normalization (lowercasing, stopword removal), stemming (suffix/prefix/plural reduction). The doc notes language-specific analyzers ship in, and you can build custom analyzers or attach a multi-analyzer to one field for multiple search behaviors.

### Static vs dynamic mappings

Static mappings give per-field control (which analyzer, whether to support autocomplete, etc.) and tend to be smaller and faster. Dynamic mappings auto-index everything indexable, useful for prototypes but heavier and less precise.

### Common use cases

- Search-as-you-type with the `autocomplete` operator (returns results for partial words).
- Faceted search with the `facet` collector (groups results by values or numeric/date ranges).
- Stable pagination via `searchSequenceToken` + `searchAfter`/`searchBefore`.

### Scoring and tuning

Default scoring boosts terms that appear frequently in a document and rarely in the collection (TF-IDF style). You can boost specific fields, decay by recency, or apply a function score to encode business rules.

## When to dive into the source

- You are choosing between dynamic and static mappings for an index.
- You need the operator/collector reference for a specific query (autocomplete, compound, facet).
- You are designing a custom analyzer or wiring a multi-analyzer for autocomplete plus exact match on the same field.
- Skip if: a simple `$text` index plus regex is enough, or you already know which operator you need; jump to the operator reference.

## Source

- Primary: https://www.mongodb.com/docs/atlas/atlas-search/
- Related: https://www.mongodb.com/docs/atlas/atlas-search/tutorial/ (quick start), https://www.mongodb.com/docs/atlas/atlas-search/operators-and-collectors/ (operator reference), https://www.mongodb.com/docs/atlas/atlas-search/analyzers/ (analyzer catalog)
