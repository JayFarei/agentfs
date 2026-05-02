---
title: "MongoDB-AE-Hackathon, Product Design"
type: evergreen
tags: [magic-docs]
updated: 2026-05-01
hackathon_theme: "Adaptive Retrieval"
working_codename: "AtlasFS"
---

# Product Design

The most detailed root document. Describes the product as it exists today (or, in this hackathon's case, the product we are building over the May 2-7 window): architecture, components, data flow, security model, API surface, and key implementation decisions. The specific "how" rather than the aspirational "what."

---

## What It Is

A code-mode adaptive retrieval system that **crystallises query shape from agent usage, per-tenant, over a polymorphic document store**:

- Any MongoDB Atlas cluster is exposed at `/datafetch/` as a virtual module surface inside the agent sandbox (Cloudflare Worker + `@cloudflare/sandbox`).
- Each collection appears as a typed TypeScript module synthesised lazily on `read`, with polymorphic shapes lifted into `oneOf`-style discriminated unions and presence-frequency metadata in JSDoc.
- For novel intents, hand-authored hooks at `/datafetch/hooks/<domain>/<intent>.ts` scaffold the agent's first move with a domain-aware suggested chain shape (relevant collections, parameter interface, derivation sketch), bridging the gap between an over-broad bootstrap and a not-yet-crystallised procedure.
- A code-mode agent (Pi) writes TypeScript snippets that import from these typed paths.
- An audit log captures every typed call (`tool_calls`, provided by AgentFS).
- The user reviews trajectories on completion and endorses successful ones.
- Endorsed trajectories crystallise into TypeScript files in `procedures/`, **scoped per-tenant** so the same Atlas cluster grows different procedure libraries for different tenants.
- A budget worker compiles each promoted procedure to a single Atlas aggregation pipeline so the LLM is no longer in the hot path on the next call.
- A pre-registered intent-clustered eval measures **two orthogonal axes of adaptation**: cost convergence within a tenant (T_n, D_n, R_n, I_n) and library divergence across tenants (L_n), against vanilla agentic RAG and static-typed baselines.

The substantive insight: schema is **never imposed** on the data; it is **induced** at three increasingly stable tiers (sampled inferred type at `readFile`, endorsed query trajectory at crystallisation, compiled aggregation pipeline at budget pay-out). MongoDB collections are typically polymorphic across documents but stable across query intents once an application matures. AtlasFS's job is to crystallise the *query shape*, not the *document shape*, and to do it once per tenant. In one phrase: **embeddings discover affordances; code exercises them; procedures name them.** See `kb/mission.md` for the why and `kb/br/02` for the structured-vs-unstructured-fit research.

What is being built during the 48-hour hackathon is the **MongoFS backend**, the **procedure crystallisation pipeline**, the **schema fingerprint and drift workflow**, the **eval harness with three baselines**, the **cluster heatmap and procedure library UIs**, and the **optimisation-budget worker**. Everything else is a configured external service.

---

## Core Design Principles

Technical, distinct from the product principles in `mission.md`.

1. **Schema is induced at three tiers, never imposed; the first tier is mechanical, the next two are emergent.** Structure surfaces in three forms with different mechanisms: (a) **bootstrap** at `MongoFS.readFile` time, a deterministic function of sampled documents producing a generic typed surface with `oneOf` discriminated unions, presence-frequency JSDoc, and a fixed set of retrieval primitives, refreshed on schema fingerprint change; (b) **endorsed query trajectory** at crystallisation, settled per-tenant in `procedures/<tenant_id>/<name>.ts`, narrows the bootstrap to specific polymorphic variants and specific primitive compositions; (c) **compiled aggregation pipeline** at budget pay-out, fully stable, LLM out of hot path. The bootstrap (a) is shared across tenants and answers "what *can* the agent do"; the emergent layer (b) is per-tenant and answers "what *works* for this tenant"; the compiled layer (c) answers "what is the *cheapest* way." No tier imposes structure on the data; every tier induces it from data plus usage. See "Bootstrap to Emergence" below for the chicken-and-egg resolution.

2. **Schema fingerprint as a TypeScript constant.** Every generated module exports a `SCHEMA_VERSION` constant set to a sha256 of the inferred schema. Procedures pin themselves to the fingerprint at crystallisation time. Drift is mechanical to detect: change-stream event, recompute fingerprint, walk `procedures/` with ts-morph, flag every procedure whose pin is stale.

3. **Trajectory is the procedure.** Because the typed filesystem unifies discovery, access, and composition, the trajectory log is already valid TypeScript. The crystallisation step has no "translate trajectory to procedure" phase. It is `git add` plus `git commit`.

4. **Bindings, not network, inside the agent sandbox.** The agent gets typed filesystem paths, never API keys. Prompt-injection key exfiltration is structurally impossible.

5. **Read-only base, writable delta.** MongoFS exposes the cluster as read-only virtual modules. `procedures/` and `scratch/` live in the tenant Durable Object's SQLite store. Branching is `state.storage` snapshot + replay into a sibling DO.

6. **Procedure correctness is verifier-checked, not LLM-checked.** Before a trajectory is allowed to become a procedure, the system replays the procedure's final synthesised typed call against a held-out shadow input and compares the result to the trajectory's recorded result. Crystallisation fails closed.

7. **One eval, many seeds, pre-registered.** The dataset, the labels, and the protocol are committed before any baseline runs. Variance bands on every chart.

8. **Per-tenant interface emergence is a first-class property.** Procedure libraries, the AgentFS overlay, and the trajectory namespace are scoped per *tenant*, not per cluster. The same Atlas cluster can crystallise into different libraries for different tenants. Library divergence (L_n) is a first-class metric on the eval ledger, alongside the within-tenant convergence axes.

---

## Two Dimensions of Adaptation

The hackathon theme is *Adaptive Retrieval*. AtlasFS adapts in two orthogonal dimensions, both visible in the demo and measurable in the eval. This section is the load-bearing pitch surface; the rest of the architecture exists to support it.

### Dimension 1, across tenants (interface emergence, "library divergence")

Same Atlas cluster, same data plane, **different `procedures/` overlays per tenant**. Each tenant's agent trajectories produce a different procedure library because each tenant's *intent set* differs. A security analyst's library converges to compliance-flavoured procedures (`is_safe_to_install(pkg)`, `audit_dependency_chain(repo)`); an ML researcher's library converges to discovery-flavoured procedures (`find_actively_maintained_alternatives(pkg)`, `cluster_by_maintainer_velocity()`); a compliance officer's library converges to audit-flavoured procedures (`who_introduced_dependency(pkg, since)`, `evidence_for_soc2_control(id)`). Same `db/packages.ts`, same Voyage embeddings, fundamentally different typed surfaces.

Implementation: per-tenant CoW overlays in AgentFS isolate the procedure libraries and scratch state; per-tenant trajectory namespaces (a `tenant_id` column on `tool_calls`) isolate the audit trail; per-tenant procedure metadata isolates fingerprint pins and budget allocations. The `db/` and `views/` read-only base is shared.

Demo artefact: a two-pane file-tree view showing two simulated tenants' `procedures/` directories diverging across rounds. The same `db/packages.ts` underlies both; the procedure files do not overlap.

Metric: **L_n** (library divergence) = Jaccard distance between procedure signature sets across tenants at round n. Rises monotonically across rounds. For the demo, computed across two simulated tenants with different intent priors over the eval set.

### Dimension 2, within a tenant over time (cost convergence, "compile path")

For a single tenant, a novel intent enters **expensive**: agent ReAct loop over typed primitives, multi-call, LLM in the hot path, tokens spent. A successful trajectory is endorsed. Crystallisation produces a deterministic typed procedure. Optimisation budget compiles the procedure to a single Atlas aggregation pipeline. The same intent on subsequent calls runs **cheap** at deterministic-software speed with no LLM invocation.

Implementation: existing crystallisation pipeline + budget worker (Plans 005 and 009).

Demo artefact: a single intent re-runs three times. Round 0 trajectory is multi-step, mostly red. Round 3 trajectory is one deterministic call, all green. The Atlas pipeline the procedure compiled to is shown in a side panel.

Metrics: **T_n** (trajectory length, lower is better), **D_n** (determinism rate, higher is better), **R_n** (reuse rate, high by construction under user endorsement), **I_n** (information rate per action), token cost, wall-clock. All converge over rounds within-cluster.

### The 2D divergence chart

The headline chart of the eval has two axes:

- X axis: round number (Dimension 2 unfolds in time per tenant)
- Y axis: cost (T_n or wall-clock; lower is better)
- Multiple lines per tenant: per-tenant trajectories on the same task set (Dimension 1 visible as line-separation across tenants)
- Faceted by baseline: vanilla / static-typed / ours

A single chart shows both dimensions simultaneously. Cost falls within each tenant (Dimension 2). Per-tenant lines fan out (Dimension 1, only visible in "ours"; the baselines do not adapt per-tenant). The vanilla and static-typed baselines exhibit neither dimension; they are the flat-curve reference.

### Why two dimensions matter

A single dimension of adaptation (cost convergence within a tenant) is the obvious story; many adaptive-retrieval systems have it in some form. The second dimension (interface emergence across tenants from the same data) is the under-told story, and it is exactly what makes the document-store substrate load-bearing. Per-tenant emergent interfaces are infeasible on a relational substrate without per-tenant schemas (heavy, irreversible) or per-tenant ORM layers (manual). On Atlas, with BSON staying polymorphic and the typed view regenerated per-tenant from trajectories, it falls out for free. The two-axis framing is therefore not just a more impressive pitch; it is a structural argument for why this specific substrate is the right one.

---

## Bootstrap to Emergence

A subtle question the design must answer: **how do you bootstrap a typed interface for agentic structure-finding when the *purpose* of the agent's exploration is to find structure?** The naive reading is paradoxical. The design answer is that the bootstrap and the emergent layer do *different things*, and the chicken-and-egg dissolves once they are distinguished. This section makes the distinction explicit and walks through the four mechanical steps that turn an unmounted Atlas cluster into an explorable typed surface.

### The three layers, side by side

| Layer | Question answered | Mechanism | Output | Audience |
|-------|-------------------|-----------|--------|----------|
| **Bootstrap** | What *can* the agent do on this collection? | Mechanical sampling + inference; deterministic | Generic typed module: `oneOf` unions, presence-frequency JSDoc, fixed retrieval primitives | Agent on novel intents |
| **Emergent** | What *works* for this tenant's intents? | Trajectory crystallisation, user-endorsed | Tenant-specific procedure: pinned polymorphic variant, specific primitive composition, specific weights/filters | Agent on repeating intents |
| **Compiled** | What is the *cheapest* way to execute this? | Budget worker, compile-to-pipeline, verifier-checked | Single Atlas aggregation pipeline replacing the procedure body | Atlas runtime, no agent |

The bootstrap layer is *shared* across tenants on the same cluster because the data is shared and the sampling is deterministic. The emergent and compiled layers are *per-tenant* because each tenant's intents drive different trajectories. This split is what makes Dimension 1 (interface emergence across tenants) observable: bootstrap is the control, the rest is the variable.

### The four-layer bootstrap mechanism

AtlasFS produces a usable typed surface from a previously-unmounted Atlas cluster in four steps. None of these steps are "emergent" in the trajectory-learning sense; all are deterministic functions of the data plus a sampling budget. The agent is not yet in the loop.

#### Step 1, adaptive sampling and schema inference

On the first `readFile("/db/<coll>.ts")`, MongoFS samples N documents (N adapts based on observed field-presence variance: default 100, scaling to 1000 for high-variance collections), runs `mongodb-schema` over them, and emits a TypeScript interface. Per-field JSDoc carries presence-frequency metadata ("present in 30% of sampled docs"), so the agent reading the generated module can reason about partiality explicitly. The samples themselves are cached at `_samples.json` for direct inspection.

The sample-bias risk is real: `mongodb-schema`'s default 100-document sample can miss rare fields in collections of millions, per [the Compass Sampling docs](https://www.mongodb.com/docs/compass/current/sampling/). Adaptive sampling addresses this by widening N when the first pass detects high field-presence variance. The presence-frequency annotations make any remaining bias visible to the agent rather than hiding it.

#### Step 2, polymorphism lifted into the type system

When `mongodb-schema` reports type variance on a field, MongoFS lifts the variance into a `oneOf`-style discriminated union if a discriminator field is detectable (heuristics: a field whose value space is small and whose presence is universal, e.g., `kind`, `type`, `_t`). When no discriminator is detectable, MongoFS emits a wide union with a JSDoc comment flagging the polymorphism. The agent sees the polymorphism explicitly; it never has to guess.

This is the technique [`product-design.md`](./product-design.md) already relies on for the supply-chain corpus: `entities.ts` exposes a `Entity = NpmPackage | Advisory | DependentSnapshot` discriminated union keyed on a `kind` field, and the agent pattern-matches on `kind` to access shape-specific fields. The MongoDB [Polymorphic Schema Pattern docs](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/polymorphic-data/polymorphic-schema-pattern/) plus [Specify Validation for Polymorphic Collections](https://www.mongodb.com/docs/manual/core/schema-validation/specify-validation-polymorphic-collections/) sanction this pattern at the database layer; AtlasFS lifts it into TypeScript.

#### Step 3, schema fingerprint pinned as a constant

The synthesised module exports `SCHEMA_VERSION = "sha256:..."`. Procedures crystallised at tier 2 pin this fingerprint as an import-time constant. A Change Stream listener watches the underlying collection (per `kb/br/02`, Change Streams provide field-level `updatedFields` and `removedFields` plus pre-and-post images, GA since MongoDB 6.0); on a structural change, MongoFS recomputes the fingerprint and invalidates the cached typed module. Procedures whose pin no longer matches are flagged for re-derivation by the drift workflow (Plan 008), surfaced in the library pane as yellow or red badges.

#### Step 4, fixed retrieval primitives exposed alongside the type

Every synthesised module exports the same four-method interface: `findExact`, `findSimilar` (vector via Voyage), `search` (BM25 via `$search`), `hybrid` (`$rankFusion` weighted across vector and lexical). These primitives are not *discovered*; they are *fixed* across all collections. What the agent discovers is *which primitive works for which intent* and *with which weights*; that discovery is what crystallises into procedures.

Fixing the primitives at four is a deliberate constraint. A wider primitive surface (graph traversal via `$graphLookup`, faceting via `$facet`, union-with via `$unionWith`) would push more decision-making onto the bootstrap and away from the trajectory layer. Keeping the bootstrap narrow forces the trajectory layer to do the composing, which is exactly the behaviour we want to measure. Non-retrieval primitives (disambiguation, label-mapping, figure-extraction) live in hand-authored sibling modules (see "Primitive modules" below); they extend the typed surface without enlarging the bootstrap-synthesis surface.

### Bootstrap is scaffolding, not the answer

The bootstrap surface is intentionally **over-typed and under-useful**. It exposes too many methods (every collection has all four primitives, regardless of whether all four make sense), too many polymorphic shapes (the discriminated union covers all observed variants, including the ones the agent will never need for the current tenant), and too many access patterns (the agent can call any method on any field). This is by design. The bootstrap's job is to give the agent enough scaffolding to start exploring; it is not to *be* the useful interface.

The procedure library is where structure emerges. Each crystallised procedure narrows the bootstrap surface in three ways:

1. **Polymorphism narrowed.** The procedure pins one specific variant of the `oneOf` union (e.g., `kind === "advisory"`), not the full union.

2. **Primitive composition selected.** The procedure invokes a specific composition, e.g., `hybrid` with `weights: { vec: 0.7, lex: 0.3 }` followed by `rerank-2.5`, not the generic four-primitive surface.

3. **Filters and projections fixed.** The procedure pins a specific filter (e.g., `severity: { $gte: "high" }`) and a specific projection (e.g., `{ id: 1, summary: 1, mitigation: 1 }`).

The agent's trajectory is the discovery process; the procedure file is the discovery outcome.

### Hooks, hand-crafted scaffolds for novel intents

The bootstrap is generic and the emergent procedure does not yet exist; the gap between them is filled by **hooks**. A hook is a hand-authored TypeScript file at `/datafetch/hooks/<domain>/<intent>.ts` that captures a domain-aware suggested chain shape: which collections matter, which fields are evidence sources, which retrieval primitives are likely to compose well, and a step-by-step derivation sketch in JSDoc.

Hooks are demo-time artefacts, not a derivation tier. We hand-author ~10 to 15 for the Round 1 corpus (FinQA financial computations, supply-chain safety queries) and load them as files alongside the typed collections. The agent's first action on a novel intent is to look for a relevant hook before falling back to raw collection exploration.

Example, for the FinQA lease-obligation share intent:

```typescript
// /datafetch/hooks/finqa/lease_obligation_share.ts

/**
 * Compute what share of total contractual or lease obligations is due
 * in a selected target period.
 *
 * Suggested chain:
 *   1. find filing by company + filingYear in `finqa_cases`
 *   2. locate the obligation table on the filing
 *   3. select the target-period row + total row
 *   4. sum relevant columns on each row
 *   5. divide numerator by denominator
 *
 * Evidence: cite cells used in numerator and denominator.
 */
export interface LeaseObligationShareIntent {
  company: string;
  filingYear: number;
  targetPeriod: string;
  obligationTypes: string[];
}
```

Hooks differ from procedures in three ways: they are hand-authored, not trajectory-derived; they are shared across tenants, not tenant-specific; they describe a chain shape, not a chain implementation. They are deliberately incomplete; the agent fills in the actual code-mode derivation.

After endorsement, the agent's trajectory crystallises into a tenant-specific procedure that supersedes the hook for that tenant on that intent. The hook remains available for other tenants who have not yet crystallised the same intent. This makes hooks a starter kit for novel intents, not a replacement for the emergent layer.

Post-hackathon, hook inference from collection schemas plus sampled queries is a research problem worth pursuing. For Round 1, hand-authored is the right answer.

### Primitive modules, hand-authored typed primitives with implementations

Hooks describe a chain *shape* with no implementation. Many useful chain *steps* — disambiguating which filing a question targets, mapping a natural-language line-item label to a canonical row key, locating a numeric cell behind an underspecified phrase — are not retrievals over a collection. Their implementations may be stochastic (a Flue sub-agent invocation, a small classifier) or deterministic (a lookup table, a regex), and they evolve as we observe traffic. We expose these as **hand-authored primitive modules** under `/datafetch/db/<utility>.ts`, sibling to the synthesised collection modules; from the agent's view they are typed primitives like any other (signature, JSDoc, return-value schema), and the host-side matcher (Decision #18) finds them by the same embedding-against-JSDoc mechanism it uses for collection primitives. Example sibling to `db/finqa_cases.ts`:

```typescript
// /datafetch/db/finqa_resolve.ts
export const finqa_resolve: {
  /** Pick the most likely target filing given question + candidates + priors. */
  pickFiling(args: { question: string; candidates: Filing[]; priorTickers?: string[] }): Promise<Filing | null>;
  /** Map a natural-language line-item reference to the canonical row label. */
  mapRowLabel(args: { target: string; availableLabels: string[] }): Promise<string | null>;
};
```

The implementation behind a primitive is an internal concern: `pickFiling` may dispatch to a Flue sub-agent today, a SQLite cache tomorrow, a derived rule next week. **The procedures calling it do not change** because the contract does not change. This is the design property that lets the optimisation worker improve primitive implementations (Plan 009 first pay-out) transparently, and reserve procedure-body compilation (Plan 009 second pay-out) for the case where every primitive a procedure calls has converged to deterministic Atlas-compatible form. Hooks scaffold the chain *shape*; primitive modules ship typed chain *steps* with implementations. Round 1 ships ~5 to 10 primitive modules alongside ~10 to 15 hooks.

### Graceful degradation when bootstrap fails

Three failure modes, each handled at the typing layer rather than failing closed:

- **Sample bias omits real fields.** Adaptive sample-size widening on first pass; presence-frequency JSDoc surfaces residual bias; trajectories using undocumented fields trigger re-sampling.
- **No discriminator field is detectable.** Emit a wide union with `unknown` typing on variant-only fields; the agent narrows via runtime checks rather than `kind === "..."`.
- **The collection is empty.** Emit a stub with `Record<string, unknown>` plus the four primitives; first insert triggers re-bootstrap via change-stream.

Bootstrap is best-effort; the trajectory layer compensates for any over-broadness.

The chicken-and-egg is illusory because the bootstrap is *not the answer* the agent is looking for; it is the *vocabulary in which the answer can be expressed*. The trajectory layer crystallises the answer. This is schema-on-read at the agent layer (the principle Iceberg and Delta Lake brought to data engineering) applied to a different consumer with a different artefact: a per-tenant procedure library, not a query plan.

---

## Architecture

```
+---------------------------------------------------------------+
|                          User / Judge                         |
|   visits https://atlasfs.vercel.app/t/<tenant>                |
|   reviews trajectory, endorses successful runs                |
+---------------------------------+-----------------------------+
                                  |
                                  v
+---------------------------------------------------------------+
|     Vercel + Next.js  (deployed via `vercel deploy`)          |
|     - cluster heatmap, procedure library pane                 |
|     - hot-path overlay, two-tenant divergence view            |
|     - trajectory review UI with endorsement button            |
|     - app/api/agents/<name>/<id>  ->  CF Worker (SSE proxy)   |
+---------------------------------+-----------------------------+
                                  |
                                  v
+---------------------------------------------------------------+
|     Cloudflare Worker  (Flue, --target cloudflare)            |
|     deployed via `wrangler deploy`                            |
|     - Pi runtime in a V8 isolate (no process.env, no fs)      |
|     - SandboxFactory = @cloudflare/sandbox                    |
|     - virtual module resolver for /datafetch/db/<coll>.ts     |
|       (MongoFS.synthesize emitted at request time)            |
|     - tree-structured trajectory, parallel tool exec          |
|     - bindings: ATLAS (TCP), ANTHROPIC (HTTPS), VOYAGE        |
+--+----------+--------------+---------------+------------------+
   |          |              |               |
   v          v              v               v
+-----+  +---------+  +-----------+  +-----------+
|Atlas|  |Tenant   |  |Optimise + |  |Anthropic  |
| M10 |  |Durable  |  |Drift CF   |  |API direct |
|     |  |Object   |  |Workers    |  |           |
|$vec |  | SQLite: |  | (cron)    |  |Opus 4.7   |
|$rank|  |  proc/, |  | compile + |  |  (demo)   |
|chgs |  |  traj   |  | ts-morph  |  |Haiku 4.5  |
+--+--+  +---------+  +-----+-----+  +-----------+
   |                        ^
   |                        |
   +---- Change Streams ----+

+-------------------------------------------+
| Voyage (Atlas Embedding & Reranking API)  |
|   voyage-4-large, rerank-2.5,             |
|   voyage-multimodal-3.5                   |
| invoked from Atlas pipelines              |
| (no separate API key)                     |
+-------------------------------------------+
```

| Component | Responsibility |
|-----------|---------------|
| **Flue (`@flue/sdk` v0.3.x)** | Apache-2.0 sandbox agent framework that wraps Pi in a build pipeline, an HTTP/SSE server, an MCP runtime adapter, valibot-typed results, and the `SandboxFactory` integration interface. Built with `flue build --target cloudflare` and deployed via `wrangler deploy`. Per Decision #15, the Cloudflare target is the demo runtime; the Node target stays unused unless a workerd-incompat fallback fires. See `kb/br/07-flue-harness.md` for the integration brief. |
| **Pi (`@mariozechner/pi-agent-core` + `pi-ai`)** | The agent runtime Flue drives internally. MIT-licensed, 11.5K+ stars upstream. TypeScript-native ReAct loop, tree-structured trajectory, parallel tool execution. Multi-provider model abstraction; we use the `anthropic` provider against `api.anthropic.com` direct (Bedrock is also supported but not in the demo path). Pinned via `pnpm.overrides` because Flue declares them as `*`-versioned. Emits typed virtual-module operations only. |
| **Cloudflare Worker + Tenant Durable Object** | The runtime substrate. The Worker hosts Pi + the `@cloudflare/sandbox` connector. Each tenant gets one Durable Object instance with its own SQLite holding `procedures/`, `scratch/`, trajectories, and `tool_calls`. Cross-tenant isolation is structural — DO instances cannot share state. Replaces the AgentFS-over-NFS layer of the prior design. |
| **MongoFS** | The codegen module we author. ~3 functions: `sample(coll, n)`, `synthesize(coll, samples) -> string`, `fingerprint(schema) -> sha256`. Imported by the Worker's virtual-module resolver to emit typed TypeScript modules at request time when the agent imports `/datafetch/db/<coll>.ts`. No longer implements a `FileSystem` interface (the prior NFS/FUSE-style design has been superseded). |
| **Vercel + Next.js** | UI host: cluster heatmap, procedure library pane, hot-path overlay, two-tenant divergence view, trajectory review UI. The webhook surface (`app/api/agents/<name>/<id>/route.ts`) proxies into the Cloudflare Worker. Free Hobby tier covers the demo. |
| **MongoDB Atlas (M10)** | The data plane. Hybrid retrieval primitives: `$vectorSearch`, `$search`, `$rankFusion`. Change Streams for schema-drift detection. Connection from the Worker via MongoDB driver 6.x + `cloudflare:sockets`, cached per-DO. Stores the demo corpus (BIRD-SQL subset + FinQA filings + supply-chain micro-set, ~2 GB total) and the procedure metadata. See `Demo Corpus` section below for the corpus design rationale. |
| **Voyage (via Atlas Embedding & Reranking API)** | `voyage-4-large` for text embeddings, `rerank-2.5` for cross-encoder reranking, `voyage-multimodal-3.5` for logo similarity (typosquat cluster). Native Atlas integration since the MongoDB acquisition (Feb 2025). |
| **Claude via Anthropic API direct** | The model. pi-ai's `anthropic` provider points at `api.anthropic.com`; `claude-haiku-4-5` for eval bulk, `claude-opus-4-7` for the demo turn. AWS Bedrock is no longer in the path (Decision #15 reversal). |
| **Optimisation worker (Cloudflare Worker, cron)** | Sibling Worker triggered by `wrangler.toml` cron entries. Takes a promoted procedure, compiles its multi-call ReAct sequence into a single `db.collection.aggregate([...])` pipeline, validates the rewrite against shadow inputs, swaps the `procedures/<name>.ts` body to call the compiled pipeline. Reads the same Atlas + DO bindings as the runtime Worker. |
| **Schema-drift Worker (Cloudflare Worker, Atlas Change Streams subscriber)** | Sibling Worker subscribed to Atlas Change Streams. On a structural change, recomputes the schema fingerprint and writes it to a shared DO; the optimisation worker walks `procedures/` with ts-morph and tags stale pins green/yellow/red. |
| **Eval harness** | Replays the pre-registered intent-clustered task set on each of the three baselines (vanilla / static-typed / ours), records T_n, D_n, R_n, I_n, token cost, wall-clock, correctness, evidence completeness, renders the cluster heatmap, the procedure library pane, and the hot-path overlay. Runs locally during dev against the live Atlas + Anthropic; can also run as a Worker for production-shaped runs. |

---

## Hosting & Deploy

**Stack:** Cloudflare Workers + Durable Objects (agent runtime, sandbox, per-tenant state) + Vercel + Next.js (UI, webhook surface) + MongoDB Atlas M10 (data plane) + Anthropic API direct (Claude). Atlas is the only stack element required by the hackathon rules (`kb/resources/scope-schedule.md` lines 90-91 and 133, "MongoDB Atlas as a core component"); the rest is chosen to align with Flue's first-class `--target cloudflare` build path, give us structural per-tenant isolation via Durable Objects, and keep the Day-1 deploy story to two commands (`wrangler deploy` and `vercel deploy`). The earlier AWS-Lambda framing was a misread of `kb/resources/aws/participant-guide.md`, which is a partner credit-setup guide, not a constraint on hosting.

### Dev and deploy posture

**Cloud-deployed from Day 1, with a local-first feedback loop.** The hackathon rules require a live demo running against the provided Atlas Sandbox; we cannot demo from a laptop. Two posture commitments fall out of this:

1. **First-90-minutes deploy gate.** Before any product work begins on Day 1, we produce a working live URL: a Cloudflare Worker that talks to Atlas + Anthropic, a Durable Object that persists across requests, and a Vercel page that proxies to the Worker. If the gate doesn't pass, we fall back per the ladder below; cloud deploy is *not* deferred to "polish later." Specific gate steps:
   - `flue build --target cloudflare` + `wrangler deploy` -> live Worker URL responds.
   - MongoDB driver 6.x via `cloudflare:sockets` round-trips a `db.runCommand({ ping: 1 })`.
   - Anthropic SDK round-trips a 1-token completion from the Worker.
   - Durable Object SQLite write/read survives a request boundary.
   - `vercel deploy` of a stub Next.js page proxies to the Worker URL end-to-end.

2. **Local-first iteration, deploy-early discipline.** Tight iteration uses `wrangler dev` (miniflare) for the Worker and `vercel dev` for the UI; the agent loop, codegen, trajectory writes, and DO state all execute locally against the live Atlas M10 and live Anthropic API. Every material change is deployed within the same working session via `wrangler deploy` + `vercel deploy` so production-only issues (Atlas TCP-socket compatibility, DO hibernation across requests, Vercel function timeout on the SSE proxy, subrequest-limit ceilings, cold-start tail latency) surface on Day 1, not on Saturday afternoon. Rule of thumb: *no more than one local commit before a corresponding cloud deploy.*

### Where each component runs

| Component | Service | Notes |
|---|---|---|
| **UI + webhook surface** | Vercel + Next.js (App Router), Hobby tier | `app/api/agents/<name>/<id>/route.ts` proxies to the CF Worker. Free tier covers the demo. |
| **Agent runtime (Flue + Pi)** | Cloudflare Worker, `flue build --target cloudflare`, `wrangler deploy` | Workers Paid plan ($5/mo) required: agent loops blow free-tier 10ms-CPU and 50-subrequest ceilings. |
| **Per-tenant state** (`procedures/`, `scratch/`, trajectories, `tool_calls`) | Durable Object SQLite, one DO instance per tenant | Structural cross-tenant isolation: DO instances cannot share state. Branching is `state.storage` snapshot + replay into a sibling DO. |
| **Agent sandbox** | `@cloudflare/sandbox` connector via Flue's `SandboxFactory` | V8 isolate with no `process.env`, no fs, no shell; bindings are the only ingress/egress. Core Design Principle #4 enforced by the platform, not engineered. |
| **MongoDB Atlas M10** | Provided by MongoDB on AWS, region as assigned | Connection from Workers via MongoDB driver 6.x + `cloudflare:sockets`, cached per-DO (one tenant = one DO = one connection). |
| **Voyage embedding + reranking** | Native Atlas Embedding & Reranking API | Decision #9 unchanged; no separate API key. |
| **Claude (Opus 4.7 demo, Haiku 4.5 eval bulk)** | Anthropic API direct, `api.anthropic.com` via pi-ai's `anthropic` provider | AWS Bedrock no longer in the path; we accept the loss of AWS credit subsidy in exchange for skipping Bedrock model-access approval and AWS-account setup. |
| **Optimisation budget worker** | Sibling Cloudflare Worker, `wrangler.toml` cron trigger | Reads the same Atlas + DO + Anthropic bindings; compiles promoted procedures to single Atlas aggregation pipelines. |
| **Schema-drift Worker** | Sibling Cloudflare Worker subscribed to Atlas Change Streams | On a structural change, recomputes fingerprint and writes to a shared DO; the optimisation worker walks `procedures/` with ts-morph and tags stale pins. |
| **Secrets** (`MONGODB_URI`, `ANTHROPIC_API_KEY`, optional `VOYAGE_API_KEY`) | `wrangler secret put` (Worker) + Vercel env vars (UI) | Agent never sees them per Core Design Principle #4. |

### Fallback ladder (in order, all keep cloud deploy)

| # | Fallback | When | Cost |
|---|---|---|---|
| 1 | Flue `--target cloudflare` Worker + Vercel UI | Default — passes Day-1 gate | $5/mo CF Paid + Vercel free |
| 2 | Flue `--target node` in a Cloudflare Container | If workerd lacks a Node API Pi requires | +30 min packaging |
| 3 | Flue `--target node` on Vercel as a Node serverless function | If Container path also fails | Per-tenant state moves to Vercel KV; lose structural DO isolation |
| 4 | AWS Lambda + API Gateway (panic button) | If options 1-3 all fail | Half-day of AWS account + IAM + Bedrock-access setup |

Options 1-3 keep the deploy story coherent within the Cloudflare/Vercel ecosystem; option 4 is the panic button.

### Landmines

- **Workers Paid plan required.** Free tier (10ms CPU, 100K req/day, 50 subrequests/req) is too tight for agent loops. Subscribe Day 1.
- **DO hibernation.** Durable Objects hibernate after inactivity. Flush trajectory rows after every tool call (durability is per-call, not per-session); use `state.blockConcurrencyWhile()` to keep the DO alive during a single trajectory.
- **Atlas driver from Workers.** MongoDB driver 6.x + `cloudflare:sockets` is supported but not battle-tested for our load shape. The Day-1 deploy gate verifies it; if it fails, the fallback ladder kicks in.
- **Vercel SSE timeout.** Hobby-tier serverless functions cap at ~10s; the agent's trajectory stream may exceed this. Mitigation: the UI subscribes to the Worker's SSE stream directly, with Vercel only serving the static shell.
- **Cross-cloud egress.** Atlas runs on AWS; Workers are global edge. Pin the Atlas cluster to the region with the lowest latency to the audience for Round 1.
- **Subrequest budget.** Even on Paid, 1000 subrequests per request is a real ceiling for long agent loops. Bound the ReAct loop at 50 LLM turns and budget tool calls accordingly.

### Out-of-pocket budget

CF Workers Paid ($5) + Vercel Hobby ($0) + Atlas M10 (provided) + Anthropic API (~$15-20 across eval bulk + demo turn at Haiku 4.5 + Opus 4.7 mix) + Voyage (Atlas-bundled) ≈ **$25 total** for the full hackathon. AWS credits unused.

---

## Data Flow

The pipeline stages from input to output, per query:

1. **Bootstrap.** The Cloudflare Worker boots and hydrates the tenant Durable Object. The Worker registers a virtual module resolver: `/datafetch/db/<coll>.ts` and `/datafetch/views/<name>.ts` resolve via MongoFS codegen against the live Atlas cluster (samples + schema inference + JSDoc + fingerprint constant); `/datafetch/procedures/<name>.ts`, `/datafetch/scratch/...`, and `/datafetch/hooks/<domain>/<intent>.ts` resolve against the tenant DO's SQLite store (hooks are seeded read-only at deploy time; procedures and scratch are writable per-tenant).

2. **Discovery.** The agent (or user) `ls /datafetch/db/`, `cat /datafetch/db/packages.ts`. MongoFS's `readdir` lists collections; `readFile` synthesises the typed module from the live cluster (sample documents, `mongodb-schema` inference, JSDoc with examples, schema fingerprint constant).

3. **Match check (intent routing).** The user's natural-language query is embedded and compared against the embedded signatures plus JSDoc descriptions of every procedure in the tenant's `procedures/` directory. High-confidence match (above a configured cosine threshold) -> deterministic execution path, the procedure is invoked directly, no LLM is consulted on the query, the call is logged with `mode: "deterministic"`. Mid-confidence match -> the matched procedure name is passed to the agent as a hint along with the typed surface. No match -> fall through to Step 4. The matcher runs host-side, before the LLM ever enters the loop, so cost convergence kicks in at the routing layer rather than waiting for the agent to discover the procedure itself.

4. **Hook lookup, then novel ReAct.** No match -> Pi spawns a fresh agent with the typed surface loaded. The agent's first move is to look for a hook in `/datafetch/hooks/` whose intent description matches the user's query (via the same embedding-search mechanism as Step 3, just over hooks rather than procedures). If a hook is found, the agent loads it and follows the suggested chain shape, narrowing the bootstrap to specific collections and primitive compositions. If no hook matches, the agent falls back to raw collection exploration. Either way, each typed call is intercepted by MongoFS, executed against Atlas, and recorded as a row in `tool_calls` along with timing, tokens, and parent-trajectory id.

5. **Hybrid retrieval inside a typed call.** A single `db.packages.hybrid({...})` call expands into a `$rankFusion` pipeline that combines `$vectorSearch` (Voyage embeddings) and `$search` (BM25), with optional reranking via `voyage-rerank-2.5`. The agent never sees the pipeline.

6. **Synthesis.** The agent's snippet returns a structured payload (verdict, evidence). Only what the snippet `console.log`s enters the agent's context; intermediate hits stay in the sandbox.

7. **Review prompt.** The trajectory is rendered (graph view: green for deterministic, red for LLM-invocation) and the user is asked: correct? satisfies intent? needs more?

8. **Crystallisation.** On endorsement, the trajectory is written to `procedures/<name>.ts` with: imports from `/datafetch/db/...`, the typed call sequence in order, schema fingerprints pinned as comments, the trajectory id for replay. A verifier replays the procedure against a shadow input and compares against the recorded result. Pass -> promotion. Fail -> rejection, with a reason recorded.

9. **Budget allocation.** The promoted procedure earns optimisation budget. The worker picks the highest-value pay-out (compile-to-pipeline by default), runs it asynchronously, and swaps the procedure body when the rewrite passes verification.

10. **Drift handling.** Atlas Change Streams emit on the underlying collections. On a schema change, the worker recomputes the fingerprint, walks `procedures/` with ts-morph, and flags every procedure whose pin no longer matches.

11. **Eval round.** At the end of each round, the harness re-runs the pre-registered task set and updates the metric ledger. The cluster heatmap re-renders with the new round of cells.

---

## Key Components

### MongoFS (the novel piece)

**Inputs:** AgentFS `FileSystem` operations (`stat`, `readdir`, `readFile`, `writeFile`, `mkdir`, `rm`, `rename`); a MongoDB Atlas connection; a sampling budget (documents per collection for schema inference).

**Outputs:** Synthesised typed TypeScript modules per collection; lazily-computed schema fingerprints; allow/deny on writes (deny on `db/`, pass-through to AgentFS delta on `procedures/` and `scratch/`).

**Internal logic:**

- `readdir("/db/")` lists collections in the cluster.
- `readdir("/db/<coll>/")` lists synthetic subpaths (`_samples.json`, `_schema.json`, individual indexed methods).
- `readFile("/db/<coll>.ts")` runs `mongodb-schema` over a sampled set of documents, emits a typed TS module with: `interface <Coll>`, `SCHEMA_VERSION` constant, typed methods (`findExact`, `findSimilar`, `search`, `hybrid`), JSDoc with sampled example documents.
- `readFile("/db/<coll>/_samples.json")` runs `db.<coll>.find().limit(5)`.
- `readFile("/db/<coll>/_schema.json")` returns the inferred schema.
- `writeFile("/db/...")` returns `EACCES`.
- `writeFile("/procedures/...")` is delegated to the AgentFS overlay.

### Hooks (hand-authored scaffolds)

**Inputs:** hand-authored intent scaffolds at `/datafetch/hooks/<domain>/<intent>.ts`.

**Outputs:** TypeScript modules imported by the agent, exposing each intent's parameter interface plus JSDoc with a suggested derivation chain and references to the relevant collections.

**Internal logic:** None at runtime. Hooks are static files served by AgentFS's CoW overlay (read-only at the `hooks/` path). The host-side embedding matcher (Data Flow Step 4) finds them by comparing the user's query to the hook's JSDoc description; the agent loads the matched hook and uses the suggested chain as a starting point for code-mode derivation. Round 1 ships ~10 to 15 hooks covering the FinQA financial computations and supply-chain safety queries the demo exercises. Hooks are shared across tenants; per-tenant procedure overlays at `/procedures/` supersede the hook once an intent has been crystallised for that tenant.

### Procedure crystallisation pipeline

**Inputs:** a session id, an endorsement decision, the trajectory rows from `tool_calls` for that session.

**Outputs:** a TypeScript file in `procedures/`, a row in `procedure_metadata` binding the procedure to its source trajectory and pinned fingerprints.

**Internal logic:** The trajectory is already valid TypeScript by construction. The pipeline replays the trajectory against shadow inputs to compute a deterministic-mode result and compares it against the original. On success, the trajectory is committed to `procedures/<name>.ts`, fingerprints are pinned, and budget is allocated.

### Schema fingerprint + drift workflow

**Inputs:** Atlas Change Stream events.

**Outputs:** updated fingerprint constants; flags on procedures whose pin is stale.

**Internal logic:** On a structural change to a collection, recompute the schema, hash it, compare to the existing fingerprint. On change, walk `procedures/` with ts-morph, find every procedure whose pin matches the *old* fingerprint, run the eval suite against each with the new schema, tag green / partial / broken, surface in the library pane.

### Eval harness

**Inputs:** the pre-registered task set with three label layers (answer, evidence, canonical pathway); a baseline configuration (vanilla / static-typed / ours); a seed.

**Outputs:** per-task metric rows in a metric ledger; the cluster heatmap; the procedure library pane; the hot-path overlay.

**Internal logic:** Runs each task end to end on the chosen baseline, captures T_n, D_n, R_n, I_n, token cost, wall-clock, correctness, evidence completeness. Aggregates within-cluster, across-cluster, and out-of-cluster.

### Optimisation-budget worker

**Inputs:** a promoted procedure or an observed primitive, an allocated budget, a target pay-out.

**Outputs:** a faster implementation that satisfies the same contract; a verification result.

**Internal logic:** Two verifier-checked pay-out levels. (1) **Primitive-impl improvement** — replace a primitive's body with a cheaper implementation (cache, derived rule, smaller model) that satisfies the same contract; procedures calling it do not change. Runs continuously at primitive granularity. (2) **Procedure-body compilation** — when every primitive a procedure calls is deterministic and Atlas-compatible, compile the call sequence to a single `$rankFusion`/`aggregate` pipeline; swap the body on verifier success. Conditional on the procedure's primitive set having converged.

---

## Security Model

**Trust boundaries:**

1. **User <-> Pi.** The user is trusted; the agent is not. The user reviews and endorses; the agent proposes.

2. **Pi <-> AgentFS / MongoFS.** The agent has only the typed filesystem surface. No HTTP client, no shell, no `process.env` access. Reads from `db/` are unrestricted; writes to `db/` are blocked at the FS layer with `EACCES`.

3. **MongoFS <-> Atlas.** A single connection string with a single user, scoped to the demo cluster. Stored in AWS Systems Manager Parameter Store, never committed to git, never reaches the agent's context.

4. **Optimisation worker <-> Atlas.** Runs in AWS Lambda with an IAM role scoped to the demo cluster. Pipeline rewrites are validated against shadow inputs before swap.

**Input validation:** User snippets are executed in a V8 isolate with `globalOutbound: null`. Procedure files are written to a directory in the AgentFS overlay, not directly to the host filesystem. The verifier shadow-input comparison is the gate for promotion; failed verifications are recorded but not promoted.

**Secrets handling:**

- `VOYAGE_API_KEY` (if standalone Voyage is used; preferred path is Atlas-native Embedding API which does not require a separate key)
- `MONGODB_URI` (Atlas connection string)
- AWS credentials for Lambda

All three live in AWS Systems Manager Parameter Store. Lambda receives them via IAM role; the local agent runtime receives them via environment variable. Neither path lets the agent itself observe them.

**Threat model:** A malicious user query attempts to exfiltrate secrets via prompt injection into the agent. The structural defense is bindings-not-network in the sandbox; even a fully compromised agent cannot make a network call. A secondary defense is that the agent cannot read its own context window state through the sandbox surface.

A schema-drift event occurs while a procedure is mid-replay. The fingerprint check at procedure entry is the gate; a stale-pin procedure refuses to run and is flagged for re-derivation.

---

## Schema / API Surface

### What the agent sees

The agent imports from typed paths under the mount. The minimum surface per collection:

```typescript
// /datafetch/db/packages.ts: synthesised by MongoFS.readFile

export interface Package {
  name: string;
  version: string;
  publishedAt: string;
  maintainer: { id: string; trustScore: number };
  // ... inferred fields
}

export const SCHEMA_VERSION = "sha256:c3f1a8..." as const;

export const packages: {
  /** Exact lookup by indexed fields. */
  findExact(filter: Partial<Package>): Promise<Package[]>;
  /** Vector search over content. */
  findSimilar(text: string, k?: number): Promise<Package[]>;
  /** BM25 over indexed text fields. */
  search(text: string, opts?: SearchOpts): Promise<Package[]>;
  /** $rankFusion of vector + BM25, optional reranker. */
  hybrid(q: HybridQuery, weights?: Weights): Promise<Package[]>;
};
```

### What the user sees

The mount root (`/datafetch/`) contains:

| Path | Contents |
|------|----------|
| `db/` | Typed TS modules per collection. Read-only. |
| `db/<coll>/_samples.json` | Lazy sample documents. |
| `db/<coll>/_schema.json` | Inferred schema. |
| `views/` | Curated query modules (e.g. `recent_compromises.ts`). |
| `hooks/<domain>/` | Hand-authored intent scaffolds, shared across tenants. Read-only. |
| `procedures/` | The user's personal library. Writable via the overlay. |
| `scratch/` | Workspace for in-flight queries. Writable. |
| `_trajectories/` | Read-only views of `tool_calls`, queryable as JSON. |

### CLI verbs (host side, not exposed to the agent)

| Command | Effect |
|---------|--------|
| `atlasfs mount <conn>` | Starts the NFS server, mounts at `/datafetch/`. |
| `atlasfs branch <name>` | Snapshots the AgentFS overlay for branching. |
| `atlasfs eval <round>` | Runs the pre-registered eval set on the chosen baseline. |
| `atlasfs review <session_id>` | Opens the trajectory review UI for a session. |
| `atlasfs budget <proc>` | Inspects or runs the optimisation worker on a procedure. |

---

## Demo Corpus

The Round 1 corpus is a **three-source hybrid** chosen to satisfy the schema-emergent thesis on three orthogonal axes of polymorphism plus provide published baseline comparability and visceral demo legibility. The full design rationale lives in [`br/06-bird-finqa-corpus.md`](./br/06-bird-finqa-corpus.md); this section captures the load-bearing facts and integration points.

### The three components

**BIRD-SQL subset, 3 to 5 databases, ~1 to 2 GB after load.** A subset of the BIRD-SQL benchmark ([Li et al., NeurIPS 2023, arXiv:2305.03111](https://arxiv.org/abs/2305.03111)) loaded into MongoDB Atlas as collections (one collection per source table within each database). Recommended starter picks: `video_games`, `european_football_2`, `financial`, `formula_1`, `debit_card_specializing`. Source: supervision pairs from [`xu3kev/BIRD-SQL-data-train`](https://huggingface.co/datasets/xu3kev/BIRD-SQL-data-train) on HuggingFace (2.33 MB), row-level data from BIRD's official 33.4 GB GitHub release. **Role:** cross-collection polymorphism plus published baseline comparability (Spider, BIRD, DAIL-SQL, EvoMQL).

**FinQA full, ~36 MB after load.** All 8,281 examples (6,251 train + 883 validation + 1,147 test) of the FinQA benchmark ([Chen et al., EMNLP 2021, arXiv:2109.00122](https://arxiv.org/abs/2109.00122)) loaded into MongoDB Atlas as **two complementary collections** that lean into the document model rather than flattening it:

- **`finqa_cases`**, the primary collection. Each FinQA example is a single rich nested document with `question`, `company`, `filingYear`, `preText`, `postText`, `table` (with `rows` and `cells` as nested arrays carrying `normalizedLabel`, `column`, `value`), `provenance`, `goldProgram`, and `goldAnswer`. Queries operate over the nested structure directly via `$filter` over `table.rows` and `$reduce` over `cells`, no relational denormalisation.
- **`finqa_search_units`**, the sidecar retrieval collection. Contains row summaries, table summaries, case summaries, and pre/post-text chunks with embeddings (Voyage `voyage-4-large`). This is an indexing layer for semantic and lexical discovery, not a normalised view of the case data.

Source: HF mirror at [`dreamerdeo/finqa`](https://huggingface.co/datasets/dreamerdeo/finqa) plus the original [`czyssrs/FinQA`](https://github.com/czyssrs/FinQA) repo for the gold program annotations the HF mirror omits. With the user's "remove the document, force search" twist applied at evaluation time. **Role:** within-document polymorphism plus the "compilable program is the procedure" demonstration. The two-collection split makes the Mongo-native pitch concrete: MongoDB stores nested financial evidence (`finqa_cases`), retrieval sidecars (`finqa_search_units`), and learned derivations and compiled pipelines (`atlasfs_procedures`), all in the same data plane.

**Supply-chain micro-set, ~10 MB, ~10 hand-crafted queries.** Hand-crafted on Day 1 from npm registry metadata, GitHub Security Advisories, OSV, and published incidents (event-stream, ua-parser-js, xz-utils, polyfill.io). **Role:** Round 1 demo narrative spine because of its visceral stakes ("is this dependency safe to install?") and multimodal coverage (`voyage-multimodal-3.5` for typosquat-logo detection). Not in the formal eval; load-bearing only for the demo.

### Why three sources

The schema-emergent thesis is tested on three locations of polymorphism (per `br/02`):

| Polymorphism location | BIRD subset | FinQA | Supply-chain |
|----------------------|-------------|-------|--------------|
| Within a collection (document polymorphism) | low (uniform tables) | high (table-layout variation across companies) | medium |
| Across collections within a cluster (collection polymorphism) | **high** (15 to 25 collections, wildly different schemas) | n/a (single collection) | medium |
| Across queries within a tenant | covered by both | covered by both | covered |

BIRD provides the cross-collection polymorphism that supply-chain alone could not. FinQA provides within-document polymorphism with explicit gold programs. Supply-chain provides the demo narrative anchor. The three are complementary, not redundant.

### Two simulated tenants for L_n

The two-tenant scheme that drives Dimension 1 (interface emergence, library divergence) per the section above:

- **Tenant A, `data-analyst`:** intent prior weighted toward BIRD aggregation and window-function queries (publishers by sales, legislator tenure, formula-1 podium counts). Crystallises BIRD-shaped procedures.
- **Tenant B, `financial-analyst`:** intent prior weighted toward FinQA financial computation queries (YoY revenue growth, operating margin, fuel-expense ratio). Crystallises FinQA-shaped procedures.

By Round 5, the two tenants' `procedures/` libraries do not overlap; L_n (Jaccard distance between procedure signature sets) approaches 1.0. The divergence is dramatic enough to read at a glance in the demo's two-pane file-tree visual.

### Round 1 demo narrative split

The supply-chain micro-set is the **stage anchor**; BIRD+FinQA is the **proof backbone**. The 3-minute demo (per `roadmap.md` Plan 010) splits:

- **Beats 1 + 3** (setup + cost convergence) use supply-chain queries because "is event-stream safe to install?" lands faster than "compute the YoY change in fuel-expense ratio for AAL".
- **Beats 2 + 4** (tenant divergence + 2D divergence chart) use BIRD+FinQA because the two-tenant L_n divergence is the chart that needs scale and comparability.

This split is structural, not optional. Round 1's 45% live-demo weight rewards visceral; the eval scoring rewards comparability. Both serve different beats.

### Worked example, Union Pacific 2017 lease obligations

The Round 1 demo's headline derivation is a multi-step calculation that exercises every layer of the system end to end. Demo wording:

> "For Union Pacific's 2017 lease obligations, what percentage of total minimum lease payments was due in 2019, combining operating and capital leases?"

Derivation:

```
2019 amount = 359 (operating) + 156 (capital) = 515
total amount = 2649 (operating) + 1079 (capital) = 3728
share = 515 / 3728 = 0.13814
share percent = 13.814%
```

The chain the agent must produce:

1. find the UNP 2017 filing in `finqa_cases`
2. locate the lease-obligations table on the filing
3. select the 2019 row
4. select the total row
5. select the operating-leases and capital-leases columns
6. sum each row over those columns
7. divide numerator by denominator
8. return answer plus evidence cells

This is exactly the chain a hook scaffolds and a procedure crystallises. After endorsement and budget pay-out, the procedure body becomes a single Atlas aggregation pipeline:

```typescript
// /datafetch/procedures/financial-analyst/calculate_obligation_due_share.ts

const pipeline = [
  { $match: { company: "UNP", filingYear: 2017, kind: "finqa_case" } },
  {
    $project: {
      dueRow: {
        $first: {
          $filter: {
            input: "$table.rows",
            as: "row",
            cond: { $eq: ["$$row.normalizedLabel", "2019"] }
          }
        }
      },
      totalRow: {
        $first: {
          $filter: {
            input: "$table.rows",
            as: "row",
            cond: {
              $eq: [
                "$$row.normalizedLabel",
                "total_minimum_lease_payments"
              ]
            }
          }
        }
      }
    }
  },
  {
    $project: {
      numerator: {
        $reduce: {
          input: {
            $filter: {
              input: "$dueRow.cells",
              as: "cell",
              cond: {
                $in: [
                  "$$cell.column",
                  ["operating_leases", "capital_leases"]
                ]
              }
            }
          },
          initialValue: 0,
          in: { $add: ["$$value", "$$this.value"] }
        }
      },
      denominator: {
        $reduce: {
          input: {
            $filter: {
              input: "$totalRow.cells",
              as: "cell",
              cond: {
                $in: [
                  "$$cell.column",
                  ["operating_leases", "capital_leases"]
                ]
              }
            }
          },
          initialValue: 0,
          in: { $add: ["$$value", "$$this.value"] }
        }
      }
    }
  },
  {
    $project: {
      answer: { $divide: ["$numerator", "$denominator"] },
      answerPercent: {
        $multiply: [{ $divide: ["$numerator", "$denominator"] }, 100]
      },
      numerator: 1,
      denominator: 1
    }
  }
];
```

The pitch payoff: the learned reasoning chain becomes a database-native aggregation. MongoDB is the execution engine, not just the storage layer. Round 0 invokes the LLM N times to produce one answer; Round 5 runs this single aggregation in milliseconds. The cost-convergence chart's slope is exactly this transition. This worked example anchors Beat 4 of the demo (the cost-convergence beat); the Atlas pipeline appears in the side panel as the procedure body swaps from ReAct sequence to compiled aggregation.

### ETL and storage

Total post-load size: ~2 GB (~1.5 GB BIRD subset + ~36 MB FinQA + ~10 MB supply-chain + ~0.5 GB vector indexes). M10 cluster has ~10 GB storage default, so ample headroom. ETL effort: half a day on Day 1 (`loadBird.ts`, `loadFinQA.ts`, hand-craft supply-chain). Plan 001 budget covers this.

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | ~~NFS, not FUSE, as the transport~~ **Obsoleted by Decision #15.** | The agent runs inside a Cloudflare Worker; `/datafetch/` is a virtual module surface resolved by the Worker, not a real filesystem. No transport choice is required because there is no filesystem to transport. The original rationale (zero install friction across macOS/Linux/Windows) is also moot since the Worker hosts the agent, not the demo laptop. |
| 2 | ~~AgentFS as the VFS engine, not a hand-rolled NFS server~~ **Obsoleted by Decision #15.** | Replaced by Cloudflare Durable Objects + a virtual module resolver inside the Worker. AgentFS's CoW overlay, NFS server, `tool_calls` audit table, and MCP fallback are all replaced by per-tenant DO SQLite. ~1000 LoC of dependency surface eliminated. |
| 3 | MongoFS as the only novel infrastructure piece | A pure codegen module (~3 functions: `sample`, `synthesize`, `fingerprint`) imported by the Worker's virtual-module resolver. No longer implements a `FileSystem` interface; the prior NFS/FUSE-style design has been superseded by the Cloudflare runtime substrate (Decision #15). |
| 4 | Lazy codegen via `readFile`, not a build-time artefact | A user who `cat`s the typed module and an agent that imports it get the same lazily-computed content. No stale-output failure mode, no separate codegen directory. |
| 5 | Schema fingerprint as a TypeScript constant | Pinning a procedure to a fingerprint becomes an `import` and a constant comparison. Drift detection is `ts-morph` over `procedures/`, no custom dep tracker. |
| 6 | User-endorsed crystallisation, not auto-induction | Reuse rate by construction. Direct answer to *Library Learning Doesn't*. Aligns with the hackathon's "live demo, show the agentic behaviour" framing, the endorsement step is the visible agentic moment. |
| 7 | Compile-to-pipeline as the v1 budget pay-out | Most legible to a judge ("watch the procedure go from 30s to 2s"), most aligned with MongoDB's native capabilities, and the cleanest demonstration of the convergence claim. |
| 8 | Pi via Flue (`@flue/sdk`), not bare Pi | Flue wraps `@mariozechner/pi-agent-core` in a build pipeline, HTTP/SSE server, MCP adapter, valibot-typed results, and `SandboxFactory` interface, ~500 to 1000 lines of scaffolding we don't have to author. We use pi-ai's `anthropic` provider against `api.anthropic.com` direct (Bedrock is also supported but not in the demo path; see Decision #15 for the Cloudflare deploy story). Live-tested 2026-05-01; see `kb/br/07-flue-harness.md`. |
| 9 | Voyage via Atlas Embedding & Reranking API, not standalone | Native Atlas integration since Feb 2025 acquisition. One less API key, one less rate-limit headache, hits the "MongoDB as a core component" gate squarely. |
| 10 | Pre-registered intent-clustered eval as the central artefact | The headline chart is the moat made visible. Without pre-registration, every positive curve is rationalisable as p-hacking. Eligibility cost is half a day on day one. |
| 11 | Three-baseline comparison, not just our system | Vanilla agentic RAG and static-typed environment are the comparison points. The chart that wins is the divergence chart, which only exists if we run all three. |
| 12 | No DataFetch / envrun.ai branding in the hackathon repo | Original-work rule plus strategic discretion. Working codename `AtlasFS`. Brand decisions deferred to post-submission. |
| 13 | Three-source corpus: BIRD subset + FinQA + supply-chain micro-set | BIRD: cross-collection polymorphism + published baselines (Spider, BIRD, DAIL-SQL, EvoMQL). FinQA: within-document polymorphism + compilable gold programs. Supply-chain: Round 1 demo viscerality + multimodal coverage. Three polymorphism axes, three demo beats. See `br/06`. |
| 14 | Static schema discovery for Round 1, dynamic as Round 2/3 stretch | ~10 to 30 collections, ~6K to 12K tokens — fits Claude's context comfortably. Hooks (Decision #17) narrow the agent's surface to a domain's known intents. Dynamic (`db.search` + `db.execute` per Cloudflare Code Mode) is the right destination if the corpus grows past ~5 databases or for Round 3 polish. |
| 15 | `flue build --target cloudflare` for the demo runtime, deployed via `wrangler deploy`; Vercel + Next.js for the UI | Re-read of `kb/resources/scope-schedule.md` lines 90-91 and 133: the hackathon mandates Atlas as a core component but is silent on hosting; `kb/resources/aws/participant-guide.md` is a partner credit-setup guide, not a hosting constraint. Flue ships a first-class `--target cloudflare` path with Durable Object SQLite session storage and the `@cloudflare/sandbox` connector — exactly what AtlasFS needs for structural per-tenant isolation and a no-network V8 sandbox. Cloudflare deploy is two commands (`wrangler deploy` + `vercel deploy`); the AWS Lambda + API Gateway + IAM + Parameter Store + Bedrock-access path is half a day of yak-shaving on Day 1 we cannot afford given the 6.5-hour build window before submissions close. Anthropic API direct replaces Bedrock; we accept the loss of AWS credit subsidy ($100-200) for a simpler deploy story. The Node target stays unused unless we hit a workerd-incompat fallback per the ladder in Hosting & Deploy. |
| 16 | Custom `DurableObjectSessionStore` plus `tool_calls` ETL, not Flue's defaults | Flue's `InMemorySessionStore` doesn't survive Worker hibernation. Replace with a ~50-line `SessionStore` writing `SessionData` to the tenant Durable Object's SQLite via `state.storage`, plus an ~80-line ETL that walks `SessionData.entries` and writes per-tenant rows to `tool_calls` for crystallisation. The DO instance is the per-tenant boundary: cross-tenant isolation is structural, not conventional. Pin `pi-agent-core` and `pi-ai` via `pnpm.overrides` (Flue declares them `*`). |
| 17 | Hand-authored hooks at `/datafetch/hooks/<domain>/<intent>.ts`, not a generic catalog system | The bootstrap is over-broad and the procedure does not yet exist for novel intents; hooks bridge that gap with domain-aware suggested chain shapes (relevant collections, parameter interface, derivation sketch in JSDoc). Hand-authoring ~10 to 15 hooks for FinQA + supply-chain is half a day of work and gives the agent a starting point on novel intents without building catalog infrastructure or the 7-card-type maturity ladder discussed in earlier design memos. Hook inference from schema + sampled queries is a post-hackathon research problem; for Round 1 the demo gain is what matters. Shared across tenants; superseded per-tenant by procedures once an intent crystallises. |
| 18 | Embedding-based intent routing for procedure, hook, and primitive lookup, not signature matching | Signature matching breaks on natural-language paraphrase. Embedding the user query against signature + JSDoc and thresholding on cosine is robust and runs host-side, so high-confidence procedure hits skip the LLM entirely. The same mechanism applies uniformly to all typed primitives regardless of implementation (deterministic Atlas calls, stochastic sub-agent calls, cached lookups, derived rules): the matcher routes by contract, not by impl. |
| 19 | FinQA modelled as `finqa_cases` (nested) plus `finqa_search_units` (sidecar), not flattened | Lean into the document model. Each case is a rich nested document with `table.rows`, `cells`, `provenance`, `goldProgram`, `goldAnswer`; the sidecar holds searchable summaries plus embeddings. Compiled pipelines operate on the nested structure directly via `$filter`/`$reduce` (see the Union Pacific 2017 worked example). |
| 20 | Hand-authored primitive modules with non-deterministic implementations exposed as siblings of synthesised collection modules, not as a separate stochastic-tools tier | The typed-interface contract is what enables composition and crystallisation; the implementation behind a primitive (Atlas call, Flue sub-agent, cached lookup, derived rule) is an internal concern. Treating these as siblings under `/datafetch/db/<utility>.ts` keeps the toolbox uniform: same matcher (Decision #18), same composition rules, same crystallisation. The budget worker improves primitive implementations transparently before any procedure-level compilation. See "Primitive modules" subsection in Bootstrap to Emergence. |

---

## Open design questions

These are tracked here so the docs reflect what is unresolved, not so we resolve them now.

1. **Static or dynamic schema discovery?** **Resolved for Round 1** by Decisions #14, #17, #18: static namespace (~6K to 12K tokens) loads upfront; hooks scaffold novel intents; the host-side matcher routes repeat intents to procedures without invoking the LLM. Dynamic discovery (Cloudflare-style `searchCollection()`/`loadType()`) is deferred until the corpus exceeds ~50 collections. See `br/06` for sizing analysis.

2. **Vanilla RAG baseline implementation: LangGraph + MongoDB or hand-roll?** Hand-roll is more original-work-friendly; framework is more credible. Tentative: LangGraph with a clear "we wired this up, didn't build it" disclosure in README.

3. **Scoring granularity: binary endorse/reject or graded 1-5?** Tentative: binary for v1; saves UI cost; matches the falsification framing.

4. **Per-tenant overlays for the demo: simulated or real?** **Resolved by Decision #15:** two real Durable Object instances, addressed via `https://atlasfs.vercel.app/t/data-analyst` and `https://atlasfs.vercel.app/t/financial-analyst`. Different agent system prompts (different intent priors over the eval set: data-analyst weighted toward BIRD aggregations; financial-analyst weighted toward FinQA computations) drive different trajectories into different DO SQLite stores. The two-pane divergence view reads real DO state.

5. **Cross-tenant procedure-library leakage.** **Resolved by Decisions #15 + #16:** the per-tenant boundary is now a Durable Object instance; DO instances cannot share SQLite state, so cross-tenant leakage is physically impossible rather than enforced by path convention. Per-tenant `tool_calls` namespaces, fingerprint pins, and codegen cache keys all live within the tenant's DO storage.

6. **Personal vs shared library (cross-tenant routing-score moat).** Tentative: personal-per-tenant for v1, shared-with-routing-scores as roadmap.

7. **AgentFS license verification.** **Obsoleted by Decision #15:** AgentFS is no longer in the architecture; per-tenant state lives in Durable Object SQLite, not in an AgentFS CoW overlay. The license check is no longer required.

8. **Sandbox runtime for the agent.** **Resolved by Decisions #8 and #15.** The runtime is `@cloudflare/sandbox` via Flue's `SandboxFactory`, hosted in a Cloudflare Worker. The agent imports from `/datafetch/db/<coll>.ts` virtual modules resolved by MongoFS at request time; per-tenant state lives in the tenant's Durable Object SQLite. The earlier NFS-mount path (AgentFS + Pi `sandbox: 'local'` with `cwd: '/datafetch/'`) is superseded.

9. **Flue API churn risk.** Flue is at v0.3.5 with an explicit "Experimental, APIs may change" warning, 131 commits over the 2026-04-29-to-30 weekend, 2 contributors, no test suite, no CI. `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai` are `*`-pinned upstream. Mitigation per Decision #16: pin Flue and both upstream packages exactly via `pnpm.overrides`, treat each Flue bump as a deliberate maintenance event. Open question is what cadence we adopt post-hackathon if we keep AtlasFS alive; for the 48-hour build, we freeze Flue at the version we install on Day 1.
