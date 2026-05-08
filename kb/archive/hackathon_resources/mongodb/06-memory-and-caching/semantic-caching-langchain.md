---
title: "Add Memory and Semantic Caching with LangChain and MongoDB"
source: https://www.mongodb.com/developer/products/atlas/advanced-rag-langchain-mongodb/
type: tutorial
captured: 2026-05-01
---

## TL;DR

End-to-end Python tutorial that layers conversation memory and semantic caching onto a LangChain RAG chain backed by MongoDB Atlas Vector Search, using `MongoDBChatMessageHistory` for per-session history and `MongoDBAtlasSemanticCache` to short-circuit semantically similar LLM calls.

## Key Takeaways

- Memory and semantic cache are independent features but plug into the same LangChain chain, both backed by MongoDB collections in the `langchain_db` database.
- `MongoDBChatMessageHistory` stores chat turns keyed by `session_id` and is wired into the chain via `RunnableWithMessageHistory`, enabling follow-up questions like "Why did they do it?" to resolve against prior context.
- A history-aware retriever uses an LLM prompt to rewrite follow-up questions into standalone queries before vector retrieval, fixing the classic naive-RAG failure where pronouns kill recall.
- `MongoDBAtlasSemanticCache` is registered globally with `set_llm_cache(...)` and uses Voyage embeddings plus a `similarity_threshold` (0.5 in the demo) over a `semantic_cache` collection.
- The cache stores only the LLM input, not retrieved documents, so retrieval-driven variation between runs can produce cache misses on otherwise similar queries.
- Stack used: `langchain-mongodb`, `langchain-voyageai` (`voyage-3-large`, 1024 dims), `langchain-openai` (`gpt-4o`), `MongoDBAtlasVectorSearch` over a PDF corpus.

## What's Covered

### 1. Vector store setup

Installs `langchain-mongodb` plus Voyage and OpenAI integrations. Instantiates `MongoDBAtlasVectorSearch.from_connection_string(...)` against the `langchain_db.rag_with_memory` namespace using `VoyageAIEmbeddings(model="voyage-3-large")`. A PDF (MongoDB earnings report) is loaded with `PyPDFLoader`, split with `RecursiveCharacterTextSplitter` (chunk size 200, overlap 20), and ingested. The vector index is created via the helper `vector_store.create_vector_search_index(dimensions=1024)`.

### 2. Conversation memory with MongoDBChatMessageHistory

Defines `get_session_history(session_id)` that returns a `MongoDBChatMessageHistory` bound to `langchain_db.rag_with_memory`. The class persists messages per session so different users or threads stay isolated.

### 3. History-aware RAG chain

Builds a multi-stage chain:

- A `standalone_question_prompt` rewrites follow-ups into self-contained questions using `MessagesPlaceholder("history")`.
- `question_chain = standalone_question_prompt | llm | StrOutputParser()` produces the rewritten query.
- `retriever_chain = RunnablePassthrough.assign(context=question_chain | retriever | join_docs)` injects retrieved context.
- A final `rag_prompt` answers strictly from `{context}` plus history.
- `RunnableWithMessageHistory(rag_chain, get_session_history, input_messages_key="question", history_messages_key="history")` ties the chain to MongoDB-backed history, keyed by `session_id` passed in `configurable`.

The demo confirms memory works: a first call asks about MongoDB's latest acquisition, a second asks "Why did they do it?" and resolves correctly to Voyage AI.

### 4. Semantic cache with MongoDBAtlasSemanticCache

Configures the cache:

```
set_llm_cache(MongoDBAtlasSemanticCache(
    connection_string=MONGODB_URI,
    database_name="langchain_db",
    collection_name="semantic_cache",
    embedding=embedding_model,
    index_name="vector_index",
    similarity_threshold=0.5,
))
```

Once registered, every LLM call is checked against `semantic_cache`. The walkthrough fires two semantically equivalent prompts ("What was MongoDB's latest acquisition?" vs. "What company did MongoDB acquire recently?") and shows the second returning faster, served from cache.

### 5. Cache hit/miss flow and caveats

On each LLM call: embed prompt, vector-search `semantic_cache`, return cached completion if any candidate exceeds `similarity_threshold`, else call the LLM and write a new entry. Because only LLM input is cached, retrieval differences between runs (different chunks pulled into `{context}`) change the LLM input and produce a miss even when the user question is similar. Tune `similarity_threshold` to trade hit rate against staleness.

## When to dive into the source

- You need exact `from_connection_string` and `create_vector_search_index` call shapes for a Python LangChain build.
- You want the runnable Colab notebook to copy-paste a working memory plus cache pipeline in one sitting.
- You are debugging unexpected cache misses and need the explanation of why retrieval variability defeats input-only caching.
- Skip if: your hackathon stack is JavaScript, or you only need vanilla RAG without conversational follow-ups or LLM caching.

## Source

- Primary: https://www.mongodb.com/developer/products/atlas/advanced-rag-langchain-mongodb/
- Related: https://github.com/mongodb/docs-notebooks/blob/main/ai-integrations/langchain-memory-semantic-cache.ipynb
- Related: https://www.mongodb.com/docs/atlas/ai-integrations/langchain/get-started/
