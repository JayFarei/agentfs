---
title: "MongoDB Section, Hackathon Resource Guide"
captured_on: 2026-05-01
parent_index: ../resources.md
upstream_section: "MongoDB (resources.md)"
---

# MongoDB

Deep summaries of all MongoDB-authored learning materials for the hackathon: the 5-part pre-hackathon webinar series plus 31 docs/code/integration resources across 7 topic areas. Organized for progressive discovery: an agent should be able to decide in 30 seconds whether a resource is relevant, get the substance in 3 minutes, and know when to open the source URL for full detail.

## How to use this folder

1. **Orienting?** Read this file's "Sub-sections" table below.
2. **Picking a resource?** Open the relevant `<NN>-<topic>/README.md`, scan its resource table.
3. **Using a resource?** Open the individual `<slug>.md` for TL;DR, key takeaways, what's covered, and when to dive deeper.
4. **Need verbatim accuracy?** Follow the source URL in the file's Source section.

## Sub-sections

| # | Folder | Resources | Best for | Hackathon priority |
|---|--------|-----------|----------|-------------------|
| 0 | [00-pre-hackathon-webinars](./00-pre-hackathon-webinars/) | 5 + overview | The Modern Data Architecture Mastery video series, foundations through agents | Watch first if new to MongoDB |
| 1 | [01-key-resources](./01-key-resources/) | 7 | Foundational MongoDB capabilities, sample data, docs entry points | Foundation |
| 2 | [02-quickstarts](./02-quickstarts/) | 3 | Hands-on getting-started guides for Atlas, Voyage AI embeddings, vector search | Foundation |
| 3 | [03-code-samples](./03-code-samples/) | 9 | Reference apps and starters: GenAI Showcase, Java/MEAN/MERN stacks | Reference |
| 4 | [04-chatbots-and-agents](./04-chatbots-and-agents/) | 4 | Chatbot to function-calling agent to multi-tool agent progression | **High** |
| 5 | [05-rag-and-memory](./05-rag-and-memory/) | 4 | Pick an embedding model, build a RAG pipeline, evaluate it, package it | **High** |
| 6 | [06-memory-and-caching](./06-memory-and-caching/) | 2 | LangChain `MongoDBChatMessageHistory` and `MongoDBAtlasSemanticCache` patterns | **High** |
| 7 | [07-vertex-ai](./07-vertex-ai/) | 2 | Reference patterns on Google Cloud Vertex AI | Reference only (finalists must build on AWS + Atlas) |

## Recommended reading path for the Agentic Evolution Hackathon

The hackathon's theme is agentic memory and context engineering. The load-bearing folders are **4, 5, and 6**. A productive path:

1. **Foundation pass (skip if comfortable):** [01-key-resources/sample-mflix](./01-key-resources/sample-mflix.md) (it ships pre-computed OpenAI 1536d and Voyage 2048d embeddings, the fastest way to test a vector pipeline) → [01-key-resources/atlas-vector-search](./01-key-resources/atlas-vector-search.md).
2. **Pick your stack:** [05-rag-and-memory/choose-embedding-model](./05-rag-and-memory/choose-embedding-model.md) → either [05-rag-and-memory/llamaindex-rag](./05-rag-and-memory/llamaindex-rag.md) (Python) or [05-rag-and-memory/mongodb-rag-npm](./05-rag-and-memory/mongodb-rag-npm.md) (Node).
3. **Add memory + cache:** [06-memory-and-caching/javascript-rag-memory](./06-memory-and-caching/javascript-rag-memory.md) and [06-memory-and-caching/semantic-caching-langchain](./06-memory-and-caching/semantic-caching-langchain.md) for `MongoDBChatMessageHistory` + `MongoDBAtlasSemanticCache`.
4. **Promote to agent:** [04-chatbots-and-agents/](./04-chatbots-and-agents/) in the order [pdf-chatbot-mistral](./04-chatbots-and-agents/pdf-chatbot-mistral.md) → [interactive-rag-agent](./04-chatbots-and-agents/interactive-rag-agent.md) → [hr-agentic-chatbot](./04-chatbots-and-agents/hr-agentic-chatbot.md) → [maap-chatbot-builder](./04-chatbots-and-agents/maap-chatbot-builder.md). Simplest to most production-shaped.
5. **Evaluate before submitting:** [05-rag-and-memory/evaluate-rag](./05-rag-and-memory/evaluate-rag.md) for context precision, faithfulness, answer relevance.

The shared substrate across all four "agent" resources is **Atlas Vector Search**: every example uses it as the retrieval layer, so you can reuse one cluster for vectors, chat history, and the LLM cache.

## Capture quality notes

29 of 31 sources captured cleanly via defuddle. Eight summary files carry directional content rather than tutorial-grade detail because the source either failed to render or returned a generic landing page:

| File | Issue | Mitigation |
|------|-------|-----------|
| [02-quickstarts/semantic-search-tutorial.md](./02-quickstarts/semantic-search-tutorial.md) | defuddle 502 | Stub with cross-links, follow source URL for full tutorial |
| [02-quickstarts/atlas-python-quickstart.md](./02-quickstarts/atlas-python-quickstart.md) | GitHub notebook URL returned only file chrome | Open the repo root for the full notebook series |
| [03-code-samples/genai-showcase-chatbot.md](./03-code-samples/genai-showcase-chatbot.md) | URL points to a deployed SPA, only "Authenticating..." extractable | Stub plus pointer to the GenAI-Showcase repo |
| [03-code-samples/java-spring-boot-vector-search.md](./03-code-samples/java-spring-boot-vector-search.md) | redirected to docs landing | Open source URL for actual steps |
| [04-chatbots-and-agents/pdf-chatbot-mistral.md](./04-chatbots-and-agents/pdf-chatbot-mistral.md) | redirected to docs landing | Directional summary, open source for code |
| [04-chatbots-and-agents/interactive-rag-agent.md](./04-chatbots-and-agents/interactive-rag-agent.md) | redirected to docs landing | Directional summary, open source for code |
| [05-rag-and-memory/choose-embedding-model.md](./05-rag-and-memory/choose-embedding-model.md) | redirected to docs landing | Directional summary, open source for specifics |
| [05-rag-and-memory/llamaindex-rag.md](./05-rag-and-memory/llamaindex-rag.md) | redirected to docs landing | Directional summary, open source for specifics |

These thin files are clearly flagged inside their own frontmatter or body so an agent reading them knows when to defer to the live URL.

## Capture method

- Source list extracted from `kb/resources/resources.md` MongoDB section (31 URLs across 7 sub-sections)
- Pre-fetched in parallel via `defuddle.md` (15 succeeded immediately, 16 retried after a 45-second backoff, 14 of those 16 succeeded on retry)
- Synthesized by 7 parallel general-purpose agents, one per sub-section, each working only against its slice of pre-fetched markdown to keep the main context lean
- Format template held identical across agents: TL;DR → Key Takeaways → What's Covered → When to dive into the source → Source links
- Constraints honored throughout: no em-dashes (commas instead), no emojis, summarize do not reproduce
