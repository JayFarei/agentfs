---
title: "MAAP Chatbot Builder (MongoDB AI Applications Program Framework)"
source: https://github.com/mongodb-partners/maap-chatbot-builder
type: github-repo
captured: 2026-05-01
---

## TL;DR

A configuration-driven Node.js framework for spinning up RAG chatbots on MongoDB Atlas, where the entire pipeline (data loaders, embedding model, vector store, LLM) is described in a single YAML file. Targets teams that want to swap providers (Cohere, Fireworks, Anthropic, Bedrock, Azure OpenAI, Nomic, etc.) without rewriting code.

## Key Takeaways

- Pipeline is declared in `config.yaml`: ingest sources, chunking, embedding class, vector store, LLM model, system prompt path.
- Supports plug-in data loaders for PDF, web, sitemap, DOCX, and Confluence content out of the box.
- Embedding and LLM classes are selected by `class_name`, mapping to provider-specific implementations (VertexAI, Azure-OpenAI, Cohere, Nomic for embeddings; Fireworks, Anthropic, Bedrock for chat).
- Atlas Vector Search is the fixed retrieval backend, with index name, candidate count, and min-score thresholds set in YAML.
- Includes a separate UI client at `builder/partnerproduct/ui` so the chatbot has a web frontend on `localhost:3000`.
- Two reference demos: an internal enterprise search over insurance policies and a customer-service returns assistant.

## What's Covered

### Configuration model

A single `config.yaml` drives ingest, embedding, vector_store, and llms blocks. Example values from the repo: PDF source with `chunk_size: 2000` and `chunk_overlap: 200`, `embedding.class_name: Nomic-v1.5`, vector_store with `numCandidates: 150`, `minScore: 0.1`, `vectorSearchIndexName: vector_index`, and an llms block selecting `class_name: Fireworks` with `model_name: accounts/fireworks/models/mixtral-8x22b-instruct`. A separate `.env` holds API keys for each partner provider.

### Data loaders

The framework ships pluggable loaders: `WebLoader`, `PdfLoader`, `SitemapLoader`, `DocxLoader`, `ConfluenceLoader`. Each takes source paths and chunking parameters, and they are added to a loaders array in the config. This is what lets non-developers point the chatbot at a new corpus without touching code.

### Embeddings and LLM abstraction

Both embedding models and chat models are instantiated by class name lookup, so the same YAML shape works whether you choose VertexAI, Azure OpenAI, Cohere, or Nomic embeddings, and whether you generate with Fireworks, Anthropic, or Bedrock. Adding a new provider means writing one class, not rewriting the pipeline.

### Vector storage on Atlas

Atlas is the fixed vector backend. The framework writes embeddings into a configured collection and queries them through Atlas Vector Search using the index name in YAML. Re-ranking and filtering hooks exist post-retrieval, in line with the framework's documented "advanced RAG" stages (data loading, chunking, retrieval, re-ranking, query transformation, response synthesis).

### Repo layout and run flow

Work happens under `builder/partnerproduct`. The standard sequence is:

1. `npm install` at the repo root and again in `builder/partnerproduct`.
2. Copy `partnerproduct/example.env` to `.env` and fill in provider keys (Cohere, Fireworks, Anyscale, Bedrock, Azure OpenAI, Anthropic).
3. Edit `config.yaml`.
4. `npm run ingest <path-to-config.yaml>` to load and embed source data into Atlas.
5. `npm run start <path-to-config.yaml>` to run the server.
6. In a second terminal, `cd builder/partnerproduct/ui && npm install && npm run start` for the web UI on `localhost:3000`.

Tested against Node v20+ and Atlas v7.0 on an M10 cluster.

### Partner integrations

Documented partners include AWS, Azure, GCP as cloud providers, and Anthropic, Anyscale, Cohere, Fireworks.AI, LangChain, and Nomic as AI tech partners. Each has its own integration page in the MAAP framework docs site.

## When to dive into the source

- You want a production-shaped RAG chatbot template, not a notebook.
- You are evaluating multiple LLM and embedding providers and need to swap them quickly.
- You need to ingest from mixed sources (PDF, web, Confluence, DOCX) through one pipeline.
- You want a UI client wired up out of the box.
- Skip if: you are prototyping a single-provider chatbot in Python, the YAML and Node setup is overhead you do not need yet.

## Source

- Primary: https://github.com/mongodb-partners/maap-chatbot-builder
- Related: MAAP framework docs at https://mongodb-partners.github.io/maap-framework/, Atlas Vector Search overview, MongoDB AI Applications Program page
