---
title: "How to Choose the Right Embedding Model for Your RAG Application"
source: https://www.mongodb.com/developer/products/atlas/choose-embedding-model-rag/
type: tutorial
captured: 2026-05-01
---

## TL;DR

Practical guide to picking an embedding model for a MongoDB Vector Search RAG pipeline, weighing retrieval quality, dimension count, cost, latency, context length, and language coverage.

## Key Takeaways

- The embedding model is the highest-leverage choice in a RAG pipeline because it determines what "similar" means and what the retriever can ever surface.
- MTEB leaderboard scores are a starting signal, not the answer; domain-specific evaluation on your own corpus matters more than generic benchmark wins.
- Higher dimensions improve recall but increase index size, query cost, and latency in MongoDB Vector Search.
- Voyage AI models (voyage-3, voyage-3-lite, voyage-large-2) are MongoDB's recommended option and are accessible through Atlas with strong out-of-the-box quality.
- OpenAI text-embedding-3-small (1536 dims) and text-embedding-3-large (3072 dims) are common defaults for general-purpose English RAG.
- Open-source options like nomic-embed-text and bge-large keep data in your environment and run locally via Ollama or Hugging Face.

## What's Covered

### Selection Criteria

The article frames model choice around six axes you should evaluate against your data: retrieval quality on your domain, embedding dimensionality, max input token length, multilingual support, inference cost (per million tokens or self-hosted compute), and licensing. Test candidates on a labeled subset of your corpus rather than trusting leaderboards alone.

### Dimension Tradeoffs in MongoDB Vector Search

Vector dimensionality directly affects Atlas Vector Search index size, query latency, and storage cost. Smaller models (384 to 768 dims) are cheaper and faster; larger models (1536 to 3072 dims) capture more nuance. Atlas supports common dimension counts via `numDimensions` in the vector index definition with `similarity` set to `cosine`, `dotProduct`, or `euclidean`.

### Recommended Models

- Voyage AI: voyage-3 (1024 dims, general purpose), voyage-3-lite (512 dims, cost-optimized), voyage-large-2-instruct (1024 dims, instruction-tuned), voyage-code-2 (code retrieval).
- OpenAI: text-embedding-3-small (1536 dims) and text-embedding-3-large (3072 dims, supports Matryoshka truncation).
- Open source via Hugging Face or Ollama: nomic-embed-text-v1.5, bge-large-en-v1.5, all-MiniLM-L6-v2 for cheap local embedding.

### Evaluation Workflow

Build a small ground-truth set (queries paired with the documents that should be retrieved). Embed your corpus with each candidate model, run vector search, and measure retrieval metrics like recall@k and MRR. Pick the model that wins on your data, not someone else's benchmark.

### Cost and Operational Considerations

Hosted APIs (Voyage, OpenAI, Cohere) trade per-token cost for zero infrastructure. Self-hosted models trade infrastructure work for predictable cost and data locality. Reranking models (such as voyage-rerank-1) can boost quality without re-embedding the whole corpus.

## When to dive into the source

- You are committing to a specific embedding model for a production corpus and want the full decision framework.
- You need the side-by-side comparison of Voyage, OpenAI, and open-source options with concrete numbers.
- Skip if: you are prototyping a hackathon demo and just need something that works; pick text-embedding-3-small or voyage-3-lite and move on.

## Source

- Primary: https://www.mongodb.com/developer/products/atlas/choose-embedding-model-rag/
- Related: https://docs.voyageai.com/docs/introduction
- Related: https://www.mongodb.com/docs/vector-search/
