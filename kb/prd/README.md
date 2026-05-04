---
title: "Datafetch — Product Design Workspace"
type: prd
status: design-target
date: 2026-05-04
---

# Datafetch

Datafetch turns a mounted dataset into a Unix-shaped workspace where intelligent, composable, learning-over-time TypeScript functions live alongside the data. A user mounts a source (Atlas, HuggingFace, Postgres, JSONL); a tenant works against it through typed function calls; the system gets cheaper and more idiomatic per tenant over time, and the dataset surface gets richer for everyone.

The architectural shape: agents see a real bash shell over a mounted virtual filesystem. They explore with `ls` / `cat` / `grep`, run TypeScript with `npx tsx`, and write new files when they need to. Behind the shell, every typed call routes to a sandbox alongside the data; every trajectory is mined; functions crystallise; the surface compounds across tenants of the same dataset.

---

## Where to start

| You want | Read |
|---|---|
| The full design, top-down | [`design.md`](./design.md) |
| The locked architectural decisions | [`decisions.md`](./decisions.md) |
| What it looks like for each persona (provider / user / agent) | [`personas.md`](./personas.md) |
| What the prototype delivers today vs the design target | [`snapshot/`](./snapshot/) |

The natural reading order is `design.md` (5–20 minutes depending on depth) → `personas.md` (concrete code samples) → `decisions.md` (a one-page reference of locked points).

---

## Status

Working design, pre-implementation. The prototype currently in this repo (see `snapshot/01-prototype-walkthrough.md`) delivers a subset of the design's behaviour for FinQA over MongoDB Atlas. The forward-looking work captured in `design.md` re-uses much of the prototype's substrate, but reshapes the agent's interface around just-bash and rebuilds the SDK around a single-function-factory model.

---

## Editing convention

`design.md` is the source of truth for the architecture. `decisions.md` is the audit log of locked design choices. `personas.md` evolves as we iterate on the persona mocks. `snapshot/` is the retrospective on the current prototype — useful as reference, will decay as the prototype catches up to the design.

When iterating, prefer editing `design.md` and adding a new entry to `decisions.md` over creating new top-level documents.
