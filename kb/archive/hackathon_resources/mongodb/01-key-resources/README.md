---
title: "Key Resources (including sample data) to get you started"
captured: 2026-05-01
---

# Key Resources

Foundational MongoDB documentation an agent should consult before writing schema, queries, or search/vector indexes for the hackathon. This folder is the "first stop" reference layer: sample data to load, mental model for schema design, command-line tooling, the aggregation primitive, and the search and vector-search overviews. Reach for files here when you need authoritative source-derived context. For runnable getting-started flows, see `02-quickstarts/`. For end-to-end example apps, see `03-code-samples/`.

## Resources

| # | Resource | What it gives you | File |
|---|----------|-------------------|------|
| 1 | Sample Mflix Dataset | Movies/theaters/users/comments dataset with pre-computed OpenAI 1536d and Voyage 2048d plot embeddings, geo and text indexes ready to use | [sample-mflix.md](./sample-mflix.md) |
| 2 | Data Modeling | Embed-vs-reference guidance, polymorphic schema rules, document-vs-relational tradeoffs | [data-modeling.md](./data-modeling.md) |
| 3 | MongoDB Tools | Index of `mongosh`, Compass, Atlas CLI, Database Tools, `mongosync`, Relational Migrator, VS Code extension, Terraform and k8s integrations | [mongodb-tools.md](./mongodb-tools.md) |
| 4 | Aggregations | Pipeline mechanics (`$match`, `$group`, `$sort`, `$limit`, `$lookup`, `$merge`, `$out`), worked PDX-airlines example, single-purpose methods | [aggregations.md](./aggregations.md) |
| 5 | Atlas Search | `$search` and `$searchMeta` stages, static vs dynamic field mappings, analyzers, autocomplete, faceting, scoring | [atlas-search.md](./atlas-search.md) |
| 6 | Atlas Vector Search | Marketing/positioning page for vector search; pitch material and customer cases. Click through to docs for syntax | [atlas-vector-search.md](./atlas-vector-search.md) |
| 7 | AI Learning Hub | Curated tracks of MongoDB AI content (RAG notebook, eval video, embedding-model selection, agent memory primer) | [ai-learning-hub.md](./ai-learning-hub.md) |
