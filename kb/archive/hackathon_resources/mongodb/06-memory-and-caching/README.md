---
title: "Memory and Caching: Implement advanced memory features in your applications"
captured: 2026-05-01
---

# Memory and Caching

Two deep tutorials on adding conversation memory and semantic LLM caching to RAG applications via the LangChain MongoDB integration, one in Python, one in JavaScript. Use `MongoDBChatMessageHistory` (per-session chat turns persisted to a MongoDB collection) when your agent needs to resolve follow-up questions against prior context. Use `MongoDBAtlasSemanticCache` (vector-search-backed LLM response cache) when you want to cut latency and cost on semantically repeated prompts. The two features compose cleanly inside a single LangChain `RunnableWithMessageHistory` chain. This sub-section complements `04-chatbots-and-agents` (which covers the agent loop and tool calling) and `05-rag-and-memory` (which covers retrieval design and embedding choices), focusing specifically on the persistence layer for conversation state and the optimization layer for LLM calls. The sub-section is small but high-value: both source articles run roughly 30KB each and go deep on chain wiring, namespace conventions, and cache hit/miss behavior.

## Resources

| # | Resource | What it gives you | File |
|---|----------|-------------------|------|
| 1 | Add Memory and Semantic Caching with LangChain and MongoDB | Python tutorial wiring `MongoDBChatMessageHistory` and `MongoDBAtlasSemanticCache` into a history-aware RAG chain, end-to-end with code | [semantic-caching-langchain.md](./semantic-caching-langchain.md) |
| 2 | Add Memory to a JavaScript RAG Application with MongoDB and LangChain | Node.js `$vectorSearch` reference query and the JS counterparts to the LangChain memory and cache classes | [javascript-rag-memory.md](./javascript-rag-memory.md) |
