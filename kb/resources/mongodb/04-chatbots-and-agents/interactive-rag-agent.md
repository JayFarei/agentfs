---
title: "Interactive RAG with MongoDB Atlas and Function Calling"
source: https://www.mongodb.com/developer/products/atlas/interactive-rag-mongodb-atlas-function-calling-api/
type: tutorial
captured: 2026-05-01
---

## TL;DR

Shows how to turn a static RAG pipeline into an interactive agent by exposing retrieval and ingestion as LLM-callable functions, so the model can decide when to search MongoDB Atlas, when to add new sources, and when to answer directly. Bridges the gap between "chatbot with documents" and "agent that manages its own knowledge base."

## Key Takeaways

- Function calling reframes RAG as a tool the LLM invokes, not a fixed pre-step before every prompt.
- The agent can ingest new documents on demand, for example by accepting a URL from the user and inserting the resulting chunks into Atlas.
- Tool definitions follow the OpenAI function calling schema (name, description, JSON parameters), which is portable across compatible LLM providers.
- Atlas Vector Search is the persistent memory and retrieval surface, with the LLM choosing when to query it.
- Good template for domain agents that need to grow their knowledge during a conversation.

## What's Covered

### Tool design

The agent exposes at least two tools to the LLM: a `retrieve` style function that takes a query and returns top matching chunks from Atlas Vector Search, and an `ingest` style function that accepts a source (URL or text) and writes new embedded chunks into the same collection. Each tool is described with a JSON schema so the LLM can fill in arguments.

### Atlas as the agent's memory

A single MongoDB collection stores text chunks plus embeddings. A vector search index over the embedding field lets the retrieve tool run a `$vectorSearch` aggregation. The same collection grows as ingest is called, so the agent's working knowledge is durable across sessions.

### Function calling loop

On each user turn the LLM either responds directly or returns a tool call. The application executes the tool, sends the result back as a tool message, and the model continues until it produces a final answer. This is the standard ReAct-style loop expressed through function calling rather than text parsing.

### Interactive ingestion pattern

When the user supplies a new source mid conversation, the agent calls the ingest tool, the source is fetched, chunked, embedded, and stored, and subsequent retrieve calls can immediately use the new content. This is the part that makes the system feel agentic rather than scripted.

### Wiring it up

The tutorial walks through the prompt that primes the LLM on its tools, the Python code that dispatches function calls to MongoDB driver operations, and the Atlas index that makes vector search performant.

## When to dive into the source

- You want a worked example of LLM function calling that reads and writes a MongoDB collection.
- You are designing an agent that needs to expand its own knowledge base during use.
- You need the exact tool schemas and dispatch loop, not just the concept.
- Skip if: your agent's knowledge is fixed at deploy time and pre-indexing is fine.

## Source

- Primary: https://www.mongodb.com/developer/products/atlas/interactive-rag-mongodb-atlas-function-calling-api/
- Related: OpenAI function calling docs, Atlas Vector Search overview
