---
title: "The Modern Data Architecture Mastery Series, Overview"
source: https://www.mongodb.com/resources/solutions/use-cases/webinar-modern-data-mastery-ai-search
type: documentation
captured: 2026-05-01
---

## TL;DR

A 5-part MongoDB webinar series that walks from "you know SQL, you don't know MongoDB" all the way to "you can shard a global cluster and ship an AI agent on it." Each ~50-60 min, runs as virtual instructor-led training, ends with a Skill Badge check.

## Why the series exists

MongoDB is positioning itself as the agentic-AI database (vector + document + scale in one engine). The series is structured to give a developer everything they need to build a hackathon-grade agent on MongoDB Atlas in one path, instead of stitching together blog posts.

## Track structure

```
W1: Schema fundamentals      ─┐
W2: Vector Search            ─┼─→ W3: RAG  ─→  W4: AI Agents
W5: Sharding (scale concern) ─┘
```

W1 + W5 are foundational MongoDB skills. W2 → W3 → W4 is the AI build path: embeddings → retrieval → autonomous behavior.

## What you'll come out knowing

After all five:

- How to model data without "translating" from relational thinking
- How to set up Atlas Vector Search with the right embedding model + distance metric
- How to wire MongoDB into a RAG pipeline with metadata filtering and context-window management
- How to use MongoDB as the memory + state layer for an AI agent
- How to scale the whole thing horizontally with a sensible shard key

## When to skip what

- Already shipped a MongoDB app? Skip W1.
- Already running a vector index in prod? Skip W2.
- Greenfield hackathon project where you'll never exceed one cluster? Skip W5.
- The valuable middle for the Agentic Evolution Hackathon is **W2 → W3 → W4**.

## Source links

- Series landing page: <https://www.mongodb.com/resources/solutions/use-cases/webinar-modern-data-mastery-ai-search>
- W1 page: <https://www.mongodb.com/resources/products/capabilities/webinar-relational-document-model>
- W2 page: <https://www.mongodb.com/resources/solutions/use-cases/webinar-vector-search-fundamentals>
- W3 page: <https://www.mongodb.com/resources/solutions/use-cases/webinar-rag-with-mongodb>
- W4 page: <https://www.mongodb.com/resources/solutions/use-cases/webinar-ai-agents-with-mongodb>
- W5 page: <https://www.mongodb.com/resources/products/capabilities/webinar-sharding-strategies>
- Skills hub: <https://learn.mongodb.com/skills>
