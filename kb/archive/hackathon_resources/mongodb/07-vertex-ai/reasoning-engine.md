---
title: "MongoDB-VertexAI-Reasoning-Engine"
source: https://github.com/mongodb-partners/MongoDB-VertexAI-Reasoning-Engine
type: github-repo
captured: 2026-05-01
---

## TL;DR

A MongoDB partners reference repo showing how to wire MongoDB Atlas vector search into a Google Vertex AI Reasoning Engine (now Agent Engine) for RAG with conversation history. Notebook-only, no application scaffolding.

## Key Takeaways

- The repo is a small set of Jupyter notebooks plus an architecture diagram, not a deployable app or library.
- Demonstrates RAG where MongoDB Atlas is the vector store and Vertex AI Agent Engine hosts the reasoning loop.
- The actively maintained notebook is `reasoning_engine_with_history[Latest].ipynb`, which adds chat history to the basic pattern.
- Two older notebooks are explicitly marked deprecated, useful only for tracing API evolution.
- 100 percent Jupyter Notebook content, so the repo is meant to be read and run cell by cell, not imported.
- For the Agentic Evolution Hackathon the AWS Bedrock + Atlas path is required, so this is reference architecture rather than a starting template.

## What's Covered

### Repo contents

Four files at the root: a README, an architecture image (`reasoning_engine_mongodb_arch.png`), and three notebooks. `reasoning_engine_with_history[Latest].ipynb` is the canonical entry point. `reasoning-engine[deprecared].ipynb` and `reasoning_engine_with_history[deprecated].ipynb` are kept for history but should not be followed.

### Architecture pattern

A user query goes to a Vertex AI Reasoning Engine (Agent Engine) instance, which uses Atlas vector search to retrieve relevant documents and Gemini to generate the answer. Conversation history is stored and rehydrated across turns so the agent can handle follow-ups. The architecture diagram in the repo is the clearest summary of the flow.

### Vertex services used

Vertex AI Reasoning Engine (rebranded as Agent Engine) for hosting the agent runtime, Vertex AI generative models for LLM calls, and MongoDB Atlas (external) as the vector store accessed via the Atlas Python driver. Setup runs inside Google Colab or a Vertex AI Workbench notebook.

### What is not in the repo

No Terraform, no CI, no Dockerfile, no production deployment recipe. There is no Python package or extracted library. Anything you want to reuse you must lift out of the notebook cells yourself.

## When to dive into the source

- You are specifically building on Google Cloud and want a worked example of Vertex AI Agent Engine plus Atlas vector search with chat history.
- You want to see how to persist and replay conversation history inside a Reasoning Engine session.
- You need an architecture diagram to crib for a slide or design doc.
- Skip if: you are on the AWS Bedrock + Atlas hackathon track, in which case the AgentCore samples are the right reference instead.

## Source

- Primary: https://github.com/mongodb-partners/MongoDB-VertexAI-Reasoning-Engine
- Related: https://github.com/mongodb-partners/MongoDB-VertexAI-extensions
