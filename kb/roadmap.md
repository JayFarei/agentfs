---
title: "MongoDB-AE-Hackathon, Roadmap"
type: evergreen
tags: [magic-docs]
updated: 2026-05-01
---

# Roadmap

A synthesized narrative built from the individual plan documents in `plans/`. Groups shipped features by version, lists in-progress work, and outlines the backlog. Each entry references plan numbers.

The hackathon window is **Saturday, May 2** for build and Round 1 judging, and **Thursday, May 7** for Round 2 (community vote) and Round 3 (mainstage, Top 3 only). Total estimated work: **~7.5 person-days**, sequenced for two engineers across the build window with focused parallelism.

---

## Eligibility gates (must clear by 5:00 PM Saturday)

Tracking these here so they are not buried in `kb/resources/judging-criteria.md`. Failing any one disqualifies the project regardless of demo quality.

- [ ] Built on the **MongoDB Atlas Sandbox** provided for the hackathon (M10 cluster, email-invite link)
- [ ] MongoDB Atlas is a **core component** (the demo cluster is the data plane; Atlas Vector Search and `$rankFusion` are load-bearing)
- [ ] Project addresses **Adaptive Retrieval** (theme 3)
- [ ] Repository is **public**, before the 5:00 PM submission
- [ ] Team size **<= 4** (solo allowed)
- [ ] All work done **during the event**; original contributions clearly delineated in README
- [ ] At least one team member can attend **MongoDB.local London** on May 7
- [ ] Project is **not** "Basic RAG Application" (banned list); the differentiator from a basic RAG is the user-endorsed cross-session procedure library plus the optimisation budget worker, both visible in the demo. Banned-list risk is highest on FinQA (which can read like "ask SEC filings RAG"); mitigation is to lead the demo with crystallisation and deterministic-replay visuals, not retrieval, and to surface the two-tenant divergence visual which is structurally not a RAG pattern
- [ ] Built on **AWS** (Top 6 finalist gate); Bedrock for the model, Lambda for the optimisation worker satisfies this without the Bedrock mid-build surprise-bill risk (kb/resources/aws/participant-guide.md)
- [ ] **Submission package** by 5:00 PM Saturday: 1-minute demo video, public repo URL, all team members on the form

---

## Shipped

### v0.0, Pre-build (2026-05-01)

Documentation and methodology lock-in. Plans are still being authored.

- The six top-level kb docs are filled in with the Adaptive Retrieval framing: `mission.md`, `product-design.md`, `research.md`, `market.md`, `mental-model.md`, this file.
- Resource inventory captured under `kb/resources/` (MongoDB, AWS, partners, judging rubric).
- Background research: `br/01` (Voyage + Code Mode); `br/18` and `br/52` queued for capture (FUSE-vs-NFS, AgentFS).

> No code shipped yet. v0.1 begins with the day-one pre-registration plan.

---

## In Progress

> Empty until Day 1. Plans 001 and 002 (below) are the first to start.

---

## Planned / Backlog

The plans queue, in execution order. Effort estimates per the brief (in person-days, single-engineer focused). All plans use the `plans/000-convention.md` template.

### Plan 001, feat: corpus ETL + pre-registered task set with three label layers

**Status:** proposed. **Effort:** 1 day (was 1/2 day before the hybrid corpus). **Why first:** longest lead-time artefact; freezes the eval and the data plane *before* any optimisation work begins, which is the load-bearing methodological commitment. Every later plan depends on this. See `br/06` for full corpus rationale.

**Deliverable A: corpus ETL.** Half a day.
- `loadBird.ts`: download BIRD's official 33.4 GB SQLite release, subset to 3 to 5 databases (recommended: `video_games`, `european_football_2`, `financial`, `formula_1`, `debit_card_specializing`), parse each SQLite table into MongoDB collections (one collection per source table). Source supervision pairs from [`xu3kev/BIRD-SQL-data-train`](https://huggingface.co/datasets/xu3kev/BIRD-SQL-data-train).
- `loadFinQA.ts`: download [`dreamerdeo/finqa`](https://huggingface.co/datasets/dreamerdeo/finqa) from HF (8,281 examples), clone [`czyssrs/FinQA`](https://github.com/czyssrs/FinQA) for the gold program annotations the HF mirror omits, merge by `id`, insert into a single `filings` collection with polymorphic documents.
- `loadSupplyChain.ts`: hand-crafted ~10 documents (npm registry metadata, GHSA advisories, OSV records, dependency-graph snippets for documented incidents).
- Total post-load size target: ~2 GB across `bird_video_games`, `bird_european_football_2`, etc., plus `finqa.filings`, plus `supply_chain.{packages, advisories, dependents}`.
- License-verification recorded in README.

**Deliverable B: pre-registered task set.** Half a day.
- `eval/tasks.json` committed to the public repo on Day 1, with:
  - 5 intent clusters of 8 tasks each (40 total):
    - 2 BIRD clusters (e.g., `bird-video-games-publishers`, `bird-formula-1-results`).
    - 2 FinQA clusters (e.g., `finqa-revenue-growth`, `finqa-operating-margin`).
    - 1 supply-chain cluster (`supply-chain-risk-assessment`).
  - 10 out-of-cluster control tasks.
  - Per task: answer label (gold SQL / gold program / hand-labelled answer), evidence label (required source ids: db_id for BIRD, filing id for FinQA, package name for supply-chain), canonical-pathway label (near-optimal trajectory length).
  - Per task: `tenant_id` recommendation (BIRD tasks lean to `data-analyst`, FinQA tasks lean to `financial-analyst`, supply-chain tasks span both).
- Public commit hash recorded in `eval/PRE_REGISTRATION.md`.

Dependencies: none. Blocks 002, 005, 006, 010.

---

### Plan 002, feat: vanilla agentic RAG baseline

**Status:** proposed. **Effort:** 1/2 day. **Why second:** we need something to beat from day one. Starts in parallel with the MongoFS plan once the eval is frozen.

Deliverable: a LangGraph + MongoDB Atlas Vector Search agent that answers tasks from `eval/tasks.json`. Clearly labelled in the README as "external framework, configured during the event, not built". Used as one of the three baselines in the headline divergence chart.

Dependencies: 001. Blocks 010.

---

### Plan 003, feat: MongoFS over AgentFS plus NFS mount

**Status:** proposed. **Effort:** 1.5 days. **Why third:** the only piece of novel infrastructure we author. Single TypeScript class implementing AgentFS's `FileSystem` interface against the demo Atlas cluster. Closes the loop from "agent writes typed snippet" to "typed call hits Atlas".

Deliverable: `src/mongofs/index.ts` (~300 LOC) + a CLI entrypoint `atlasfs mount <conn>` that starts the AgentFS NFS server with MongoFS plugged in as the FileSystem implementation for `db/` and `views/`, and AgentFS's CoW overlay handling `procedures/` and `scratch/`.

Includes:
- `readdir`, `stat`, `readFile` for `db/` and `db/<coll>/`.
- `writeFile` returns `EACCES` on `db/`, delegates to overlay for `procedures/` and `scratch/`.
- License-verification of AgentFS recorded in the README.

Dependencies: AgentFS license check must pass on Day 1. Blocks 004, 005.

---

### Plan 004, feat: codegen-as-readFile and schema fingerprints

**Status:** proposed. **Effort:** 1/2 day. **Why fourth:** unlocks the typed surface; the foundation for everything that imports from `db/`.

Deliverable: MongoFS `readFile("/db/<coll>.ts")` returns a synthesised TS module with:
- Inferred TypeScript interface from `mongodb-schema` over a sampled set of documents.
- `SCHEMA_VERSION` constant exported.
- Typed methods: `findExact`, `findSimilar`, `search`, `hybrid`.
- JSDoc comments with sampled example documents.

Dependencies: 003. Blocks 005, 008.

---

### Plan 005, feat: agent + procedure-library loop on top of primitives

**Status:** proposed. **Effort:** 1 day. **Why fifth:** the mechanism the brief is testing. Routes novel queries to a fresh Pi agent, captures trajectories, presents review prompts, crystallises endorsed trajectories into typed procedures.

Deliverable:
- Pi agent harness configured with Bedrock provider (Claude) and the typed filesystem surface as its only context.
- Snippet matcher: routes matches to deterministic execution, novel snippets to the agent.
- Trajectory capture via `tool_calls`.
- Crystallisation pipeline: trajectory -> verifier -> `procedures/<name>.ts` -> promotion.
- Schema-fingerprint pinning at crystallisation time.

Dependencies: 003, 004. Blocks 007, 009, 010.

---

### Plan 006, feat: eval harness, metric ledger, cluster heatmap renderer

**Status:** proposed. **Effort:** 1 day. **Why sixth:** so we see the picture as we work. Renders during build, not just at demo time.

Deliverable:
- `atlasfs eval <round> --baseline=<vanilla|static|ours> --tenant=<id>` runs the pre-registered task set on the chosen baseline for the chosen tenant and writes per-task metric rows.
- Metric ledger schema: `(round, task_id, baseline, tenant_id, T_n, D_n, R_n, I_n, tokens, wall_seconds, correct, evidence_completeness, seed)`. The `tenant_id` column is added so library divergence (L_n) can be computed post-run as a Jaccard distance over `procedures/<tenant_id>/`.
- Cluster heatmap renderer: 50 rows (tasks), N columns (rounds), cell colour by trajectory cost. Round 0 mostly red, by round 5 within-cluster cells are deep green, out-of-cluster cells stay red.
- Multi-seed support (>=3 seeds per round).
- Two simulated tenants for "ours" baseline: distinct system prompts plus intent-prior weights over the eval set (e.g., security-analyst leaning A+C, ML-researcher leaning B+D). Single tenant for vanilla and static-typed.

Dependencies: 001, 005. Blocks 010.

---

### Plan 007, feat: user-review UI for endorsing trajectories

**Status:** proposed. **Effort:** 1/2 day. **Why seventh:** the user-curation gate, the visible agentic moment in the demo.

Deliverable:
- A small web UI that opens on `atlasfs review <session_id>`.
- Renders the trajectory as a graph (deterministic nodes green, LLM-invocation nodes red).
- Three review prompts: correct? satisfies intent? needs more?
- Binary endorsement (yes -> crystallise, no -> archive).

Dependencies: 005. Blocks 010.

---

### Plan 008, feat: drift workflow

**Status:** proposed. **Effort:** 1/2 day. **Why eighth:** schema-as-code becomes operational; the demo gains the "schema changes, the affected procedure lights up yellow" moment.

Deliverable:
- Atlas Change Stream listener.
- Fingerprint recompute on change.
- ts-morph dependency walk over `procedures/` to find stale-pin procedures.
- Library pane badge: green / yellow / red per procedure based on `eval-against-new-schema` result.

Dependencies: 004, 005. Blocks 010.

---

### Plan 009, feat: optimisation-budget worker (compile-to-pipeline)

**Status:** proposed. **Effort:** 1 day. **Why ninth:** most pitchable artefact, shipped late so its absence does not block earlier work. Watch a procedure go from 30s to 2s when budget is spent.

Deliverable:
- AWS Lambda function `optimise-procedure(procedure_id)`.
- Reads procedure body, generates a candidate `$rankFusion` / aggregate pipeline that subsumes the typed-call sequence.
- Verifier replay against shadow inputs.
- Body-swap on success; rollback on failure.
- Visible state transition in the procedure library pane.

Dependencies: 005, 006. Blocks 010.

---

### Plan 010, ops: three-baseline runs, two-axis chart, demo polish

**Status:** proposed. **Effort:** 1 day. **Why last:** pre-demo bake. Runs all three baselines on the pre-registered eval with multiple seeds and (for "ours") multiple simulated tenants, generates the 2D divergence chart, drills the 3-minute demo, prepares Q&A talking points.

Deliverable:
- Five rounds of eval, three baselines, three seeds each. For "ours", two simulated tenants per seed (so 5 rounds * 3 baselines * 3 seeds * (1 or 2) tenants = 75 round-baseline-seed-tenant combinations, of which 45 are baseline runs and 30 are tenant-paired ours runs). Vanilla and static-typed do not have per-tenant procedure libraries, so they run once per round/baseline/seed.
- Variance bands on every curve.
- Cluster heatmap timelapse video for the standalone showcase.
- **Two-axis divergence chart**: X = round, Y = cost (T_n or wall-clock), per-tenant lines for "ours" fanning out across rounds, baselines as flat-curve references. Confidence intervals.
- **L_n curve**: Jaccard distance between the two simulated tenants' `procedures/` signature sets at each round, undefined for vanilla and static-typed. Rises monotonically.
- 3-minute demo script with backup plan (pre-recorded segment, deterministic local fallback). Demo beats:
  - **Beat 1, 0:00 to 0:30: setup.** `ls /datafetch/db/` listing collections from BIRD + FinQA + supply-chain micro-set; `cat /datafetch/db/packages.ts` showing the typed module. Use the supply-chain `packages.ts` because its schema is most legible at a glance.
  - **Beat 2, 0:30 to 1:30: tenant divergence (Dimension 1).** Two-pane file-tree showing Tenant A (`data-analyst`) and Tenant B (`financial-analyst`) procedure libraries diverging across rounds. Tenant A fills with BIRD-shaped procedures (`top_publishers_by_sales.ts`, `legislator_tenure_by_state.ts`); Tenant B fills with FinQA-shaped procedures (`yoy_revenue_growth.ts`, `operating_margin.ts`). Same cluster, divergent libraries.
  - **Beat 3, 1:30 to 2:30: cost convergence (Dimension 2) on a supply-chain query.** Single hand-crafted query: "is the npm package `event-stream` safe to install?". Round 0: ReAct loop with 15+ typed calls (red graph), expensive. Round 5: matched procedure, single deterministic call (all green). Atlas aggregation pipeline shown in side panel. Supply-chain chosen for visceral stakes; matches the 45% live-demo weight criterion.
  - **Beat 4, 2:30 to 3:00: 2D divergence chart.** Both axes simultaneously visible. X = round, Y = cost (T_n). Per-tenant lines fanning out (Dimension 1). Line slopes diving (Dimension 2). 3-seed confidence intervals. Vanilla and static-typed baselines as flat references. L_n curve overlaid in a corner subplot.
- Q&A talking points: reuse rate vs *Library Learning Doesn't*, why MongoDB Atlas specifically, why per-tenant emergence is structurally infeasible on relational substrates, why the BIRD+FinQA hybrid is not "just text-to-SQL" (cross-collection polymorphism + cross-tenant divergence + compile-to-pipeline), what would v2 look like (dynamic schema discovery via `db.search`/`db.execute` per Cloudflare's 1,000-tokens reference).

Dependencies: 002, 005, 006, 007, 008, 009.

---

## Schedule overview

```
Day 1 (Sat May 2, 9:00 AM - 5:00 PM submission)
+----+----+----+----+----+----+----+----+
| 9  | 10 | 11 | 12 | 1  | 2  | 3  | 4  |  Hours after kickoff
+----+----+----+----+----+----+----+----+
|  P001 (1/2d)  |
|       P002 (1/2d, parallel after P001)|
|              P003 MongoFS (1.5d, spans into Day 2)
|              P004 codegen (1/2d, after P003 mount works)
|                                P005 agent loop start (1d, spans Day 2)
+----+----+----+----+----+----+----+----+

Day 2 (build continues, Round 1 judging on Day 1 evening means
       Day 2 work is for Round 2 and Round 3 only, see below)

Day 1 reality: only enough to get a *first* version of the demo to Round 1
judges by 5:00 PM. The plan above is for the full project; the Day 1 cut is
a Pareto subset:
- P001 frozen (no further changes)
- P003+P004 working at "ls /datafetch/db/, cat db/packages.ts"
- P005 working at "novel query -> trajectory captured"
- P007 working at "endorsement -> procedure file appears"
- P006 working at "one-round eval against P002 baseline"

That cut is the Round 1 demo.

Day 2 - 6 (Sun May 3 to Wed May 6): finish P008, P009, complete P010.
The MongoDB.local Round 2 and Round 3 demos are the polished version.
```

The brief's effort estimate (~7.5 person-days for two engineers in a 4-day window) is the *full* project. The Round 1 demo is the Pareto subset that hits the eligibility gates and the headline moment, deliverable in one day for two engineers.

---

## Roadmap dependencies summary

```
P001 -> P002 -> ----------\
                            \
P001 -> P003 -> P004 -> P005 ---> P006 ---\
                                            \
                          P005 -> P007 ----- P010
                          P005 -> P008 ----/
                          P005 -> P009 ---/
```

---

## Out of scope (post-hackathon roadmap)

For honesty, these are deferred:

- **Production-grade multi-tenant infrastructure.** AgentFS's single-writer SQLite ceiling is fine for one-agent-one-writer; multi-tenant production needs a different overlay primitive plus auth, isolation, and billing. Note: *demonstration* of two simulated tenants on the same cluster (for the Dimension 1 / L_n story) is **in scope** for the hackathon, implemented as filesystem-path-scoped overlays (e.g., `procedures/<tenant_id>/`) under AgentFS's CoW layer. What stays out of scope is auth-isolated multi-tenancy and the routing scaffold a real SaaS would need.
- **Vanilla `better-sqlite3` backend.** AgentFS uses Turso's `turso` crate / `@tursodatabase/database`; a fork to vanilla SQLite is straightforward but not load-bearing for the hackathon.
- **Shared procedure library** (cross-tenant routing-score moat where one tenant's promoted procedures suggest themselves to another). v1 is per-tenant isolated; cross-tenant routing is a publishable v2.
- **Graded scoring (1-5)** instead of binary endorsement. Saves UI cost in v1.
- **Dynamic schema discovery** (search/execute primitives over an OpenAPI-like spec). v1 is static.
- **Open-source `mongo-mount` package.** The MongoFS backend converted into a standalone tool; natural OSS contribution post-hackathon.
- **Publishable measurement framework write-up.** A short paper on the T_n / D_n / R_n / I_n / L_n axes with within / across / out-of-cluster aggregations plus the three-baseline comparison; conditional on the curves moving.
