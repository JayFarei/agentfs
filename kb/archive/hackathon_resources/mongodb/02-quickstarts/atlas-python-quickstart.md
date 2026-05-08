---
title: "MongoDB Atlas Python Quickstart (Notebook Series)"
source: https://github.com/mongodb-developer/mongodb-atlas-python-quickstart/blob/main/quickstart-1-getting-started-atlas-python.ipynb
type: github-repo
captured: 2026-05-01
---

## TL;DR

Official MongoDB Developer Relations notebook series for getting Python developers onto Atlas. The linked file is "quickstart-1: getting started", the first in a multi-part series, so open the repo root to scan the full sequence before committing to a single notebook.

## Key Takeaways

- Maintained on the `mongodb-developer` GitHub organization, signaling first-party Developer Advocacy provenance rather than community content.
- Delivered as Jupyter notebooks (`.ipynb`), runnable locally or in Colab without writing project scaffolding.
- The captured page is just the first notebook (`quickstart-1-getting-started-atlas-python.ipynb`, 332 lines, 11.8 KB), so the full educational arc lives across sibling notebooks in the same repo.
- This is the right starting point for a hackathon team that has Python skills but has never connected to Atlas before, since it covers the connection and basic CRUD layer that later genai-focused samples assume.

## What's Covered

### Notebook 1: getting started

Based on the file name and size, the notebook covers the foundational path: installing `pymongo`, getting an Atlas connection string, opening a `MongoClient`, picking a database and collection, and running the basic insert/find/update/delete operations. Defuddle returned only the GitHub file shell rather than the rendered notebook cells, so confirm specifics by opening the notebook directly.

### Series structure (inferred)

The naming convention `quickstart-1-...` strongly implies follow-up notebooks (`quickstart-2`, `quickstart-3`, etc.) covering progressively richer topics such as aggregation, indexes, and likely vector search given the org's recent focus. Browse the repo root to enumerate.

### How to consume

- Open `https://github.com/mongodb-developer/mongodb-atlas-python-quickstart` to list every notebook in order.
- Click "Open in Colab" if available, or `git clone` and run with a local Jupyter kernel.
- Have an Atlas free-tier cluster ready before starting, the first notebook will ask for the SRV connection string.

## When to dive into the source

- You are onboarding a Python teammate who has never used Atlas, and want a single linkable starting point.
- You want a known-good `pymongo` connection snippet to copy into a hackathon project.
- You want to see the full curriculum of notebooks, not just notebook 1, since the repo root is the only place where the series order is visible.
- Skip if: your team already has a working Atlas connection and you only need vector search or RAG patterns, in which case go to `../03-code-samples/genai-showcase.md` and the Atlas Vector Search tutorial instead.

## Source

- Primary: https://github.com/mongodb-developer/mongodb-atlas-python-quickstart/blob/main/quickstart-1-getting-started-atlas-python.ipynb
- Related (repo root): https://github.com/mongodb-developer/mongodb-atlas-python-quickstart
