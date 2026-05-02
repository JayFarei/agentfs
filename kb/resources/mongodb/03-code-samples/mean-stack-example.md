---
title: "MEAN Stack Sample CRUD Application"
source: https://github.com/mongodb-developer/mean-stack-example
type: github-repo
captured: 2026-05-01
---

## TL;DR

A minimal CRUD reference app built on MongoDB, Express, Angular, and Node.js, runnable with a single `npm start` once your Atlas URI is configured. Useful as a starting point when you want a JavaScript stack with a strongly-typed Angular front end instead of React.

## Key Takeaways

- Stack: MongoDB Atlas + Express + Angular + Node.js (MEAN), full CRUD only, no auth or AI.
- Configuration is one environment variable in `server/.env`: `ATLAS_URI`.
- A single `npm start` boots both the server and the Angular client.
- The Angular dev server runs on port 4200 (`http://localhost:4200/`), the standard Angular CLI default.
- Has a step-by-step companion tutorial linked from the README.
- Disclaimer: not a supported MongoDB product, use at your own risk.

## What's Covered

### Project layout

The repo splits into a `server` directory (Express + Node) and a client directory (Angular). The server reads `ATLAS_URI` from `server/.env` and connects to a database named `meanStackExample` by default.

### Configuration

```
ATLAS_URI=mongodb+srv://<username>:<password>@sandbox.jadwj.mongodb.net/meanStackExample?retryWrites=true&w=majority
```

Replace the placeholders with credentials from your Atlas cluster, save under `server/.env`.

### Run

`npm start` from the project root builds and starts both apps. Open `http://localhost:4200/` once both are up.

### Companion tutorial

The README links to a full tutorial at `mongodb.com/languages/mean-stack-tutorial` that walks through the same code with explanation, useful if you want narrative context instead of just running the sample.

## When to dive into the source

- You want a working Angular + Express + MongoDB skeleton and prefer Angular over React.
- You need to demonstrate a baseline CRUD pattern before layering on hackathon-specific logic.
- Skip if: you want React (use ./mern-stack-example.md), or you need AI/vector search features (use ./genai-showcase.md).

## Source

- Primary: https://github.com/mongodb-developer/mean-stack-example
- Related: https://www.mongodb.com/languages/mean-stack-tutorial (step-by-step companion)
