---
title: "Aggregation Operations - Database Manual"
source: https://www.mongodb.com/docs/manual/aggregation/
type: documentation
captured: 2026-05-01
---

## TL;DR

Reference entry point for MongoDB aggregation pipelines, the multi-stage data-processing primitive used for analytics, transformations, and any query more expressive than a single `find()`. Reach for this when a `find()` is not enough.

## Key Takeaways

- A pipeline is an ordered list of stages. Each stage transforms documents and feeds the next. Stages include `$match` (filter), `$group` (aggregate), `$sort`, `$limit`, plus many more (`$lookup`, `$project`, `$unwind`, `$facet`, etc.).
- Run pipelines via `db.collection.aggregate([...])`. Pipelines are read-only unless they end in `$merge` or `$out`, which write results to a collection.
- You can also update documents using an aggregation pipeline as the update spec (different doc, but worth knowing).
- Single-purpose aggregation methods exist (`estimatedDocumentCount()`, `count()`, `distinct()`) but are limited compared to a pipeline.
- Pipelines run inside the database, so analytics happen without exporting data to another platform.
- Atlas provides a UI builder for pipelines (also surfaced in Compass), useful for iterating stage by stage.

## What's Covered

### Aggregation pipeline mechanics

A pipeline is an array of stages; each stage receives documents from the previous stage and emits documents to the next. Source documents come from a collection, a view, or a synthetic stage. The MongoDB Query Language (MQL) provides expressions used inside stages (`$sum`, `$filter`, `$avg`, etc.).

### Worked example: top airlines from PDX

The doc walks through `sample_training.routes` to find the top three airlines offering nonstop flights from Portland (PDX). The full pipeline:

```javascript
db.routes.aggregate([
  { $match: { src_airport: "PDX", stops: 0 } },
  { $group: { _id: { "airline name": "$airline.name" }, count: { $sum: 1 } } },
  { $sort:  { count: -1 } },
  { $limit: 3 }
])
```

Document counts as the pipeline progresses: `$match` 66,985 to 113, `$group` 113 to 16, `$limit` 16 to 3. Result: Alaska 39, American 17, United 13.

### Read-only by default, write with $merge or $out

`aggregate()` does not mutate input documents. Add `$merge` (incremental upsert into a collection) or `$out` (replace an entire collection) as the final stage when you want results persisted, for example for materialized views.

### Single-purpose methods

Three methods sit alongside the pipeline: `estimatedDocumentCount()` (fast approximate count via collection metadata), `count()` (exact count), `distinct()` (unique values for a field). Use these when a pipeline would be overkill.

### Where to next

The page lists deeper references: full operator catalog, pipeline core concepts, and the runnable examples doc. The Atlas UI's pipeline builder is the easiest way to iterate stage-by-stage.

## When to dive into the source

- You need to know whether a particular operator (`$lookup`, `$facet`, `$setWindowFields`) belongs in your pipeline or you should restructure.
- You want to write results back to a collection and need to choose `$merge` vs `$out`.
- You are deciding whether a single-purpose method is sufficient instead of a full pipeline.
- Skip if: you already know the stage names you need; jump straight to the operator reference.

## Source

- Primary: https://www.mongodb.com/docs/manual/aggregation/
- Related: https://www.mongodb.com/docs/manual/reference/mql/aggregation-stages/ (full stage reference), https://www.mongodb.com/docs/manual/core/aggregation-pipeline/ (concepts and runnable examples), https://www.mongodb.com/docs/atlas/atlas-ui/agg-pipeline/ (UI builder)
