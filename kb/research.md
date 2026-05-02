---
title: "MongoDB-AE-Hackathon, Research"
type: evergreen
tags: [magic-docs]
updated: 2026-05-01
---

# Research

A synthesized narrative built from the individual background research files in `br/`. Provides a thematic index that groups research by topic and explains what each cluster means for the project. New entries are added at the top.

The thesis the project probes: **typed retrieval primitives + user-endorsed cross-session interface evolution + deterministic procedure replay + measurable longitudinal compression on intent-clustered tasks**. Each theme below contributes one face of that conjunction.

---

## Table of Contents

| Theme | BR Files | Core Question |
|-------|----------|---------------|
| Code-mode as the agent surface | [br/01](./br/01-voyage-ai-code-mode-data-interface.md) | Why is a typed TypeScript namespace, not an MCP tool catalog, the right surface for agent retrieval? |
| MongoDB substrate, adjacent projects, and the schema-emergent fit | [br/02](./br/02-mongodb-fit-and-adjacent-projects.md) | Is the conjunction unclaimed? What does Atlas + Voyage actually expose as of May 2026? Is the schema-emergent pitch a fit for a document store, or a misfit? |
| Virtual filesystems for agents | br/18 (to capture) | Why is NFS, not FUSE, the right transport on a 48-hour build? |
| documentdbfuse: closest public expression of MongoFS | [br/03](./br/03-documentdbfuse.md) | What does the closest substrate-side prior art ship, and which AtlasFS design decisions does its v0.1 validate by demonstrating the alternative is worse? |
| AgentFS as the VFS engine | br/52 (to capture) | What does AgentFS provide for free and what is the only piece we need to author? |
| Adaptive RAG within a session | br/?? (to capture) | Self-RAG, FLARE, Adaptive-RAG: where do they end and where does cross-session compounding begin? |
| Test-time plan caching for Plan-Act agents | [br/04-apc](./br/04-agentic-plan-caching-stanford.md) | Stanford APC saves 50% of cost at 96.6% accuracy on five workloads; which guardrails port into AtlasFS, and which of its design choices does AtlasFS structurally improve on? |
| Skill induction without users | br/?? (to capture) | Voyager, ASI: why does *Library Learning Doesn't* deflate the auto-induced library claim? |
| Auto-induced skill libraries: SkillCraft | [br/04-skillcraft](./br/04-skillcraft-tool-skill-acquisition.md) | SkillCraft's MCP-primitive protocol is the closest contemporary auto-induction baseline; what is the AtlasFS delta and what should we port? |
| Agent Workflow Memory: the academic precedent | [br/05](./br/05-agent-workflow-memory.md) | Which AtlasFS design decisions does the closest published induce-integrate-utilize loop validate by lacking? |
| Human-in-the-loop crystallisation | br/?? (to capture) | What does adding a user-endorsement gate buy us, and how do we measure it? |
| Demo corpus: BIRD-SQL + FinQA + supply-chain micro-set | [br/06](./br/06-bird-finqa-corpus.md) | Why a three-source hybrid? Where does each component test the schema-emergent thesis? Why does "structured benchmark data" not break the polymorphism story? |

> **Capture status (2026-05-01):** br/00-convention.md, br/01, br/02, br/03,
> br/04 (Stanford APC), br/04 (SkillCraft), br/05 (AWM), and br/06 (corpus) are
> in `br/`. Together they cover the substrate-side closest expression of MongoFS,
> the strongest contemporary auto-induction baseline, the strongest published
> academic precedent for trajectory crystallisation, the strongest published
> validation of test-time plan caching, and the Round 1 corpus design. The
> remaining themes (br/18 NFS-vs-FUSE, br/52 AgentFS, the Adaptive RAG / Skill
> induction / HITL syntheses) are reflected here from conversational research;
> their formal br/ files are queued.

---

## Themes

### MongoDB substrate, adjacent projects, and the schema-emergent fit

**Source:** [br/02-mongodb-fit-and-adjacent-projects.md](./br/02-mongodb-fit-and-adjacent-projects.md).

**Insight:** Three findings collected in one ultradeep file. First, the AtlasFS conjunction is genuinely unclaimed at the system level, ~80% confidence, across a 40-project survey covering Mongo-as-FS prototypes (documentdbfuse, mongofs), agent-FS systems (AgentFS, hf-mount), code-mode references (Cloudflare, Anthropic), skill-induction research (Voyager, ASI, Berlot-Attwell), and the official MongoDB MCP server with `agent-skills` plus the LangChain `MongoDBDatabaseToolkit`. Second, the Atlas + Voyage substrate as of May 2026 is more ready than the team's docs imply: the Embedding & Reranking API at `https://ai.mongodb.com/v1` is in Public Preview, `$rankFusion` is GA on 8.0+, Voyage 4 has a shared embedding space, Flat Indexes ship for multi-tenancy. Third, the standing critique that "MongoDB suits unstructured data while typed surfaces suit structured data" is partly valid but largely answerable: the right axis is not "structured versus unstructured" but "schema-stable across documents" versus "schema-stable across queries". MongoDB lives in the second regime; AtlasFS makes it tractable.

**What it tells us about how to build:** Build on the standalone Embedding API (Public Preview, free-tier-funded), not on database-native auto-embedding (Preview on Community 8.2+, Atlas access "coming soon"). Default to `voyage-4` general-purpose, `voyage-context-3` for chunked content, `voyage-code-3` for typed-TS procedure embeddings, `rerank-2.5` for post-retrieval. Generate `oneOf`-style discriminated unions for polymorphic collections; lift presence-frequency metadata into JSDoc.

**What it tells us about positioning:** Lead with the conjunction, not any single axis. Reframe the pitch around schema-stability-across-queries; pick a moderately polymorphic corpus (the supply-chain blend already specified hits the sweet spot); cite Voyager + ASI + Cloudflare Code Mode + AgentFS + hf-mount + the official MongoDB MCP server explicitly as ancestors.

**What it tells us about the demo:** Two simulated tenants on the same cluster, diverging procedure libraries (Dimension 1, L_n) plus a single intent re-running across rounds within a tenant (Dimension 2, T_n / D_n). Both axes visible in one chart.

---

### Code-mode as the agent surface

**Source:** [br/01-voyage-ai-code-mode-data-interface.md](./br/01-voyage-ai-code-mode-data-interface.md).

**Insight:** Cloudflare Code Mode (2025-26) and Anthropic Tool Search (2025) both demonstrate that a typed TypeScript namespace plus a single `runCode(snippet)` tool collapses the token cost of a 2,500-endpoint MCP from ~1.17M tokens to ~1,000 tokens (81 to 99.9% reduction depending on how you measure it). The agent chains calls inside a sandboxed snippet, intermediate results never enter the model's context, and bindings replace network access (no API keys ever reach the agent).

**What it tells us about how to build:** The typed surface for `db/`, `views/`, and `procedures/` is the right shape. The agent reads schemas as TypeScript types it has seen millions of times in training, not contrived tool-call JSON. A 60-line `.d.ts` injected into the system prompt buys an unbounded retrieval surface.

**What it tells us about positioning:** Code-mode is itself table stakes by mid-2026. The differentiator is what the typed surface *evolves into*, not its existence. Cloudflare's stubs are static; ours grow from agent usage gated by user endorsement.

**Voyage specifics that matter:** `voyage-context-3` for chunked corpora, `rerank-2.5` for top-k cross-encoder reranking, `voyage-multimodal-3.5` for the typosquat logo cluster. Native via Atlas Embedding & Reranking API since the February 2025 acquisition.

---

### Virtual filesystems for agents

**Source:** br/18 (to capture).

**Insight:** Two contemporary projects (`hf-mount` from XetData, AgentFS from Turso) both expose data to agents via an NFS-mounted virtual filesystem. Both explicitly chose NFS over FUSE for the same reason: macFUSE is a kernel extension, has zero install-friction tolerance, and fails ungracefully when network or daemon issues arise. NFS has built-in client support on macOS, Linux, and Windows, fails gracefully, and requires no kernel-level dependencies.

**What it tells us about how to build:** NFS is the transport. We do not write a FUSE driver. The mount is `mount -t nfs localhost:/datafetch /mnt/datafetch` on any contemporary macOS or Linux developer laptop with no setup beyond the NFS server we ship.

**What it tells us about positioning:** "Virtual filesystem for agents" is an emerging primitive, not a novel category. We adopt the convention rather than invent it. The original-work claim is `MongoFS` (the backend), not the transport.

---

### documentdbfuse: closest public expression of MongoFS

**Source:** [br/03-documentdbfuse.md](./br/03-documentdbfuse.md).

**Insight:** documentdbfuse is a 1.6k-LOC Go FUSE binary, single author, 2 GitHub stars, MIT-licensed, that mounts any MongoDB-wire-compatible database (Atlas, Microsoft DocumentDB, FerretDB) as a Linux filesystem with documents as `.json` files and aggregation pipelines composed as nested directory paths (e.g., `cat /mnt/db/sampledb/users/.match/city/Seattle/.sort/-age/.limit/3/.json/results`). It is the closest existing public expression of the MongoFS component in `kb/product-design.md`. It is also a v0.1 prototype with documented bugs (in-place replace via `echo > existing.json` returns ENOTSUP, contradicting the README) and nothing close to hybrid retrieval, typed schemas, drift detection, or trajectory crystallisation. Live-tested locally on 2026-05-01: every advertised read-side feature passed; the replace bug reproduced; macOS support is absent despite the README's "FUSE/NFS" claim (the repo ships only FUSE).

**What it tells us about positioning:** A judge familiar with documentdbfuse will read AtlasFS's typed-modules + schema fingerprint + hybrid retrieval + crystallisation + cross-platform NFS as substantive delta rather than cosmetic gloss. Cite documentdbfuse explicitly in Related Work alongside TigerFS (Postgres-backed, by Tiger Data / Timescale) and AgentFS (Turso, SQLite-backed) as the three points in the converging "DB-as-FS for agents" trend; AtlasFS is the only one combining hybrid retrieval, typed discovery, and crystallisation in one system. The framing is recognised on first read, lowering AtlasFS's explanation budget.

**What it tells us about how to build:** Three small ideas worth porting today, all sub-day additions: (1) `--ls-limit` plus `.all/` opt-in for default-safe directory listings on large collections; (2) `.count` as a virtual file for an LLM-friendly affordance that avoids exposing aggregation syntax; (3) the three-format `.json|.csv|.tsv/results` export pattern for stable, diff-friendly result rendering. Three big AtlasFS design decisions are validated by documentdbfuse's mistakes: read-only `db/` (sidesteps the in-place-replace bug class), NFS-not-FUSE (the alternative gives no macOS support), and typed-TS-with-fingerprint (raw JSON forces field-name guessing on every query). Do not vendor any documentdbfuse code: wrong language, wrong contract, no upstream maintenance discipline visible.

---

### AgentFS as the VFS engine

**Source:** br/52 (to capture). Brief 52 in the conversational research stream.

**Insight:** AgentFS (Turso) is a pre-built TypeScript / Python / Rust / Go SDK that ships:

| AgentFS gives us | What we would otherwise build |
|------------------|-------------------------------|
| `FileSystem` interface (`stat`, `readFile`, `writeFile`, `readdir`, `mkdir`, `rm`, `rename`) | The whole NFS trait surface |
| `OverlayFS`, CoW delta over any base FileSystem | Branchable collections (delta layer + whiteouts) |
| `tool_calls` audit table, append-only, queryable | Trajectory ingestion + storage |
| `agentfs serve mcp` | MCP-compatible context provider for any agent that prefers tool-calling |
| `agentfs run <cmd>`, process-level CoW sandbox via NFS + `sandbox-exec` on macOS | Sandboxed agent execution |
| `KvStore`, agent context/config | Procedure metadata, schema fingerprints, optimisation budgets |

**What it tells us about how to build:** The CoW overlay maps exactly to the branching story. Base = MongoFS over Atlas (read-only). Delta = AgentFS's writable layer (procedures, scratch). Branch = new session id = new delta. Merge = governance check on the delta diff. Author MongoFS as the single FileSystem implementation (~10 methods, ~1.5 days), adopt everything else.

**Effort estimate per brief 52:** Quick (hours) for evaluation against AgentFS's local profile spec; Short (days) for full integration with CoW sandbox, audit trail, and KV.

**Caveats to surface in the README:**

1. Single-writer SQLite ceiling. Fine for single-agent-single-writer (our demo); a multi-tenant production concern, not a hackathon one.
2. Turso vendor coupling (uses the `turso` crate / `@tursodatabase/database`, not vanilla SQLite). Acceptable for v1; a fork to vanilla `better-sqlite3` is straightforward post-hackathon if Turso's roadmap diverges.
3. License needs verification. No SPDX identifier in AgentFS's GitHub metadata; license files exist in `licenses/`. Pre-adoption check is a Day 1 task.

---

### Adaptive RAG within a session

**Source:** br/?? (to capture). Self-RAG, FLARE, Adaptive-RAG papers (2024-2026).

**Insight:** All three families adapt query / chunking / reranking *within* a single run. They are smarter retrievers, not learning retrievers. The next session starts from scratch.

**What it tells us about positioning:** Our differentiator is *cross-session* compounding. A vanilla agentic-RAG baseline that reuses the same Self-RAG-style loop is the right comparison line for the headline chart. It will adapt within each session and remain flat across rounds; ours should diverge from round 2.

**What it tells us about scope:** Within-session adaptation is a free win we inherit from any modern RAG framework. We do not need to author one. LangGraph + MongoDB Atlas Vector Search gives us a credible baseline in half a day with a clear "configured externally, did not build" delineation.

---

### Test-time plan caching for Plan-Act agents

**Source:** [br/04-agentic-plan-caching-stanford.md](./br/04-agentic-plan-caching-stanford.md).

**Insight:** Stanford's APC paper (Zhang, Wornow, Wan, Olukotun; arXiv 2506.14852v2) is the cleanest published academic validation of AtlasFS's central thesis: ReAct-style Plan-Act agents are expensive at the planning stage, the cost is repeatable across semantically similar tasks, and the right caching unit is the *plan template* parameterised away from data-specific details, not the *query response*. APC reports a 50.31% cost reduction and 27.28% latency reduction at 96.61% of accuracy-optimal performance across FinanceBench, QASPER, AIME, TabMWP, and GAIA. The cache overhead is 1.04% of total cost on average and 1.31% in the worst (zero-hit-rate) case. Two of APC's biggest empirical findings are decisions AtlasFS already made independently and goes further on: (a) keyword-exact-match beats semantic-similarity for cache lookup (false-positive rate; 56µs exact vs 148ms fuzzy at 10^6 entries), which AtlasFS's procedure-signature match captures with no LLM in the lookup path; (b) plan templates beat full execution histories because small LMs choke on long unfiltered logs, which AtlasFS's "trajectory is the procedure" design skips because the trajectory is already valid TypeScript, no extraction phase required.

**What it tells us about positioning:** Cite APC as concurrent academic validation of the test-time plan-caching premise; the 50.31% / 27.28% / 96.61% triple removes the burden of proving the premise from scratch in 48 hours. AtlasFS goes structurally further on three axes: keyword-LLM-call vs typed-signature match (no LLM in lookup), small-LM-adapt vs compiled-pipeline (no LLM in hot path on tier 3), no-schema-drift vs `SCHEMA_VERSION` plus Change-Stream walker. State these three deltas explicitly in the README; they are the differentiation that makes AtlasFS more than "APC on a filesystem." Per-tenant interface emergence (Dimension 1, L_n) is the contribution APC implicitly leaves on the table: APC has one global cache; AtlasFS has per-tenant procedure libraries. This belongs on the leading slide, not in a footnote.

**What it tells us about how to build:** Borrow four operational guardrails from APC into the eval harness and budget worker, all small lifts: (1) the cold-start curve framing (hit rate by query percentile) is exactly the chart shape Dimension 2 needs; (2) auto-disable-on-low-reuse for the optimisation-budget worker, demoting compiled-pipeline back to typed-procedure when reuse drops below threshold; (3) the cache-size diminishing-returns finding (hit rate plateaus around the unique-keyword count of the workload) as the empirical shape AtlasFS's L_n curve should mirror within tenant; (4) a fourth "cost-optimal" baseline (small LM only, no caching) as the floor of the cost-axis chart. Do not borrow APC's keyword-extraction LLM call: AtlasFS's procedure-signature match is structurally cheaper. Total integration if all five lifts are adopted: roughly one engineer-day, mostly eval harness plumbing.

---

### Skill induction without users

**Source:** br/?? (to capture). Voyager (Wang et al., 2023), ASI (arXiv:2504.06821), *Library Learning Doesn't* (Berlot-Attwell, NeurIPS MATH-AI 2024).

**Insight:** Voyager and ASI auto-crystallise reusable skills from agent runs. *Library Learning Doesn't* showed that across multiple skill-induction systems, the auto-induced library is rarely actually reused, the reuse rate is the deflated metric.

**What it tells us about how to build:** The user-endorsement gate is *the* answer to the deflation. Reuse rate is high by construction in our system because every entry was endorsed before promotion. We must report reuse rate as a first-class metric, not just T_n / D_n, to inoculate ourselves against the same deflation.

**What it tells us about positioning:** "Skill induction" without a human is the prior art's framing. "User-endorsed crystallisation" is ours. The semantic distinction is load-bearing in the originality story.

---

### Auto-induced skill libraries: SkillCraft

**Source:** [br/04-skillcraft-tool-skill-acquisition.md](./br/04-skillcraft-tool-skill-acquisition.md).

**Insight:** SkillCraft (Chen et al., arXiv:2603.00718, 2026-03) is a 126-task benchmark plus a "Skill Mode" protocol exposed as four MCP primitives (`save_skill`, `get_skill`, `list_skills`, `execute_skill`) that retrofit any tool-using agent with a persistent skill library. It is the closest contemporary public expression of AtlasFS's procedure-crystallisation pipeline: the agent auto-abstracts successful tool-call sequences into parameterized code-based Skills, validates each candidate through a three-stage Coding Verifier (syntax, runtime, post-execution quality with a 50%-null heuristic), and reuses the cached Skills on later tasks. Headline numbers are exactly the convergence axes AtlasFS proposes to measure: GPT-5.2 lifts overall success from 87% to 90% while cutting tokens from 1.23M to 0.26M (-79%) and cost from $1.77 to $0.43 (-75%); Claude-4.5-Sonnet cuts tokens from 1.36M to 0.40M (-71%). The §5.1 hierarchical-skill negative result (auto-generated nested skill hierarchies amplify error propagation; "shallow well-tested skill libraries are currently more reliable and cost-effective than deep automatically-generated hierarchies") is a direct gift to AtlasFS: compile-to-pipeline (Tier 3) is the alternative to nesting Skills.

**What it tells us about positioning:** Cite SkillCraft as the canonical auto-induction baseline. Five concrete AtlasFS axes constitute defensible novelty: (1) user-endorsed crystallisation, not deterministic auto-induction (SkillCraft has no human gate; GLM-4.7 regresses 15 percentage points because of over-applied auto-induced Skills); (2) per-tenant library divergence (Dimension 1, L_n; SkillCraft tests single-agent libraries with no multi-tenancy notion); (3) compile-to-pipeline (Tier 3; SkillCraft skills stay as code the agent invokes, LM in the hot path); (4) typed filesystem discovery surface (SkillCraft uses MCP primitives over a fixed tool set); (5) schema fingerprint and Change-Stream-driven drift handling (SkillCraft holds the tool surface static). Lead with Dimension 1 and compile-to-pipeline in any judge conversation that opens with "isn't this just SkillCraft?".

**What it tells us about how to build:** Port SkillCraft's three-stage Coding Verifier near-verbatim into AtlasFS's verifier in week one (the 50%-null post-execution quality check is roughly an hour's work and closes a real gap: AtlasFS's existing replay-against-shadow-input verifier catches mismatches but does not catch a procedure that "succeeds" while returning mostly-null payloads). Adopt SkillCraft's metric vocabulary (Exec Rate, Reusing Rate) onto the eval ledger alongside AtlasFS's existing T_n / D_n / R_n / I_n, for trivial side-by-side comparability. Optionally (post-hackathon if Day 1 capacity is tight) run SkillCraft's protocol as a fourth baseline in the eval; the implementation cost is roughly one day if the existing three-baseline harness lands on schedule.

---

### Agent Workflow Memory: the academic precedent

**Source:** [br/05-agent-workflow-memory.md](./br/05-agent-workflow-memory.md).

**Insight:** Agent Workflow Memory (AWM; Wang, Mao, Fried, Neubig; ICML 2025 poster, GitHub 426 stars, Apache-2.0) is the closest *academic* precedent for AtlasFS's trajectory-crystallisation pipeline. AWM's "induce, integrate, utilize" loop summarises past trajectories into reusable workflows, each consisting of a natural-language description plus a sequence of (observation, action) steps with example-specific values abstracted into named variables. Online AWM lifts WebArena overall task success from 23.5 to 35.5 (+12.0 absolute, +51.1% relative) using GPT-4, beating even the human-expert-workflow baseline (SteP, 33.0); on Mind2Web, online beats offline 35.5 vs 32.6 cross-domain step SR with the gap widening as the train-test distribution gap widens. The whole induction logic fits in a single LM prompt with no fine-tuning, no embedding model, no retrieval index over workflows: the simplicity is itself a finding that AtlasFS's procedure-crystallisation pipeline can inherit.

**What it tells us about positioning:** Three AtlasFS design decisions are validated by AWM's gaps, not just consistent with them: (a) AWM has no environment-state pinning, so DOM changes silently break workflows (AtlasFS's `SCHEMA_VERSION` plus Change-Stream walker is exactly the missing piece); (b) AWM has no compilation tier, so successful workflows still require an LM call on every invocation (AtlasFS's compile-to-pipeline budget worker removes the LM after a procedure earns budget); (c) AWM has no tenant or user model, so the library divergence Dimension-1 axis does not exist (a multi-tenant deployment of AWM would either lose intent-specific workflows in one big shared library or balloon prompt context per tenant). AWM's online-generalisation finding (online beats offline as train-test gap widens) is direct empirical support for AtlasFS's per-tenant Dimension-1 axis: cite the +14.0 absolute step SR cross-domain figure when defending the structural argument that per-tenant procedure libraries beat shared-training-data transfer.

**What it tells us about how to build:** Adopt AWM's four quality metrics (number of workflows per website, function overlap, coverage, utility rate) for the AtlasFS eval ledger; this is roughly half an hour of work and converts the eval from "we measured cost convergence" into "we measured cost convergence using the same metric vocabulary as the academic standard". Targets to beat: 7.4 workflows per intent cluster (parsimony), 0.08 function overlap (hygiene), 0.94 utility rate (R_n). Add a "lift constants to parameters" pass in the crystallisation pipeline (AWM finds abstraction matters more than the induction mechanism). Modify the crystallisation prompt to also emit a JSDoc summary AWM-style, surfaced in the procedure-library pane of the demo UI. AWM's workflow-as-action variant (AWM_AS) showed only 18.5% usage rate when workflows were exposed as new agent actions: a structural argument for AtlasFS's deterministic matcher (the system, not the LLM, decides when a procedure runs).

---

### Human-in-the-loop crystallisation

**Source:** br/?? (to capture). Synthesized from the brief.

**Insight:** Adding a user gate to skill induction trades a small UX cost (a binary endorsement after each novel run) for a structural reuse guarantee. Every entry is, by definition, useful, the user said so. The cost of the gate is dominated by the cost of the LLM call it replaces on subsequent runs.

**What it tells us about how to build:** The review UI is small, three prompts (correct? satisfies intent? needs more?), binary for v1, graded post-hackathon. The trajectory rendering is reused for both review and the hot-path overlay.

---

### Demo corpus: BIRD-SQL + FinQA + supply-chain micro-set

**Source:** [br/06-bird-finqa-corpus.md](./br/06-bird-finqa-corpus.md).

**Insight:** The Round 1 corpus is a three-source hybrid, not the supply-chain-only plan in the original framing. Each component tests a different polymorphism axis and serves a different demo beat:

- **BIRD-SQL subset (3 to 5 databases):** cross-collection polymorphism plus published baseline comparability. 15 to 25 collections with wildly different schemas (video games vs european football vs financial vs formula 1 vs debit card transactions). The agent must discover which typed module answers an intent. Compares against Spider 1.0 (DAIL-SQL, 86.6%), BIRD-bench (~65 to 75% on hard split), and EvoMQL on text-to-MQL (76.6% / 83.1%).
- **FinQA full (8,281 examples):** within-document polymorphism plus compilable gold programs. Filings vary across companies (airline fuel tables vs tech R&D tables vs financial loan-loss-provision tables); same question shape demands different polymorphic-shape match per company. Gold programs from `czyssrs/FinQA` are exactly what crystallised AtlasFS procedures should look like.
- **Supply-chain micro-set (~10 hand-crafted queries):** Round 1 demo narrative spine because of visceral stakes ("is this dependency safe?") and multimodal coverage (`voyage-multimodal-3.5` for typosquat detection). NOT in the formal eval; load-bearing only for the demo.

**What it tells us about how to build:** Plan 001's deliverable expands from "task set" to "corpus ETL plus task set," ~1 day total. ETL for BIRD pulls from [`xu3kev/BIRD-SQL-data-train`](https://huggingface.co/datasets/xu3kev/BIRD-SQL-data-train) for supervision plus BIRD's official 33.4 GB SQLite release for row-level data. ETL for FinQA pulls [`dreamerdeo/finqa`](https://huggingface.co/datasets/dreamerdeo/finqa) for the question-answer pairs plus [`czyssrs/FinQA`](https://github.com/czyssrs/FinQA) for the gold program annotations the HF mirror omits. Total post-load size: ~2 GB on M10's ~10 GB storage budget.

**What it tells us about positioning:** The structured-data critique fails on a sharper read of the schema-emergent thesis. Polymorphism lives at three locations (within-document, cross-collection, across-queries-within-tenant); the hybrid covers all three. Cross-collection polymorphism in particular is arguably a more rigorous test of AtlasFS's schema-discovery story than within-document polymorphism alone. FinQA's compilable gold programs are the cleanest possible demonstration of the trajectory-is-procedure property.

**What it tells us about the demo:** Use supply-chain queries for Round 1 Beats 1 and 3 (setup and cost-convergence) because of visceral stakes that land in 3 minutes; use BIRD+FinQA for Beats 2 and 4 (tenant divergence and 2D divergence chart) because of scale and comparability. The split is structural: Round 1's 45% live-demo weight rewards visceral, the eval scoring rewards comparability, both are needed.

**What it tells us about the design (downstream consequence):** The hybrid forces resolution of `kb/product-design.md` Open Question #1 on schema discovery. At 3 to 5 BIRD databases, static namespace (~6K to 12K tokens) fits comfortably; if BIRD subset grows past 5 databases, flip to dynamic discovery (`db.search` + `db.execute` per Cloudflare's 1,000-tokens reference). Tentative answer: static for Round 1, dynamic as Round 2/3 stretch.

---

## The conjunction

The published prior art, mapped:

| Property | Adaptive RAG / APC | Code Mode | Voyager / ASI / SkillCraft / AWM | Mongo MCP / Text-to-MQL | Ours |
|----------|--------------------|-----------|----------------------------------|------------------------|------|
| Typed retrieval primitives | partial (programmatic retrievers; APC keyword-extracts) | yes (static stubs) | no (MCP primitives, click-action) | no (tool-call shaped) | yes (lazy codegen) |
| Cross-session interface evolution | global cache only (APC) | no | yes (auto-induced) | no (regenerates per call) | yes (user-endorsed) |
| Deterministic procedure replay | no (small-LM adapt on each hit) | partial (snippets) | partial (skills, code-based but LM-invoked) | no | yes (typed procedures) |
| Schema crystallises from agent usage | no | no (static at deploy) | n/a (static tool surface) | no (schema introspected per query) | yes (three-tier induction) |
| Per-tenant interface emergence | no (one global cache) | no | n/a (single agent) | no | yes (per-tenant overlays + L_n) |
| Compile to aggregation pipeline | no | n/a | no (skills stay as code) | no | yes (budget worker) |
| Measurable longitudinal compression | within-session + global-cache (APC: -50.3% cost, -27.3% latency, 96.6% acc) | not measured | per-task only (SkillCraft: -71% to -79% tokens; AWM: +51% rel SR on WebArena) | not measured | T_n, D_n, R_n, L_n on intent-clustered eval |

The conjunction in the right column is unclaimed in the prior-art sweep. The hackathon is the cheapest credible falsification test of whether it produces measurable convergence on a held-out, intent-clustered, three-baseline-compared eval.

---

## Methodological commitments

These constrain how the research turns into a measurement, and they sit alongside the technical research because the measurement *is* the contribution.

1. **Pre-register the dataset, labels, and protocol on day one.** Without this, every positive result is rationalisable. This is the single largest load-bearing risk identified in the brief.

2. **Multiple seeds per round (>=3).** Variance bands on every curve. Single-seed results are anecdote.

3. **Reuse rate as a first-class metric.** Inoculates against the *Library Learning Doesn't* deflation.

4. **Three-baseline comparison.** Vanilla agentic RAG, static typed environment, ours. The chart that wins is the divergence chart.

5. **Honest README.** Every artefact tagged "built this hackathon" or "external service used".

6. **Out-of-cluster controls (10 tasks).** Tasks unrelated to the security clusters. These should produce a flat curve. If they fall, we are measuring inference-time scaling, not transfer.

---

## Recent Entries

- **2026-05-01**, [br/06, BIRD-SQL + FinQA Hybrid Corpus, with a Supply-Chain Demo Spine](./br/06-bird-finqa-corpus.md). Deep, 18 sources. Documents the Round 1 corpus design: a BIRD subset (3 to 5 databases) for cross-collection polymorphism plus published baseline comparability, FinQA full for within-document polymorphism plus compilable gold programs, and a supply-chain micro-set as the Round 1 demo narrative spine. Resolves the static-vs-dynamic schema discovery question (static for Round 1, dynamic as Round 2/3 stretch). Names two HF dataset gotchas: `xu3kev/BIRD-SQL-data-train` ships only supervision pairs (row-level data is in BIRD's separate 33.4 GB release), and `dreamerdeo/finqa` omits the gold program field (must be recovered from `czyssrs/FinQA`). Drives Plan 001 ETL deliverables and Plan 010 demo narrative split.

- **2026-05-01**, [br/05, Agent Workflow Memory: The Closest Academic Precedent for AtlasFS Procedure Crystallisation](./br/05-agent-workflow-memory.md). Deep, 16 sources. ICML 2025 poster (Wang/Mao/Fried/Neubig, CMU+MIT, GitHub 426 stars) is the strongest published academic precedent for the trajectory-crystallisation idea. Online AWM lifts WebArena task SR 23.5 → 35.5 (+51.1% relative); online beats offline as train-test gap widens (direct empirical support for AtlasFS's Dimension-1 axis). Three AtlasFS design decisions are validated by AWM's gaps (no environment pinning, no compilation tier, no tenant model). Borrow AWM's four quality metrics (~30 min of work) for the eval ledger; "lift constants to parameters" pass plus JSDoc summary in crystallisation pipeline.

- **2026-05-01**, [br/04, SkillCraft: Auto-Induced Skill Libraries for Tool-Using Agents, and the AtlasFS Differentiation Story](./br/04-skillcraft-tool-skill-acquisition.md). Deep, 8 sources. The closest contemporary public expression of AtlasFS's procedure-crystallisation pipeline: four MCP primitives (`save_skill`, `get_skill`, `list_skills`, `execute_skill`) plus a three-stage Coding Verifier. GPT-5.2: -79% tokens at 90% success; Claude-4.5-Sonnet: -71% tokens at 96% success. §5.1 hierarchical negative result is a free gift for AtlasFS Tier 3 (compile-to-pipeline beats nesting). GLM-4.7's 15-pp regression is the strongest argument for the endorsement gate. Port the 50%-null post-execution quality check into AtlasFS's verifier (~1h); adopt Exec Rate / Reusing Rate metrics for ledger.

- **2026-05-01**, [br/04, Agentic Plan Caching (Stanford 2025): Test-Time Memory for Plan-Act Agents](./br/04-agentic-plan-caching-stanford.md). Scan, 1 source. Stanford APC paper (Zhang/Wornow/Wan/Olukotun, arXiv 2506.14852v2) is the cleanest academic validation of the test-time plan-caching premise: -50.31% cost, -27.28% latency at 96.61% of accuracy-optimal, 1.04% overhead, across five workloads. AtlasFS goes structurally further on three axes (typed-signature match vs keyword-LLM-call, compile-to-pipeline vs small-LM-adapt, fingerprint-pinning vs none). Per-tenant L_n is the contribution APC implicitly leaves on the table; lead with it on the pitch slide. Borrow four operational guardrails (cold-start curve, auto-disable, cache-size knee, cost-optimal fourth baseline); ~1 engineer-day total integration.

- **2026-05-01**, [br/03, documentdbfuse: The Closest Public Expression of MongoFS, and What to Take From It](./br/03-documentdbfuse.md). Deep, 12 sources. Single-author Go FUSE binary, 1.6k LOC, 2 GitHub stars, mounts any MongoDB-wire-compatible database as a Linux FS with a path-segment aggregation DSL. Live-tested on this machine 2026-05-01: every advertised read-side feature passed; replace-on-existing-doc bug reproduced (ENOTSUP contradicts README); no NFS code despite README claim. Three small ideas to port (`--ls-limit` plus `.all/`, `.count` virtual file, three-format export pattern). Three big AtlasFS design decisions validated by documentdbfuse's mistakes (read-only `db/`, NFS-not-FUSE, typed-TS-with-fingerprint). Strengthens AtlasFS framing rather than threatening it; cite explicitly in Related Work alongside TigerFS and AgentFS as the three points of the "DB-as-FS for agents" trend.

- **2026-05-01**, [br/02, MongoDB Atlas + Voyage Fit, Adjacent Projects, and the Schema-Emergent Thesis](./br/02-mongodb-fit-and-adjacent-projects.md). Ultradeep, 65 sources. Validates the conjunction's originality at ~80% confidence across a 40-project survey. Catalogs the Atlas + Voyage substrate at GA / Preview / Roadmap level. Reframes the structured-vs-unstructured doubt into the right axis (schema-stability-across-queries vs schema-stability-across-documents). Drives the design update to product-design.md and mission.md adding "Two Dimensions of Adaptation" as a load-bearing section.

- **2026-05-01**, [br/01, Voyage AI as the Retrieval Backbone for a Code-Mode Data Interface](./br/01-voyage-ai-code-mode-data-interface.md). Establishes the code-mode + Voyage + Atlas Vector Search substrate; treats Voyage as the natural retrieval backbone given the MongoDB acquisition.

- **2026-05-01 (queued for capture)**, br/18, FUSE vs NFS for Virtual Filesystems for Agents. Conversational research; conclusion: NFS, not FUSE, on a 48-hour build.

- **2026-05-01 (queued for capture)**, br/52, AgentFS (Turso) as the VFS Engine. Conversational research; conclusion: adopt AgentFS as the primitive, author only MongoFS.
