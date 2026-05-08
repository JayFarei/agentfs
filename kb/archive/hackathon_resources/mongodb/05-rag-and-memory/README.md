---
title: "RAG and Memory: Resources to help you build and optimize RAG applications"
captured: 2026-05-01
---

# RAG and Memory

Four resources covering the full RAG lifecycle on MongoDB Atlas Vector Search, from picking an embedding model to packaging a working app. The recommended path is: start by choosing an embedding model that fits your data and budget, then build a baseline pipeline (Python via LlamaIndex, or Node via the mongodb-rag npm package), then add evaluation so you can measure changes instead of guessing. For hackathon speed, the npm package gets you to a running app in one command; for production thinking, the LlamaIndex tutorial and the eval guide matter more.

## Resources

| # | Resource | What it gives you | File |
|---|----------|-------------------|------|
| 1 | Choose an Embedding Model | Decision framework for picking among Voyage, OpenAI, and open-source embeddings, with dimension and cost tradeoffs | [choose-embedding-model](./choose-embedding-model.md) |
| 2 | RAG with the POLM Stack (LlamaIndex) | End-to-end Python RAG pipeline using LlamaIndex, OpenAI, and MongoDB Atlas Vector Search | [llamaindex-rag](./llamaindex-rag.md) |
| 3 | Evaluate Your RAG Application | Ragas-based evaluation with context precision, context recall, faithfulness, and answer relevance | [evaluate-rag](./evaluate-rag.md) |
| 4 | mongodb-rag (npm) | Node library and CLI that scaffolds a full RAG app and exposes ingest and search APIs in a few lines | [mongodb-rag-npm](./mongodb-rag-npm.md) |
