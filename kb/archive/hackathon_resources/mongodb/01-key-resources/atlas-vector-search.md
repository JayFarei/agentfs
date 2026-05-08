---
title: "MongoDB Vector Search"
source: https://www.mongodb.com/products/platform/atlas-vector-search
type: documentation
captured: 2026-05-01
---

## TL;DR

This is the marketing/positioning landing page for MongoDB Vector Search. It pitches the value (vectors live with operational data, no sync tax, hybrid search in one query) and lists customer logos. For technical depth, the Atlas Vector Search docs are the right next click.

## Key Takeaways

- Positioning page, not a technical reference. Useful for a project pitch, executive summary, or stakeholder deck. Light on syntax, heavy on use cases and case studies.
- Core value prop: vectors stored alongside operational data in Atlas, eliminating the sync between an OLTP store and a separate vector DB.
- "Automated Embedding" is mentioned as handling the indexing process end-to-end (embedding generation through index population). Details live in the docs, not on this page.
- Hybrid query story: combine vector queries with metadata filters, graph lookups (`$graphLookup`), aggregation stages, geospatial search, and lexical (Atlas Search) queries in one pipeline.
- Architectural claim: vector search scales independently from the core database, allowing workload isolation. Search Nodes are the underlying mechanism (referenced in customer quotes).
- News callouts on the page: Flat Indexes for multitenant vector search (improved efficiency), and Search/Vector Search now in public preview for Community Edition.
- Customer cases cited: Novo Nordisk (clinical reports in 10 minutes), Okta (30 percent lower costs on Inbox), Delivery Hero (recommendations), Kovai (knowledge-base Q&A), VISO TRUST (cyber risk).

## What's Covered

### Why a unified store

The page argues that keeping embeddings next to source documents avoids the synchronization tax (drift, dual-write complexity, multi-system failure modes). One database, one query plane, one auth and HA model.

### Hybrid retrieval framing

The page claims you can compose vector similarity, metadata filters, joins via `$lookup`/`$graphLookup`, geospatial queries, and lexical Atlas Search inside a single pipeline. Concrete syntax is not shown here; the docs link is where to look.

### Independent scaling

Vector search workloads run on Search Nodes that scale separately from operational nodes. Mentioned in the VISO TRUST quote as deploying "with a few button clicks" and matching memory requirements to the existing Search Node deployment.

### What is missing on this page

No index syntax, no `$vectorSearch` example, no embedding model recommendations, no dimensionality guidance, no quantization or filter syntax. Treat this as the "why" and click through to the docs for the "how".

## When to dive into the source

- You need a pitch or case-study reference for a stakeholder deck.
- You want to confirm the public-preview status of vector search on Community Edition.
- You want a customer logo to cite for a specific use case (RAG, recommendations, semantic search).
- Skip if: you are writing code. Go directly to the Atlas Vector Search docs at docs.mongodb.com for `$vectorSearch` syntax, index creation, and embedding model guidance.

## Source

- Primary: https://www.mongodb.com/products/platform/atlas-vector-search
- Related: https://www.mongodb.com/docs/atlas/atlas-vector-search/ (technical docs), https://www.mongodb.com/docs/atlas/atlas-vector-search/tutorials/vector-search-quick-start/ (quick start with code), https://www.mongodb.com/company/blog/product-release-announcements/improved-multitenancy-support-in-vector-search-introducing-flat-indexes (Flat Indexes blog)
