---
title: "Webinar 3, RAG With MongoDB"
source_video: https://www.youtube.com/live/ZoYXZAvGDzM
source_page: https://www.mongodb.com/resources/solutions/use-cases/webinar-rag-with-mongodb
type: video + curated page
duration: "(approx 50 min, not directly captured)"
speaker: "MongoDB (likely Solution Architect / Curriculum Engineer)"
upload_date: late 2025
channel: "MongoDB (YouTube)"
captured: 2026-05-01
transcript_status: "YouTube auto-subtitles rate-limited at capture time, content below is from MongoDB's curated resource page only"
---

## TL;DR

How to build a retrieval-augmented generation pipeline on MongoDB. Covers anchoring an LLM in your proprietary data via vector retrieval, managing the context window, metadata filtering for precision, and building a feedback loop so the system stays performant as data grows. Builds on Webinar 2 (vector search).

## Key Takeaways

- An LLM alone hallucinates or returns generic answers. RAG bridges the model and your data so responses are accurate, current, and proprietary-aware
- The pipeline shape is: query → embed query → vector search in MongoDB → assemble retrieved chunks → prompt the LLM → return grounded response
- Retrieval optimization is the lever: fetching the right chunks matters more than tuning the model. This session focuses on that lever
- The context window must be actively managed, balance accuracy (more retrieved context) against latency and token cost (less)
- Metadata filtering on the vector search narrows the candidate set before similarity ranking, big win for both precision and speed
- A feedback loop (logging retrievals, scoring relevance, retraining/re-chunking) keeps the system performant as the underlying data grows

## What's Covered

> Note: The video transcript was not captured (YouTube rate-limited yt-dlp during defuddle/capture). The bullets below come from MongoDB's curated resource page for this webinar. Treat them as topic markers, watch the full video for code samples and architectural detail.

### 1. From theory to a real RAG pipeline
The session moves past "RAG explained" diagrams into actually orchestrating the data flow from a MongoDB collection through embedding → retrieval → prompt → LLM response.

### 2. Optimizing the retrieval step
How to fetch the most relevant chunks for a given query. Covers chunk-size tradeoffs, top-k selection, and reranking.

### 3. Context-window management
The token budget for a model is finite. Strategies for compressing or summarizing retrieved content, dropping low-relevance chunks, and dynamically sizing the context.

### 4. Metadata filtering
Pre-filter the vector search candidate set with structured metadata (date, source, user, tags) so similarity ranking only runs against documents that are eligible to begin with. Big precision and latency win.

### 5. Feedback loops + ongoing performance
Logging which retrievals led to good answers, monitoring retrieval quality drift, and tightening the pipeline as the corpus grows. Avoids the common failure mode where a RAG system silently degrades after launch.

### 6. Skill badge
End-of-session 10-question check earns the RAG with MongoDB badge.

## When to dive into the source

- You've understood vector search (W2) and now want the orchestration layer
- You're building a RAG app that's hitting hallucination or token-cost problems
- You're deciding how to combine vector search with structured metadata filters
- **Skip if:** you have a production RAG pipeline already with eval in place, content is likely intro-to-intermediate

## Source

- Video: <https://www.youtube.com/live/ZoYXZAvGDzM>
- Resource page: <https://www.mongodb.com/resources/solutions/use-cases/webinar-rag-with-mongodb>
- Related, MongoDB Developer guides:
  - "Building a RAG System using LlamaIndex, OpenAI, and MongoDB Atlas", <https://www.mongodb.com/developer/products/atlas/rag-with-polm-stack-llamaindex-openai-mongodb>
  - "How to Evaluate Your RAG Application", <https://www.mongodb.com/developer/products/atlas/evaluate-llm-applications-rag>
  - "How to Choose the Right Embedding Model for RAG", <https://www.mongodb.com/developer/products/atlas/choose-embedding-model-rag/>
