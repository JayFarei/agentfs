---
title: "MongoDB-AE-Hackathon, Mission"
type: evergreen
tags: [magic-docs]
updated: 2026-05-01
hackathon_theme: "Adaptive Retrieval"
working_codename: "AtlasFS"
---

# Mission

The foundational "why" document. Defines the product's reason for being, the problem space it addresses, core values, and decision-making framework. Consult this when asking "should we build this?"

---

## What It Is

A code agent that performs adaptive retrieval inside a virtual filesystem which exposes any MongoDB Atlas cluster as a typed TypeScript codebase. AtlasFS does not impose a schema; it crystallises **query shape** from agent usage, per-tenant. Every successful trajectory is captured by an audit log, presented to the user for review, and, if endorsed, crystallised into a deterministic, typed procedure that imports from the typed filesystem paths. Each new procedure earns an optimisation budget the system spends on compiling it down to a single Atlas aggregation pipeline, removing the LLM from the hot path. Convergence is measured longitudinally on a pre-registered, intent-clustered task set against vanilla agentic RAG and static-typed baselines, on **two orthogonal axes**: cost convergence within a tenant over time, and library divergence across tenants sharing the same data plane.

Built for the MongoDB Agentic Evolution Hackathon (London, 2026-05-02) under the **Adaptive Retrieval** theme.

---

## Core Insight

**AtlasFS crystallises query shape, not document shape.**

MongoDB collections are typically polymorphic across documents but stable across query intents once an application matures. A product catalog has wildly different attributes for shirts versus laptops versus books, but the queries against it repeat: by SKU, by category, by price range, by availability. A clinical-study corpus has heterogeneous document structures, but the queries are ritualised: extract eligibility criteria, build adverse-events tables, find dosing regimens. A supply-chain corpus has wildly different shapes for npm package metadata, GHSA advisories, and dependency-graph snapshots, but the queries are bounded: "is this safe to install", "what depends on this", "has this maintainer shipped malware before". Polymorphism lives in the *documents*; regularity lives in the *intents*.

This is the axis on which document-store + agent retrieval wins. Trajectory learning crystallises the *query shape*, not the *document shape*, and that is the structure that emerges from usage. Schema is never *imposed* on the data; it is *induced* at three increasingly stable tiers:

1. **Sampled inferred type at `readFile` time**: the most volatile tier. `mongodb-schema` over a sampled set of documents produces a TypeScript interface, possibly polymorphic (a `oneOf` discriminated union when the collection has discriminator fields), with presence-frequency metadata in the JSDoc. Volatile because new documents can shift the inferred type.

2. **Endorsed query trajectory at crystallisation time**: settles per-tenant. The procedure file in `procedures/<name>.ts` captures *which* polymorphic shape mattered for *which* business question, validated by the verifier. Stable until the schema fingerprint changes.

3. **Compiled aggregation pipeline at budget pay-out time**: fully stable. The procedure body becomes a single Atlas aggregation pipeline; the LLM leaves the hot path.

At no tier is structure imposed; at every tier it is induced. This is the gentlest possible posture for a polymorphic, evolving operational store, and it is the answer to the standing critique that MongoDB suits unstructured data while typed surfaces suit structured data. The right axis is not "structured versus unstructured" but "schema-stable across documents" versus "schema-stable across queries" (see `br/02`). MongoDB lives in the second regime; AtlasFS makes it tractable.

### Scaffold versus emergence

The "schema is induced" claim has a subtlety worth naming explicitly. There is a chicken-and-egg paradox in agentic structure-finding: to agentically derive structure, the agent needs typed primitives; but typed primitives seem to require structure already established. The resolution is that the three tiers above are not three points on one gradient. **Tier 1 is mechanical; tiers 2 and 3 are emergent.** They are different kinds of induction with different audiences.

Tier 1 (the bootstrap) is **scaffolding**. It is a deterministic function of the data plus a sampling budget. It exposes a generic, over-typed surface: `oneOf` discriminated unions over all observed polymorphic shapes, presence-frequency metadata in JSDoc, and a fixed set of retrieval primitives (`findExact`, `findSimilar`, `search`, `hybrid`) per collection. The bootstrap surface is intentionally under-useful; every collection looks similar through it. Its job is to give the agent a *vocabulary* in which to explore, not to give the agent the answer.

Tiers 2 and 3 (crystallisation and compilation) are the **emergence**. The agent's trajectory through the bootstrap surface, gated by user endorsement, narrows the over-typed scaffolding into a small, dense, opinionated procedure library that pins specific polymorphic variants and specific primitive compositions per intent. The procedure library is what "schema crystallised from agent usage" actually means.

The bootstrap is shared across tenants on the same cluster (same data, same sampling). The emergent layer diverges per tenant (different intents, different procedures). This is what makes Dimension 1 (interface emergence across tenants) observable rather than asserted: the bootstrap is the control, the crystallised layer is the variable.

The framing that Iceberg and Delta Lake brought schema-on-read to the data-engineering layer is the precedent. AtlasFS brings schema-on-read to the agent layer.

---

## Two Dimensions of Adaptation

The hackathon theme is *Adaptive Retrieval*. AtlasFS adapts in **two orthogonal dimensions**, both visible in the demo and measurable in the eval.

### Dimension 1, across tenants (interface emergence)

Every tenant or cluster of users on the same Atlas cluster crystallises a **different procedure library**. Same data plane, different emergent interfaces. A security analyst's library converges to compliance-flavoured procedures; an ML researcher's library converges to discovery-flavoured procedures; a compliance officer's library converges to audit-flavoured procedures. The data is shared; the interface is private and emergent. Each tenant's typed surface is grown from *that tenant's* trajectory of intents, not from a global pre-design. This is the per-tenant search application story in concrete operational form.

Demo artefact: a two-pane file-tree view showing two simulated tenants' `procedures/` directories diverging across rounds. The same `db/packages.ts` underlies both; the procedure files do not overlap.

Metric: **library divergence L_n** (Jaccard distance between procedure signature sets across tenants at round n). Rises monotonically across rounds as tenants diverge.

### Dimension 2, within a tenant over time (cost convergence)

For a single tenant, a novel intent runs **expensive** (agent ReAct loop over typed primitives, multi-call, LLM in the hot path). A successful trajectory is endorsed. Crystallisation produces a deterministic typed procedure. Optimisation budget compiles the procedure to a single Atlas aggregation pipeline. The same intent on subsequent calls runs **cheap** at deterministic-software speed with no LLM invocation.

Demo artefact: a single intent re-runs three times. Round 0 trajectory is a multi-step red graph. Round 3 trajectory is one deterministic call. The Atlas pipeline the procedure compiled to is shown in a side panel.

Metrics: T_n (trajectory length), D_n (determinism rate), R_n (reuse rate), token cost, wall-clock. All converge over rounds within-cluster.

### Why two dimensions matter

A single dimension of adaptation (cost convergence within a tenant) is the obvious story; many adaptive-retrieval systems have it in some form. The second dimension (interface emergence across tenants from the same data) is the under-told story, and it is exactly what makes the document-store substrate load-bearing. Per-tenant emergent interfaces are infeasible on a relational substrate without per-tenant schemas (heavy, irreversible) or per-tenant ORM layers (manual). On Atlas, with BSON staying polymorphic and the typed view regenerated per-tenant from trajectories, it falls out for free. The two-axis framing is therefore not just a more impressive pitch; it is a structural argument for why this specific substrate is the right one.

---

## The Problem

Three families of prior art each solve a slice; nobody has built the conjunction.

1. **Adaptive RAG (Self-RAG, FLARE, Adaptive-RAG, 2024-2026)** adapts query, chunking, and reranking *within a single run*. The next session starts from scratch. There is no cross-session compounding, the same intent re-pays the same retrieval cost forever.

2. **Code-mode interfaces (Cloudflare Code Mode 2025-26, Anthropic Tool Search 2025)** give the agent a typed namespace instead of a tool catalog and unlock orders-of- magnitude token compression. The interface is **static**: an MCP catalog reflected into a TypeScript namespace at deploy time. It does not evolve from agent usage.

3. **Skill-induction agents (Voyager, ASI / arXiv:2504.06821)** crystallise reusable skills automatically from agent runs. *Library Learning Doesn't* (Berlot-Attwell, NeurIPS MATH-AI 2024) showed the consequence: auto-induced libraries are rarely actually reused. No human-in-the-loop endorsement, no reuse guarantee.

4. **Document-store + agent retrieval today treats schema as something to *impose***. Typed namespaces are reflected at deploy time (Cloudflare Code Mode); validators are enforced at write time (JSON Schema, Mongoose); ORM layers are declared at the application layer (Prisma, Typegoose). None treats schema as something that *crystallises per-tenant from the trajectory of agent queries over polymorphic data*. For a document store with repeating intents, the right schema artefact is the procedure library, induced from usage, scoped per-tenant. That insight is the load-bearing originality claim, validated by the adjacent-projects survey in `br/02` at roughly 80% confidence.

The unclaimed conjunction: **typed retrieval primitives + user-endorsed cross-session interface evolution + deterministic procedure replay + measurable longitudinal compression on intent-clustered tasks + per-tenant crystallisation over a polymorphic document store**. That is the gap this project probes.

The pain felt by the user this addresses: every agent that touches the same Atlas cluster relearns the cluster's shape, the same retrieval pattern, and the same synthesis recipe on every novel run. The user has no way to convert a successful trajectory into a future shortcut, and no way to measure whether the system is getting better. It looks intelligent and is amnesiac.

---

## How It Works

The conceptual arc, not implementation:

1. **Mount.** The user mounts a MongoDB Atlas cluster as `/datafetch/`, served over NFS. Inside the mount they find typed TypeScript modules per collection (`db/packages.ts`, `db/advisories.ts`), curated views (`views/...`), and an initially-empty `procedures/` folder for their personal library.

2. **Query in code.** The user writes a query as a code-mode TypeScript snippet against the typed surface that is visible to them: standard primitives plus any procedures they have already endorsed.

3. **Match or run.** If the query matches an existing procedure, deterministic execution, no LLM in the hot path. If novel, a fresh agent runs a ReAct loop over hybrid Atlas retrieval (structured queries, BM25, vector, multimodal, web). Every step is logged.

4. **Review.** The trajectory is presented to the user with three prompts: correct? satisfies intent? needs more?

5. **Crystallise.** If endorsed, the trajectory becomes a named, typed procedure committed to `procedures/`. The procedure pins itself to the schema fingerprint of every collection it touches. The precedent earns an optimisation budget.

6. **Optimise.** A background worker spends the budget on compiling the procedure into a single Atlas aggregation pipeline (or pre-computed cache, dedicated index, or refined signature). The next call replays at deterministic-software speed.

7. **Measure.** Two axes are tracked across rounds on the pre-registered eval set. The within-tenant axis (Dimension 2) captures cost convergence: trajectory length T_n, determinism rate D_n, reuse rate R_n, information rate I_n, token cost, wall-clock. The across-tenant axis (Dimension 1) captures interface emergence: library divergence L_n (Jaccard distance between tenants' procedure signature sets at round n). The 2D divergence chart shows both simultaneously, faceted by baseline (vanilla / static-typed / ours) and aggregated three ways (within-cluster, across-cluster, out-of-cluster control).

The output a tenant actually receives over time is a personal, deterministic library of typed procedures that grows with every endorsed run, and that looks *different* from any other tenant's library on the same cluster. The output a judge sees is two simultaneously visible adaptations: cost falling within tenants and interfaces fanning out across tenants, both measured against baselines that exhibit neither.

---

## Design Principles

1. **Discovery, access, and composition share one surface.** The typed filesystem unifies "what data is here", "how do I read it", and "how do I combine it" into one code surface the agent already knows how to navigate. No separate doc system, no separate tool catalog.

2. **Schema is induced at three tiers, never imposed.** Sampled inferred type at `readFile` (volatile, refreshes on schema fingerprint change); endorsed query trajectory at crystallisation (settles per-tenant); compiled aggregation pipeline at budget pay-out (fully stable, LLM out of hot path). At every tier, structure is induced from data and usage; at no tier is it pre-declared.

3. **User-endorsed crystallisation, not auto-induction.** Procedures only enter the library when the user says yes. Reuse rate is high *by construction*, which is the direct answer to *Library Learning Doesn't*.

4. **Per-tenant interface emergence is a first-class property.** Procedure libraries are scoped per-tenant; the same data plane crystallises into different interfaces for different tenants. Library divergence (L_n) is a first-class metric, alongside cost convergence (T_n, D_n, R_n).

5. **Pre-registration before optimisation.** The dataset, the labels, and the protocol are committed to the public repo on day one, before any optimisation work begins. Without this, every positive curve is rationalisable as p-hacking.

6. **Three-baseline comparison or it didn't happen.** Vanilla agentic RAG, static typed environment, and ours, on the identical task set with multiple seeds and visible variance bands. Anything less is a marketing chart.

7. **Adopt primitives the ecosystem already provides.** AgentFS for the VFS engine, Pi for the agent harness, Voyage for embeddings, Atlas for the data plane. The only novel infrastructure code we author is MongoFS, a single TypeScript class implementing AgentFS's `FileSystem` interface against MongoDB.

8. **Every primitive is observable.** Procedures are TypeScript files you can `cat`. Trajectories are rows in `tool_calls`. Branches are file copies. No hidden state.

9. **Honest README.** Every artefact is tagged "built this hackathon" or "external service used". The demo highlights only the first column. Compliance with the "new work only" rule is structural, not asserted.

---

## Decision Framework

When principles collide, the order of precedence is:

1. **Falsification design over demo polish.** If a choice strengthens the headline chart at the cost of demo flair, take the chart. A working measurement framework is the more publishable artefact, regardless of which way the curves bend.

2. **Adopt over invent.** If an ecosystem primitive exists that does what we need, we use it and credit it. The project's signature is the *conjunction*, not any one component.

3. **Honesty over scope.** When scope creeps, ask "is this MongoFS, the eval, the crystallisation loop, or the budget worker?" Those four are in scope. Everything else is roadmap.

4. **Reproducibility over speed.** If a shortcut compromises seed-to-seed variance bands or the pre-registered protocol, we eat the time cost.

5. **Hackathon eligibility is non-negotiable.** Atlas as a core component, AWS in the stack, public repo, original work clearly delineated, no banned-list features ("Basic RAG Applications" is on the banned list, our differentiator from a basic RAG is the load-bearing originality claim).

Escalation path for hard calls during the build: write the question down in the plan file, get a second pair of eyes via the Architect or Plan Reviewer expert, default to the simpler choice if no clear signal emerges within 15 minutes.
