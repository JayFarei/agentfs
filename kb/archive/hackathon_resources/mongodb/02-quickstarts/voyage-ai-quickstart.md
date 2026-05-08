---
title: "Voyage AI Quickstart Tutorial: Build a RAG Chatbot with Embeddings and Rerankers"
source: https://docs.voyageai.com/docs/quickstart-tutorial
type: tutorial
captured: 2026-05-01
---

## TL;DR

Walks through a complete minimal RAG stack using Voyage AI embeddings, a reranker, and an LLM (Claude or GPT-4o). Reach for it when you need to understand the end-to-end retrieval pipeline before plugging it into Atlas Vector Search.

## Key Takeaways

- The Voyage Python client (`voyageai.Client()`) reads `VOYAGE_API_KEY` from the environment and exposes `embed`, `tokenize`, `count_tokens`, and `rerank`.
- Embeddings use `model="voyage-4-large"` with `input_type="document"` for the corpus and `input_type="query"` for queries, yielding length-normalized vectors so dot product equals cosine similarity.
- For more than 128 documents, batch in groups of 128 to comply with request limits.
- Reranking with `model="rerank-2.5"` and `top_k` re-orders an initial candidate set by semantic relevance, materially improving the final document picked for the prompt.
- The tutorial demonstrates a measurable lift: with retrieved context, both Claude Sonnet 4.5 and GPT-4o answer a date-specific question correctly, without it they hedge.
- For real corpora the tutorial explicitly defers to a vector database such as MongoDB Atlas Vector Search for approximate k-NN at scale.

## What's Covered

### 1. RAG stack overview

A query is embedded, used to retrieve the most relevant documents from a vector store, optionally reranked, and then concatenated with the query as input to a generative model.

### 2. Preparing and embedding documents

Define a list of strings as the corpus, then call `vo.embed(documents, model="voyage-4-large", input_type="document").embeddings`. The tutorial includes a batched variant for corpora larger than 128 items.

### 3. Tokenization helpers

`vo.tokenize(documents)` returns per-document token lists, and `vo.count_tokens(documents)` returns the total. Useful for staying within context-length and per-request token limits.

### 4. Minimalist retrieval

Embed the query with `input_type="query"`, then compute cosine similarity. Because Voyage embeddings are unit-normalized, `np.dot(doc_embds, query_embd)` is sufficient. The tutorial provides a reference `k_nearest_neighbors` function built on `sklearn.metrics.pairwise.cosine_similarity` that returns the top-k indices and embeddings.

### 5. Reranking

```
documents_reranked = vo.rerank(query, documents, model="rerank-2.5", top_k=3)
```

Each result has `document`, `relevance_score`, and `index`. In the example, the correct answer scores ~0.94 while distractors score below 0.29.

### 6. Plugging in an LLM

Build a prompt of the form `f"Based on the information: '{retrieved_doc}', generate a response of {query}"` and pass it to either:

- Anthropic: `claude-sonnet-4-5-20250929` via `anthropic.Anthropic(...).messages.create(...)`.
- OpenAI: `gpt-4o` via `OpenAI(...).chat.completions.create(...)`.

Both correctly return the date when grounded on the retrieved snippet.

## When to dive into the source

- You need the exact reference implementation of `k_nearest_neighbors` to copy into a notebook.
- You want to confirm tokenization and batching limits before sizing a corpus.
- You are deciding whether reranking is worth the extra call for your use case and want to see concrete score deltas.
- Skip if: you have already wired Voyage into Atlas Vector Search and just need API parameters, in which case go to the Voyage API reference and the Atlas Vector Search docs directly.

## Source

- Primary: https://docs.voyageai.com/docs/quickstart-tutorial
- Related: https://www.mongodb.com/products/platform/atlas-vector-search
- Related: https://www.mongodb.com/resources/basics/artificial-intelligence/retrieval-augmented-generation
