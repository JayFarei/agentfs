---
title: "Add Memory to a JavaScript RAG Application with MongoDB and LangChain"
source: https://www.mongodb.com/developer/products/atlas/add-memory-to-javascript-rag-application-mongodb-langchain/
type: tutorial
captured: 2026-05-01
---

## TL;DR

JavaScript companion to the Python memory and cache tutorial, showing how to run a `$vectorSearch` aggregation against `sample_mflix.embedded_movies` from the Node.js driver and outlining the patterns used to bolt LangChain conversation memory onto a Node RAG app via `MongoDBChatMessageHistory`.

## Key Takeaways

- Demonstrates the canonical Node.js `$vectorSearch` aggregation: the `index`, `path`, `queryVector` (passed as `Binary.fromFloat32Array`), `numCandidates`, and `limit` parameters, followed by a `$project` that returns `score` via `$meta: 'vectorSearchScore'`.
- Uses Atlas sample data (`sample_mflix.embedded_movies`, `plot_embedding` field) so a hackathon team can reproduce the query without ingesting their own corpus first.
- Shows ANN search defaults: `numCandidates: 150`, `limit: 10`, scores in the 0.91 to 0.93 range for "time travel" semantic queries against movie plots.
- Pairs with the Python memory walkthrough as the JS equivalent for the LangChain integration classes (`MongoDBChatMessageHistory`, `MongoDBAtlasVectorSearch`) exposed by the `@langchain/mongodb` package.
- Connection pattern is the standard `MongoClient`, `db()`, `collection()`, `aggregate()` flow with a `try/finally` to close the client.
- Embeddings must be supplied as a `Binary` Float32 array, not a plain JS array, when querying via the driver.

## What's Covered

### 1. Prerequisites and feature compatibility

Requires an Atlas cluster on a version that supports `$vectorSearch`, the Node.js driver, a vector search index built over the embedding field, and the Atlas sample datasets loaded so `sample_mflix.embedded_movies` is available.

### 2. Building the $vectorSearch aggregation

The example pipeline:

```
{ $vectorSearch: {
    index: 'vector_index',
    path: 'plot_embedding',
    queryVector: Binary.fromFloat32Array(Float32Array.from([...])),
    numCandidates: 150,
    limit: 10
}}
```

Followed by a `$project` stage that drops `_id`, keeps `plot` and `title`, and surfaces `score: { $meta: 'vectorSearchScore' }`. Results are streamed by `for await (const doc of result)`.

### 3. Tuning ANN search

`numCandidates` controls how many neighbors HNSW evaluates before returning the top `limit`. Higher values trade latency for recall. The tutorial uses 150 candidates to return 10, a common starting ratio.

### 4. Connecting memory via LangChain

While the page anchors on the raw driver query, it is part of MongoDB's broader memory tutorial track. The same `MongoDBChatMessageHistory` pattern documented in the Python tutorial is exposed in `@langchain/mongodb` for Node, taking a `connectionString`, `databaseName`, `collectionName`, and `sessionId`. Combined with a `MongoDBAtlasVectorSearch` retriever over `embedded_movies`, you get the JS equivalent of the Python history-aware RAG chain.

### 5. Cache hit/miss flow in JS

The JS LangChain integration exposes a semantic cache class that mirrors the Python `MongoDBAtlasSemanticCache`: each LLM call embeds the prompt, runs a vector search against a cache collection, returns the cached completion when similarity clears the threshold, and writes a new entry on miss. Same caveat applies, only the LLM input is cached, so retrieval drift produces misses on otherwise similar user questions.

## When to dive into the source

- You need the exact shape of a Node.js `$vectorSearch` pipeline including the `Binary.fromFloat32Array` query vector encoding.
- You are wiring LangChain memory into a JavaScript or TypeScript hackathon app and want a working query as the foundation.
- You want a minimal reproducible example against Atlas sample data before touching your own embeddings.
- Skip if: you already have a working Node `$vectorSearch` query and only need the conceptual memory and cache patterns, which are spelled out more clearly in the Python tutorial.

## Source

- Primary: https://www.mongodb.com/developer/products/atlas/add-memory-to-javascript-rag-application-mongodb-langchain/
- Related: https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/
- Related: https://www.mongodb.com/docs/atlas/atlas-vector-search/tutorials/
