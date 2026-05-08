---
title: "Atlas Vector Search Tutorial: Semantic Search (capture failed)"
source: https://www.mongodb.com/docs/atlas/atlas-vector-search/tutorials/vector-search-tutorial/
type: tutorial
captured: 2026-05-01
---

## TL;DR

This is the official MongoDB Atlas Vector Search tutorial for building a semantic search application. The defuddle capture failed at fetch time (HTTP 502, then a 404 when re-attempted, leaving a 42-byte error stub), so the body below is reconstructed from context. Open the source URL directly for the authoritative content.

## Key Takeaways

- This is MongoDB's canonical "first semantic search query on Atlas" walkthrough, the natural next step after a basic Atlas connection is working.
- Expected coverage based on the URL path and sister docs: loading sample data with embeddings, defining a `vectorSearch` index, and running a `$vectorSearch` aggregation stage.
- The page typically offers driver-specific variants (Python, Node.js, etc.), so pick the language path that matches your stack when you open it.
- The capture failed, do not rely on the file body, treat this stub as a redirect to the live URL plus pointers to overlapping resources already captured in this KB.

## What's Covered

### Capture status

The pre-fetched markdown at `/tmp/mdb-fetch/02-quickstarts/semantic-search-tutorial.md` is a 42-byte file containing only `{"error":"Failed to fetch: 404 Not Found"}`. An earlier attempt reportedly returned HTTP 502. Either way, no usable content was extracted, so this stub points elsewhere rather than fabricating detail.

### What the tutorial is, from context

The MongoDB Atlas Vector Search tutorials section hosts step-by-step guides that take a developer from "I have an Atlas cluster" to "I am running a vector query". The semantic search tutorial specifically walks through choosing an embedding model, generating embeddings for a sample dataset, creating a `vectorSearch` index on the embedding field, and issuing a query with the `$vectorSearch` aggregation stage. Variants typically exist for multiple drivers and frameworks.

### Where to get the same content reliably

- Open the live URL in a browser, the docs site is the source of truth.
- For background on Atlas Vector Search itself, see `../01-key-resources/atlas-vector-search.md` in this KB.
- For runnable end-to-end notebooks that exercise the same workflow, see `../03-code-samples/genai-showcase.md`, which collects MongoDB's GenAI showcase notebooks for semantic search and RAG.

## When to dive into the source

- You need the exact, current shape of a `vectorSearch` index definition (field types, similarity metric, numDimensions).
- You want the reference `$vectorSearch` aggregation stage with `queryVector`, `path`, `numCandidates`, and `limit` parameters.
- You want the canonical sample dataset MongoDB uses in its docs so your code lines up with their examples.
- Skip if: the genai-showcase notebooks already give you a working semantic search snippet, in which case reuse those and consult this tutorial only for parameter reference.

## Source

- Primary: https://www.mongodb.com/docs/atlas/atlas-vector-search/tutorials/vector-search-tutorial/
- Related (this KB): ../01-key-resources/atlas-vector-search.md
- Related (this KB): ../03-code-samples/genai-showcase.md
