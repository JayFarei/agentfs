---
title: "MERN Stack Sample Application"
source: https://github.com/mongodb-developer/mern-stack-example
type: github-repo
captured: 2026-05-01
---

## TL;DR

The reference MERN app (MongoDB, Express, React, Node.js) that backs MongoDB's official MERN tutorial. Tiny in scope, deliberately minimal, and useful as the bare-bones starting point for any React-fronted hackathon project that needs a MongoDB-backed API.

## Key Takeaways

- Stack: MongoDB Atlas + Express + React + Node.js, separate `server` and `client` directories.
- Server reads `ATLAS_URI` and `PORT` from `mern/server/config.env`.
- Client uses Vite (`npm run dev`), not Create React App.
- Default ports: server 5050, client whatever Vite picks (typically 5173).
- CI is wired up via GitHub Actions, so the repo always builds in main.
- Disclaimer: not a supported MongoDB product, use at your own risk.

## What's Covered

### Project layout

The repo nests both apps under a `mern/` directory: `mern/server` (Express + Node) and `mern/client` (Vite + React). Each has its own `package.json`, you `npm install` in both.

### Configuration

Create `mern/server/config.env`:

```
ATLAS_URI=mongodb+srv://<username>:<password>@sandbox.jadwj.mongodb.net/
PORT=5050
```

### Run order

```
cd mern/server
npm install
npm start

cd mern/client
npm install
npm run dev
```

The server must be running before the client makes API calls.

### Companion tutorial

The README points at `mongodb.com/languages/mern-stack-tutorial` for a guided walkthrough of the same code.

## When to dive into the source

- You need a React + Express + MongoDB skeleton to drop your hackathon UI on top of.
- You want the Vite-based modern setup rather than Create React App.
- Skip if: you prefer Angular (use ./mean-stack-example.md), or you need AI/vector search out of the box (use ./genai-showcase.md).

## Source

- Primary: https://github.com/mongodb-developer/mern-stack-example
- Related: https://www.mongodb.com/languages/mern-stack-tutorial (step-by-step companion)
