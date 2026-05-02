---
title: "Building a RAG System With the POLM Stack: LlamaIndex, OpenAI, and MongoDB"
source: https://www.mongodb.com/developer/products/atlas/rag-with-polm-stack-llamaindex-openai-mongodb
type: tutorial
captured: 2026-05-01
---

## TL;DR

End-to-end Python tutorial that builds a RAG pipeline on MongoDB Atlas Vector Search using LlamaIndex as the orchestration layer and OpenAI for embeddings and generation.

## Key Takeaways

- POLM is an acronym for the stack: Python, OpenAI, LlamaIndex, MongoDB. It is MongoDB's reference combination for fast Python RAG.
- LlamaIndex provides the document loaders, node parsers, vector store abstraction, and query engine; MongoDB Atlas provides storage and the vector index.
- The integration ships as `llama-index-vector-stores-mongodb`, which wraps Atlas Vector Search behind LlamaIndex's `VectorStoreIndex`.
- The default embedding model is OpenAI `text-embedding-ada-002` (1536 dims) and the default LLM is `gpt-3.5-turbo` or `gpt-4`, both configurable via LlamaIndex `Settings`.
- A vector search index must be created on the target collection before querying; the tutorial shows the JSON definition with `numDimensions: 1536` and `similarity: "cosine"`.
- The same code shape (load, chunk, embed, store, retrieve, generate) generalizes to other embedding and LLM providers by swapping LlamaIndex components.

## What's Covered

### 1. Environment Setup

Install the core packages: `pymongo`, `llama-index`, `llama-index-vector-stores-mongodb`, `llama-index-embeddings-openai`, `llama-index-llms-openai`. Set `OPENAI_API_KEY` and a MongoDB Atlas connection string. The Atlas cluster needs Vector Search enabled (M10+ or shared tier with Search).

### 2. Data Ingestion and Chunking

Load source documents with `SimpleDirectoryReader` (or any LlamaIndex reader). LlamaIndex parses them into `Node` objects via a node parser; the default chunk size is around 1024 tokens with overlap. Each node carries text and metadata.

### 3. Embedding and Storage

Configure the embedding model in `Settings.embed_model`. Construct a `MongoDBAtlasVectorSearch` vector store pointed at a database and collection, then build a `VectorStoreIndex.from_documents(...)` with a `StorageContext` that uses the MongoDB store. LlamaIndex calls OpenAI to embed each node and writes the document plus its 1536-dimension vector into MongoDB.

### 4. Vector Search Index Creation

Define an Atlas Vector Search index on the collection so queries can use `$vectorSearch`:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" }
  ]
}
```

The tutorial creates this through the Atlas UI or programmatically.

### 5. Query and Generation

Call `index.as_query_engine().query("...")`. LlamaIndex embeds the query, runs vector search against MongoDB, retrieves the top-k nodes, packs them into a prompt template, and sends the prompt plus question to the configured OpenAI LLM. The query engine returns a response object with the generated answer and the source nodes used.

### 6. Tuning Knobs

Swap embedding models via `OpenAIEmbedding(model="text-embedding-3-small")` or any other LlamaIndex embedding integration. Adjust retrieval breadth with `similarity_top_k`. Add metadata filters by passing a `MetadataFilters` object to the retriever.

## When to dive into the source

- You want a copy-pasteable Python notebook to stand up a RAG pipeline in under an hour.
- You are choosing between LlamaIndex and LangChain and want to see the LlamaIndex shape concretely.
- Skip if: you are working in TypeScript or Node (use `mongodb-rag` instead) or you do not need a heavyweight orchestration framework.

## Source

- Primary: https://www.mongodb.com/developer/products/atlas/rag-with-polm-stack-llamaindex-openai-mongodb
- Related: https://docs.llamaindex.ai/en/stable/examples/vector_stores/MongoDBAtlasVectorSearch/
- Related: https://www.mongodb.com/docs/atlas/atlas-vector-search/
