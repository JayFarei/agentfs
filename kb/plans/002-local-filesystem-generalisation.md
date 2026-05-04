---
title: "feat: Local Filesystem Generalisation"
summary: "Complete the AtlasFS product-design scope against a self-contained local filesystem runtime, with dataset-specific logic moved behind adapters."
type: feat
status: completed
date: 2026-05-02
related_research:
  - kb/product-design.md
  - kb/scenario.md
  - kb/plans/001-mongodb-search-milestone.md
---

# Local Filesystem Generalisation

## Overview

This plan completes the `kb/product-design.md` scope for a local-first prototype:
typed `/datafetch/` discovery, hooks, trajectory capture, review, crystallisation,
verification, optimisation, drift, evals, and CLI/web clients. The simplifying
runtime is a self-contained filesystem workspace under `ATLASFS_HOME`; Cloudflare,
Durable Objects, Vercel, Atlas, and Atlas Search remain adapter/deploy concerns,
not prerequisites for the local loop.

The end state is that a blank directory can be initialized, loaded with a corpus,
queried, reviewed, evolved, evaluated, and replayed without hidden state outside
that directory. FinQA becomes the first dataset adapter, not the shape the core
runtime is hardcoded around.

## Problem Frame

The current prototype proves the adaptive retrieval loop, but the proof is still
too tightly coupled to the FinQA demo corpus, the Alice/Bob UI shape, and a live
Atlas data plane. That creates three problems for the hackathon build:

- The local test path is brittle because several commands still assume
  `data/FinQA` exists in the repo checkout.
- The product claim is broader than the implementation: AtlasFS is meant to
  crystallise tenant-specific query shapes over arbitrary document collections,
  but the core runner still imports FinQA types and dispatches through
  FinQA-named primitives.
- The demo story depends on portability. A judge or teammate should be able to
  initialize a blank workspace, load a tiny corpus, watch procedures and agents
  emerge, reset it, and replay the result without hidden state in Atlas, `.env`,
  or prior `.atlasfs` files.

This plan turns the live FinQA milestone into the first adapter-backed corpus
while keeping the local loop self-contained. The near-term goal is not to remove
MongoDB from the product; it is to make the local filesystem contract complete
enough that Atlas, Cloudflare, and Vercel can reconnect as deploy adapters
without defining the runtime shape.

## Current Prototype Snapshot

What is already real:

- The CLI entry point exists in `src/cli.ts` with `load-finqa`, `setup-search`,
  `atlas-status`, `demo`, `run`, `review`, and `endorse`.
- The runner records typed calls and persists local trajectories and procedures
  under `.atlasfs`.
- The current demo proves FinQA-shaped procedure reuse, multi-turn review,
  observer-generated TypeScript glue, and reusable agent primitives.
- Recent work adds the first off-script planner loop: the observer can emit an
  `ExecutionPlan`, identify missing deterministic function primitives, codify
  those functions, save them under `.atlasfs/functions/<tenant>/`, execute them
  via `runPlan()`, and crystallise a `planned_chain` procedure.
- The repository currently has checked-in Flue agents under `.flue/agents/`.
  Some are observer/factory templates, which fits the desired architecture; some
  are hardcoded task/scorer execution agents, which should move behind the
  tenant filesystem boundary.
- The web client is a Vite app over a Hono API, with `/api/state`, `/api/run`,
  `/api/endorse`, and `/api/reset`.
- The API/UI now expose learned deterministic functions next to boot primitives
  and learned agent primitives.
- Atlas is currently live: `pnpm atlasfs atlas-status` reports
  `atlasfs_hackathon`, 8,474 cases, 243,236 search units, and both text indexes
  READY.

Current verification:

- `pnpm test` passes with local filesystem workspace coverage.
- `pnpm typecheck` passes.
- `pnpm --dir web typecheck` passes.
- `pnpm --dir web build` passes.
- `pnpm exec flue build --target node --workspace ./.flue --output /tmp/atlasfs-flue-build-check`
  passes and reports only template/factory agents plus `tenant-agent-launcher`.
- The disposable `ATLASFS_HOME` CLI loop initializes fixture finance/support
  datasets, answers local finance and support queries, promotes a verified
  procedure, replays the sibling query through one call, records budget
  compilation, checks drift, and writes eval rows.
- Missing external `data/FinQA` files no longer break local tests; the FinQA
  loader falls back to committed fixtures for the live adapter tests.

## Delta From Product Design

| Product-design scope | Current prototype | Delta |
|---|---|---|
| Any collection exposed at `/datafetch/db/<coll>.ts` with lazy type synthesis and schema fingerprint | `finqa_cases` is a hand-written primitive; `finqa_search_units` is an implementation detail | Add a generic filesystem-backed collection store plus module synthesizer. |
| Fixed collection primitive surface: `findExact`, `findSimilar`, `search`, `hybrid` | Surface exists only on `FinqaCasesPrimitive` | Move primitives behind a generic `CollectionPrimitive<T>` and adapter registry. |
| Hooks at `/datafetch/hooks/<domain>/<intent>.ts` for novel intents | No hook filesystem or route exists | Add hook storage, matching, and UI/CLI visibility. |
| Host-side intent routing over procedure, hook, and primitive descriptions | Current `matchProcedure()` is predicate/string based and FinQA-specific | Replace with a matcher interface and a deterministic local embedding/scoring fixture first. |
| Per-tenant procedure/agent/trajectory namespace | Local directories exist, but types and web tenants are fixed to Alice/Bob/financial-analyst | Generalize tenant IDs and remove closed unions from public API. |
| Observer can produce new primitives for future searches | Recent diffs add `planTrajectory`, `codifyFunction`, `LocalFunctionStore`, capability snapshots, `runPlan()`, and `planned_chain` replay for stats-style questions | Treat this as baseline; generalize it beyond FinQA, add dedicated tests, route through review/verifier, and remove regex/fingerprint special cases from the core matcher. |
| Observer agents are templates; task agents are tenant files | `.flue/agents/finqa-observer.ts` and factory agents are repo-root templates, but `.flue/agents/finqa-task-agent.ts` and `finqa-outlook-scorer.ts` are hardcoded execution agents | Keep only observer/factory/generic launcher templates in repo `.flue`; persist all minted task-agent prompts, schemas, and chain references under `.atlasfs/agents/<tenant>/` and `.atlasfs/procedures/<tenant>/`. |
| User review is the promotion gate | Some flows auto-save procedures; average-payment endorsement exists; draft review exists for revenue share | Make all promotion explicit: trajectory -> draft -> endorsement -> verifier -> procedure. |
| Verifier replays against shadow input before promotion | Not implemented as a shared gate | Add verifier contract and fixture shadow cases. |
| Optimisation budget compiles promoted procedures to deterministic pipeline | Average-payment has a static aggregation template; generic table math is a procedure wrapper | Add local compilation records and a deterministic executor before Atlas pipeline generation. |
| Schema fingerprint and drift workflow | No generated fingerprints or stale-procedure badges | Add schema fingerprinting over filesystem collections and drift status in state/UI. |
| Eval ledger and two-axis adaptation chart | Scenario tests cover happy paths; no ledger, T_n/D_n/R_n/I_n/L_n computation | Add local eval tasks, metric ledger, divergence computation, and web rendering. |
| Full corpus: BIRD + FinQA + supply-chain | Only FinQA loader and demo paths exist | Define corpus adapters; ship tiny fixture corpora for tests and optional full-corpus importers. |
| Cloudflare DO and Atlas as runtime substrate | Local Hono/Vite plus Atlas data plane | Local filesystem runtime first; Atlas and Cloudflare become adapters after parity. |

## Requirements Trace

- R1. A blank `ATLASFS_HOME` can be initialized and run using only files under
  that workspace, with no dependency on `data/FinQA`, `.env`, Atlas, or prior
  `.atlasfs` state.
- R2. Core runtime code does not mention FinQA collection names, FinQA row labels,
  Alice/Bob tenants, or demo question strings outside dataset/demo adapters and
  tests.
- R3. A corpus adapter can register at least two collections with different
  shapes, and `/datafetch/db/<collection>.ts` is synthesized lazily with
  `SCHEMA_VERSION`, inferred types, examples, and the fixed primitive surface.
- R4. `db/` is read-only; `procedures/`, `scratch/`, hooks, trajectories, review
  events, functions, agents, eval ledgers, and generated metadata are stored
  under `ATLASFS_HOME`.
- R5. Novel queries route through procedure match, hook match, then planner
  fallback; repeated endorsed intents replay through one deterministic
  procedure call.
- R6. Every promoted procedure passes verifier replay against at least one
  shadow input; verifier failure records an explicit rejected promotion and does
  not publish the procedure.
- R7. Optimisation turns at least one promoted procedure into a compiled local
  plan with identical verified output and lower recorded trajectory cost.
- R8. Schema drift changes the collection fingerprint and flags dependent
  procedures without deleting them.
- R9. The CLI and web UI expose the same workspace state: data surface,
  procedures, hooks, learned functions, learned agents, trajectories, drafts,
  drift status, and eval metrics.
- R10. The local eval harness records T_n, D_n, R_n, I_n, token or simulated
  token cost, wall time, correctness, evidence completeness, and L_n across two
  tenants.

## Scope Boundaries

- No Cloudflare Worker or Durable Object implementation in this plan.
- No Vercel or public deployment requirement.
- No Atlas dependency for local acceptance tests; Atlas remains an optional data
  adapter after local parity.
- No full BIRD or supply-chain import in the first green path; tiny fixture
  corpora prove generality before heavy imports.
- No broad UI redesign beyond the views required to expose the completed local
  runtime.
- No opaque LLM-only behavior in tests; tests use fixture observer/planner
  runtimes and can opt into Flue/Anthropic separately.

## Context & Research

- `kb/product-design.md` defines the target shape: typed `/datafetch/`
  collection modules, hand-authored hooks for novel intents, reviewed trajectory
  crystallisation, verifier-checked promotion, optimisation budgets, schema
  fingerprints, drift handling, and two-axis adaptation metrics. This plan
  scopes those product requirements to a self-contained local runtime.
- `kb/scenario.md` captures the executable prototype state. It proves
  procedure replay, observer-generated deterministic functions, reusable agent
  primitives, multi-turn review, and FinQA table-math crystallisation from blank
  tenant homes, but all of those paths are still FinQA-shaped.
- `kb/plans/001-mongodb-search-milestone.md` is the implemented live Atlas
  milestone. Its Atlas Search work stays useful, but becomes an optional data
  adapter after the filesystem workspace can pass the same adaptive retrieval
  loop locally.
- The current source tree confirms the remaining coupling: `src/runner.ts`,
  `src/server/state.ts`, `src/review/drafts.ts`, and the web client still carry
  FinQA names, fixed demo tenants, or Atlas/FinQA assumptions in the core path.
- The local acceptance target is the committed fixture corpus, not the full
  external FinQA checkout. Full corpus imports remain valuable for live demos,
  but cannot be required for the green path.

## Architectural Decisions

- **Workspace root**: `ATLASFS_HOME` is the complete runtime boundary. Tests
  always use a temporary workspace.
- **Workspace manifest**: `.atlasfs/workspace.json` records datasets, tenants,
  adapters, schema versions, and enabled local capabilities.
- **Data store**: `.atlasfs/data/<dataset>/<collection>.jsonl` is the first
  backing store. Full corpora can be imported or linked later, but acceptance
  tests use committed fixture corpora.
- **Virtual filesystem**: implement an in-process `DatafetchWorkspace` with
  `list`, `readFile`, and `writeFile` semantics. Real mounts are deferred.
- **Dataset adapters**: FinQA-specific normalization, search-unit creation,
  table math, and demo prompts live under adapter modules. The runner depends
  on dataset-agnostic capabilities.
- **Procedure contract**: procedures are metadata plus TypeScript source under
  `.atlasfs/procedures/<tenant>/`; each records source trajectory, schema pins,
  verifier status, optimisation status, and matcher examples.
- **Learned primitive contract**: observer-minted deterministic functions live
  under `.atlasfs/functions/<tenant>/` and are visible to planning through the
  same capability snapshot as boot primitives. The existing stats fixture is the
  first implementation, but the contract must be dataset-neutral.
- **Flue template boundary**: repo `.flue/agents` may contain only build-time
  observer templates, factory templates, and a generic launcher if Flue needs a
  static entry point. Tenant-created task agents are not repo-root Flue agents;
  their prompts, input/output schemas, provenance, and owning chains live under
  `.atlasfs/agents/<tenant>/` and are invoked by passing the saved spec to the
  launcher.
- **Matcher**: start with deterministic lexical scoring over names, signatures,
  examples, and JSDoc. Keep the interface compatible with embedding-based
  routing later.
- **Verifier**: public interface is `verify(procedure, shadowCase) ->
  pass|fail`; implementation starts deterministic and filesystem-local.
- **Metrics**: eval rows are append-only JSONL under `.atlasfs/eval/ledger.jsonl`.

## Architecture

```text
CLI / WEB API / TEST
        |
        v
  AtlasFS Runtime
        |
        +--> DatafetchWorkspace
        |      db/          read-only synthesized collection modules
        |      hooks/       read-only shared intent scaffolds
        |      procedures/  tenant writable promoted code
        |      scratch/     tenant writable temporary files
        |
        +--> DatasetAdapter registry
        |      fixture-finance
        |      fixture-support
        |      finqa
        |
        +--> EvolutionStore
        |      trajectories / drafts / review-events
        |      procedures / functions / agents
        |      verifier / drift / optimisation / eval
        |
        v
  .atlasfs/
```

## Milestones

1. **Self-contained workspace gate**: Add `atlasfs init`, committed fixture
   corpus files, and a `WorkspaceStore` that makes local tests independent of
   `data/FinQA` and `.env`. *Effort: Short (< 4h)*

2. **Generic data plane and module synthesis**: Implement filesystem collections,
   schema inference, schema fingerprinting, `_samples.json`, `_schema.json`, and
   synthesized `/datafetch/db/<collection>.ts` modules. *Effort: Medium (< 1d)*

3. **Dataset adapter boundary**: Move FinQA-specific loader, table math,
   resolver hints, and demo scenarios behind an adapter interface; add a second
   tiny non-FinQA fixture adapter to prove the core does not depend on FinQA.
   *Effort: Medium (< 1d)*

4. **General matcher and hook path**: Add filesystem hooks, hook/procedure
   matching, and host-side route order: procedure -> hook -> planner fallback.
   *Effort: Short (< 4h)*

5. **Generalise observer-minted primitive execution**: The recent diff already
   wires `planTrajectory`, `codifyFunction`, `LocalFunctionStore`, `runPlan()`,
   and `planned_chain` replay into the FinQA path. Convert that path into the
   dataset-neutral planner fallback: capabilities come from the workspace, plan
   args do not require `FinqaCase`, execution handlers come from adapter
   registrations, and the matcher does not special-case stats regexes or
   filename fingerprints. *Effort: Medium (< 1d)*

6. **Tenant filesystem agent boundary**: Replace hardcoded repo-root task/scorer
   Flue agents with tenant-saved agent specs and, if needed, one generic Flue
   launcher template. Observer/factory agents remain templates; all generated
   task-agent capability lives under `.atlasfs/agents/<tenant>/` and all reuse
   is through chain/procedure files. *Effort: Medium (< 1d)*

7. **Review and verifier as the only promotion gate**: Normalize all novel
   trajectories into drafts, add explicit endorsement/rejection, run verifier on
   shadow cases, and publish only verified procedures. *Effort: Medium (< 1d)*

8. **Optimisation budget and compiled local plan**: Add procedure budget state,
   compile one verified procedure into a deterministic local execution plan, run
   verifier before swap, and surface before/after cost. *Effort: Medium (< 1d)*

9. **Schema drift workflow**: Recompute fingerprints when collection files
   change, flag stale procedures, and expose green/yellow/red status in CLI and
   web state. *Effort: Short (< 4h)*

10. **Eval ledger and two-tenant divergence**: Add `atlasfs eval` over local task
   files, compute T_n/D_n/R_n/I_n/L_n, and render the heatmap/divergence data in
   the web API. *Effort: Medium (< 1d)*

11. **Client parity pass**: Align CLI and web routes around the same local
    contract: query, review, state, reset, eval, drift, and budget. Remove
    hardcoded Alice/Bob state and drive tenants from workspace config. *Effort:
    Medium (< 1d)*

12. **Atlas optional adapter**: Reconnect the existing Atlas Search path as a
    `DataPlaneAdapter` that can hydrate or mirror a filesystem workspace, without
    changing the local runtime contract. *Effort: Medium (< 1d)*

## TDD Verification Plan

Use vertical red-green cycles. Do not write all tests first; each milestone gets
one failing behavior test, the smallest implementation, then the next test.

1. **RED**: `atlasfs init` in a temp dir, then `atlasfs run --local` succeeds
   with fixture corpus and creates only files under that temp dir.
   **GREEN**: workspace manifest, fixture loader, and `WorkspaceStore`.

2. **RED**: reading `/datafetch/db/orders.ts` from a fixture corpus emits
   `SCHEMA_VERSION`, inferred fields, examples, and `findExact/search/hybrid`;
   writing `/datafetch/db/orders.ts` fails with `EACCES`.
   **GREEN**: `DatafetchWorkspace` and synthesizer.

3. **RED**: the same runner answers one fixture-finance task and one
   fixture-support task with no FinQA imports on the core path.
   **GREEN**: `DatasetAdapter` boundary and adapter registry.

4. **RED**: a novel query with a matching hook records that hook in the
   trajectory and follows the suggested primitive chain.
   **GREEN**: hook store and matcher route.

5. **RED**: in a temp filesystem workspace, a novel query over fixture data asks
   for a missing deterministic primitive, receives an observer plan, mints
   `.atlasfs/functions/<tenant>/stats.stddev.{json,ts}`, returns the right
   answer, and a sibling query reuses the learned function without re-codifying
   it. The test must not import FinQA types on the planner path.
   **GREEN**: lift the existing planner/function/runPlan implementation behind
   dataset-neutral capability and executor interfaces.

6. **RED**: a query that requires an LLM task agent creates no new repo-root
   `.flue/agents/<task>.ts` files. Instead it writes the task agent spec under
   `.atlasfs/agents/<tenant>/`, links that spec from the chain/procedure, replays
   through the saved spec, and reset removes the tenant agent file. The repo
   `.flue/agents` directory contains only observer/factory/generic-launcher
   templates.
   **GREEN**: generic Flue launcher plus tenant agent store integration.

7. **RED**: an endorsed trajectory with a passing shadow case publishes a
   procedure; the same trajectory with a failing shadow case records rejection
   and does not appear in `listProcedures()`.
   **GREEN**: verifier and promotion states.

8. **RED**: `atlasfs budget <procedure>` compiles a verified procedure, verifier
   passes, replay uses one compiled call, and metric cost decreases.
   **GREEN**: local compiled-plan store and executor.

9. **RED**: mutating a collection file changes `SCHEMA_VERSION` and marks a
   dependent procedure drifted; adding a new data row with the same shape does
   not.
   **GREEN**: fingerprint cache and drift scanner.

10. **RED**: `atlasfs eval --round 0 --tenant a,b` writes ledger rows and computes
   `L_n` from the two tenants' procedure signature sets.
   **GREEN**: eval runner, metrics, and divergence calculation.

11. **RED**: web API state for a workspace-created tenant contains dynamic
    collections, hooks, procedures, functions, agents, drift, and eval metrics;
    Vite build remains green.
    **GREEN**: API/client parity and UI data binding.

## Files To Modify

| File | Changes |
|---|---|
| `src/cli.ts` | Add `init`, generic `load`, local `eval`, `budget`, `drift`, and workspace flags; keep FinQA commands as adapter shortcuts. |
| `src/runner.ts` | Replace FinQA predicate dispatch with matcher/planner/procedure lifecycle while preserving adapter-specific primitive execution. |
| `src/server/types.ts` | Remove closed tenant union and add hooks, functions, drift, eval, and verifier state. |
| `src/server/routes.ts` | Add local contract routes for query/review/state/eval/budget/drift; keep compatibility aliases as needed. |
| `src/server/state.ts` | Drive tenants, primitives, data collections, and suggested queries from workspace state instead of hardcoded Alice/Bob tables. |
| `src/datafetch/db/*` | Keep FinQA as an adapter implementation; extract generic collection primitive contracts. |
| `src/datafetch/primitives/*` | Finish learned-function and capability registry integration. |
| `src/planner/*` | Wire existing plan executor into the public runner and add tests. |
| `.flue/agents/*` | Keep observer/factory templates only; remove hardcoded task/scorer agents or replace them with one generic launcher that reads tenant-saved specs. |
| `src/agents/*` | Treat tenant-created task agents as filesystem artifacts with prompt, schema, provenance, and chain references. |
| `src/procedures/*` | Add verifier status, schema pins, optimisation state, and generalized matcher metadata. |
| `src/trajectory/recorder.ts` | Add mode, hook/procedure references, parent ids, token/cost fields, and filesystem-only guarantees. |
| `src/review/drafts.ts` | Generalize review drafts beyond revenue-share and make all promotion pass through verifier. |
| `web/src/*` | Replace hardcoded tenant/demo state with workspace-driven state and add drift/eval/budget panels. |
| `tests/*` | Add fixture-corpus, workspace, synthesis, matcher, verifier, budget, drift, eval, CLI, API, and web contract tests. |
| `kb/scenario.md` / `README.md` | Update after the local filesystem loop is green. |

## Verification

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm --dir web typecheck`
4. `pnpm --dir web build`
5. `ATLASFS_HOME=$(mktemp -d) pnpm atlasfs init --fixture all`
6. `ATLASFS_HOME=<tmp> pnpm atlasfs run "..." --local`
7. `ATLASFS_HOME=<tmp> pnpm atlasfs review <draft> --yes --local`
8. `ATLASFS_HOME=<tmp> pnpm atlasfs budget <procedure>`
9. `ATLASFS_HOME=<tmp> pnpm atlasfs drift check`
10. `ATLASFS_HOME=<tmp> pnpm atlasfs eval --round 0 --tenant data-analyst --tenant financial-analyst`
11. Start API and web against the same `ATLASFS_HOME`; verify the UI can run,
    review, replay, reset, show drift, and show eval metrics.

## Completion Audit

Completed on 2026-05-03 against the local filesystem scope in this plan.

| Requirement | Evidence |
|---|---|
| R1 blank workspace | `tests/workspace-local-runtime.test.ts` initializes a temp `ATLASFS_HOME`, runs `atlasfs init --fixture all`, and answers local queries without Atlas, `.env`, or `data/FinQA`. |
| R2 adapter boundary | Core local runtime lives in `src/workspace/*`; FinQA-specific behavior remains in `src/finqa/*`, `src/datafetch/db/finqa_*`, loader/demo adapter paths, and tests. Repo-root Flue task/scorer agents were replaced by `tenant-agent-launcher`. |
| R3 two fixture corpora and typed modules | The workspace manifest registers `fixture-finance/orders` and `fixture-support/tickets`; `DatafetchWorkspace.readFile("/datafetch/db/orders.ts")` verifies `SCHEMA_VERSION`, examples, inferred row type, and fixed primitives. |
| R4 filesystem ownership | Local tests assert generated files under the temp workspace: `data/`, `hooks/`, `trajectories/`, `drafts/`, `functions/`, `procedures/`, and `eval/`. |
| R5 route order and replay | Novel revenue queries record hook/search/sum calls; after review, the beta sibling query replays as `procedures.customer_total_revenue`. Support-ticket queries route through support hook/search/count. |
| R6 verifier gate | `atlasfs review <draft> --yes --local` verifies the beta shadow case before publishing; verifier failure records rejected promotion and does not publish. |
| R7 budget compilation | `atlasfs budget customer_total_revenue --tenant data-analyst` records `beforeCost: 3` and `afterCost: 1`; replay metadata reports compiled status. |
| R8 drift | Appending a same-shape order keeps the procedure current; appending an order with a new field marks it drifted. |
| R9 CLI/web parity | `buildState("alice")` maps to the first workspace tenant and exposes dynamic collections, hooks, procedures, learned functions, drift, and eval metrics; the Vite build is green. |
| R10 eval ledger | `atlasfs eval --round 0 --tenant data-analyst --tenant support-analyst` writes JSONL rows with T_n, D_n, R_n, I_n, simulated token cost, wall time, correctness, evidence completeness, and L_n. |

Verification run:

- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir web typecheck`
- `pnpm --dir web build`
- `pnpm exec flue build --target node --workspace ./.flue --output /tmp/atlasfs-flue-build-check`
- Disposable `ATLASFS_HOME` CLI lifecycle: `init`, local `run`, local `review`,
  procedure replay, `budget`, `drift check`, and `eval`.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Runtime | Make local filesystem the first complete runtime | Architecture | Self-contained proof | The current blocker is missing local data files; all acceptance tests should run from a temp workspace. |
| 2 | Data | Move FinQA behind a dataset adapter | Architecture | Generality | Current core types and matcher are FinQA-shaped; the product claim is arbitrary document-store adaptation. |
| 3 | Storage | Store data, state, generated code, metrics, and drift under `ATLASFS_HOME` | Architecture | Portability | This satisfies the user's filesystem-only requirement and gives deterministic test isolation. |
| 4 | Promotion | Require review plus verifier for every procedure | Product | Trust boundary | The design says procedure correctness is verifier-checked, not LLM-checked. |
| 5 | Matching | Use a matcher interface before embedding services | Scope | Local-first | Deterministic local scoring proves the control flow; Atlas/Voyage embeddings can replace implementation later. |
| 6 | Agents | Keep observer agents as templates and generated task agents as tenant files | Architecture | Filesystem truth | The product claim is that trajectories, primitives, agents, and chains emerge as portable workspace artifacts, not repo-root hardcoded Flue files. |
| 7 | Cloud | Defer Cloudflare and Atlas runtime dependencies | Scope | Momentum | The requested simplifying assumption is local run first; adapters can reconnect after local parity. |
