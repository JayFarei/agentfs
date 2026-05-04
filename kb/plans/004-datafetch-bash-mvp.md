---
title: "feat: Datafetch Bash MVP"
summary: "Reshape the prototype into a bash-shaped Unix workspace over a mounted FinQA dataset, with an in-process Flue runtime and a within-tenant generalisation + speed-up demo."
type: feat
status: proposed
date: 2026-05-04
related_research:
  - kb/prd/README.md
  - kb/prd/design.md
  - kb/prd/decisions.md
  - kb/prd/personas.md
  - kb/prd/snapshot/01-prototype-walkthrough.md
  - kb/prd/snapshot/02-product-design-delta.md
  - kb/prd/snapshot/03-flue-integration-audit.md
---

# Datafetch Bash MVP

## Overview

Deliver the locked design (`kb/prd/design.md`) as a working end-to-end demo over the FinQA dataset on MongoDB Atlas. The agent's only tool is `bash`; the dataset surfaces as a synthesised `/db/<mount>/<coll>.ts` module produced by a generic bootstrap pipeline; typed functions live at `/lib/<name>.ts` and are authored via a single `fn({...})` factory; LLM-backed bodies dispatch through Flue used as an in-process library; an asynchronous observer crystallises convergent trajectories into new `/lib/` files, and the second asking of a related intent flips from `mode: "novel"` to `mode: "interpreted"` with a measurable cost drop.

## Problem Frame

The prototype proves the elevator pitch on FinQA but the surface is wrong for the design target. The agent has a CLI dispatcher, not a bash shell; modules are hand-authored, not synthesised; procedures live in a four-way taxonomy (`procedures/`, `agents/`, `functions/`, primitives), not in one `/lib/`; Flue is wrapped as a `pnpm exec flue run` subprocess with sentinel-marker JSON parsing, not as an in-process library; the result envelope users see is shaped by the runner's per-intent branches, not by a uniform contract. Closing those gaps is what makes datafetch a reusable substrate rather than one demo with the right vocabulary stapled onto it. The MVP cuts to the bone of the design — bash + mount adapter + `fn({...})` + in-process Flue + within-tenant crystallisation — and explicitly defers cross-tenant promotion, content-addressable pins, the compiled tier, and non-Atlas adapters.

## Requirements Trace

- **R1.** A provider can call `datafetch.publishMount({source: atlasMount({...})})` and receive an inventory whose entries reference `/db/<mount-id>/<coll>.ts` files synthesised from sampling, plus `_descriptor.json`, `_samples.json`, `_stats.json`, and a per-mount `README.md`. None of these are hand-authored.
- **R2.** The agent's tool list contains exactly one entry: `bash`. The agent can run `cat`, `ls`, `grep`, `head`, `jq`, `find`, plus the three custom commands `npx tsx`, `man`, `apropos`. Filesystem state persists across `exec` calls; shell state (env, cwd) does not, and `/AGENTS.md` documents the workaround.
- **R3.** Every callable in `/lib/` is authored through one factory, `fn({intent, examples, input, output, body})`. Three body shapes are supported: pure TypeScript, `llm({prompt, model, output})`, and `agent({skill, model})`.
- **R4.** LLM-backed bodies dispatch through `@flue/sdk` used as an in-process library. There is one persistent Flue session per tenant on the data plane. No subprocess shell-out, no sentinel-marker JSON parsing, no `--target node` invocations from inside the runtime.
- **R5.** Every successful call returns a uniform `Result<T>` envelope: `{value, mode, cost: {tier, tokens: {hot, cold}, ms: {hot, cold}, llmCalls}, provenance: {tenant, mount, functionName?, trajectoryId}, escalations, warnings?}`.
- **R6.** When an agent's `npx tsx` snippet successfully composes primitives into an answer, an asynchronous observer can mine the trajectory and persist a parameterised `/lib/<name>.ts` written through `fn({...})`. The next call resolves `df.lib.<name>` to that file with no further codification cost.
- **R7.** A two-question demo on FinQA proves both properties simultaneously. Q1 (e.g. table-math on chemicals revenue range) is an ad-hoc composition over seed primitives; the trajectory records every `df.db.*` and `df.lib.*` call. The async observer crystallises a parameterised `/lib/<tenant>/<name>.ts` from that trajectory. Q2 (the same intent shape on coal) calls `df.lib.<crystallised>(...)` directly. Acceptance is measured on three observable properties of the resulting envelopes / trajectories, not on token counts (the seed primitives are pure-TS so neither path fires an LLM in its hot path):
    - **Function-name flip.** Q1's trajectory's terminal `provenance.functionName` is one of the seed primitives (e.g. `executeTableMath`). Q2's terminal `provenance.functionName` is the crystallised wrapper's name (e.g. `crystallise_pickfiling_<hash>`).
    - **Call-graph collapse.** Q1's per-call records list every step in the composition chain (≥3 entries: `db.<coll>.findSimilar`, `lib.pickFiling`, `lib.<later>` …). Q2's top-level call list collapses to a single `lib.<crystallised>(...)` entry that internally invokes the same chain.
    - **Latency drop.** Q2's `cost.ms.cold` ≤ Q1's, since dispatch is one wrapper call instead of N independent fn() invocations.
    The crystallised file's existence under `<baseDir>/lib/<tenant>/` is itself the third observable proof. (Token-count and `llmCalls > 0` semantics — originally locked in — assumed an LLM-in-the-loop authoring step inside Q1's hot path. The MVP defers cold-path LLM authoring to client-agent territory per D-015; the observer crystallises pure-composition trajectories asynchronously, so Q1's envelope honestly reports `cost.llmCalls === 0`. If a tenant authors `body: llm({...})` in their own /lib/ files the envelope will report the LLM cost faithfully.)
- **R8.** The data plane is the single execution boundary. Substrate credentials and the LLM API key live there. The agent client holds a tenant token only.

## Scope Boundaries

- **No cross-tenant promotion.** The three-layer `/lib/` resolver (tenant overlay → mount-shared → SDK core) collapses to tenant overlay only. The `family-promoted` event, the N≥3 convergence rule, and the verifier-against-each-contributor's-shadow-inputs gate are all deferred.
- **No content-addressable pins or drift handling.** Artefacts are not sha256-hashed. TS files do not carry `@sha256:` import comments. Drift detection, the `stale_pin` error path, the verified/stale/reborn tier model, and verifier replay are all deferred.
- **No compiled tier.** `MountAdapter.runCompiled` is part of the interface but unimplemented. The hot path runs the interpreted body; tier 1 is reserved.
- **No additional substrate adapters.** Only `AtlasMountAdapter` ships. HuggingFace, Postgres, SQLite, JSONL, S3 Parquet are deferred. The current `src/workspace/runtime.ts` JSONL path is retired without replacement.
- **No typed user-SDK polish.** `datafetch.connect` exposes `df.run` and direct `df.lib.<name>` / `df.db.<coll>.<method>` calls; `df.query({intent, expect})` and per-tenant `.d.ts` regeneration are deferred. The agent's bash surface is the primary demo path.
- **No event subscriptions on `connect`.** `df.on("function-crystallised", …)` and `df.on("schema-drift", …)` are deferred; users learn about crystallisation by reading `/lib/`.
- **No security boundary.** The bash session is not VM-isolated. `new Function`-style execution of codified source is acceptable for the MVP. Vercel Sandbox / V8 isolate / `globalOutbound: null` are deferred.
- **No three-source corpus.** FinQA-on-Atlas only. BIRD-SQL and the supply-chain micro-set from `kb/prd/snapshot/02` remain absent.
- **No web UI updates beyond what falls out of the API rewrite.** The Vite/React client at `web/` is left to follow once the data-plane API stabilises.

## Context & Research

- `kb/prd/design.md` is the source of truth for the architecture. Sections §4 (agent environment), §5 (`/db/` and `/lib/`), §6 (function model), §11 (SDK surfaces) are load-bearing for this plan.
- `kb/prd/decisions.md` D-001 through D-020 are the locked architectural choices the MVP must respect. D-005 (one bash tool), D-007 (two regions), D-008 (data gravity), D-011 (functions are the unit), D-013 (real bash), D-014 (just-bash as library), D-015 (client agent authors LLM-backed functions), D-016 (TS files universal, skills opt-in), D-017 (Flue in-process), and D-018 (`/tmp/` not `/scratch/`) are particularly relevant.
- `kb/prd/personas.md` provides three concrete walkthroughs the MVP must reproduce in spirit, particularly the agent's six-turn FinQA scenario in §3.
- `kb/prd/snapshot/01-prototype-walkthrough.md` maps every load-bearing claim of the current prototype to the file where it lives. Use it as a port-from index.
- `kb/prd/snapshot/02-product-design-delta.md` ranks the cuts in the prototype by how much they bend the pitch. Tier A cuts (no MongoFS, no real eval, lexical-only retrieval, single-domain tenants) are the ones this plan addresses.
- `kb/prd/snapshot/03-flue-integration-audit.md` documents the subprocess-shell-out integration the MVP replaces with in-process library use.

## Architecture

```
+------------------------------- AGENT (thin client) ------------------------------+
| Tool list: [{name: "bash"}].  Authenticates with a tenant token.                 |
+----------------------------------------------------------------------------------+
                                       |  HTTPS, persistent session id
                                       v
+------------------------------- DATA PLANE (server) ------------------------------+
|                                                                                   |
|  HTTP surface                                                                     |
|    POST /v1/mounts          provider publishes a mount; SSE stream of warm-up     |
|    POST /v1/connect         tenant handshake; returns session id                  |
|    POST /v1/bash            run one bash command in a persistent session          |
|    POST /v1/snippets        execute a TS snippet (used by `npx tsx` and df.run)   |
|                                                                                   |
|  Bash session     just-bash + MountableFs                                         |
|                   /db/   read-only, synthesised by bootstrap                      |
|                   /lib/  tenant overlay (mutable, fn-authored TS files)           |
|                   /tmp/  ephemeral per-session                                    |
|                   custom commands: npx tsx, man, apropos                          |
|                   orientation: /AGENTS.md, /db/<mount>/README.md,                 |
|                                /usr/share/datafetch/skill/SKILL.md                |
|                                                                                   |
|  Snippet runtime  binds df.* (db handles + lib functions) into the npx tsx        |
|                   evaluation scope; every df.* call is recorded                   |
|                                                                                   |
|  Trajectory       per-call records: {primitive, input, output, ms};               |
|  recorder         per-trajectory envelope: {tenant, mount, question, mode,        |
|                                            cost, calls, result}                   |
|                                                                                   |
|  Flue session     @flue/sdk in-process; one persistent session per tenant;        |
|                   dispatches llm({...}) and agent({skill}) bodies; valibot        |
|                   result validation                                               |
|                                                                                   |
|  Mount adapters   AtlasMountAdapter implementing MountAdapter; bootstrap          |
|                   pipeline (sample → infer → emit) is source-agnostic             |
|                                                                                   |
|  Observer worker  async; mines trajectories; on convergence, writes a new         |
|                   /lib/<name>.ts authored via fn({...})                           |
|                                                                                   |
|  Substrate        MongoDB Atlas (FinQA); Atlas Search indexes; mount cache        |
+----------------------------------------------------------------------------------+
```

| Region | Responsibility |
|---|---|
| Bootstrap pipeline | `sample()` → `inferShape()` → `classifyFields()` → emit `<coll>.ts` + `_descriptor.json` + `_samples.json` + `_stats.json` + `README.md`. Source-agnostic. |
| `MountAdapter` | One per substrate. Exposes `id`, `capabilities()`, `probe()`, `sample()`, `collection<T>()`. `runCompiled()`, `watch()`, `ensureIndex()` declared but unimplemented in MVP. |
| `CollectionHandle<T>` | The four-method retrieval contract: `findExact`, `search`, `findSimilar`, `hybrid`. |
| `fn({...})` factory | The only authoring surface. Three body shapes: pure TS, `llm({prompt, model, output})`, `agent({skill, model})`. Returns a typed callable registered into `/lib/`. |
| `llm({...})` / `agent({...})` | Body factories. Both dispatch through the per-tenant Flue session. `agent({skill})` references `/lib/skills/<name>.md`. |
| Snippet runtime | Evaluates `npx tsx` content with `df` bound as a global. `df.db.<coll>.<method>` and `df.lib.<name>` are Proxies. Records every call into the active trajectory. |
| Trajectory recorder | Persists per-trajectory JSON; one row per `df.*` invocation; envelope carries `mode`, `cost`, `provenance`. |
| Observer worker | Reads trajectories asynchronously; on a convergent template, writes a parameterised `/lib/<name>.ts` via `fn({...})`. Single-tenant only in MVP. |
| Result envelope | Uniform across `df.run`, `df.lib.<name>`, and `df.db.<coll>.<method>`. Returned to the user; printed by the agent's snippet output. |

### Storage layout

```
$DATAFETCH_HOME/
  mounts/<mount-id>/
    <coll>.ts                         synthesised typed module
    <coll>/_descriptor.json
    <coll>/_samples.json
    <coll>/_stats.json
    README.md
  lib/<tenant>/<name>.ts              tenant overlay (only layer in MVP)
  skills/<tenant>/<name>.md           Flue frontmatter+prompt format
  trajectories/<id>.json
```

`$DATAFETCH_HOME` defaults to `$ATLASFS_HOME` for backward compatibility with current fixtures; rename of the env var is a separate cleanup.

## Milestones

### Phase 1: Bash workspace over a hand-built FinQA mount

**User stories** — Agent persona §3 lifecycle steps 1–3 (orient, look for an existing function, probe the chain); provider's `publishMount` shape with a placeholder bootstrap.

**What to build.** Stand up the bash-shell-shaped surface end-to-end with a single hand-authored mount. just-bash is wired with a `MountableFs` mounting `/db/`, `/lib/`, `/tmp/`. The three custom commands (`npx tsx`, `man`, `apropos`) are registered. `/AGENTS.md`, `/db/<mount>/README.md`, and `/usr/share/datafetch/skill/SKILL.md` are present. One collection module `/db/<mount>/<coll>.ts` is hand-authored by porting the current Atlas retrieval code as-is — this is the staging surface that Phase 2 will replace with synthesis. One stub function `/lib/<name>.ts` is authored via a minimal `fn({...})` factory that supports pure-TS bodies, to prove the registration path. One `bash` tool is exposed over `POST /v1/bash` against a persistent session id; the CLI reuses the same endpoint.

**Acceptance criteria.**
- [ ] Agent's tool list has exactly one entry, `bash`. The tool description references `/AGENTS.md`.
- [ ] `cat /AGENTS.md`, `ls /db /lib`, `man <stub-fn>`, `apropos <keyword>` all work and produce output that mirrors the format in `kb/prd/personas.md` §3.
- [ ] `npx tsx -e "console.log(await df.db.<coll>.findExact({...}))"` returns substrate rows from Atlas.
- [ ] `npx tsx -e "console.log(await df.lib.<stub>(input))"` returns the typed output of the stub function.
- [ ] Filesystem state persists across `bash.exec` calls; the workaround for shell-state reset is documented in `/AGENTS.md`.
- [ ] HTTP `POST /v1/bash` accepts `{sessionId, command}` and returns `{stdout, stderr, exitCode}`.

### Phase 2: Bootstrap pipeline + AtlasMountAdapter

**User stories** — Provider persona §1 with the warm-up stage event stream and inventory; agent persona §3 Turn 1 reading auto-generated `/db/<mount>/README.md` and `_descriptor.json`.

**What to build.** Define the `MountAdapter` interface and ship the first concrete implementation by extracting the current Atlas Search and retrieval logic into `AtlasMountAdapter`. Build the source-agnostic bootstrap pipeline: probe the substrate, sample documents adaptively, infer shape with field-role classification, and emit `<coll>.ts`, `_descriptor.json`, `_samples.json`, `_stats.json`, and the per-mount `README.md`. Wire `datafetch.publishMount({source})` to drive the bootstrap and stream progress events over SSE. The hand-authored `/db/<mount>/<coll>.ts` from Phase 1 is deleted; the synthesised version takes its place. The four-method retrieval contract (`findExact`, `search`, `findSimilar`, `hybrid`) is the only surface a `CollectionHandle<T>` exposes.

**Acceptance criteria.**
- [ ] `datafetch.publishMount({id, source: atlasMount({...})})` returns successfully and streams stages (`probing` → `sampling` → `inferring` → `ready`) over SSE.
- [ ] `/db/<mount>/<coll>.ts` is generated with an `interface` derived from inferred schema, a typed handle exposing the four retrieval methods, and a header comment recording the sample size and substrate.
- [ ] `/db/<mount>/<coll>/_descriptor.json` carries `kind`, `cardinality`, `fields` (with `role`, `presence`, optional `cardinality_estimate`, `embeddable`, `indexable_as`), and `affordances` matching `kb/prd/design.md` §7.4.
- [ ] `/db/<mount>/_samples.json` contains 5–10 representative documents.
- [ ] `/db/<mount>/README.md` is generated from bootstrap output and is present in the agent's bash workspace.
- [ ] Hand-authored FinQA-specific TypeScript modules from the current prototype are removed from the active code path.
- [ ] No FinQA-specific knowledge lives in `AtlasMountAdapter` — the adapter discovers the FinQA shape from sampling.

### Phase 3: `fn({...})` factory, `/lib/` populated, full composition snippet, Result envelope

**User stories** — Agent persona §3 Turn 4 (Full composition) where the snippet fans out across `df.db.<coll>.findSimilar` + `df.lib.pickFiling` + `df.lib.locateFigure`; user persona §2 Style B (`df.run` snippet) returning a Result envelope with cost and provenance.

**What to build.** Define the `fn({intent, examples, input, output, body})` factory in `@datafetch/sdk`. Body shapes supported in this phase: pure TS and composition. Port the deterministic primitives that today live across `src/datafetch/db/*.ts` (filing selection, table-cell location, arithmetic) into `/lib/<name>.ts` files authored via `fn({...})`. The snippet runtime binds `df` as a global inside `npx tsx`; `df.db.<coll>.<method>` and `df.lib.<name>` are Proxies that record every invocation. Define the `Result<T>` envelope as the uniform return shape across `df.run`, `df.lib.<name>`, and `df.db.<coll>.<method>`. The trajectory recorder writes per-call records and a per-trajectory envelope including `mode`, `cost`, `provenance.functionName?`, `provenance.trajectoryId`, and `escalations`. The current per-intent dispatcher in the runner is deleted; the only intent-recognition surface is `df.lib.<name>` lookup.

**Acceptance criteria.**
- [ ] `fn({intent, examples, input, output, body})` accepts pure-TS and composition body shapes; rejects malformed schemas with a clear error.
- [ ] The functions previously hand-coded as primitives (filing selection, table-cell location, arithmetic) are present in `/lib/<name>.ts` and authored through `fn({...})`. They retain their behaviour against the current FinQA fixtures.
- [ ] An agent's `npx tsx` snippet that composes `df.db.<coll>.findSimilar` → `df.lib.<pickFiling>` → `df.lib.<locateFigure>` returns a typed value and a complete `Result<T>` envelope.
- [ ] The Result envelope's shape matches `kb/prd/personas.md` §2 exactly. `mode` is one of `"cache" | "compiled" | "interpreted" | "llm-backed" | "novel"`. `cost.tier` is in `0..4`. `cost.tokens.{hot,cold}`, `cost.ms.{hot,cold}`, `cost.llmCalls` are numeric.
- [ ] Per-call trajectory rows record `{index, primitive, input, output, ms}`. The trajectory envelope records the mode and cost.
- [ ] The matcher / `LocalProcedureStore` / per-kind procedure translators of the current prototype are removed.

### Phase 4: In-process Flue runtime, LLM-backed body shapes, skill markdown sidecars

**User stories** — Agent persona §3 Turn 6 (Need a new LLM-backed function), where the agent writes a `fn({...})` file with `body: llm({prompt, model})` inline; user/agent both observe `mode: "llm-backed"` in the result envelope.

**What to build.** Replace the subprocess Flue integration with `@flue/sdk` used as an in-process library. Maintain one persistent Flue session per tenant on the data plane; do not cold-start per call. `llm({prompt, model, output})` and `agent({skill, model})` body factories dispatch through that session and return valibot-validated results. Define the skill markdown sidecar contract (`/lib/skills/<name>.md` with frontmatter `{name, input, output, model?}` plus the prompt body) so `agent({skill})` resolves correctly. Migrate the existing observer / outlook scorer / sentiment agents from `.flue/agents/*.ts` standalone executables into in-process skill calls — the agent files become prompt templates the SDK loads, not CLI binaries. Delete the duplicated `runFlueJson` / `parseFlueJson` / sentinel-marker JSON parsing across `finqa_observe.ts`, `finqa_outlook.ts`, `finqa_agent.ts`. The agent demonstration of writing a new LLM-backed `/lib/<name>.ts` file via `cat > <<EOF` heredoc returns a typed answer from `df.lib.<name>(input)` on the same session.

**Acceptance criteria.**
- [ ] `@flue/sdk` is a dependency; `@flue/cli` is not invoked at runtime. No `pnpm exec flue run` lines remain in the request path.
- [ ] One Flue session is constructed per tenant on the data plane and reused across calls; tokens spent on session warm-up are charged once.
- [ ] `body: llm({prompt, model, output})` and `body: agent({skill, model})` both work end-to-end against Anthropic via Flue. Result validation is via valibot.
- [ ] An agent who writes `/lib/<name>.ts` with an inline `llm({...})` body via `cat > <<EOF` can call `df.lib.<name>(input)` on the same session and receive a typed result. The result envelope reports `mode: "llm-backed"` and `cost.llmCalls ≥ 1`.
- [ ] An agent who writes `/lib/skills/<name>.md` and a function with `body: agent({skill: "<name>"})` gets a typed result, and `cat /lib/skills/<name>.md` shows the markdown source.
- [ ] LLM API key reads occur only on the data plane; the agent client carries no `ANTHROPIC_*` env vars.
- [ ] The four agents in `.flue/agents/` are either deleted or repurposed as plain prompt templates loaded by the SDK; the host's three near-duplicate copies of `runFlueJson` are gone.

### Phase 5: Async observer crystallises a /lib/ function from a trajectory

**User stories** — Agent persona §3 Turn 5 (Coming back the next day), where `ls /lib` shows a function the observer crystallised from yesterday's trajectory, `man <name>` describes it, and `df.lib.<name>(...)` is callable directly.

**What to build.** An asynchronous observer worker (in-process scheduler in MVP, no separate process required) reads completed trajectories, looks for templates whose call graph and parameter shape suggest a parameterised function, and persists the result as `/lib/<name>.ts` authored through `fn({...})`. The codification step reuses the existing observer's prompt and the in-process Flue session from Phase 4. The crystallised function carries an `intent`, `examples` (the originating trajectory's input becomes the first example), `input` and `output` schemas, and a composition or LLM-backed body. The worker is conservative: only proposes crystallisation when the trajectory looks complete and the call graph is plausible. The matcher / fingerprint-hash short-circuit of the current prototype is gone — the second asking finds the function by `df.lib.<name>` lookup, which is a property of the file system, not a separate code path.

**Acceptance criteria.**
- [ ] After a successful novel-mode snippet completes, the observer asynchronously writes a `/lib/<name>.ts` file authored through `fn({...})`.
- [ ] The new file passes `man <name>` rendering and contains the originating trajectory's input as one of its `examples`.
- [ ] `apropos <related-keyword>` returns the new function with a non-zero relevance score.
- [ ] No `procedures/` directory is written. No FNV-1a question fingerprinting is invoked. Crystallisation is file-writing into `/lib/`.
- [ ] If the trajectory is incomplete or the call graph is implausible, no crystallisation occurs and the trajectory is left as-is. The MVP's heuristic for "implausible" is documented in code.

### Phase 6: Replay, side-by-side cost panel, demo script

**User stories** — User persona §2's full happy path, where the first call has `mode: "novel"` / `tier: 4` / non-zero `cost.tokens.cold`, the second has `mode: "interpreted"` / `tier: 2` / `cost.tokens.cold = 0`; agent persona §3 Turn 5's "Observer crystallised the pattern from yesterday."

**What to build.** A demo CLI that runs the headline two-question scenario end-to-end and prints both Result envelopes side by side. The first question (e.g. table-math on chemicals revenue range) is novel; the agent's snippet composes primitives, the trajectory is recorded, and the observer crystallises a `/lib/<name>.ts`. The second question (the same intent shape on coal) calls `df.lib.<name>` directly through the agent's snippet. The CLI prints `value`, `mode`, `tier`, `cost.tokens.{hot,cold}`, `cost.ms.{hot,cold}`, `cost.llmCalls`, `provenance.functionName`, and `provenance.trajectoryId` for both calls and explicitly highlights the diff. A no-cache flag re-runs Q2 with `/lib/` cleared so the cold-path-always-works property is also visible.

**Acceptance criteria.**
- [ ] `pnpm datafetch demo --mount finqa-2024 --tenant <id>` runs both questions end-to-end without manual intervention.
- [ ] Q1's envelope shows `mode: "novel"`, `cost.tier == 4`, `cost.tokens.cold > 0`, `cost.llmCalls > 0`.
- [ ] Q2's envelope shows `mode: "interpreted"`, `cost.tier <= 2`, `cost.tokens.cold == 0`, `cost.llmCalls == 0`.
- [ ] Q2's `provenance.functionName` matches the file the observer wrote in `/lib/` after Q1.
- [ ] Both answers are correct against the FinQA dataset's expected values (verified against fixtures).
- [ ] A `--no-cache` flag re-runs Q2 with `/lib/<name>.ts` removed and shows the snippet falls through to the composition path correctly.
- [ ] The CLI output reproduces the visual structure of `kb/prd/personas.md` §2's "First call → Same intent shape, different params" snippet.

## Files to Modify

The structural change is large — the prototype's procedures-and-matchers spine is removed and replaced with a bash-and-`/lib/` spine. File-level paths are intentionally not enumerated phase-by-phase (the new structure is a green-field rewrite under `src/sdk/`, `src/runtime/`, `src/adapter/atlas/`, `src/bootstrap/`, `src/observer/`, `src/snippet/`, `src/server/`); listing them now would lock in names that are likely to change as the rewrite lands.

| Region | Disposition |
|---|---|
| `src/datafetch/primitives/{registry,capabilities,learned_functions}.ts` | Removed. Functions live in `/lib/<tenant>/<name>.ts` written via `fn({...})`; the registry collapses into bootstrap output and overlay reads. |
| `src/datafetch/db/finqa_*.ts` | Removed. Atlas-specific retrieval code moves into `AtlasMountAdapter.collection().{findExact,search,findSimilar,hybrid}`. FinQA-specific shape lives nowhere — it is sampled and inferred. |
| `src/loader/{loadFinqaToAtlas,setupAtlasSearch}.ts` | Folded into `AtlasMountAdapter.bootstrap()` and `ensureIndex()`. The loader becomes one-shot mount publishing, not a separate ingestion script. |
| `src/procedures/{store,matcher,types}.ts` | Removed. Crystallisation writes `/lib/<name>.ts`; matching is `df.lib.<name>` resolution. The seven `intent`-tagged builders are deleted. |
| `src/agents/{store,learned_store}.ts` | Removed. Agent specs become `/lib/skills/<name>.md` markdown sidecars referenced by `agent({skill})` bodies. |
| `src/planner/{runner,executor,types}.ts` | Removed. The off-script ReAct loop is replaced by the agent's bash session composing primitives directly; gap minting is the agent writing a `fn({...})` file. |
| `src/workspace/{runtime,datafetch,atlasAdapter}.ts` | Removed. The JSONL workspace path is retired; multi-substrate support returns post-MVP via additional `MountAdapter` implementations. |
| `src/runner.ts` | Removed. The single dispatcher with per-intent branches is replaced by the snippet runtime + the bash session. |
| `src/trajectory/recorder.ts` | Adapted. The per-call record format extends to record `df.*` invocations from snippets (not just primitive calls). The per-trajectory envelope absorbs `mode`, `cost`, `provenance` fields. |
| `.flue/agents/*.ts` | Either deleted or repurposed as prompt templates loaded in-process. The standalone CLI executable shape is gone. |
| `src/server/*` | Replaced by the four-route HTTP surface (`/v1/mounts`, `/v1/connect`, `/v1/bash`, `/v1/snippets`) with SSE for warm-up events. |
| `src/cli.ts` | Slimmed to `publish`, `connect`, `agent` (interactive bash), and `demo` subcommands. The current `run`, `endorse`, `eval`, `budget`, `init`, `setup-atlas-search` verbs are subsumed or retired. |
| `web/` | Untouched in MVP beyond what falls out of the API rewrite; UI work is a separate plan. |

## Verification

1. Provider runs `datafetch.publishMount({source: atlasMount({...})})` end-to-end against a clean Atlas database; warm-up SSE stream emits `probing` → `sampling` → `inferring` → `ready`; `/db/finqa-2024/cases.ts`, `_descriptor.json`, `_samples.json`, `_stats.json`, `README.md` all present and well-formed.
2. Agent persona reproduction: a transcript of bash commands matching `kb/prd/personas.md` §3 Turns 1–6 runs without manual escape hatches; the agent's tool list contains exactly one entry; `man`, `apropos`, `cat`, `ls`, `npx tsx`, heredoc-write all work.
3. Function-authoring loop: an agent writes `/lib/<name>.ts` via `cat > <<EOF` with a pure-TS body; `df.lib.<name>(input)` is callable on the next bash command and returns a typed result.
4. LLM-backed loop: an agent writes `/lib/<name>.ts` with `body: llm({prompt, model})`; `df.lib.<name>(input)` returns a result with `mode: "llm-backed"` and `cost.llmCalls ≥ 1`. No subprocess `pnpm exec flue run` is spawned.
5. Skill sidecar loop: an agent writes `/lib/skills/<name>.md` and a function with `body: agent({skill: "<name>"})`; the call resolves and returns a typed result.
6. Crystallisation: a successful novel-mode snippet results in a new `/lib/<name>.ts` file authored via `fn({...})` within an observable async window; the file is documented by `man` and discoverable by `apropos`.
7. Headline demo (R7 in full): `pnpm datafetch demo` runs Q1 and Q2 end-to-end; the cost panel shows (a) the function-name flip from a seed primitive to a `crystallise_*` wrapper, (b) the trajectory call-graph collapse from N entries to a single `lib.<crystallised>` wrapper, (c) `cost.ms.cold` for Q2 ≤ Q1; both answers are correct against fixtures.
8. Cold-path fallback: `--no-cache` re-runs Q2 with `/lib/<name>.ts` removed and shows the snippet falls through to the composition path successfully.
9. Data gravity: agent client invocation does not require `ANTHROPIC_*` or `ATLAS_URI` to be set; only a tenant token. All substrate and LLM credentials live on the data plane.
10. Removal: a `find src -name '*.ts' | xargs grep -l 'StoredProcedure\|LocalProcedureStore\|matchProcedure\|runFlueJson\|parseFlueJson\|runPlannedQuery'` returns no hits in the active source tree.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Scope | Drop cross-tenant promotion from MVP | Scope | Focus | Within-tenant convergence proves the headline; cross-tenant doubles demo work and depends on simulated multi-tenant traffic that is harder to fake honestly. Tracked for follow-up. |
| 2 | Scope | Drop content-addressable pins, drift, verifier replay from MVP | Scope | Focus | The single-session demo never drifts. Pins are valuable for multi-session and multi-tenant flows, both deferred. Adds disproportionate work for headline value. |
| 3 | Scope | Drop the compiled tier from MVP | Scope | Simplicity | `mode: "interpreted"` is a sufficient cost-drop signal. Compiled tier requires per-substrate plan synthesis that only pays back across many crystallised functions. |
| 4 | Scope | Atlas-only adapters in MVP | Scope | Focus | `MountAdapter` interface ships with one implementation; multi-substrate proof can land post-MVP without changing the contract. |
| 5 | Scope | Drop typed `df.query({intent, expect})` polish and per-tenant `.d.ts` regen | Scope | Focus | Agent's bash surface drives the demo. Typed user-SDK ergonomics are a separate plan once the data plane is stable. |
| 6 | Architecture | Add Flue-in-process to MVP scope | Architecture | Coherence | Subprocess Flue produces noisy `cost.llmCalls`/`cost.ms` numbers that muddy the speed-up demo. In-process Flue is also called out by D-017 as the locked target; deferring it would have been a known regression we'd immediately have to undo. |
| 7 | Architecture | Crystallisation writes `/lib/<name>.ts`, not `procedures/<name>.json` | Architecture | Simplicity | Per D-007 and D-011, functions are the unit and `/lib/` is the only mutable region. The current `procedures/` namespace plus per-kind translators is taxonomy this design has dropped. |
| 8 | Architecture | Bash session is single-tenant per session id | Architecture | Data gravity (D-008) | Tenant token resolves to one tenant; one Flue session per tenant; one `/lib/<tenant>/` overlay. Multiplexing tenants in one bash session is a non-feature. |
| 9 | Architecture | `MountAdapter` interface ships with `runCompiled`/`watch`/`ensureIndex` declared but unimplemented | Architecture | Stable contract | Locking the shape now means adding compiled tier and drift handling later requires no interface change. The MVP just no-ops the optional methods. |
| 10 | Architecture | `$DATAFETCH_HOME` falls back to `$ATLASFS_HOME` | Architecture | Migration | Avoids a forced rename of fixture paths during the rewrite. Final rename is a separate cleanup. |
| 11 | Scope | Web UI updates deferred | Scope | Focus | The data-plane API is in flux through this MVP; locking UI to it now would force two rewrites. Schedule UI port once Phase 6 lands. |
