---
title: "Webinar 2, Vector Search Fundamentals"
source_video: https://www.youtube.com/live/13GkAGIg9Do
source_page: https://www.mongodb.com/resources/solutions/use-cases/webinar-vector-search-fundamentals
type: video + curated page
duration: "50:04"
speaker: "Oscar Han (Solution Architect, MongoDB Netherlands)"
upload_date: 2025-12-18
channel: "MongoDB (YouTube)"
captured: 2026-05-01
---

## TL;DR

How MongoDB Atlas Vector Search actually works under the hood: what an embedding is, how vector indexes are built, and how to pick a distance metric. Goes from a 2D toy example (vehicles plotted by size and utility) up to a movie-database demo with auto-embedding triggers. ~50 min.

## Key Takeaways

- A vector embedding is a learned numeric representation of meaning. Each dimension encodes one feature the model picked up during training (topic domain, sentiment, syntactic role, etc.)
- Two pieces of content with similar vector values across dimensions are semantically close, even when their words don't overlap
- The search problem is "find the nearest points to my query vector" in high-dimensional space
- Brute force comparison works but doesn't scale. You need an indexing algorithm (the lecture builds intuition starting from a 1D skip list and extending to high-dim)
- Three distance metrics matter: **Euclidean** (straight-line distance), **Cosine** (angle, ignores magnitude), **Dot Product** (hybrid, includes both angle and magnitude)
- The embedding model dictates the right metric, e.g. OpenAI's `text-embedding-*` models are designed for cosine. Always check the model docs
- You can create multiple vector indexes on the same field with different metrics and A/B test which gives the most relevant results for your queries

## What's Covered

### 1. What semantic search solves
Keyword/full-text search misses intent. "Affordable family transport" and "cheap car for kids" don't share keywords but share meaning. Embeddings capture that.

### 2. Embeddings, intuition build
Starts with a 2D toy: plot {`car`, `truck`, `police car`, `ambulance`} along axes (`size`, `utility`). The four points form clusters that match human intuition. The full thing is the same idea in hundreds or thousands of dimensions.

### 3. Generating + storing embeddings in MongoDB
Two patterns demonstrated:
- **Atlas Trigger** that fires on insert/update/replace and writes the embedding back into the document via `collection.updateOne`. Keeps embeddings fresh without an external pipeline.
- **Batch Python job** for one-time backfill on existing collections. Same logic, run as a script.

The example collection is a movie database (Christmas movies as the running gag).

### 4. Vector indexing, why and how
Brute-force compare a query vector to every stored vector → milliseconds becomes minutes at scale. The session builds the indexing problem up from a 1D skip list, then explains how high-dim approximate-nearest-neighbor (ANN) structures generalize that idea to make queries return in milliseconds.

### 5. Distance metrics
- **Euclidean**: straight-line distance between two points. Intuitive for spatial data.
- **Cosine**: measures the angle between vectors, length-independent. The default for most text embedding models.
- **Dot product**: hybrid. Sensitive to both angle and magnitude.

OpenAI embeddings are trained for cosine. Other models may differ, always check the model card. You can spin up multiple indexes on the same field with different metrics and benchmark which gives the best precision for your queries.

### 6. Putting it together
Define a vector index in Atlas → write embeddings on insert via trigger → query with `$vectorSearch` aggregation stage → return semantically-similar documents.

### 7. Skill badge
End-of-session 10-question check earns the Vector Search Fundamentals badge. Part of a 3-badge AI track: Vector Search → RAG → AI Agents.

## When to dive into the source

- You've never built anything with embeddings and want the foundational concepts
- You're choosing between Euclidean / Cosine / Dot product and want intuition before reading docs
- You're setting up auto-embedding-on-write and want to see the Atlas Trigger pattern
- **Skip if:** you've already shipped vector search to prod, content is intro-level

## Source

- Video: <https://www.youtube.com/live/13GkAGIg9Do>
- Resource page: <https://www.mongodb.com/resources/solutions/use-cases/webinar-vector-search-fundamentals>
- MongoDB Atlas Vector Search docs: <https://www.mongodb.com/docs/atlas/atlas-vector-search/>
- Code samples mentioned in session: MongoDB GenAI-Showcase repo, <https://github.com/mongodb-developer/GenAI-Showcase>
