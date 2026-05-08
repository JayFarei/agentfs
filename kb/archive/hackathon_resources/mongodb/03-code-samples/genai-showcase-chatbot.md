---
title: "MDBAI Assistant: Interactive Chatbot for the GenAI Showcase Repo"
source: https://mdbai-assistant.vercel.app/
type: sample-app
captured: 2026-05-01
---

## TL;DR

A deployed JavaScript single-page chatbot that helps you find resources inside the MongoDB GenAI Showcase repo through natural-language queries. Source content could not be extracted in capture, so this stub describes the resource by context and points to the underlying repo.

## Key Takeaways

- The URL hosts a Vercel-deployed SPA, so it renders client-side and yielded only an "Authenticating..." placeholder when fetched as static HTML; defuddle could not extract content.
- By context (title "MDBAI Assistant", description "AI Showcase for MongoDB", and the matching slug in this section), it is an interactive front end onto the GenAI Showcase repo, useful for asking "is there an example for X?" without grepping the repo by hand.
- The actual GenAI examples, code, and notebooks live in the GitHub repo, not in the chatbot UI; the chatbot is a navigation aid.
- During a hackathon, expect to use the chatbot for discovery and the repo for the runnable artifacts.

## What's Covered

### Capture status

The captured markdown is 165 bytes long and contains only the SPA boot text "Authenticating...". No tutorial steps, code, or feature documentation is available in the snapshot. Treat this file as a pointer, not as a content summary.

### Inferred purpose

A natural-language assistant indexed over the GenAI Showcase repo. The likely interaction model: type a question about RAG, agents, vector search, or a partner integration, and the assistant returns links and snippets from the matching notebook or app.

### How to use it productively

- Open the live URL directly in a browser to interact with the assistant.
- Use it as a search alternative to the GitHub repo's folder structure when you do not know which notebook or app addresses your scenario.
- Confirm any code or pattern it surfaces by reading the actual file in the repo.

## When to dive into the source

- You want to try the live assistant and see what it returns for hackathon-style queries.
- Skip if: you already know which folder or notebook in the showcase repo you need, just open the repo directly.

## Source

- Primary: https://mdbai-assistant.vercel.app/
- Related: ./genai-showcase.md (the underlying repo this assistant indexes, the primary entry point)
