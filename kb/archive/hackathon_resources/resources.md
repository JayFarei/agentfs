---
title: "MongoDB Agentic Memory & Context Engineering Hackathon Resource Guide"
site: "mongodb-hackathons on Notion"
source: "https://mongodb-hackathons.notion.site/MongoDB-Agentic-Evolution-Hackathon-350bf2cba6d5803992b0dfe0f0b7e018?source=copy_link"
domain: "mongodb-hackathons.notion.site"
language: "en"
description: "Welcome to the Hackathon Resource Guide, a place to quickly access all MongoDB and Partner-provided hackathon resources."
fetched_via: "dev-browser (Playwright) with all toggles expanded"
fetched_on: 2026-05-01
---

## Welcome to the Hackathon Resource Guide

Whether you're here to build your first AI agent or level up your existing stack, this guide is your one-stop shop for everything you may need throughout the hackathon. From various MongoDB tools and workshops, to partner APIs, SDKs, and demo resources.

Inside you'll find:

- **Developer Enablement Sessions & Recordings** -> catch up on any pre-hackathon training sessions.
- **MongoDB + Voyage AI Resources** -> learn how to build agentic memory systems powered by MongoDB Atlas Vector Search and Voyage AI embeddings.
- **Partner Toolkits** -> access docs, starter repos, and sample projects from our incredible partners: AWS, Emergent, ElevenLabs, Factory, Fireworks AI, LangChain, LiveKit, NVIDIA and Replit.

> **Please Note:** In order to be a Top 6 Finalist, you MUST build on **MongoDB Atlas & AWS**.

You should have received an **email with a link to join the MongoDB Atlas Sandbox** for the hackathon. You must create your **project + cluster** through this link.

Join the [Agentic Evolution Hackathon Discord](https://discord.gg/GnBNJpXk5) to ask questions to our sponsors, meet other participants, get official updates, and begin forming teams.

Everything here is designed to help you go from idea to "it actually works!" as fast as possible.

---

## MongoDB Pre-Hackathon Enablement

[The Modern Data Architecture Mastery Series](https://www.mongodb.com/resources/solutions/use-cases/webinar-modern-data-mastery-ai-search/?utm_campaign=rev-mktg-west&utm_source=sales-outbound)

> **Deep summaries with progressive discovery:** [`mongodb/00-pre-hackathon-webinars/`](./mongodb/00-pre-hackathon-webinars/) (start with [README](./mongodb/00-pre-hackathon-webinars/README.md)). Each summary captures TL;DR, key takeaways, what's covered, and when to dive into the source video.

- **[Webinar 1] Relational to Document Model**, [Watch Webinar #1 on-demand](https://www.youtube.com/live/Q_lnTtPzGAA), [summary](./mongodb/00-pre-hackathon-webinars/01-relational-to-document-model.md)
- **[Webinar 2] Vector Search Fundamentals**, [Watch Webinar #2 on-demand](https://www.youtube.com/live/13GkAGIg9Do), [summary](./mongodb/00-pre-hackathon-webinars/02-vector-search-fundamentals.md)
- **[Webinar 3] RAG With MongoDB**, [Watch Webinar #3 on-demand](https://www.youtube.com/live/ZoYXZAvGDzM), [summary](./mongodb/00-pre-hackathon-webinars/03-rag-with-mongodb.md)
- **[Webinar 4] AI Agents With MongoDB**, no public YouTube link in the hackathon guide. MongoDB resource page: <https://www.mongodb.com/resources/solutions/use-cases/webinar-ai-agents-with-mongodb>, [summary](./mongodb/00-pre-hackathon-webinars/04-ai-agents-with-mongodb.md)
- **[Webinar 5] Sharding Strategies**, [Watch Webinar #5 on-demand](https://www.youtube.com/watch?v=_YPcqVwOJs4), [summary](./mongodb/00-pre-hackathon-webinars/05-sharding-strategies.md)

---

## MongoDB

Your central resource for guides, code samples, and tools to help you quickly build prototypes with MongoDB.

> **Deep summaries with progressive discovery:** [`mongodb/`](./mongodb/) (start with [README](./mongodb/README.md)). 31 resources across 7 sub-folders, each with TL;DR, key takeaways, what's covered, and when to dive into the source. Recommended hackathon path: `04-chatbots-and-agents` + `05-rag-and-memory` + `06-memory-and-caching`.

### Key Resources (including sample data) to get you started

- [Load the sample Mflix Dataset](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix), Quickly spin up sample data to kickstart your project. `sample_mflix.embedded_movies` already contains vector embeddings for Vector Search.
- [Data Modelling in MongoDB](https://www.mongodb.com/docs/manual/data-modeling/#data-modeling), Learn best practices for structuring your data.
- [MongoDB Tools](https://www.mongodb.com/try/download/database-tools), Explore essential tools to optimize your development workflow.
- [MongoDB Aggregations](https://www.mongodb.com/docs/manual/aggregation/), Master data processing and analysis with powerful aggregation pipelines.
- [MongoDB Atlas Search](https://www.mongodb.com/docs/atlas/atlas-search/), Build lightning-fast search experiences directly within your database.
- [MongoDB Vector Search](https://www.mongodb.com/products/platform/atlas-vector-search), Supercharge your apps with AI-driven search capabilities.
- [AI Learning Hub](https://www.mongodb.com/resources/use-cases/artificial-intelligence), Dive into AI with MongoDB, guides, tutorials, and more.

### Quickstarts: Get up and running with practical, hands-on guides

- [Voyage AI Quickstart + Tutorial](https://docs.voyageai.com/docs/quickstart-tutorial), Implement a specialized chatbot with RAG stack using embedding models.
- [Getting started with MongoDB Atlas and Python](https://github.com/mongodb-developer/mongodb-atlas-python-quickstart/blob/main/quickstart-1-getting-started-atlas-python.ipynb), Building powerful apps with Python and Atlas.
- [Perform Semantic Search on Your Data Using MongoDB Atlas](https://www.mongodb.com/docs/atlas/atlas-vector-search/tutorials/vector-search-tutorial/#std-label-vector-search-tutorial), Unlock deeper insights with advanced semantic search techniques.

### Code Samples & Showcase: Explore practical examples and full-stack applications

- [The MongoDB GenAI-Showcase](https://github.com/mongodb-developer/GenAI-Showcase/tree/main), Discover a collection of examples, sample code, and cookbooks to jumpstart your projects, and learn how to integrate MongoDB Atlas with frameworks like LangChain, LlamaIndex, and model providers like OpenAI, Cohere, and Hugging Face.
- [MongoDB GenAI Showcase Chatbot](https://mdbai-assistant.vercel.app/?utm_term=karissa.fuller&utm_medium=genai-showcase-bot), Quickly find the right examples and resources from the GenAI Showcase with the help of our chatbot.
- [The MongoDB Chatbot Framework](https://github.com/mongodb/chatbot), Explore a set of libraries for building full-stack intelligent chatbot applications using MongoDB Atlas Vector Search.
- [MEAN, Sample CRUD Application with MEAN Stack](https://github.com/mongodb-developer/mean-stack-example), Build full-stack apps using MongoDB, Express, Angular, and Node.js (MEAN).
- [MERN, MERN Stack Code for the MERN Tutorial](https://github.com/mongodb-developer/mern-stack-example), Develop full-stack apps with MongoDB, Express, React, and Node.js (MERN).
- [Java, Java Quick Start Code Samples](https://github.com/mongodb-developer/java-quick-start), Kick off your Java projects with sample code and best practices for integrating MongoDB.
- [Java Spring Boot REST APIs](https://github.com/mongodb-developer/java-spring-boot-mongodb-starter), Learn to build REST APIs using Spring Boot and MongoDB.
- [Getting Started with MongoDB and Java, CRUD Operations Tutorial](https://www.mongodb.com/developer/languages/java/java-setup-crud-operations)
- [Build a Java-Powered Movie Search Engine with Atlas Vector Search and Spring Boot](https://www.mongodb.com/developer/products/atlas/java-spring-boot-vector-search)

### Chatbots and AI Agents: Build intelligent chatbots and dynamic agents using MongoDB and AI

- [Build a smart PDF chatbot with Mistral AI and MongoDB Atlas](https://www.mongodb.com/developer/products/mongodb/mistral-ai-integration)
- [Building an Interactive RAG Agent with MongoDB Atlas and Function Calling](https://www.mongodb.com/developer/products/atlas/interactive-rag-mongodb-atlas-function-calling-api/)
- [Build an intelligent HR chatbot with seamless integration of LangChain, OpenAI, and Google APIs](https://github.com/mongodb-developer/hr_agentic_chatbot)
- [Internal Enterprise Search Chatbots and Customer Service Chatbots](https://github.com/mongodb-partners/maap-chatbot-builder)

### RAG and Memory: Resources to help you build and optimize RAG applications

- [How to Choose the Right Embedding Model for RAG](https://www.mongodb.com/developer/products/atlas/choose-embedding-model-rag/), Learn how to select the best embedding model to optimize your Retrieval-Augmented Generation (RAG) applications.
- [Building a RAG System using LlamaIndex, OpenAI, and MongoDB Atlas](https://www.mongodb.com/developer/products/atlas/rag-with-polm-stack-llamaindex-openai-mongodb), Step-by-step guide to building a powerful RAG system using LlamaIndex, OpenAI, and MongoDB Atlas.
- [How to Evaluate Your RAG Application](https://www.mongodb.com/developer/products/atlas/evaluate-llm-applications-rag), Discover best practices for evaluating and fine-tuning your RAG application for optimal performance.
- [MongoDB-RAG NPM](https://www.npmjs.com/package/mongodb-rag?activeTab=readme), Easily perform vector search, caching, batch processing, and indexing with this powerful NPM module for fast, accurate data retrieval using MongoDB Atlas.

### Memory and Caching: Implement advanced memory features in your applications

- [Enhance your RAG app with semantic caching and memory using MongoDB Atlas and LangChain](https://www.mongodb.com/developer/products/atlas/advanced-rag-langchain-mongodb/)
- [Add memory to your JavaScript RAG application using MongoDB Atlas and LangChain](https://www.mongodb.com/developer/products/atlas/add-memory-to-javascript-rag-application-mongodb-langchain/)

### Advanced AI and Vertex AI Integrations: Enhance your applications with advanced AI capabilities

- [Public Repo for Reasoning Engine on Google Cloud Vertex AI](https://github.com/mongodb-partners/MongoDB-VertexAI-Reasoning-Engine)
- [Supercharge your project with Vertex AI Extensions](https://github.com/mongodb-partners/MongoDB-VertexAI-extensions)

---

## AWS

Amazon Web Services (AWS) is the world's most comprehensive and broadly adopted cloud platform, offering over 200 fully featured services from data centers globally.

**Resources:**

- AWS Free Tier, Hackathon Participant Guide, captured locally: [`aws/participant-guide.md`](./aws/participant-guide.md). Folder: [`aws/`](./aws/).

---

## ElevenLabs

Build voice AI applications with realistic speech generation.

**Resources:**

All participants receive 1 month free access to the ElevenLabs Creator tier ($22 value).

### Free ElevenLabs Credits

On the day of the hackathon, participants will receive a unique ElevenLabs coupon code via the email used to register on the Cerebral Valley platform.

- Create an ElevenLabs account (or log in to an existing one).
- Navigate to **Billing -> Redeem Coupon Code** in your ElevenLabs dashboard.
- Enter your assigned coupon code to activate your free Creator tier access.

Additional links:

- [Hacker Guide](https://docs.google.com/document/d/1mCh5MtOzBw0aJpurQVUmIVFfPMAHW3MjNemE-LNiMto/edit?usp=sharing)
- For all projects using ElevenLabs: After the event, please submit your project to [showcase.elevenlabs.io](http://showcase.elevenlabs.io/)

> **Best Project Built with ElevenLabs:** Each team member receives 6 months of the Scale tier ($1980 value/team member).

---

## Fireworks AI

Fireworks AI: The fastest inference for Generative AI.

**Resources:**

- https://docs.fireworks.ai/getting-started/introduction

---

## LangChain

LangChain provides the engineering platform and open source frameworks developers use to build, test, and deploy reliable AI agents.

**Resources:**

- Redeem your $50 in LangSmith credits for the Hackathon [here](https://airtable.com/appzjKToipPcn2dKI/pagTsO0Ld3edczsrV/form).
  - Note: you'll need to sign up for LangSmith and add a credit card to your account, your card will not be charged. You just need to add it in order to display these credits.
- https://chat.langchain.com/
- https://academy.langchain.com/
- https://docs.langchain.com/oss/python/concepts/products
- https://docs.langchain.com/oss/python/langchain/overview
- https://docs.langchain.com/oss/python/deepagents/quickstart
- https://docs.langchain.com/oss/python/langgraph/overview

---

## LiveKit

LiveKit: Build voice, video, and physical AI agents.

An open source framework and developer platform for building, testing, deploying, scaling, and observing agents in production.

**Resources:**

- https://www.livekit.info/

---

## NVIDIA

NVIDIA NemoClaw is an open source reference stack that simplifies running OpenClaw always-on assistants, with a single command.

**Resources:**

- Check it out here: https://github.com/NVIDIA/NemoClaw

---

## Notes on capture

Captured 2026-05-01 by automating the live Notion page in Playwright, expanding all top-level toggles plus the 7 nested MongoDB sub-toggles and the ElevenLabs "Free ElevenLabs Credits" sub-toggle, then walking the DOM in document order and pulling every `<a href>` along with the surrounding bullet text.

The Notion page intro mentions partners **Emergent, Factory, and Replit** alongside the eight that have toggle sections. Those three did not have toggle sections published at capture time, so no resources were available for them on the page.

The AWS section's "Hackathon Participant Guide" PDF is a Notion file attachment without a public URL, download it from the live page if needed.
