---
title: "How to Evaluate Your LLM Application with RAG"
source: https://www.mongodb.com/developer/products/atlas/evaluate-llm-applications-rag
type: tutorial
captured: 2026-05-01
---

## TL;DR

Walks through measuring the quality of a MongoDB Atlas RAG application using the Ragas framework, covering retrieval metrics, generation metrics, and how to wire evaluation into a development loop.

## Key Takeaways

- RAG quality has two failure modes that need separate metrics: bad retrieval (the right context never reached the LLM) and bad generation (the LLM had context but answered poorly).
- Ragas defines a small set of named metrics that map to those failure modes: context precision, context recall, faithfulness, and answer relevance (also called answer relevancy).
- Faithfulness asks "does the answer only make claims supported by the retrieved context"; answer relevance asks "does the answer actually address the user's question."
- Context precision and context recall require a labeled ground-truth set; faithfulness and answer relevance can be computed without ground truth using an LLM-as-judge.
- Evaluation runs are themselves LLM calls, so they cost tokens and have latency; sample your test set rather than running on every commit.
- MongoDB recommends iterating on chunking strategy, embedding model, and retrieval parameters by watching these metrics move on a fixed eval set.

## What's Covered

### The Two-Layer Evaluation Model

Retrieval quality and generation quality fail independently. The article frames evaluation around isolating each layer: retrieval metrics tell you whether the vector search returned useful chunks; generation metrics tell you whether the LLM used them well. Both are needed because a perfect retriever cannot save a hallucinating LLM, and a great LLM cannot save a retriever that returned irrelevant chunks.

### Retrieval Metrics

- Context precision: of the chunks retrieved, what fraction are actually relevant to the question. Penalizes returning too much noise in the top-k.
- Context recall: of all the information needed to answer, what fraction appears in the retrieved chunks. Penalizes missing the right chunk entirely. Requires a ground-truth answer to compare against.

### Generation Metrics

- Faithfulness: fraction of claims in the generated answer that are entailed by the retrieved context. Measures hallucination directly. No ground truth needed; an LLM judge checks each claim against the context.
- Answer relevance (answer relevancy): how well the answer addresses the actual question, regardless of whether it is correct. Catches off-topic or evasive answers.

### Building an Eval Set

Construct a small set (dozens to a few hundred) of question and ground-truth-answer pairs that reflect real user queries against your corpus. The ground truth is needed for context recall and answer correctness. Faithfulness and answer relevance can run on questions alone.

### Using Ragas with MongoDB

Ragas takes the question, the retrieved contexts (from your MongoDB Vector Search query), the generated answer, and optionally the ground truth, and returns scores per metric. The article shows wiring this into a Python loop where each row in the eval dataset is run through the live RAG pipeline and then scored.

### Closing the Loop

Treat evaluation as a regression suite for RAG. When you change an embedding model, chunk size, or prompt template, rerun the eval set and watch which metrics moved. Improvements in faithfulness usually come from better retrieval or stricter prompts; improvements in context recall usually come from better chunking or a stronger embedding model.

## When to dive into the source

- You have a working RAG prototype and need a principled way to compare two embedding models or two chunking strategies.
- You are debugging hallucinations and need to isolate whether the retriever or the LLM is the cause.
- Skip if: you are still in the "does this thing run end to end" phase; eval comes after you have something to measure.

## Source

- Primary: https://www.mongodb.com/developer/products/atlas/evaluate-llm-applications-rag
- Related: https://docs.ragas.io/
- Related: https://github.com/mongodb-developer/GenAI-Showcase/tree/main/notebooks/evals
