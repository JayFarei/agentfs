---
title: "BIRD-SQL + FinQA Hybrid Corpus, with a Supply-Chain Demo Spine"
date: 2026-05-01
mode: deep
sources: 18
status: complete
---

# BIRD-SQL + FinQA Hybrid Corpus, with a Supply-Chain Demo Spine

## Executive Summary

The Round 1 corpus changes from "open-source supply-chain risk only" to a
three-source hybrid: a **BIRD-SQL subset** (3 to 5 domains, ~1 to 2 GB after
load) for cross-collection polymorphism plus published text-to-SQL
comparability, **FinQA full** (8,281 examples across hundreds of S&P 500
filings) for within-document polymorphism plus the "compilable program is
the procedure" story, and a hand-crafted **supply-chain micro-set** (~10
queries, ~10 MB) preserved as the Round 1 demo narrative spine because of
its visceral stakes. The eval harness measures cost convergence (T_n, D_n,
R_n, I_n) and library divergence (L_n) on BIRD plus FinQA against vanilla
agentic RAG and static-typed baselines. Two simulated tenants drive
Dimension 1: a "data-analyst" role weighted toward BIRD aggregation queries,
a "financial-analyst" role weighted toward FinQA computation queries.

The reframing answers the standing concern that BIRD and FinQA "look like
structured data, not MongoDB-typical polymorphic content." The schema-emergent
thesis was never about within-document polymorphism alone; it was about
**schema for the agent's view emerging per-tenant from queries**, not about
the underlying data being messy. Polymorphism in this corpus lives at three
locations: across BIRD's ~70 databases (cross-collection polymorphism, where
the agent must discover which typed module answers an intent), within FinQA
filings (table-layout and accounting-line-item variation across companies),
and across queries within a tenant (the regime where AtlasFS's L_n
divergence becomes observable). Cross-collection polymorphism, in
particular, is arguably a *more rigorous* test of AtlasFS's
schema-discovery story than within-document polymorphism alone.

The downstream design consequence: a 95-domain BIRD cluster stresses static
schema-namespace discovery (per Cloudflare Code Mode). A 3 to 5 domain
subset (15 to 25 collections total) keeps static viable for Round 1; the
dynamic-discovery path (`db.search(intent)` plus `db.execute(coll, op)`,
the Cloudflare two-primitive reference architecture) becomes a Round 2 / 3
stretch goal. Two practical caveats also need flagging: the
`xu3kev/BIRD-SQL-data-train` HF dataset ships supervision pairs only, not
the row-level SQLite data (which lives in BIRD's separate 33.4 GB GitHub
release), and `dreamerdeo/finqa` ships answers plus gold_evidence but *not*
the program annotations the original FinQA paper describes; the original
`czyssrs/FinQA` repo is required for the compilable-program story.

## Overview

This brief documents the corpus design decision for the AtlasFS hackathon
demo. It supersedes the supply-chain-only framing in `kb/research.md`'s
"Demo domain" theme and updates the corpus-choice paragraphs in
`kb/product-design.md` and `kb/market.md`.

The corpus must satisfy seven properties (already enumerated in `br/02`'s
"Recommendation: corpus characteristics for the demo"):

1. Schema variance (4 to 12 distinct discriminator values)
2. Mid-scale size (100K to 5M docs)
3. Query diversity (5 to 20 distinct query shapes, with vector and traversal both represented)
4. Moderate update rate
5. Latent emergence (right structure not obvious from raw data)
6. Tenant-specific divergence (same data, different libraries per intent profile)
7. Competitor failure (where the obvious alternative visibly struggles)

Plus three hackathon-specific properties:

8. Eligibility-safe (not "Basic RAG Application" per banned list)
9. Demo-legible in 3 minutes (Round 1 weight: 45% live demo)
10. Standalone-attractive in a showcase loop (Round 2 weight: community vote)

The hybrid satisfies all ten. The supply-chain-only corpus satisfied 1 to 5
plus 9 well, but had no published baseline (property 11, comparability) and
weaker tenant-specific divergence than the BIRD+FinQA combination
(property 6).

## How It Works

### The three corpus components

#### Component 1: BIRD-SQL subset (3 to 5 domains)

**Source:** [BIRD-bench leaderboard](https://bird-bench.github.io/) (Li et al.,
NeurIPS 2023, [arXiv:2305.03111](https://arxiv.org/abs/2305.03111)) plus the
HuggingFace mirror at
[`xu3kev/BIRD-SQL-data-train`](https://huggingface.co/datasets/xu3kev/BIRD-SQL-data-train).

**What's shipped on HuggingFace:** 9,428 question/SQL pairs across ~70+ databases
(visible db_ids include `video_games`, `disney`, `legislator`, `food_inspection_2`,
`mondial_geo`, `shakespeare`, `movie_3`, `car_retails`, `superstore`,
`regional_sales`, `student_loan`, `olympics`, `hockey`, `public_review_platform`,
plus more not enumerated in the dataset card). Total HF download size: 2.33
MB. Fields per row: `db_id`, `question`, `evidence`, `SQL`, `schema`. The
`schema` field is the full `CREATE TABLE` DDL (up to 37.3K characters) for
the database.

**What's NOT shipped on HuggingFace:** the row-level data. The actual
SQLite databases (~33.4 GB across all 95 BIRD databases) live in BIRD's
official release at [github.com/AlibabaResearch/DAMO-ConvAI/tree/main/bird](https://github.com/AlibabaResearch/DAMO-ConvAI/tree/main/bird).
We download those, ETL the rows into Atlas as MongoDB collections (one
collection per table within each database), and discard databases not in
our subset.

**Subset selection criteria:** pick 3 to 5 databases that together satisfy
(a) high intra-database query density (so per-tenant crystallisation has
multiple queries to converge over), (b) cross-database schema diversity (so
the cross-collection polymorphism story is visible), (c) total post-load
size under 2 GB (so we fit comfortably under M10 storage limits with
headroom for FinQA and the supply-chain micro-set). Recommended starter
picks: `video_games`, `european_football_2`, `financial`, `formula_1`,
`debit_card_specializing`. These five appear repeatedly in published BIRD
analyses and have rich query families.

**What goes into Atlas:** one MongoDB database per BIRD `db_id`, one
collection per source table. Documents are flat-serialized rows, with
`_id: ObjectId()` and the original primary key preserved as a separate
field. Schema fingerprints will be generated by MongoFS on first `readFile`
exactly as on any other collection.

**Why this serves the design:**

- **Cross-collection polymorphism.** The cluster contains 15 to 25
  collections (3 to 5 databases × 3 to 5 tables each) with wildly different
  shapes. The agent's first task on a novel intent is to discover which
  collection's `db/<coll>.ts` is relevant. This is the schema-discovery
  problem at the cross-collection granularity, which is structurally what
  AtlasFS solves.
- **Published baselines.** Spider 1.0 ([Yu et al., EMNLP 2018,
  arXiv:1809.08887](https://arxiv.org/abs/1809.08887)) and BIRD reports
  numbers for a long list of LLM agents. DAIL-SQL ([VLDB 2024,
  arXiv:2308.15363](https://arxiv.org/abs/2308.15363)) reports 86.6% on
  Spider, BIRD's leaderboard tracks ~65 to 75% on the harder split, and the
  EvoMQL paper ([arXiv:2604.13045](https://arxiv.org/abs/2604.13045)) cited
  in `br/02` reports 76.6% in-distribution and 83.1% out-of-distribution
  on EAI/TEND for text-to-MQL specifically. AtlasFS can cite these as the
  "what vanilla agentic SQL agents achieve, before any cross-session
  compounding" reference point.
- **Natural intent clusters.** BIRD's queries are already grouped by
  `db_id`. The video_games database alone has dozens of related queries
  (publisher-by-sales, top-rated-games, platform-evolution-over-time);
  likewise the financial database. These pre-grouped query families are
  exactly the unit on which crystallisation should converge.

**Caveats:**

- The HF dataset has no execution column. Ground-truth scoring requires
  executing the gold SQL against the SQLite databases, then translating
  the result into the AtlasFS aggregation pipeline output. Plan 001 budget
  must include this conversion.
- License is unstated on the HF page but inherits from BIRD's official
  release; verify before public-repo commit.

#### Component 2: FinQA full

**Source:** the FinQA paper ([Chen et al., EMNLP 2021,
arXiv:2109.00122](https://arxiv.org/abs/2109.00122)) plus the HuggingFace
mirror at [`dreamerdeo/finqa`](https://huggingface.co/datasets/dreamerdeo/finqa).
The original FinQA repo at
[github.com/czyssrs/FinQA](https://github.com/czyssrs/FinQA) ships the
program annotations the HF dataset omits.

**What's shipped on HuggingFace:** 8,281 question/answer pairs (6,251
train + 883 validation + 1,147 test), 35.6 MB uncompressed. Fields per
row: `id` (e.g., `AAL/2018/page_13.pdf-2`), `pre_text`, `post_text`,
`question`, `answers`, `gold_evidence`, `table` (2D string array). Hundreds
of distinct S&P 500 companies represented.

**What's NOT shipped on HuggingFace:** the program annotations. The
original FinQA paper describes "gold programs" as compilable operations
like `divide(table_lookup("2018", "aircraft fuel expense"),
table_lookup("2018", "percent of total operating expenses"))`. These live
in the `czyssrs/FinQA` repo, not in `dreamerdeo/finqa`. To recover them,
the team must clone the original repo and merge the program field by `id`
during ETL.

**What goes into Atlas:** one `filings` collection. Each document is one
filing (id, pre_text, post_text, table, plus any company metadata
extracted from the id structure). Tables are stored as nested arrays;
pre_text and post_text are stored as string fields with embeddings via the
Atlas Embedding API (`voyage-context-3` is the recommended choice per
`br/02`).

**The "remove the document, force search" twist:** in FinQA's original
benchmark, every question carries the document context (table + text). The
agent reads the table and answers. To make FinQA a fair test of AtlasFS's
search step, we strip the document from the question at evaluation time
and force the agent to retrieve the right filing first via vector search
or hybrid search across the `filings` collection. This is the user's
contribution and it converts FinQA from a "given a document, compute" task
into a "find the document, then compute" task that exercises both the
search and the procedure-crystallisation surfaces of AtlasFS.

**Why this serves the design:**

- **Within-document polymorphism.** Filings vary substantially across
  companies: airline-industry filings have aircraft fuel tables; tech-sector
  filings have R&D expense tables; financial-sector filings have
  loan-loss-provision tables. The same question shape ("what was the
  YoY change in X?") demands a different polymorphic-shape match per
  company. This is the within-document polymorphism story the BIRD subset
  alone does not deliver.
- **Compilable procedures.** FinQA's gold programs are *literally* what
  crystallised AtlasFS procedures should look like. A trajectory that ends
  in `divide(9896, 0.236) = 41932` crystallises into a typed procedure
  that calls `db.filings.lookup(...)` twice and `compute.divide(...)` once.
  Showing the agent recover the gold program *as a typed AtlasFS procedure*
  is the cleanest possible demonstration of the "trajectory is the
  procedure" property.
- **8K examples is large enough for crystallisation to matter.** A typical
  AtlasFS Round 1 eval runs ~50 queries per cluster across 5 rounds. With
  8,281 examples available, the team can sample diverse intent profiles for
  the two simulated tenants without exhausting the corpus.

**Caveats:**

- The HF dataset's `dreamerdeo/finqa` license is unstated; the original
  FinQA repo's license should be checked. The dataset card has empty YAML
  metadata.
- The `id` format `AAL/2018/page_13.pdf-2` encodes ticker/year/page/q_idx
  but the team should verify this is consistent across the dataset.
- Gold program recovery from `czyssrs/FinQA` requires a separate ETL pass.

#### Component 3: supply-chain micro-set (Round 1 demo narrative spine)

**Source:** hand-crafted by the team during Day 1 setup. Public sources
that already exist in `kb/research.md`'s Demo domain theme:

- npm registry metadata ([registry.npmjs.org](https://registry.npmjs.org/)),
  per-package documents up to ~10 MB each
- GitHub Security Advisories ([github.com/advisories](https://github.com/advisories))
  via the GHSA database
- OSV ([osv.dev](https://osv.dev/)) cross-ecosystem vulnerability database
- Documented incidents (event-stream, ua-parser-js, xz-utils, polyfill.io)
  for ground truth

**What goes into Atlas:** small (~10 MB), ~10 hand-crafted queries with
hand-labeled answers and trajectories. These are NOT in the formal eval.
They are the **Round 1 demo narrative spine**.

**Why this serves the design:**

- **Visceral stakes.** "Is this dependency safe to install?" lands faster
  with a Round 1 judge than "compute the YoY change in fuel expense
  percentage for AAL 2018." The hackathon's 45% live-demo weight rewards
  visceral.
- **Multimodal coverage.** Logo similarity for typosquat detection
  exercises `voyage-multimodal-3.5`, which BIRD and FinQA do not. Keeping
  this in the demo (not the eval) preserves the multimodal-search visual
  for the 3-minute pitch.
- **Honest scope.** The supply-chain micro-set is not load-bearing for
  measurement; it is load-bearing for the demo. The eval lives in
  BIRD+FinQA where published baselines exist.

### The two-tenant scheme for L_n

Per `kb/product-design.md` Open Question #4, two simulated tenants run
against the combined cluster:

**Tenant A: data-analyst.** System-prompt role: `data-analyst`. Intent
prior weighted toward BIRD aggregation and window-function queries.
Examples: "list publishers of games with sales < 10000", "average tenure
of legislators by state", "top 10 superstore products by quarterly
revenue". Uses `findExact`, `search`, and the SQL-style `$group` /
`$lookup` aggregation pipelines. Crystallises procedures keyed to BIRD's
collection schemas.

**Tenant B: financial-analyst.** System-prompt role: `financial-analyst`.
Intent prior weighted toward FinQA financial computation queries.
Examples: "what was the YoY revenue growth for AAL between 2017 and
2018?", "compute the operating margin for AAPL in Q3 2019", "find the
fuel-expense ratio for any airline reporting > 20% of total operating
expenses on fuel". Uses `findSimilar` (semantic search across pre_text /
post_text), `hybrid` ($rankFusion of vector + lexical on filings), and
arithmetic-style aggregation pipelines (`$divide`, `$subtract`,
`$project`). Crystallises procedures keyed to FinQA's filings shape.

**The expected divergence pattern:** by Round 5, Tenant A's `procedures/`
contains ~5 to 10 BIRD-shaped procedures (e.g., `top_publishers_by_sales`,
`legislator_tenure_by_state`); Tenant B's contains ~5 to 10 FinQA-shaped
procedures (e.g., `yoy_revenue_growth`, `operating_margin`,
`fuel_expense_ratio`). The procedure sets do not overlap, and L_n
(Jaccard distance between signature sets) approaches 1.0. The vanilla and
static-typed baselines have no `procedures/`, so L_n is undefined for them.
The 2D divergence chart shows L_n rising on "ours" while remaining
flat-zero on the baselines.

### The static-vs-dynamic schema discovery decision

`kb/product-design.md` Open Question #1 currently says: "Static (whole TS
namespace in context) matches Cloudflare's reference and is simplest.
Tentative answer: static for v1." The hybrid corpus pushes this question
to a sharper edge.

**Static path (Round 1 default):**

- 3 to 5 BIRD databases × 3 to 5 tables each = 9 to 25 collections.
- Plus 1 FinQA `filings` collection = 10 to 26 collections total.
- Plus the supply-chain micro-set = ~30 collections at the upper bound.
- Each collection's typed module is ~30 to 60 lines of TypeScript.
- Total static namespace: ~900 to 1800 lines of TypeScript.
- Token budget per Cloudflare Code Mode reference: roughly 1 token per
  3 characters of TypeScript, so ~6K to 12K tokens for the full namespace.
- This is 6x to 12x the Cloudflare ~1,000-token claim, but well under the
  ~200K context windows of Claude Sonnet / Opus / Haiku.
- **Static is feasible at this scale.** Pick this for Round 1.

**Dynamic path (Round 2/3 stretch):**

- Implement `db.search(intent: string): CollectionDescriptor[]` and
  `db.execute(coll: string, op: TypedCallSpec): Promise<Result>` as the
  agent's two primary primitives, replacing the per-collection typed
  modules in the system prompt.
- Cloudflare uses this pattern for the 2,500-endpoint Cloudflare API per
  the [Code Mode in 1,000 tokens blog post](https://blog.cloudflare.com/code-mode-mcp/).
- Worth doing if BIRD subset grows to 10+ databases, or if the team wants
  to demo "scales to any cluster size" in Round 3.
- Adds ~half a day of engineering: the `search()` primitive is a tool over
  the metadata index of synthesised modules, the `execute()` primitive is a
  guarded reflection-based call against the typed module registry.

**Recommendation:** static for Round 1; dynamic as a stretch goal for
Round 2/3 polish. If the BIRD subset grows beyond ~5 databases, flip to
dynamic earlier.

### The Round 1 demo narrative spine

The 3-minute demo splits into four beats per `kb/roadmap.md` Plan 010:

- **Beat 1, 0:00 to 0:30: setup.** "AtlasFS mounts an Atlas cluster as a
  typed TypeScript filesystem. The agent writes code that imports from the
  mount." Show `ls /datafetch/db/` listing collections from BIRD + FinQA +
  the supply-chain micro-set. Show `cat /datafetch/db/packages.ts`
  surfacing the typed module for npm packages. Use the supply-chain
  collection because its schema is most legible (Package interface with
  named maintainers, advisories, etc.).

- **Beat 2, 0:30 to 1:30: tenant divergence (Dimension 1).** Two-pane
  file-tree showing two simulated tenants' `procedures/` libraries
  diverging across rounds. Tenant A's pane fills with BIRD-shaped
  procedures (`top_publishers_by_sales.ts`,
  `legislator_tenure_by_state.ts`); Tenant B's pane fills with FinQA-shaped
  procedures (`yoy_revenue_growth.ts`, `operating_margin.ts`). Same
  cluster, different libraries. The visual is dramatic without narration.

- **Beat 3, 1:30 to 2:30: cost convergence (Dimension 2) on a supply-chain
  query.** Single hand-crafted query: "is the npm package `event-stream`
  safe to install?". Round 0: agent ReAct loop with multi-step trajectory
  (red graph), 15+ typed calls, expensive. Round 5: matched procedure,
  single deterministic call, all green. Show the Atlas aggregation
  pipeline the procedure compiled to in a side panel. The supply-chain
  query lands faster than a FinQA computation because the stakes are
  visceral.

- **Beat 4, 2:30 to 3:00: 2D divergence chart.** Both axes simultaneously
  visible. X = round, Y = cost (T_n). Per-tenant lines fanning out
  (Dimension 1). Line slopes diving (Dimension 2). Confidence intervals
  via 3 seeds. Vanilla and static-typed baselines as flat references.
  L_n curve overlaid in a corner subplot.

The supply-chain micro-set is the **stage anchor** for Beats 1 and 3
because of its narrative immediacy; the BIRD+FinQA eval is the **proof
backbone** for Beats 2 and 4 because of its scale and comparability.

## Strengths

- **Published comparability.** AtlasFS can cite Spider, BIRD, and EvoMQL
  baselines for the SQL-style cluster, and the FinQA paper baseline for
  the financial computation cluster. No internal-eval-only chart.
- **Cross-collection plus within-document polymorphism in one cluster.**
  BIRD delivers the across-collection axis; FinQA delivers the
  within-document axis. The schema-emergent thesis is tested on both
  granularities.
- **Natural query families per database.** Crystallisation has dozens of
  related queries to converge over within each BIRD database, hundreds of
  related queries (per filing) within FinQA. Reuse rate (R_n) is
  defensible.
- **Tenant divergence is sharp.** A data-analyst and a financial-analyst
  on the same cluster crystallise non-overlapping procedure libraries.
  L_n divergence is observable without contrived intent priors.
- **Supply-chain micro-set preserved as demo spine.** The viscerality
  advantage of "is this dependency safe?" is retained for Round 1 stage
  presence without polluting the eval.
- **Compilable programs (FinQA).** Gold programs from
  `czyssrs/FinQA` are exactly what crystallised AtlasFS procedures should
  look like. Showing the agent recover the program as a typed procedure
  is the strongest possible demonstration of the trajectory-is-procedure
  property.
- **Multi-modal preserved.** Supply-chain micro-set retains
  `voyage-multimodal-3.5` for typosquat-logo detection, satisfying the
  hackathon's "five source types" implicit ask.

## Limitations & Risks

- **ETL effort.** Loading a BIRD subset requires downloading the SQLite
  databases from the official 33.4 GB release, parsing them, and
  inserting into Atlas. Estimated effort: half a day for Day 1 setup.
  Mitigation: build a small `loadBird.ts` script with a
  hard-coded subset list, run it once, commit the data dump as part of
  Plan 001.
- **License gaps.** Both `xu3kev/BIRD-SQL-data-train` and
  `dreamerdeo/finqa` have unstated licenses on their HF cards. The
  underlying BIRD and FinQA papers permit research use, but the
  team should verify before the public repo commit.
- **Program annotations missing from `dreamerdeo/finqa`.** The HF
  dataset ships answers and gold_evidence but not the program field. To
  recover programs, the team must clone `czyssrs/FinQA` and merge by
  `id`. Mitigation: build the merge into the same FinQA ETL pass.
- **Static namespace upper bound stress.** 30 collections at ~30 to 60
  lines of TypeScript each is ~1800 lines, ~12K tokens. Comfortable for
  Claude Sonnet / Opus, tight for Haiku-4.5 if the agent's working context
  is also large. Mitigation: pick the lower end of the BIRD subset (3
  databases × 3 tables) for Round 1 and reserve the rest for Round 2 / 3.
- **Round 1 demo legibility tradeoff.** A judge who knows BIRD or FinQA
  will appreciate the comparability angle; a judge who does not may find
  "compute fuel-expense ratio for AAL 2018" cold compared to "is
  event-stream safe to install?". Mitigation: keep supply-chain as the
  Round 1 narrative anchor (Beats 1 and 3); use BIRD+FinQA only for the
  proof backbone (Beats 2 and 4).
- **Banned-list risk: "Basic RAG Application".** A naive read of "ask SEC
  filings" looks like RAG. Mitigation: the demo must lead with
  *crystallisation* (procedure file appearing) and *deterministic replay*
  (procedure called without LLM), not with retrieval. The differentiator
  must be visible in the first 30 seconds. The two-tenant divergence
  visual makes this structurally hard to mis-read as basic RAG.
- **Atlas M10 storage.** M10 includes ~10 GB storage by default. The
  hybrid (1.5 GB BIRD + 0.04 GB FinQA + 0.01 GB supply-chain + ~0.5 GB
  vector indexes) totals ~2 GB, with ample headroom. If the BIRD subset
  grows past 5 databases, monitor storage with the M10 metrics dashboard.
- **Cross-corpus query confusion.** The agent on a novel intent must first
  decide which corpus a question targets. Without the corpus already pinned
  in the question, "what was the YoY change in event-stream weekly
  downloads?" is supply-chain plus computation; "average employee tenure"
  could be BIRD's `legislator` database or FinQA's filings. Mitigation:
  pre-register the intent classifier in Plan 001 with explicit
  corpus-routing labels per task; the eval scoring weights corpus
  identification as a sub-step.

## Integration Analysis

### What to extract

From **BIRD-SQL** and the published text-to-SQL literature:

1. **The benchmark structure** (per-db_id query families, schema as DDL,
   gold SQL plus evidence). Adopt the structure verbatim into Plan 001's
   eval ledger.
2. **Cross-database polymorphism as the schema-discovery test.** This is
   the angle missing from the supply-chain-only framing.
3. **Numbers to cite.** DAIL-SQL on Spider (86.6%), BIRD leaderboard
   (~65 to 75% on hard split), EvoMQL on EAI/TEND (76.6% / 83.1%).

From **FinQA**:

1. **The compilable program field** from `czyssrs/FinQA`. Programs like
   `divide(9896, 0.236) = 41932` are the canonical form for crystallised
   procedures.
2. **Per-filing polymorphism.** Different companies' filings have different
   tables and accounting line items; this is the within-document
   polymorphism the BIRD subset alone does not deliver.
3. **The "remove the document, force search" twist.** FinQA's original
   benchmark gives the agent the document; we strip it to force the
   retrieval step that AtlasFS's typed `db/filings.ts` is designed to
   exercise.

From the **supply-chain micro-set**:

1. **Demo viscerality.** "Is this safe?" is the Round 1 stage anchor.
2. **Multimodal coverage.** `voyage-multimodal-3.5` for typosquat detection.
3. **Hand-crafted ground truth.** Real published incidents (event-stream,
   ua-parser-js) provide narrative-rich correctness checks.

### Bootstrap path

1. **Day 1 morning, ~2h:** ETL.
   - Download BIRD's SQLite release; subset to 3 to 5 databases; parse and
     insert as MongoDB collections.
   - Download `dreamerdeo/finqa` from HF; clone `czyssrs/FinQA` for program
     annotations; merge by `id`; insert as a single `filings` collection.
   - Hand-craft the supply-chain micro-set (~10 documents, ~10 queries).
   - Total post-load size: ~2 GB.

2. **Day 1 afternoon, ~2h:** Pre-registered task set (Plan 001).
   - 5 intent clusters of 8 tasks each = 40 tasks.
     - 2 BIRD clusters (e.g., video-games-publishers, formula-1-results)
     - 2 FinQA clusters (e.g., revenue-growth, operating-margin)
     - 1 supply-chain cluster (security risk assessment)
   - 10 out-of-cluster controls.
   - Per task: answer label, evidence label, canonical-pathway label.
   - Commit hash recorded in `eval/PRE_REGISTRATION.md`.

3. **Day 1 evening, ~1h:** Two-tenant configuration (Plan 005 + Plan 006).
   - `data-analyst` system prompt: BIRD-weighted, biased toward
     aggregation primitives.
   - `financial-analyst` system prompt: FinQA-weighted, biased toward
     similarity search and arithmetic primitives.
   - Per-tenant CoW overlay paths under AgentFS:
     `/procedures/data-analyst/` and `/procedures/financial-analyst/`.

4. **Day 2 onward:** Run rounds 0 to 5 across both tenants and all three
   baselines. Compute T_n / D_n / R_n / I_n per tenant per round and L_n
   between tenants per round.

### Effort estimate

**Medium for Round 1 demo**, broken down:

- ETL: half a day (BIRD + FinQA + supply-chain)
- Pre-registered task set: half a day
- Eval harness adjustments for two-tenant runs and L_n computation:
  half a day (existing Plan 006 deliverable adapted)
- Demo narrative spine: covered by existing Plan 010

Total incremental over the supply-chain-only plan: ~half a day to a day.
The eval harness, crystallisation pipeline, drift workflow, and
optimisation worker are unchanged.

## Key Takeaways

1. **The structured-data critique fails on a sharper read of the
   schema-emergent thesis.** Polymorphism lives at three locations
   (within-document, across-collection, across-queries-within-tenant); the
   hybrid covers all three, with cross-collection polymorphism (BIRD's
   ~70 databases) arguably a more rigorous test of AtlasFS's
   schema-discovery story than within-document polymorphism alone.

2. **Use the supply-chain micro-set for stage presence; use BIRD+FinQA for
   measurement.** Round 1's 45% live-demo weight rewards visceral
   anchoring, which "is event-stream safe?" delivers and "compute
   AAL fuel-expense ratio" does not. Round 1's eval scoring rewards
   comparability, which BIRD+FinQA's published baselines deliver and a
   bespoke supply-chain corpus does not. Both are needed; they serve
   different demo beats.

3. **FinQA's compilable programs are the cleanest demonstration of
   trajectory-is-procedure.** Pull the program field from
   `czyssrs/FinQA` (the HF mirror omits it), show the agent recover the
   program as a typed AtlasFS procedure, and the "schema for queries
   crystallises from agent usage" pitch lands without further argument.

4. **Static schema discovery survives at 3 to 5 BIRD databases plus
   FinQA. Dynamic discovery is the Round 2/3 stretch goal.** The
   Cloudflare two-primitive (`search`/`execute`) reference architecture is
   the right destination if the corpus grows; not needed for Round 1.

## Sources

### Primary corpus papers and dataset cards

- [BIRD: A Big Bench for Large-Scale Database Grounded Text-to-SQL](https://arxiv.org/abs/2305.03111)
  (Li et al., NeurIPS 2023). The canonical BIRD paper.
- [BIRD-bench leaderboard](https://bird-bench.github.io/). Live results
  table for SQL agents.
- [`xu3kev/BIRD-SQL-data-train` on HuggingFace](https://huggingface.co/datasets/xu3kev/BIRD-SQL-data-train).
  The supervision-pair mirror used here. 9,428 question/SQL/schema pairs,
  2.33 MB.
- [BIRD official release at AlibabaResearch/DAMO-ConvAI](https://github.com/AlibabaResearch/DAMO-ConvAI/tree/main/bird).
  Contains the 33.4 GB SQLite database files.
- [FinQA: A Dataset of Numerical Reasoning over Financial Data](https://arxiv.org/abs/2109.00122)
  (Chen et al., EMNLP 2021). The canonical FinQA paper.
- [`dreamerdeo/finqa` on HuggingFace](https://huggingface.co/datasets/dreamerdeo/finqa).
  The HF mirror, 8,281 examples, omits program annotations.
- [`czyssrs/FinQA` on GitHub](https://github.com/czyssrs/FinQA). The
  original FinQA repo with program annotations preserved.

### Text-to-SQL benchmarks for comparability

- [Spider 1.0](https://arxiv.org/abs/1809.08887) (Yu et al., EMNLP 2018).
  Cross-domain text-to-SQL benchmark.
- [DAIL-SQL](https://arxiv.org/abs/2308.15363). VLDB 2024, 86.6% on
  Spider 1.0.
- [Draft-Refine-Optimize / EvoMQL](https://arxiv.org/abs/2604.13045).
  Text-to-MQL closed-loop training pipeline; 76.6% in-distribution / 83.1%
  out-of-distribution on EAI/TEND. Already cited in `br/02`.

### MongoDB and Atlas references

- [Polymorphic Schema Pattern](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/polymorphic-data/polymorphic-schema-pattern/).
  Used for FinQA filings storage.
- [Specify Validation for Polymorphic Collections](https://www.mongodb.com/docs/manual/core/schema-validation/specify-validation-polymorphic-collections/).
  The MongoDB-blessed `oneOf` discriminated union pattern.
- [Atlas M10 specifications](https://www.mongodb.com/docs/atlas/manage-clusters/).
  Storage and feature limits relevant to the corpus size budget.

### Adjacent project references (already in `br/02`)

- [`kb/br/02-mongodb-fit-and-adjacent-projects.md`](./02-mongodb-fit-and-adjacent-projects.md).
  The structured-vs-unstructured fit research that this brief operationalises.
- [Cloudflare Code Mode in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/).
  The static-vs-dynamic schema discovery reference for large API surfaces.

### Internal cross-references

- [`kb/product-design.md`](../product-design.md). Open Question #1 (static
  vs dynamic schema discovery), Open Question #4 (per-tenant overlays).
- [`kb/research.md`](../research.md). Demo domain theme.
- [`kb/roadmap.md`](../roadmap.md). Plan 001 (pre-registered task set),
  Plan 010 (demo polish).
- [`kb/market.md`](../market.md). Demo domain rationale.
