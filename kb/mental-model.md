---
title: "MongoDB-AE-Hackathon, Mental Model"
type: evergreen
tags: [magic-docs]
updated: 2026-05-01
snapshot_commit: ""
---

# Mental Model

Shared vocabulary between human and AI. Defines every primitive, entity, state, and relationship in the product. Each term should trace back to a specific construct in the codebase or the eval methodology.

This document is the source of truth when two collaborators (or two future sessions) disagree about what a word means. If a term is missing here, define it before using it.

> Snapshot commit field is empty until the first codebase scan. Run `/mental-model`
> once `MongoFS` and the eval harness exist to populate this from the repo.

---

## Primitives

The smallest, irreducible concepts in the system.

### File

A node in the virtual filesystem mounted at `/datafetch/`. Every file is one of:

- **Synthesised module file** (`db/<coll>.ts`, `views/<name>.ts`): generated lazily on `readFile` by MongoFS. Read-only.
- **Procedure file** (`procedures/<name>.ts`): user-endorsed deterministic TypeScript, lives in the AgentFS overlay. Writable.
- **Scratch file** (`scratch/...`): in-flight workspace, lives in the AgentFS overlay. Writable.
- **Synthetic JSON** (`db/<coll>/_samples.json`, `db/<coll>/_schema.json`): generated on demand by MongoFS for sampling and schema introspection.
- **Trajectory view** (`_trajectories/...`): read-only JSON view over rows in the AgentFS `tool_calls` table.

### Typed call

A single invocation of a method on a synthesised module: `db.packages.findExact(...)`, `db.advisories.findRelatedToPackage(...)`. Every typed call generates a row in `tool_calls`.

### Trajectory

An ordered sequence of typed calls produced by one agent run. Stored as rows in `tool_calls` joined by a session id. The trajectory is itself valid TypeScript when the import resolution is fixed up (`procedures/`-friendly form), which is why crystallisation is `git add` plus `git commit` with no translation step.

### Schema

The structural shape of a MongoDB collection inferred from sampling its documents, produced by `mongodb-schema`. Includes per-field types, optionality, nesting, and inferred index hints.

### Schema fingerprint

`sha256(canonical_json(schema))`. Exported as a constant in every synthesised module: `export const SCHEMA_VERSION = "sha256:..."`. Procedures pin themselves to the fingerprints of the modules they import.

### Endorsement

A user decision after a trajectory completes: the binary outcome of the review prompts (correct / satisfies intent / needs more). A positive endorsement is the gate for crystallisation.

### Procedure

A typed TypeScript function in `procedures/<name>.ts`, written by the crystallisation pipeline from an endorsed trajectory. Pinned to the schema fingerprints of its imports. Has an optimisation budget. May be optimised into a single Atlas aggregation pipeline.

### Optimisation budget

A virtual currency allocated to a procedure on promotion. Spent by the optimisation worker on one of: compile-to-pipeline, pre-compute and cache, build a dedicated index, refine the typed signature.

### Verifier

A check that runs before a procedure is promoted: replay the procedure against shadow inputs, compare the result to the trajectory's recorded result. Promotion is gated on verifier-pass.

### Match

A signature comparison between a user's snippet and the procedure library. A match routes execution to the deterministic path, no LLM in the loop.

---

## Entities

The first-class nouns the system operates on.

### Cluster

A MongoDB Atlas M10 cluster (us-east-1) provided for the hackathon. Mounted at `/datafetch/db/`. Read-only at the FS layer.

### Tenant

A logical scope for AtlasFS adaptation, independent of any user identity. A tenant has its own `procedures/` overlay, its own `scratch/` workspace, its own `tool_calls` namespace (filtered by `tenant_id`), and its own cache of synthesised `db/<coll>.ts` modules with per-tenant schema fingerprints. The read-only `db/` and `views/` base is shared across tenants; everything that crystallises is scoped to one tenant.

For the hackathon demo, two tenants are simulated by configuring the agent with different system prompts and different intent priors over the eval set (e.g., "security analyst" weighted toward clusters A and C; "ML researcher" weighted toward B and D). Production-grade auth-isolated multi-tenancy is post-hackathon roadmap.

### Tenant overlay

The per-tenant slice of the AgentFS CoW overlay. Implemented as a tenant-keyed subdirectory under the writable layer. Reads pass through to the read-only base for `db/` and `views/`; writes (and the tenant's view of `procedures/`) land in the tenant's overlay only.

### Collection

A single MongoDB collection inside the cluster. Exposed as `/datafetch/db/<coll>.ts`, a typed module synthesised on `readFile`.

### View

A curated query exposed at `/datafetch/views/<name>.ts`. Composes typed calls across one or more collections into a higher-level retrieval primitive. Authored, not synthesised.

### Session

One agent run. Identified by a session id. Has a parent (the user / harness), a start time, an end time, a final-result payload, and a sequence of typed calls. Backed by AgentFS's CoW overlay so each session is branchable.

### Trajectory

(See Primitives.) The ordered call sequence belonging to a session.

### Procedure

(See Primitives.) The endorsed, typed function in `procedures/`.

### Endorsement

(See Primitives.) The binary user decision attached to a trajectory.

### Round

One pass of the eval harness over the pre-registered task set on one baseline. Every round produces a row per task per baseline in the metric ledger.

### Task

One question in the pre-registered eval set. Carries three labels: answer label (verdict, ranked list), evidence label (required sources), canonical pathway label (near-optimal path length, used to normalise T_n).

### Cluster (intent cluster)

A group of related tasks. Five clusters in the demo eval set: 2 BIRD clusters (e.g., `bird-video-games-publishers`, `bird-formula-1-results`), 2 FinQA clusters (e.g., `finqa-revenue-growth`, `finqa-operating-margin`), 1 supply-chain cluster (`supply-chain-risk-assessment`). Plus 10 out-of-cluster controls. Distinct from "Atlas cluster"; context disambiguates. See `br/06-bird-finqa-corpus.md` for the corpus rationale that drives the cluster breakdown.

### Baseline

One of three system configurations on which the eval is run:
- **Vanilla**: agentic RAG without cross-session memory (LangGraph + Atlas).
- **Static-typed**: typed filesystem primitives, no procedure library.
- **Ours**: typed filesystem + user-endorsed procedure library + budget worker.

### Schema fingerprint

(See Primitives.) The hash that pins a procedure to a collection's structural shape at the time of crystallisation.

---

## States

The lifecycle stages each entity moves through.

### Trajectory states

| State | Meaning |
|-------|---------|
| `novel` | A snippet did not match any procedure; an agent run is starting. |
| `in_progress` | The agent is mid-loop, typed calls are accumulating. |
| `completed` | The agent returned a final result; awaiting user review. |
| `endorsed` | User answered yes on the review prompt; trajectory is queued for crystallisation. |
| `rejected` | User answered no; trajectory is preserved (for debugging / drift) but not promoted. |
| `crystallised` | A procedure file was written; further work is on the procedure entity. |

### Procedure states

| State | Meaning |
|-------|---------|
| `drafted` | File exists in `procedures/`, verifier has not run. |
| `verified` | Verifier replayed the procedure against shadow inputs and matched. |
| `promoted` | Verifier-pass plus published in the user-visible library; available for matching. |
| `optimised` | Body has been replaced by a compiled pipeline; LLM no longer in the hot path. |
| `drifted` | Schema fingerprint pin is stale; flagged in the library pane. |
| `broken` | Drift was tested against the eval and the procedure failed; held out of matching until re-derived. |

### Schema states

| State | Meaning |
|-------|---------|
| `stable` | Fingerprint matches what is pinned across all dependent procedures. |
| `drifting` | A change-stream event has fired but fingerprint recompute is pending. |
| `changed` | Fingerprint has changed; dependent procedures are flagged. |

### Budget states

| State | Meaning |
|-------|---------|
| `allocated` | Procedure was promoted; budget is reserved. |
| `in_flight` | Optimisation worker is running. |
| `spent` | Pay-out succeeded; procedure body has been swapped. |
| `exhausted` | All planned pay-outs have been attempted; no further work scheduled. |
| `rolled_back` | A pay-out failed verification post-swap; body restored to pre-pay-out state. |

### Session states

| State | Meaning |
|-------|---------|
| `active` | Agent loop is running. |
| `awaiting_review` | Trajectory complete, user has not yet endorsed or rejected. |
| `closed` | Endorsement decision recorded; trajectory either crystallised or archived. |

---

## Relationships

How entities connect, depend on, or transform into each other.

### Endorsement -> Procedure

One endorsed trajectory produces exactly one procedure (1:1). Rejection produces zero. The function `endorsement -> procedure` is the crystallisation pipeline.

### Procedure -> Trajectory

Each procedure preserves a back-reference to the trajectory it was crystallised from (1:1). The trajectory is the procedure's audit trail.

### Procedure -> Schema fingerprint

A procedure pins one or more schema fingerprints (n:1 per fingerprint, 1:n per procedure). The pins are the drift-detection key.

### Schema change -> Procedure flag

One schema change fan-outs to all procedures whose pin matches the *old* fingerprint (1:n). The walk uses ts-morph against `procedures/`.

### Optimisation budget -> Procedure

Each procedure has at most one active budget allocation (1:1). The budget is spent on at most one pay-out at a time.

### Match -> deterministic execution

A match between a user snippet and a procedure routes execution away from the agent (1:1). No new trajectory is recorded as `novel`; instead, a determined call is logged with `mode: "deterministic"`.

### Task -> intent cluster

Each task belongs to exactly one intent cluster (n:1). Out-of-cluster controls form a synthetic cluster used as a flat-curve baseline.

### Round -> task -> baseline

Each round generates one metric row per (task, baseline) pair (1:n:n). The metric ledger is the source for the cluster heatmap, the procedure library pane, and the divergence chart.

### Trajectory -> tool_calls

Each trajectory is a contiguous range of rows in `tool_calls`, joined by session id, ordered by `started_at` (1:n).

### Tenant -> Procedure (1:n)

Each procedure belongs to exactly one tenant. Two procedures with identical TypeScript bodies under different tenants are still distinct procedures with separate fingerprint pins, separate budget allocations, and separate trajectory back-references. The `db/` base is shared; the `procedures/` crystal lattice is tenant-private.

### Tenant -> Trajectory (1:n)

Each trajectory belongs to exactly one tenant via `tool_calls.tenant_id`. A session inherits its tenant from the agent harness configuration. Cross-tenant trajectory access is structurally forbidden at the audit-log layer.

---

## Metrics

The four convergence axes plus the cost and correctness controls.

### T_n, trajectory length

Number of typed calls in a trajectory, normalised by the canonical-pathway label for the task. Lower is better. Within-cluster T_n should fall sharply from round 0 to round 5; out-of-cluster T_n should stay flat.

### D_n, determinism rate

Fraction of trajectory steps that ran in deterministic mode (matched to a procedure) versus partial mode (procedure suggested a path but agent extended it) versus escalated (full LLM reasoning required). Higher is better. Should rise across rounds within-cluster.

### R_n, reuse rate

Fraction of round-n procedures actually called in round n+1. The first-class metric that inoculates against *Library Learning Doesn't*. By construction should be high (every procedure was endorsed before promotion).

### I_n, information rate per action

On a needle-in-haystack probe inside the eval set: the fraction of necessary evidence sources retrieved per typed call. Higher is better.

### L_n, library divergence

Jaccard distance between two tenants' procedure signature sets at round n. Higher means more tenant-specific structure has emerged from the same data plane. Computed across at least two simulated tenants in the demo eval, each with its own `procedures/` overlay and intent priors. The metric inoculates against the trivial reading "all tenants converge to the same library" and makes Dimension 1 (interface emergence across tenants) measurable rather than asserted.

L_n only applies to "ours"; the vanilla and static-typed baselines do not have per-tenant procedure libraries, so L_n is undefined or zero for them. This is itself a feature of the comparison: the divergence chart shows a property the baselines structurally lack.

### Token cost

Cumulative input plus output tokens consumed by the agent per task. Lower is better. Falls to ~zero when D_n approaches 1 (deterministic mode skips the LLM).

### Wall-clock time

End-to-end seconds per task. Lower is better. Falls dramatically when the optimisation worker compiles a procedure to a single aggregation pipeline.

### Correctness

Pass / fail vs the answer label.

### Evidence completeness

Fraction of required evidence sources (per the evidence label) present in the final synthesis.

### Aggregations

Every metric above is reported three ways:
- **Within-cluster**: tasks in the same intent cluster as a previously-seen task. Steep drop expected.
- **Across-cluster**: tasks in a different cluster but sharing sub-procedures. Gentle drop expected (indirect transfer).
- **Out-of-cluster**: 10 control tasks unrelated to the security domain. Flat expected.

The three-curve chart on one axis is the measurable proof of value.
