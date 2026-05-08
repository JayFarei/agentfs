---
title: "MongoDB-VertexAI-extensions"
source: https://github.com/mongodb-partners/MongoDB-VertexAI-extensions
type: github-repo
captured: 2026-05-01
---

## TL;DR

A tutorial repo that registers a Vertex AI Extension which lets Gemini run natural-language CRUD and aggregation against an Atlas cluster via the MongoDB Data API. The OpenAPI spec plus a Colab notebook are the deliverables.

## Key Takeaways

- The integration is built on the MongoDB Atlas Data API, fronted by an OpenAPI 3 spec stored in a GCS bucket and registered as a Vertex AI Extension manifest.
- Gemini converts natural-language requests into function calls whose schemas come from `mdb_crud.operation_schemas()`, then the extension executes them against Atlas.
- The API key for the Data API is stored in Google Secret Manager and referenced from the manifest via `apiKeyConfig` with `httpElementLocation: HTTP_IN_HEADER`.
- The notebook walks through findOne, find many, insertOne, updateOne, deleteOne, and aggregate against the `sample_mflix.movies` collection.
- Vertex AI Extensions required Trusted Tester enrollment at capture time, and the repo pins an internal pre-release wheel (`google_cloud_aiplatform-1.44.dev20240315+llm.extension`).
- For the Agentic Evolution Hackathon top six on AWS, this is reference only, but the OpenAPI-spec-as-tool pattern transfers cleanly to Bedrock action groups.

## What's Covered

### Repo contents

Two main artifacts: `notebook/Mongodb vertex AI integration.ipynb` (the end-to-end walkthrough) and `open-api-spec/mdb-data-api.yaml` (the OpenAPI 3 spec describing CRUD endpoints on the Atlas Data API). The README is itself a tutorial-blog with code snippets for each step.

### Prerequisites and setup

Requires a GCP account with Vertex AI access (Extensions Trusted Tester program), an Atlas cluster with the Data API enabled, the Google Cloud SDK locally, and the API key stored as a secret in Secret Manager. Colab cells call `gcloud config set project` and `auth.authenticate_user` to bind to a project, then `aiplatform.init(project, location, staging_bucket)` to bootstrap the SDK.

### Extension manifest format

The manifest passed to `llm_extension.Extension.create` has these top-level keys: `display_name`, `description`, and `manifest` (with `name`, `description`, `api_spec.open_api_gcs_uri`, and `auth_config`). Authentication uses `authType: API_KEY_AUTH` and an `apiKeyConfig` block pointing at a Secret Manager resource path like `projects/{num}/secrets/{name}/versions/{ver}`. The OpenAPI YAML lives in a GCS bucket and is referenced by `gs://...` URI.

### Natural-language to CRUD flow

The pattern in every example is the same. Start a chat with `GenerativeModel("gemini-1.0-pro").start_chat()`, send the user prompt with `tools=[Tool.from_dict({"function_declarations": mdb_crud.operation_schemas()})]`, then take the resulting `function_call.name` and `function_call.args` and pass them to `mdb_crud.execute(operation_id=..., operation_params=...)`. The notebook repeats this pattern across findOne, find many, insertOne, updateOne, deleteOne, and aggregate operations.

### Required dependencies

A private wheel pulled from `gs://vertex_sdk_private_releases/llm_extension/`, plus `google-cloud-resource-manager`, `langchain==0.0.298`, `pytube`, `google-auth`, and `bigframes==0.26.0`. The langchain pin is for an unrelated ReasoningEngine section also referenced in the repo.

### Sample data and queries

All examples target `sample_mflix.movies` on a cluster called `VertexAI-POC`. Sample prompts include "Find the release year of the movie 'A Corner in Wheat'", "give me movies released in year 1924", "create a movie named 'My first movie' which is released in the year 2024", and similar update, delete, and count operations.

## When to dive into the source

- You want to copy the OpenAPI spec for the Atlas Data API as a starting point for any tool-calling LLM, including non-Vertex setups like Bedrock action groups or OpenAI function calling.
- You are building a Gemini-based agent that needs CRUD-over-natural-language against Atlas and want a complete manifest plus auth config to crib from.
- You need to see how to bind an API key from Secret Manager into a Vertex AI Extension manifest.
- Skip if: you are not on Google Cloud, since the Extensions API and the private SDK wheel have no AWS analogue. The general pattern transfers, but the SDK code does not.

## Source

- Primary: https://github.com/mongodb-partners/MongoDB-VertexAI-extensions
- Related: https://github.com/mongodb-partners/MongoDB-VertexAI-Reasoning-Engine, https://www.mongodb.com/docs/atlas/app-services/data-api/generated-endpoints/, https://cloud.google.com/vertex-ai/generative-ai/docs/extensions/overview
