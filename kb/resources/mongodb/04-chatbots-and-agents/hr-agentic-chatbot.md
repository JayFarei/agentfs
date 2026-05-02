---
title: "HR Agentic Chatbot"
source: https://github.com/mongodb-developer/hr_agentic_chatbot
type: github-repo
captured: 2026-05-01
---

## TL;DR

Reference implementation of an HR domain agent built with LangChain, MongoDB, OpenAI, and Google APIs, served through a Chainlit web UI. Shows what a multi-tool agent that reads a database and takes real actions, like sending email or creating a Doc, looks like in practice.

## Key Takeaways

- LangChain orchestrates the agent and a LangGraph graph drives the control flow.
- MongoDB stores both the operational HR data (companies, workforce, employees) and the embeddings used for semantic employee lookup.
- Tools are split into `mongodb_tools.py` for data queries and `google_tools.py` for Drive, Docs, and Gmail actions, a clean separation between read and side-effecting tools.
- Includes a synthetic data generator so the repo runs end to end without a real HR dataset.
- Chainlit gives you a chat UI for free, including streaming and a thread sidebar.
- A MongoDB-backed checkpointer (`mongodb/checkpointer.py`) persists agent state so conversations survive restarts.

## What's Covered

### Stack and dependencies

Python 3.8+, LangChain, OpenAI for embeddings and chat completion, MongoDB Atlas for storage and vector search, Google Cloud OAuth for Drive, Docs, and Gmail. Chainlit (`chainlit run app.py`) hosts the UI on `localhost:8000`.

### Repo layout

- `agent.py` and `graph.py` define the agent and its LangGraph state graph.
- `tools/mongodb_tools.py` exposes data lookup tools backed by the MongoDB driver, including vector search over employee embeddings.
- `tools/google_tools.py` exposes Google Drive, Docs, and Gmail actions that require user OAuth (`credentials.json`, `token.json`).
- `mongodb/connect.py` centralizes the client, `mongodb/checkpointer.py` implements a LangGraph checkpointer using MongoDB.
- `data/synthetic_data_generation.py` produces `companies.json`, `workforce.json`, `employees.json`; `data/ingestion.py` embeds employees with OpenAI and writes everything to MongoDB.
- `app.py` is the Chainlit entry point that wires the agent to the chat surface.

### Setup flow

1. Clone, create a venv, `pip install -r requirements.txt`.
2. `.env` with `MONGO_URI` and `OPENAI_API_KEY`.
3. Create a Google Cloud project, enable Drive, Docs, and Gmail APIs, create a Desktop OAuth client, save as `credentials.json`. First run prompts for browser consent and writes `token.json`.
4. Run `python data/synthetic_data_generation.py` to create JSON, then `python data/ingestion.py` to embed and load MongoDB.
5. `chainlit run app.py` to start chatting.

### Agent shape

The agent is built as a LangGraph graph rather than a plain ReAct loop, which means explicit nodes and edges for tool selection, tool execution, and response generation. The MongoDB checkpointer means each conversation thread has durable state, useful for multi-turn HR workflows.

### What's wired up

Out of the box the agent can answer questions over the synthetic HR data using vector search on employee embeddings, look up structured data via MongoDB queries, and perform Google actions like drafting an email or creating a Doc on the user's behalf.

## When to dive into the source

- You want a concrete example of a domain agent that mixes read tools (database) with side-effecting tools (email, Docs).
- You are choosing between LangChain plus LangGraph and a hand-rolled agent loop.
- You need a working MongoDB-backed LangGraph checkpointer to copy.
- Skip if: you only need a pure RAG chatbot with no external actions, this is more machinery than you need.

## Source

- Primary: https://github.com/mongodb-developer/hr_agentic_chatbot
- Related: LangChain docs, LangGraph docs, Chainlit docs
