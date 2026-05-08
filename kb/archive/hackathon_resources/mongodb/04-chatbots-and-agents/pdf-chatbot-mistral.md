---
title: "Build a PDF Chatbot with MongoDB and Mistral AI"
source: https://www.mongodb.com/developer/products/mongodb/mistral-ai-integration
type: tutorial
captured: 2026-05-01
---

## TL;DR

Walks through building a question-answering chatbot over PDF documents using MongoDB Atlas Vector Search as the retrieval layer and Mistral AI models for embeddings and generation. Aimed at developers who want a minimal RAG stack without proprietary lock-in.

## Key Takeaways

- Demonstrates the smallest viable RAG loop: PDF, chunk, embed, store in MongoDB, retrieve by vector, prompt an LLM.
- Uses Mistral AI for both the embedding model and the chat completion model, so the whole pipeline runs on one provider.
- MongoDB Atlas Vector Search holds the embeddings alongside the source text, no separate vector database needed.
- Shows how to define a vector search index in Atlas and run a `$vectorSearch` aggregation against it.
- Pattern transfers cleanly to other content types like markdown, HTML, or transcripts.
- Good entry point if you have never wired an LLM to a database before.

## What's Covered

### Document ingestion

PDFs are loaded, split into overlapping text chunks, and each chunk is sent to Mistral's embedding endpoint to produce a vector. Chunk text and embedding are written together into a MongoDB collection.

### Vector index setup in Atlas

The tutorial creates a vector search index on the embedding field, specifying the dimension that matches the Mistral embedding model and a similarity metric, typically cosine. Without this index the `$vectorSearch` stage cannot run.

### Retrieval at query time

User questions are embedded with the same Mistral model, then a `$vectorSearch` aggregation pulls the top-K most similar chunks. Those chunks become the grounding context for the next step.

### Generation with Mistral chat models

Retrieved chunks are stitched into a prompt template along with the user's question and sent to a Mistral chat model. The response cites or paraphrases the retrieved content rather than relying on the model's parametric memory.

### Putting it together

The end-to-end script connects the embedding step, the Atlas vector query, and the chat call into a single function that turns a user question into a grounded answer.

## When to dive into the source

- You want copy-paste code for a Mistral plus Atlas RAG starter.
- You are evaluating Mistral as an alternative to OpenAI for embeddings or chat.
- You need exact dimension values and index JSON for the Mistral embedding model.
- Skip if: you already have a working RAG pipeline on a different LLM, the patterns are identical and you do not need a second example.

## Source

- Primary: https://www.mongodb.com/developer/products/mongodb/mistral-ai-integration
- Related: MongoDB Atlas Vector Search docs, Mistral AI API reference
