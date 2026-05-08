---
title: "Advanced AI and Vertex AI Integrations: Enhance your applications with advanced AI capabilities"
captured: 2026-05-01
---

# Advanced AI and Vertex AI Integrations

This sub-section collects MongoDB partner reference repos that wire Atlas into Google Cloud Vertex AI, covering both Agent Engine (formerly Reasoning Engine) for hosted agentic RAG and Vertex AI Extensions for natural-language CRUD via Gemini function calling. For the Agentic Evolution Hackathon, top six finalists must build on MongoDB Atlas plus AWS, so these Google Cloud paths are SECONDARY. Treat them as reference architectures: the high-level patterns (vector search backing an agent, OpenAPI spec exposed as an LLM tool, secret-managed API keys) translate cleanly to AWS Bedrock equivalents, but the SDK code itself does not run on the required hackathon stack.

## Resources

| # | Resource | What it gives you | File |
|---|----------|-------------------|------|
| 1 | MongoDB-VertexAI-Reasoning-Engine | Notebook reference for Atlas vector search behind a Vertex AI Agent Engine with chat history | [reasoning-engine](./reasoning-engine.md) |
| 2 | MongoDB-VertexAI-extensions | OpenAPI spec plus notebook that registers Atlas Data API as a Gemini tool for natural-language CRUD | [vertex-ai-extensions](./vertex-ai-extensions.md) |
