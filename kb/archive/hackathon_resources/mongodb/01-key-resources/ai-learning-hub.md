---
title: "MongoDB AI Resources for Developers"
source: https://www.mongodb.com/resources/use-cases/artificial-intelligence
type: documentation
captured: 2026-05-01
---

## TL;DR

A curated index of MongoDB's AI learning content (videos, tutorials, notebooks, guides) organized into self-paced tracks by skill level. Use it as a syllabus when you want a guided path into building RAG and agent apps on MongoDB.

## Key Takeaways

- Three self-paced tracks segmented by skill (Beginner, Intermediate, and presumably Advanced). The captured page surfaces Beginner and Intermediate items.
- Mixed media: on-demand video, written tutorials, runnable notebooks, conceptual guides. Each item is tagged with skill level and content type.
- Featured beginner notebook: "Build a simple RAG application with MongoDB and OpenAI embeddings" in the `mongodb-developer/GenAI-Showcase` GitHub repo, the canonical starting RAG notebook.
- Featured intermediate items: "Evaluating Your RAG Applications" video (RAG eval methods and metrics), and "How to Choose the Best Embedding Model for Your LLM App" tutorial.
- Beginner conceptual guide: "What Is Agent Memory?", a primer on how memory affects agent recall and learning.
- The page is a hub, the substance lives in the linked resources (YouTube, GitHub notebooks, blog posts).

## What's Covered

### Track structure

Content is grouped by skill level so a developer can pick a starting point. Tags shown on the captured page: Beginner Notebook, Beginner Guide, Intermediate Video, Intermediate Tutorial. The landing page itself is short, more of a curated link directory than a long-form doc.

### Featured beginner content

- Notebook: simple RAG with MongoDB and OpenAI embeddings, hosted at `github.com/mongodb-developer/GenAI-Showcase/blob/main/notebooks/rag/openai_text_3_emebdding.ipynb` (note the typo in the repo path).
- Guide: agent memory primer, useful before designing any agent that needs short-term plus long-term recall.

### Featured intermediate content

- RAG evaluation video on YouTube, covering eval methods and metrics for retrieval-augmented generation workflows.
- Embedding model selection tutorial on the MongoDB blog, covering why embeddings matter for RAG and how to pick a model.

### What is on the page itself

Almost nothing beyond the link tiles. Word count is roughly 145, and most surface area is link cards. The value is the curation, not the prose.

## When to dive into the source

- You are starting a hackathon and want a vetted reading/watching list before writing code.
- You need to onboard a teammate onto MongoDB AI patterns and want a coherent syllabus link to send them.
- You want the canonical "simple RAG" notebook to fork.
- Skip if: you already have a working RAG pipeline and are looking for a specific operator or index syntax. Go to the Atlas Vector Search docs instead.

## Source

- Primary: https://www.mongodb.com/resources/use-cases/artificial-intelligence
- Related: https://github.com/mongodb-developer/GenAI-Showcase (curated notebook repo), https://www.mongodb.com/company/blog/technical/how-choose-best-embedding-model-for-your-llm-application, https://www.mongodb.com/resources/basics/artificial-intelligence/agent-memory
