---
title: "datafetch, Market"
type: evergreen
tags: [magic-docs]
updated: 2026-05-07
---

# Market

The positioning doc. Where datafetch sits in the landscape, who the closest neighbours are, and what is actually different. The implementation brief at `/tmp/kb-rewrite-brief.md` is the source of truth on what ships; this doc is grounded in that.

## Core claim

> Datafetch does not virtualize the whole dataset. It virtualizes the dataset interface, then improves that interface from accepted, evidence-backed work.

A datafetch workspace is a directory mounted per intent. The agent works in files. The runtime records every typed `df.*` call as a trajectory. When a snippet commits an `df.answer({...})` envelope that passes validation, the in-process observer reads the trajectory and emits a typed `fn({intent, examples, input, output, body})` callable to `<baseDir>/lib/<tenant>/<name>.ts`. The next mount in the same tenant discovers the new function via `df.d.ts` and `apropos`, and the agent calls it in one line instead of recomposing the chain. The shipped MVP flips one tier on one dataset: `mode:"novel"` `tier:4` to `mode:"interpreted"` `tier:2`. That single hop is the wedge.

The cold path looks like this (FinQA chemicals revenue, demo Q1):

```ts
const cands = await df.db.finqaCases.findSimilar(question, 5);
const filing = (await df.lib.pickFiling({ question, candidates: cands })).value;
const plan = (await df.lib.inferTableMathPlan({ question, filing })).value;
const result = (await df.lib.executeTableMath({ filing, plan })).value;
return df.answer({ status: "answered", value: result.roundedAnswer, evidence, derivation, ... });
```

After commit, the observer emits `lib/<tenant>/rangeTableMetric.ts`. The warm path (demo Q2, coal revenue, structurally identical task) is one line:

```ts
const out = await df.lib.rangeTableMetric({ query, limit: 5 });
return df.answer({ status: "answered", value: out.value.roundedAnswer, ... });
```

Q1 has four top-level calls at `tier:4`; Q2 has one at `tier:2`. That collapse, repeated across structurally similar intents, is the product.

## Category

Datafetch is **procedural memory for code agents over a fixed dataset**. The unit of memory is a typed function file, not a plan transcript, a tool schema, or a vector index entry. The acquisition trigger is an accepted commit, not a similarity match. The discovery surface is a TypeScript declaration manifest, not a tool catalog. The substrate is a mount point, not a wrapped API.

The closest stable terms in the literature are *agent workflow memory* (Wang et al., ICML 2025), *agentic plan caching* (Zhang et al., Stanford 2025), and *auto-induced skill libraries* (Voyager 2023, ASI 2025, SkillCraft 2026). Datafetch is in the same family. The substrate (typed code files mounted alongside a typed view of a MongoDB Atlas dataset) is what is new.

## Adjacent categories explicitly distinguished

| Category | What they do | Why datafetch is not that |
|---|---|---|
| RAG / vector retrieval | Retrieve passages at query time, hand them to the model | We do not retrieve at query time. We shape the typed surface the agent calls into. The mount publishes typed `db.<coll>.findExact|search|findSimilar|hybrid` methods (`src/sdk/adapter.ts`); the agent composes them in TypeScript. No passages re-enter context. |
| Tool calling / MCP | Curate tools, expose them as a catalog, route LLM calls | We generate tools from accepted work, not from curation. There is no tool registry. The library at `<baseDir>/lib/<tenant>/` grows when an `df.answer(...)` validates and the observer crystallises the trajectory (`src/observer/worker.ts`). |
| FUSE / virtual-FS over a database | Mount the bytes (documents, rows) as files | We mount the *interface*, not the bytes. `<baseDir>/mounts/<id>/` holds typed `.ts` modules and descriptors derived from sampling, not the documents themselves. The bytes never leave Atlas; the mount is a typed view. |
| Prompt caching / KV reuse | Cache tokens or KV blocks across requests | We cache shape, not tokens. The dedup key is a 32-bit FNV-1a hash over a canonical step list (`src/observer/template.ts`); two queries about different entities crystallise into one function as long as the call shape matches. No tokens are persisted. |
| Code-mode typed namespaces (Cloudflare Code Mode, Anthropic Tool Search) | Convert an MCP catalog to a TS namespace, sandbox a snippet | We share the typed-surface thesis (see `kb/br/01`). They stop at "the namespace is static". We add the learning loop: the namespace grows when accepted work compresses into a new typed function. `df.d.ts` is regenerated on every commit (`src/server/manifest.ts`). |
| Auto-induced skill libraries (Voyager, ASI, SkillCraft) | Let the agent save successful tool-call sequences | We require a structured `df.answer({status, value, evidence, derivation, lineage})` envelope to even consider learning (`src/snippet/answer.ts`). Validation is automated (no human gate yet) but it gates on evidence and derivation, not on a coding-verifier "did it run". |

## Closest neighbours, at a glance

| Neighbour | Unit of memory | Acquisition trigger | Discovery surface | LLM in the warm path? | Substrate |
|---|---|---|---|---|---|
| Agent Workflow Memory (Wang et al., 2025) | NL workflow with named variables, in prompt context | LM-evaluator-judged successful trajectory | Memory appended to prompt | Yes, on every invocation | Web-navigation actions |
| Agentic Plan Caching (Stanford, 2025) | Plan-template string keyed by extracted keyword | Rule-and-LLM filter over completed run | `dict[keyword] -> template` | Yes, two LLM calls (extract + adapt) | Plan-Act ReAct agents |
| SkillCraft (Chen et al., 2026) | Parameterised skill blob (code) | Coding Verifier passes (syntax, runtime, quality) | Four MCP primitives (`save_skill`, `list_skills`, `get_skill`, `execute_skill`) | Optional, agent decides when to call | Tool-using agent over fixed tools |
| Code Mode (Cloudflare 2025/26) | Typed TS namespace | None, ships static with deploy | TS `.d.ts` in agent context | Yes, every call | Any MCP-shaped API |
| documentdbfuse / TigerFS / AgentFS | Document or row file (the bytes) | None, mirrors substrate | POSIX FS (FUSE or NFS) | Yes, every query | DB-as-FS |
| PySyft `@syft_function` | Submitted UserCode envelope | Owner approval | Exact-match by code-hash or func-name | Yes, on every run | Privacy-gated remote dataset |
| **Datafetch (this project)** | **Typed `fn({...})` file with valibot I/O** | **`df.answer(...)` envelope passes nine-check validation** | **Auto-generated `df.d.ts` plus BM25 `apropos`** | **No, on the warm `tier:2` path** | **Mounted Atlas dataset, per-tenant overlay** |

The row that earns the table is the LLM-in-the-warm-path column: every comparable system except code mode keeps an LLM in the request loop, even on a cache hit. Datafetch's warm path is `df.lib.<name>(...)` dispatching through the `BodyDispatcher` to a `kind:"pure"` body with no LLM call (`src/sdk/fn.ts:130-148`). The first hop from `tier:4` to `tier:2` is what the demo shows; the path from `tier:2` to `tier:1` (compiled Atlas pipeline) is reserved on the contract but not implemented yet.

## Closest neighbours, in detail

Six projects sit close enough to need a sharp answer.

### 1. Agent Workflow Memory (Wang, Mao, Fried, Neubig, ICML 2025)

The strongest academic precedent for the trajectory-crystallisation idea. AWM induces reusable workflows from agent trajectories on web-navigation benchmarks; on WebArena it lifts task success from 23.5 to 35.5. The induce-integrate-utilize loop is the academic ancestor of datafetch's commit-observe-reuse loop.

What is different. AWM workflows live in prompt context as natural-language descriptions plus parameterised step lists. Datafetch's unit is a typed `fn({...})` file with valibot input/output schemas, an `intent` string, and an executable body that re-runs through the same `df.*` surface (`src/sdk/fn.ts`). The library can grow without inflating the agent's context window, because only the `df.d.ts` declaration plus the matched function enter scope. AWM also has no environment-state pinning; datafetch persists a `@shape-hash:` per file so two trajectories with the same call shape collapse to one function.

Datafetch is also dataset-scoped, not session-scoped. Mounts are per dataset; `/lib/<tenant>/` overlays are per tenant. AWM has one global memory.

### 2. Agentic Plan Caching (Zhang, Wornow, Wan, Olukotun, Stanford 2025)

The strongest concurrent industrial-style validation of the test-time plan caching premise. APC reports 50.31% cost reduction at 96.61% of accuracy-optimal across five workloads. The unit of cache is a *plan template*, extracted by a small LM from a successful trajectory and adapted by a small LM on hit.

What is different. APC's cache unit is a string template; ours is a typed TypeScript function. APC requires two LLM calls on the cheap path (keyword extraction plus template adaptation); ours requires zero on the warm path (the learned interface dispatches deterministically through the snippet runtime). APC keys by an LM-extracted keyword; we key by a structural shape hash with no LLM in the lookup. APC's correctness gate is a post-hoc LLM-as-judge; ours is `validateAnswerEnvelope()` over a structured commit (`src/snippet/answer.ts`).

If a judge or reviewer comes in with APC in mind, the differentiator is the shape of the cached object, not the existence of caching.

### 3. SkillCraft (Chen et al., March 2026)

The most recent skill-library benchmark and protocol. Four MCP primitives (`save_skill`, `get_skill`, `list_skills`, `execute_skill`); a three-stage Coding Verifier (syntax, runtime, post-execution-quality); 71 to 79 percent token reduction at parity success on frontier models.

What is different. SkillCraft's skills are auto-induced from successful tool-call sequences with no human gate; datafetch requires the snippet to call `df.answer({...})` with structured evidence and derivation, and the validation gate runs nine specific checks before accepting (`src/snippet/answer.ts:128-134`). SkillCraft's discovery is the four MCP primitives; ours is the typed `df.d.ts` plus a BM25-flavoured five-bucket `apropos` over `<baseDir>/lib/`. SkillCraft's verifier rejects "all nulls" silent-failure cases via heuristics; ours rejects via the `noDefaultZeroFallback`, `evidencePresent`, `derivationVisible` rules in the answer envelope contract.

The honest framing is that SkillCraft is the canonical auto-induction baseline for the within-tenant cost-convergence half of the story. Datafetch's wedge is that the unit of skill is a typed function the agent calls from a `df.lib.<name>(...)` slot, not a code blob retrieved through `get_skill`.

### 4. Voyage AI as a code-mode data interface (Cloudflare Code Mode + Voyage)

Shares the "code is the interface to data" thesis (see `kb/br/01`). The pattern: convert the data API into a typed TS namespace, expose one eval-style tool to the agent, run the snippet in a sandbox. Cloudflare measured 81 to 99.9 percent token reduction collapsing 2,500 MCP endpoints into a typed namespace.

What is different. Code-mode-data-interface as published is *static*. The TS namespace ships with the deploy. Datafetch adds the learning loop: the namespace gains a new typed function every time a snippet commits an accepted answer over a previously novel call shape. The substrate is also more opinionated: the typed surface is generated from sampling-based shape inference per collection (`src/bootstrap/infer.ts`) rather than hand-authored.

If the question is "isn't this just code mode plus learning?", the answer is yes, that is exactly the wedge, and the load-bearing part is the learning loop and the answer-envelope contract that gates it.

### 5. documentdbfuse / TigerFS / AgentFS (DB-as-FS for agents)

Shares the "filesystem-shaped data" idea (see `kb/br/03`). documentdbfuse mounts a MongoDB-wire server as a Linux FUSE filesystem; collections become directories, documents become `.json` files, aggregation pipelines become nested paths.

What is different. They virtualize the bytes; we virtualize the interface. `<baseDir>/mounts/<id>/<coll>.ts` is a typed module describing how to call into the collection, not the documents themselves. There is no FUSE, no NFS; the workspace is a regular directory created by `datafetch mount` (`src/cli/workspace.ts:80`). The bash sandbox is in-process via `just-bash` with a `MountableFs` that read-only-mounts the typed view at `/db/<id>/` and writable-mounts the per-tenant library at `/lib/<tenant>/` (`src/bash/session.ts:42-46`). The previous design did consider an NFS path; the shipped MVP does not take it.

### 6. PySyft (force-intent-declaration ergonomic)

Shares the "force the agent to declare intent before executing" ergonomic (see `kb/br/11`). PySyft's `@sy.syft_function` decorator captures source, signature, an `InputPolicy`, and an `OutputPolicy` into a `SubmitUserCode` envelope; the runtime refuses to execute anything that did not pass through the envelope.

What is different. We use the same shape: every learned function is a `fn({intent, examples, input, output, body})` envelope authored by the observer (`src/sdk/fn.ts`). The runtime refuses to dispatch anything else through `df.lib`. PySyft does this for privacy gating (the data owner approves a `SubmitUserCode` before it can run against the private side); we do it because intent declaration plus typed I/O is what makes a function reusable across mounts. Same primitive, different use case, but the structural argument is the same: an envelope you have to pass through is the difference between a reusable artefact and a one-off script.

PySyft's discovery is exact-match-only over `code_hash` and `service_func_name`. Datafetch ships a richer surface: `df.d.ts` is the typed declaration manifest the agent reads on every snippet (`src/server/manifest.ts`), and `apropos` is a five-bucket BM25 scorer over name, intent, description, examples, and source (`src/discovery/librarySearch.ts`). The intent declaration is required; the discovery is generous.

## Why now

Four pieces clicked into place inside a six-month window.

1. **Agents-as-bash-loops are now mainstream.** Claude Code, codex-cli, and the broader "give the agent bash" pattern (see `kb/br/12`) shipped through 2025 to early 2026. The README pattern `claude --bare --allowedTools "Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)"` is a one-line deployment of a useful agent over a dataset. We do not have to ship an agent harness; we ship the verbs.

2. **Typed-tool surfaces are settled.** Cloudflare Code Mode (Sept 2025), Anthropic Tool Search (2025), the Cloudflare "1,000 tokens" follow-up (Q1 2026) all converged on the same architectural move within six months: stop curating an MCP catalog, expose a typed namespace, let the agent write the snippet. The token-cost argument is not contested anymore. What is open is what the typed surface evolves into; that is the slot datafetch slots into.

3. **Dataset mount points are emerging as a primitive.** documentdbfuse (April 2026), TigerFS (April 2026), AgentFS (Turso, Nov 2025 onward) all converged on "mount the dataset as something the agent can navigate". Datafetch picks the more opinionated point on this spectrum: mount the interface, not the bytes, and learn from accepted work.

4. **Procedural memory for agents is converging.** AWM (ICML 2025), Stanford APC (2025), SkillCraft (Mar 2026), ASI (Apr 2025), the December 2025 "Remember Me, Refine Me" procedural memory paper, plus the March 2026 survey on autonomous-LLM-agent memory all push the same thesis: agents need to crystallise procedural knowledge across tasks. Datafetch is in this lineage; the framing reads as recognised, not novel. The substrate (typed code files mounted alongside a typed Atlas view) is where the moat lives.

The window for "code-agent codepaths over data are repetitive in a learnable way" being a fresh framing is closing. We do not need to argue that the shape exists; we need to argue that the unit of memory is a typed function, the gate is an evidence-bearing answer envelope, and the substrate is the typed surface the agent already navigates.

## Who would care

Two concrete shapes of audience.

**Teams running agentic workloads over a fixed dataset.** Financial filings (FinQA-shape: numerical reasoning over heterogeneous tables in 10-Ks), internal docs (large enterprise corpus where the same kinds of questions recur), structured logs (incident retrospectives that ask the same shape of "what changed and when" question across many incidents). The hot path of these workloads has a long tail of structurally similar queries; today every query pays the full ReAct planning cost. Datafetch flips that tail to interpreted-tier the moment the first instance of each shape commits.

**Platform teams who want to surface a learned typed API to many agents over one dataset.** The mount is shared (`<baseDir>/mounts/<id>/`); the library is per-tenant (`<baseDir>/lib/<tenant>/`). A platform team can host one published mount and let many tenants accumulate their own private libraries against it. The cross-tenant promotion path is not shipped today; it is on the deferred list. The single-tenant story is enough for the MVP.

The audience datafetch is **not** for: ad-hoc one-shot question answering over a corpus the user only visits once, exploratory data science where the unit of work is a fresh notebook each time, and any workload where each query is structurally novel. The premise is repetition with shape-stability; without that, the learned interface never compounds and we degrade gracefully to "code mode plus a typed surface", which is a fine baseline but not the wedge.

## Market shape

The market is sized by the overlap of three populations.

1. **Bash-loop-driven agents.** Claude Code, codex-cli, and the broader pattern. Open-ended count, growing fast.
2. **Repetitive workloads over a fixed dataset.** Most internal-tool deployments after they cross some maturity threshold; the long tail of "the same kinds of questions, asked many times".
3. **Teams willing to expose a typed surface over their data.** A real friction point. Today this means publishing a mount with `datafetch publish <id> --uri --db`, which writes typed `.ts` modules and descriptors derived from sampling. The friction is not the publish step (one command); it is the willingness to let the agent navigate the data through code rather than through curated tools.

The bottleneck for adoption today is (3). Code mode adoption (Cloudflare, Anthropic) is the leading indicator: as that pattern normalises, more teams will be comfortable exposing data this way. Datafetch's bet is that the typed surface is what those teams will be looking at six to twelve months from now, and that the value-add over a static typed surface (the learning loop, the answer-envelope contract, the per-tenant overlay) will be visible.

## Unfair advantages today

Four things this implementation has that adjacent designs do not.

1. **In-process Flue, not a service.** The LLM-backed body is library code (`src/flue/dispatcher.ts`), not an HTTP service. The credential boundary is `src/flue/session.ts`, the only place LLM keys are read; the agent never sees them. Adopting another harness later is a swap of the `BodyDispatcher` interface, not a rewrite.

2. **Bash-only agent surface.** The agent gets `Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)` and nothing else (`README.md:46-57`). This works with any harness that can launch bash. We do not own the agent loop; we own the verbs.

3. **The intent workspace is a directory.** `datafetch mount` creates a CWD-rooted folder with `.datafetch/workspace.json`, `scripts/{scratch.ts, answer.ts}`, `tmp/runs/`, `result/`, and symlinks to the shared mount and the tenant library (`src/cli/workspace.ts:80`). Anything that reads directories composes with this: editors, file watchers, git, agent harnesses. The workspace HEAD is a `result/HEAD.json` pointer; supersession is just an atomic write (`src/observer/workspaceHead.ts`).

4. **Learned interfaces are visible TypeScript.** The pure-composition author (`src/observer/author.ts:154`) emits TS that re-walks the trajectory's call sequence, parameterised. The codifier-skill fallback exists but is the secondary path. Every learned function is a file the user can `cat`, `grep`, edit, or delete. Frontmatter is in Claude Code skill format so an agent reading the file can decide whether to call the wrapper directly. The "learned" output is, by design, plain auditable code, not a prompt blob or a vector entry.

## Threats to the position

Five forces could erode the wedge. Naming them honestly.

1. **Code Mode plus learning shipped by Cloudflare or Anthropic.** Cloudflare's "search() / execute()" two-primitive pattern and Anthropic's Tool Search are both one design step away from "the namespace grows". If either ships a learning loop with a structured-answer gate, the wedge narrows to the substrate (Atlas mounts, per-tenant overlays, `fn({...})` envelope) and the gate semantics. We should not be the project that argues "we did it first"; we should be the project that has the cleanest substrate and the most opinionated gate.

2. **The official MongoDB MCP server with Voyage-on-insert auto-embedding.** Tool-call shaped today, but the substrate (typed access plus learned embeddings) is sitting under it. A MongoDB-blessed code-mode wrapper plus an auto-induction loop on top is a credible six-to-twelve-month threat (per `kb/br/02`).

3. **AWM or SkillCraft ported to a typed-database substrate.** The lift is not large; both have a clean enough induction step. The defence is the answer-envelope contract (`src/snippet/answer.ts`), the workspace-head supersession model (`src/observer/workspaceHead.ts`), and the in-process Flue boundary that keeps LLM calls library-shaped.

4. **The shape-hash dedup is too crude for production.** Today the shape hash is a 32-bit FNV-1a over a canonical step list; collisions are possible at scale. The MVP collapses the design's "N >= 3 convergent trajectories" clustering to N = 1, every qualifying trajectory crystallises immediately. A more rigorous clustering pass plus an LM-assisted name disambiguator is on the deferred list.

5. **The `df.answer({...})` envelope is too strict.** Nine validation gates is a lot of surface for an agent to satisfy on the first try. If the gate is so strict that nothing learnable ever commits, the loop never closes. The mitigation today is the seed library at `<baseDir>/lib/__seed__/` (re-export shims to canonical primitives like `pickFiling`, `inferTableMathPlan`, `executeTableMath`) so the agent has a working starting point. Whether the envelope contract scales beyond FinQA-shape is the open empirical question.

## What this is not yet

The MVP flips one tier on one dataset. Specifically deferred (per `README.md:200-205` and the brief at `/tmp/kb-rewrite-brief.md` section 13):

- **Cross-tenant family-function promotion.** The `MountHandle.on("family-promoted", ...)` hook exists but never fires. Library divergence metrics across tenants are unimplemented; the multi-tenant isolation regression test (`tests/observer-multi-tenant.test.ts`) proves separation works, no UI surfaces divergence.
- **The compiled `tier:1` Atlas-aggregation-pipeline path.** `MountAdapter.runCompiled` is on the contract but throws "not implemented in MVP" (`src/adapter/atlas/AtlasMountAdapter.ts`). `CostTier=1` is reserved for it.
- **Vector / Voyage retrieval.** `AtlasMountAdapter.capabilities()` returns `vector:false`; `findSimilar` and `hybrid` delegate to lex search.
- **Drift detection.** Schema fingerprints are computed and persisted; the reactive `MountHandle.on("drift", ...)` hook never fires.
- **Content-addressable pins, HTTPS / auth, multi-seed evaluation harness.** All on the deferred list.
- **User endorsement.** Validation is automated via `validateAnswerEnvelope()`. No human review API.

The shipped headline is `datafetch demo`: Q1 (chemicals revenue 2014 to 2018) composes a four-call chain at `tier:4`, the observer crystallises `rangeTableMetric`, Q2 (coal revenue 2014 to 2018) collapses to one `df.lib.rangeTableMetric(...)` call at `tier:2`. That hop, repeated, is the product.

The pitch is the wedge, not the platform. The market story is "code-agent codepaths over data are repetitive in a learnable way, and the unit of memory should be a typed function the runtime can dispatch to with no LLM in the warm path", proved on one dataset and one tier flip. Everything beyond that is the post-MVP roadmap, and nothing in the published positioning should claim it before it ships.

## How this doc fits the kb/

This is the positioning doc. Adjacent docs:

- `kb/elevator.md` is the 60-second framing for a stranger. Same wedge, less detail on the neighbours.
- `kb/mission.md` is the why: the goal, the constraints, the bet. Less landscape, more conviction.
- `kb/product-design.md` is the architecture: the modules, the contracts, the data flow. The market doc cites the codepaths it claims; that doc explains them.
- `kb/research.md` is the prior-art survey, with sources. The market doc points at the closest neighbours; that doc has the full citation set.
- `kb/br/` carries the deep dives on each neighbour we drew positioning from (`01` Voyage / Code Mode, `02` MongoDB fit, `03` documentdbfuse, `04` Stanford APC, `04-skillcraft`, `05` AWM, `07` Flue, `11` PySyft, `12` browser harness).

When a claim in this doc says "we differ from X because we do Y", the contract is that Y is grounded in a file and line number from the brief at `/tmp/kb-rewrite-brief.md`, and X is grounded in a citation from `kb/br/`. If a claim in this doc cannot be backed by both of those, it should not be in this doc.
