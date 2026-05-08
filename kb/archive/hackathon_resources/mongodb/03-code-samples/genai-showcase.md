---
title: "MongoDB GenAI Showcase: Cookbook of RAG, Agents, and Industry Demos"
source: https://github.com/mongodb-developer/GenAI-Showcase/tree/main
type: github-repo
captured: 2026-05-01
---

## TL;DR

A curated MongoDB cookbook of GenAI examples spanning Retrieval-Augmented Generation, AI agents, and industry use cases, organized as Jupyter notebooks, runnable apps, workshops, and partner contributions. Treat it as the canonical first-stop catalog when you need a working pattern for MongoDB as a vector store, operational store, or agent memory.

## Key Takeaways

- The repo is structured as four top-level folders: `notebooks`, `apps`, `workshops`, `partners`, each with its own README.
- It demonstrates MongoDB's three roles in GenAI stacks: vector database, operational database, and memory provider.
- Apps are written in JavaScript and Python; notebooks cover RAG pipelines, agentic apps, and evaluations.
- Every example assumes an Atlas cluster, so a free-tier cluster and a connection string are prerequisites.
- MIT licensed, so snippets and patterns can be lifted into hackathon projects without friction.
- Partner folder contains contributions from MongoDB's AI partners, useful for plug-in integrations like LangChain, LlamaIndex, and embedding providers.

## What's Covered

### Repository layout

| Folder | Purpose |
| --- | --- |
| `notebooks` | Jupyter notebooks for RAG, agentic applications, and evaluation patterns |
| `apps` | Full JavaScript and Python sample apps and demos |
| `workshops` | Self-paced hands-on workshops |
| `partners` | Contributions from MongoDB AI partners |

### Prerequisites

To run anything, you need a MongoDB Atlas cluster, the connection string from that cluster, and the language runtime matching the example. The README links the Atlas free-tier signup, cluster creation, and connection-string retrieval guides.

### MongoDB roles in the examples

The showcase consistently models MongoDB as: a vector database backing semantic retrieval, an operational document store for application data, and a memory layer for agent state and conversation history. Most examples combine at least two of these roles in a single demo.

### Companion resources surfaced from the README

- AI Learning Hub (use-case-oriented tutorials and articles)
- GenAI community forum
- `mongodb/docs-notebooks` repo for tutorials directly tied to the official docs

## When to dive into the source

- You want a runnable RAG or agent template that already wires MongoDB Atlas Vector Search end to end.
- You are evaluating partner integrations (LangChain, LlamaIndex, embedding providers) and want a working reference instead of greenfield setup.
- You need a workshop-style walkthrough to onboard teammates during a hackathon.
- Skip if: you only need a CRUD MongoDB example with no AI component, the MEAN/MERN/Java starters are simpler.

## Source

- Primary: https://github.com/mongodb-developer/GenAI-Showcase/tree/main
- Related: ./genai-showcase-chatbot.md (interactive assistant for navigating this repo)
- Related: https://github.com/mongodb/docs-notebooks
