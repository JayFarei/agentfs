---
title: "Chatbots and AI Agents: Build intelligent chatbots and dynamic agents using MongoDB and AI"
captured: 2026-05-01
---

# Chatbots and AI Agents

This is the most directly relevant sub-section for the Agentic Evolution Hackathon. The four resources here trace a clear progression: a minimal RAG chatbot wired to MongoDB Atlas Vector Search, an agent that uses LLM function calling to manage its own knowledge base, a domain-specific agent (HR) that mixes read tools with side-effecting tools like Gmail and Docs, and finally a multi-provider production framework that turns the whole pipeline into a YAML file. Recommended reading order is in the table below: start with the simplest end-to-end RAG example (Mistral PDF chatbot), then study how function calling promotes RAG into an agentic loop, then see a real multi-tool LangGraph agent with persistent state, and finish with the configuration-driven framework if you are thinking about something production-shaped or multi-tenant.

## Resources

| # | Resource | What it gives you | File |
|---|----------|-------------------|------|
| 1 | PDF Chatbot with Mistral | Smallest viable RAG loop on Atlas, single LLM provider | [pdf-chatbot-mistral](./pdf-chatbot-mistral.md) |
| 2 | Interactive RAG Agent | Function calling that lets the LLM retrieve and ingest into MongoDB on demand | [interactive-rag-agent](./interactive-rag-agent.md) |
| 3 | HR Agentic Chatbot | LangChain plus LangGraph agent with MongoDB and Google tools, Chainlit UI, MongoDB checkpointer | [hr-agentic-chatbot](./hr-agentic-chatbot.md) |
| 4 | MAAP Chatbot Builder | YAML-driven multi-provider RAG framework with pluggable loaders, embedding models, and LLMs | [maap-chatbot-builder](./maap-chatbot-builder.md) |
