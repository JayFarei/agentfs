---
title: "MongoDB Chatbot Framework and Knowledge Service (archived)"
source: https://github.com/mongodb/chatbot
type: github-repo
captured: 2026-05-01
---

## TL;DR

The public archive of the MongoDB Chatbot Framework and Knowledge Service, the reference implementation behind MongoDB's documentation chatbot. The repo is deprecated; ongoing development moved to an internal `mongodb/ai-assistant` repo, but the Apache 2.0 code remains useful as a worked example of an Atlas Vector Search-powered RAG service.

## Key Takeaways

- Status: deprecated and archived, but kept public because it is Apache 2.0 licensed and widely linked.
- Originally produced by MongoDB's Education AI team to power the MongoDB Knowledge Service, the public docs chatbot.
- Two artifacts in one repo: the Knowledge Service (a higher-level docs assistant) and the Chatbot Framework (lower-level building blocks).
- Active development continues in a closed MongoDB-internal repo; expect no new public commits.
- The framework's documentation site at mongodb.github.io/chatbot still explains why it was deprecated and which alternatives MongoDB recommends.

## What's Covered

### What the repo contains

The repository hosts the work of MongoDB's Education AI team: the implementation of the MongoDB Knowledge Service, plus the Chatbot Framework that originally powered it. Both are positioned as reference material rather than maintained software.

### Knowledge Service vs Chatbot Framework

The Knowledge Service is the user-facing GenAI assistant for learning MongoDB, backed by MongoDB and Atlas Vector Search. The Chatbot Framework is the lower-level toolkit the team built first and later moved away from. Documentation explains the deprecation rationale and points to alternative approaches.

### Why look at archived code

For hackathons, the value is in seeing how an experienced team wired together vector search, retrieval, prompting, and response generation against MongoDB Atlas. The architectural patterns transfer even though the framework itself is no longer recommended for new projects.

## When to dive into the source

- You want to study a production-grade RAG service that uses Atlas Vector Search end to end.
- You are reviewing how MongoDB itself handled chatbot evaluation, retrieval, and grounding before moving to internal tooling.
- Skip if: you need a maintained framework for new development, prefer the alternatives the deprecation note mentions, or use ./genai-showcase.md for active examples.

## Source

- Primary: https://github.com/mongodb/chatbot
- Related: https://mongodb.github.io/chatbot (framework documentation and deprecation notes)
- Related: https://github.com/mongodb/ai-assistant (internal successor, not public)
