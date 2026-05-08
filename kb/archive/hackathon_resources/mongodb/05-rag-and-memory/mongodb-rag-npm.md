---
title: "mongodb-rag (npm package)"
source: https://www.npmjs.com/package/mongodb-rag
type: npm-package
captured: 2026-05-01
---

## TL;DR

A Node.js library that wraps MongoDB Atlas Vector Search with batteries-included ingestion, chunking, embedding, and search APIs, plus a CLI that scaffolds a complete Express RAG app in one command.

## Key Takeaways

- Single dependency to add RAG to a Node project: `npm install mongodb-rag dotenv`.
- The CLI does the boring setup: `npx mongodb-rag init` walks through Atlas connection, embedding provider, and dimensions, then writes `.mongodb-rag.json`.
- `npx mongodb-rag create-rag-app my-rag-app` scaffolds a working Express app with ingest, search, and delete routes.
- The `MongoRAG` class exposes two main methods you actually use day to day: `ingestBatch(documents, options)` and `search(query, options)`.
- Supports OpenAI and Ollama as embedding providers out of the box, and includes sliding window, semantic, and recursive chunking strategies.
- Hybrid search via `filter` parameter on `search()` lets you combine vector similarity with metadata filters in one call.

## What's Covered

### Install and Init

```
npm install mongodb-rag dotenv
npx mongodb-rag init
```

The `init` command prompts for connection string, database name, collection name, embedding provider (openai or ollama), API key, model name (for example `text-embedding-3-small`), and dimensions (1536 for that model). It writes a `.mongodb-rag.json` config file. Then `npx mongodb-rag create-index` provisions the Atlas Vector Search index, and `npx mongodb-rag create-env` generates a `.env` from the config.

### Scaffold a Full App

```
npx mongodb-rag create-rag-app my-rag-app
cd my-rag-app && npm install && npm run dev
```

Produces an Express server with REST routes for ingestion, search, and deletion, wired to MongoDB Atlas Vector Search. Useful as a starting point or as a reference implementation.

### Programmatic API

```js
import { MongoRAG } from 'mongodb-rag';

const rag = new MongoRAG({
  mongoUrl: process.env.MONGODB_URI,
  database: 'my_rag_db',
  collection: 'documents',
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER,
    apiKey: process.env.EMBEDDING_API_KEY,
    model: process.env.EMBEDDING_MODEL,
    dimensions: 1536,
  },
});
await rag.connect();

await rag.ingestBatch([
  { id: 'doc1', content: 'MongoDB is a NoSQL database.', metadata: { source: 'docs' } },
]);

const results = await rag.search('How does vector search work?', { maxResults: 3 });
await rag.close();
```

`ingestBatch` handles embedding, chunking, and bulk write with retry. `search` embeds the query, runs vector search, and returns ranked documents.

### Hybrid Search and Multi-Tenant Storage

`search` accepts a `filter` for metadata-constrained vector queries:

```js
await rag.search('AI topics', {
  database: 'my_rag_db',
  collection: 'documents',
  maxResults: 5,
  filter: { 'metadata.source': 'ai' },
});
```

`database` and `collection` can be overridden per call, so a single `MongoRAG` instance can write to multiple namespaces (useful for per-tenant or per-project corpora).

### Vector Index Definition

The library expects a vector index named on a field called `embedding`:

```json
{
  "definition": {
    "fields": [
      { "path": "embedding", "type": "vector", "numDimensions": 1536, "similarity": "cosine" }
    ]
  }
}
```

The `create-index` CLI command creates this for you.

## When to dive into the source

- You are building a Node or TypeScript hackathon project and want RAG running in under 10 minutes.
- You want a CLI-driven scaffold rather than wiring LangChain or LlamaIndex by hand.
- Skip if: you are working in Python (use LlamaIndex or LangChain integrations) or you need fine-grained control over the retrieval pipeline that this library abstracts away.

## Source

- Primary: https://www.npmjs.com/package/mongodb-rag
- Related: https://github.com/mongodb-developer/mongodb-rag
- Related: https://mongodb-developer.github.io/mongodb-rag/
