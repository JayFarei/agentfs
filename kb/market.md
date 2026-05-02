---
title: "MongoDB-AE-Hackathon, Market"
type: evergreen
tags: [magic-docs]
updated: 2026-05-01
---

# Market

The strategic document. The thesis about the market in which the product exists: who the players are, what gaps exist, where the opportunity lies, and how this product is positioned. For the hackathon, "the market" is dual: the immediate market of judges and finalist competition, and the broader market of adaptive retrieval systems that the project's measurement framework is a wedge into.

---

## The Opportunity

### Immediate (the hackathon)

The MongoDB Agentic Evolution Hackathon (London, 2026-05-02) has three required themes: **Prolonged Coordination**, **Multi-Agent Collaboration**, **Adaptive Retrieval**. We are competing under Adaptive Retrieval, theme 3.

**Prize stack** (Round 1 -> Top 6 -> Top 3 mainstage):
- 1st: GBP 7.5k cash + residency + ~USD 11k partner credits + NVIDIA hardware
- 2nd: GBP 4.5k + ~USD 7k partner credits
- 3rd: GBP 3k + ~USD 4k partner credits
- ElevenLabs bonus track (separate, async): 6 months Scale tier per team member

**Eligibility gates** (failing any one disqualifies regardless of demo quality):
- Built on the MongoDB Atlas Sandbox (M10 cluster provided)
- Atlas as a *core component*, not a bolt-on
- Public repo, original work only, clearly delineated from any boilerplate
- Built on AWS (Top 6 finalist gate)
- Theme: Adaptive Retrieval (theme 3)
- *Not* on the banned list (Basic RAG Applications is the relevant ban for us; our differentiator from a basic RAG is the load-bearing originality claim)
- At least one team member at MongoDB.local London on May 7

**Round 1 scoring** (20% Impact / 45% Live Demo / 35% Creativity): the Live Demo weight is the largest. The headline cluster heatmap blooming during a 30-second timelapse and a procedure library file tree growing live, plus the deterministic replay of a previously-LLM call, are the visual moments engineered for that weight.

**Round 2** (Top 6, MongoDB.local community vote): rewards a *standalone-attractive* demo, not a great pitch. Different optimisation. The procedure library pane needs to be self-explanatory at the showcase booth.

**Round 3** (Top 3, mainstage): same three criteria, equal weight (33% each). Three minutes plus two minutes Q&A. The three-baseline divergence chart on mainstage is the closing moment.

### Broader (the thesis the hackathon probes)

The published 2024-2026 work on adaptive retrieval owns three slices:
- Within-session adaptive RAG (Self-RAG, FLARE, Adaptive-RAG)
- Static typed code-mode interfaces (Cloudflare 2025-26, Anthropic 2025)
- Auto-induced skill libraries (Voyager 2023, ASI 2025)

A fourth pattern is implicit but unclaimed: **document-store + agent retrieval treats schema as something to *impose***. Typed namespaces are reflected at deploy time; validators are enforced at write time; ORM layers are declared at the application layer. None treats schema as something that *crystallises per-tenant from the trajectory of agent queries over polymorphic data*. That is the gap, validated at roughly 80% confidence by the adjacent-projects survey in `br/02`.

The conjunction (typed primitives + user-endorsed cross-session evolution + deterministic procedure replay + measurable longitudinal compression on intent-clustered tasks + per-tenant crystallisation over a polymorphic document store) is unclaimed. The hackathon is the cheapest credible experiment that probes whether that conjunction produces measurable convergence on two orthogonal axes (cost-within-tenant and library-divergence-across-tenants).

If the curve diverges from the vanilla and static-typed baselines on the held-out eval, the broader thesis (interfaces emerge from agent usage, gated by users) has its first empirical leg, and the project becomes the seed for a longer-running research line.

If the curve does not diverge, the thesis reframes from "demonstrably observed" to "structurally enabled", and we know to redesign. Either result is informative; the contribution is the measurement framework as much as any specific effect size.

---

## Market Context

### Why now (the technology timing)

- **MongoDB acquired Voyage AI on 2026-02-24**. Atlas is now the natural RAG substrate, with `voyage-4-large`, `rerank-2.5`, and `voyage-multimodal-3.5` available natively via the Atlas Embedding & Reranking API. This is the first hackathon at which the integration is GA.

- **Code-mode is consensus**. Cloudflare Code Mode (Sep 2025), the Cloudflare "1,000 tokens" follow-up (Q1 2026), and Anthropic Tool Search (2025) all converged on the same architectural move within ~6 months. The token-cost argument for typed namespaces is settled; the open question is what the typed surface evolves into.

- **NFS-mounted virtual filesystems for agents are emerging as a primitive**. `hf-mount` (XetData) and AgentFS (Turso) both ship NFS-served virtual filesystems explicitly because FUSE / kernel extensions are too brittle for agent use cases. AgentFS specifically ships the building blocks (CoW overlay, `tool_calls` audit table, MCP fallback) that this project's procedure crystallisation loop needs.

- **`Library Learning Doesn't`** (Berlot-Attwell, NeurIPS MATH-AI 2024) named the open problem that auto-induced libraries are rarely actually reused. This is the published gap our user-endorsement gate is designed to close.

### Why now (the hackathon timing)

- The MongoDB acquisition is fresh, the hackathon is themed around agentic memory, and the judging weights live demo at 45%. A demo that visibly converts agentic search into deterministic software *during the demo* is a perfect fit.

- The banned-projects list excludes "Basic RAG Applications". Most submissions in theme 3 will skirt this line. A clearly differentiated retrieval system with a measurable convergence claim is a credible non-basic-RAG even on a pessimistic read.

---

## Competitive Landscape

### Inside the hackathon (theme 3 submissions)

| Player | Likely approach | Weakness |
|--------|----------------|----------|
| Most theme-3 teams | Self-RAG / Adaptive-RAG style with a clever per-query routing layer; LangGraph + MongoDB Atlas Vector Search | No cross-session compounding. Each session pays the same retrieval cost. The judging criterion "differentiates how" is hard to clear. |
| Multimodal-heavy teams | RAG with `voyage-multimodal-3.5` for some image corpus | The novelty is the modality, not the mechanism. Same flat curve over rounds. |
| Heavy graph-RAG teams | `$graphLookup` plus Atlas Vector Search for entity-rich corpora | Strong on a specific shape of corpus; doesn't address the cross-session compounding gap; can be overshadowed by a measurement-focused submission with a clear divergence chart. |
| Multi-agent-collab teams (theme 2) | Out of theme; not direct competition |

### Outside the hackathon (the broader thesis)

| Player | Approach | Weakness vs ours |
|--------|----------|------------------|
| Self-RAG / FLARE / Adaptive-RAG | Within-session adaptive retrieval | No cross-session memory; flat curve over rounds |
| Cloudflare Code Mode / Anthropic Tool Search | Static typed namespace + sandbox | Interface does not evolve from agent usage |
| Voyager / ASI | Auto-induced skill libraries | No user gate, low actual reuse rate (per *Library Learning Doesn't*) |
| LangGraph / LlamaIndex agent frameworks | Configurable RAG agents with memory primitives | No first-class user-endorsement step, no procedure-as-typed-file model, no compile-to-pipeline budget |
| Atlas Search alone | $rankFusion of vector + BM25 | Stateless; no cross-session compounding |

### Where we are in the landscape

The intersection of (a) typed primitives, (b) user-endorsed cross-session evolution, (c) deterministic procedure replay, and (d) measurable longitudinal compression on a pre-registered, intent-clustered eval is unclaimed. We do not have to be best at any one slice; being credible at the conjunction is the differentiator.

---

## Positioning

### Headline framing for judges

> A code agent retrieval system that crystallises **query shape** from agent
> usage, per-tenant, over a virtual filesystem that exposes any MongoDB Atlas
> cluster as a typed TypeScript codebase. Schema is never imposed; it is
> induced at three tiers (sampled type, endorsed trajectory, compiled
> aggregation pipeline). The system adapts on **two orthogonal dimensions**:
> cost converges within a tenant as procedures crystallise (expensive ReAct
> to deterministic compiled pipeline), and interfaces emerge across tenants
> as different intent sets crystallise different procedure libraries from the
> same data plane. Both are measurable on a held-out, intent-clustered task
> set against vanilla and static-typed baselines that exhibit neither.

### One-sentence pitch

A retrieval system where schema *emerges* from agent usage rather than being *imposed* on the data, with two orthogonal axes of adaptation (cost convergence within a tenant, interface emergence across tenants), proved on a pre-registered intent-clustered eval.

### The positioning line

> Iceberg and Delta Lake brought schema-on-read to the data-engineering
> layer. AtlasFS brings schema-on-read to the agent layer.

This is the answer to "isn't this just SQL?" and "why MongoDB specifically?" in one sentence. The principle (schema enforced at read time, not at write time, underlying data stays flexible) is the same; the consumer is the agent rather than the analyst; the output artefact is a per-tenant procedure library rather than a query plan. The substrate is MongoDB rather than Parquet because MongoDB is the operational store where the polymorphism already lives, and because Atlas now natively integrates Voyage for the embedding and reranking primitives that any agent layer needs. Lakehouse table formats added schema-on-read to a substrate that did not have it; AtlasFS adds it to a substrate that already does, and lifts it from queries to procedures.

### The wedge

Four demonstrably-true claims that no one in theme 3 will have all of:

1. **The interface evolves from agent usage**, gated by a binary user endorsement (visible in the demo as a 5-second review prompt).
2. **The procedures are deterministic typed TypeScript files** that the user can `cat`, `grep`, and replay (visible in the demo as a file-tree pane growing).
3. **The same data plane crystallises differently per tenant** (visible in the demo as a two-pane file tree where two simulated tenants' `procedures/` directories diverge, even though both mount the same `db/`).
4. **The convergence is measurable on two orthogonal axes**: cost-within-tenant (T_n, D_n, R_n) and library-divergence-across-tenants (L_n), against vanilla and static-typed baselines on a pre-registered eval (visible as the 2D divergence chart with both axes).

### What we are *not*

- Not a basic RAG (the banned list)
- Not an auto-skill-induction system (Voyager / ASI)
- Not a static typed namespace (Cloudflare Code Mode)
- Not a within-session adaptive retriever (Self-RAG / FLARE)
- Not a multi-agent system (theme 2)

We do not undermine any of the above; we sit at their intersection.

### Risk: judges read this as "academic"

The measurement framing is the contribution but it is also the way to lose the 3-minute demo if we lead with metrics. Mitigation: lead with the cluster heatmap moment (visceral) and the deterministic-replay moment (legible), close with the divergence chart (the proof).

---

## Go-to-Market

### Hackathon GTM (May 2 - May 7)

**Saturday May 2, Round 1 (live demo, 3 minutes plus Q&A):**
- 0:00-0:20: one-line architecture beat ("a typed filesystem over MongoDB Atlas where the agent's library evolves with use, gated by a user thumbs-up").
- 0:20-1:30: the cluster heatmap timelapse (red round 0 -> mostly green by round 5 within-cluster) plus a single live novel-query crystallisation showing the procedure file appearing in the library pane.
- 1:30-2:30: the deterministic-replay moment (re-run the same intent, watch the trajectory go from mostly-red to mostly-green nodes; show the Atlas pipeline the procedure compiled to).
- 2:30-3:00: the three-baseline divergence chart with variance bands.
- Q&A reserve: pre-rehearsed answers on (a) reuse rate vs *Library Learning Doesn't*, (b) why MongoDB Atlas specifically, (c) what would v2 look like.

**May 7, Round 2 (community vote at the showcase area):**
- Looping headline video (the cluster timelapse, no audio needed).
- Standalone signage with the one-sentence pitch.
- A self-running demo of "ask a novel security question, watch the procedure appear in the library", with auto-reset every 90 seconds.
- One QR code, one CTA: vote here.

**May 7, Round 3 (mainstage, equal-weight criteria):**
- Three minutes, four moments: setup the conjunction in 30 seconds, demo a crystallisation in 90 seconds, demo a deterministic replay in 60 seconds, show the divergence chart in the closing 30 seconds.
- Two-minute Q&A: the most likely judges' questions are about generalisation (out-of-cluster controls), the reuse rate, and what happens at production scale. Answers prepared.

### Post-hackathon GTM (broader thesis)

Two natural follow-ons regardless of result:

1. **Open-source `mongo-mount`**. The MongoFS backend converted into a standalone package: any developer can mount their Atlas cluster as a typed filesystem in one command, agent or no agent. This is the natural OSS contribution; the hackathon submission is one application of it.

2. **Publishable measurement framework**. The pre-registered intent-clustered eval methodology generalises beyond supply-chain risk. A short paper on the T_n / D_n / R_n / I_n axes with within / across / out-of-cluster aggregations plus the three-baseline comparison is a publishable contribution to the adaptive retrieval literature, conditional on the curves moving.

### Channels

- The hackathon itself is the launch channel; the public repo is the artefact.
- MongoDB.local London (May 7) is the secondary launch (community vote + potential mainstage).
- Voyage / Atlas / AgentFS communities are the natural amplification path post-hackathon (every primitive we adopt is a community in itself).

---

## Demo corpus rationale (why a three-source hybrid)

A market-positioning question disguised as a corpus-choice question. The Round 1 corpus is a **three-source hybrid**: a BIRD-SQL subset for cross-collection polymorphism plus published baseline comparability, FinQA full for within-document polymorphism plus compilable gold programs, and a supply-chain micro-set as the Round 1 demo narrative spine. The full rationale, ETL details, and risk analysis lives in [`br/06-bird-finqa-corpus.md`](./br/06-bird-finqa-corpus.md). The market case for the hybrid:

- **Comparability with published baselines.** BIRD has Spider 1.0 (DAIL-SQL 86.6%), BIRD-bench (~65 to 75% on hard split), and EvoMQL on text-to-MQL (76.6% / 83.1%) as published reference points. AtlasFS can cite a number on Round 1: "on the BIRD subset, vanilla agentic RAG hits ~X% accuracy at $Y cost; AtlasFS hits ~X+5% at $Y/3 by round 5." The supply-chain-only corpus had no benchmark to compare against.

- **Three polymorphism axes covered.** Within-document (FinQA filings), cross-collection (BIRD's 15 to 25 collections with wildly different schemas), and across-queries-within-tenant (both). Cross-collection polymorphism is arguably a *more rigorous* test of AtlasFS's schema-discovery story than within-document polymorphism alone.

- **Tenant divergence is sharp and measurable.** Two simulated tenants (data-analyst on BIRD-weighted intents, financial-analyst on FinQA-weighted intents) on the same combined cluster crystallise non-overlapping procedure libraries. L_n divergence (Jaccard distance between procedure signature sets) approaches 1.0 by Round 5. The divergence chart bends visibly and undeniably.

- **FinQA's compilable programs ARE crystallised procedures.** Gold programs from `czyssrs/FinQA` (e.g., `divide(table_lookup("2018", "fuel expense"), table_lookup("2018", "percent of total")) = 41932`) are morally identical to typed AtlasFS procedures. Showing the agent recover the program *as a typed AtlasFS procedure* is the cleanest possible demonstration of "trajectory is the procedure."

- **Supply-chain preserved as Round 1 narrative spine.** "Is this dependency safe to install?" lands faster with a Round 1 judge than "compute the YoY change in fuel-expense ratio for AAL." Round 1's 45% live-demo weight rewards visceral. Multimodal coverage (`voyage-multimodal-3.5` for typosquat detection) is preserved for the demo's multimodal beat.

- **Public data, license-checkable.** BIRD inherits from [bird-bench.github.io](https://bird-bench.github.io/) terms; FinQA inherits from the original paper. Supply-chain data is OGL-licensable. Published incidents (event-stream, ua-parser-js, xz-utils, polyfill.io) provide ground truth without legal-review risk on a 48-hour timeline.

- **Banned-list mitigation.** "Basic RAG Application" is the banned category closest to a naive read of "ask SEC filings." Mitigation: lead the demo with crystallisation (procedure file appearing) and deterministic-replay (procedure called without LLM), not retrieval. The two-tenant divergence visual is structurally not a RAG pattern, which makes the differentiator visible in the first 30 seconds.

- **Real industry pain across all three corpora.** Supply-chain compromise has been a top-five enterprise concern since 2021. Cross-database SQL agents are the active research frontier (BIRD-Interact, EvoMQL, the text-to-MQL line). Financial-document numerical reasoning is the FinQA paper's whole motivation. The Impact Potential criterion (20% of Round 1) is defensible across all three without hand-waving.

---

## Strategic notes

- **No DataFetch / envrun.ai branding in the hackathon repo.** This is its own project; the broader thesis stays private. Working codename: `AtlasFS`. Brand decisions deferred to post-submission.

- **The conjunction is the moat, not any one component.** Adopting AgentFS is not a weakness, it is a deliberate move to keep the original-work claim focused on MongoFS, the procedure crystallisation loop, the eval, and the optimisation worker. Inventing primitives the ecosystem already provides burns hackathon hours.

- **The headline chart is the proof.** Without the divergence chart against baselines, the demo is "look, a clever filesystem". With it, the demo is "we have measurement evidence the convergence claim is real". The latter is the impact and creativity story judges score.
