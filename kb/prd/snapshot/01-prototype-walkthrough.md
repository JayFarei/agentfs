---
title: "PRD 001 — Prototype Walkthrough"
summary: "How the current code delivers the elevator pitch, end to end, with concrete file references"
type: prd
status: stable-snapshot
date: 2026-05-04
related: [002-product-design-delta, 003-code-mode-and-intent-routing]
---

# Prototype Walkthrough

The pitch in `kb/elevator.md` describes three tiers (typed module → endorsed trajectory → compiled pipeline) and two dimensions (cross-tenant divergence, within-tenant cost convergence). This PRD maps every load-bearing claim to the file and line where it lives in the current code, and is honest about which pieces are real, stubbed, or absent.

---

## 0. Two front doors, one core vocabulary

Two parallel runtimes share the same vocabulary (trajectory → review → procedure → compiled):

| Runtime | Entry | Data | Where to look |
|---|---|---|---|
| **FinQA / Atlas** (the live pitch) | `src/cli.ts` `demo` / `run` → `src/runner.ts` | MongoDB Atlas + Atlas Search | `src/datafetch/db/*`, `src/procedures/`, `src/planner/` |
| **Local workspace** (the no-Atlas demo) | `src/cli.ts` `init` / `run --local` → `src/workspace/runtime.ts` | JSONL fixtures under `$ATLASFS_HOME` | `src/workspace/runtime.ts` |

`src/cli.ts:201-227` dispatches `run` to whichever path is active. `src/demo.ts` runs the scripted FinQA story.

---

## 1. "Atlas mounted at /datafetch/, each collection a typed TS module"

Implemented as a **path convention**, not a real mount. The `/datafetch/db/` namespace is materialised as hand-authored TypeScript modules whose `module:` field declares the would-be virtual mount path.

- `src/datafetch/primitives/registry.ts:13-149` — every typed callable declares its virtual mount: `module: "/datafetch/db/finqa_cases"`, `"/datafetch/db/finqa_observe"`, etc.
- `src/datafetch/db/finqa_cases.ts` — the typed module for the `finqa_cases` collection. Exposes the elevator's four retrieval interfaces: `findExact`, `search`, `findSimilar`, `hybrid`, plus higher-level helpers (`runRevenueShare`, `runAveragePaymentVolumePerTransaction`).

The lazy-on-read synthesis described in `kb/mental-model.md` is not built; the modules are authored. The **interface contract** is real, the FUSE/NFS layer isn't.

---

## 2. "Audit log captures every typed call"

`src/trajectory/recorder.ts` is the audit log:

- `TrajectoryRecorder.call(primitive, input, fn)` (`recorder.ts:53-69`) wraps every call, capturing `{index, primitive, input, output, startedAt, durationMs}`.
- `recorder.save(baseDir)` writes `trajectories/<id>.json`.

Visible all over `src/runner.ts`: `runTableMathQuery` (line 475) records `finqa_cases.findSimilar → finqa_resolve.pickFiling → finqa_table_math.inferPlan → finqa_table_math.execute → procedure_store.save` as one trajectory.

---

## 3. Hybrid retrieval primitive ($search today, $rankFusion future)

`src/datafetch/db/finqa_search.ts` is the Atlas Search layer:

- `caseSearchIndexModel()` / `unitSearchIndexModel()` (lines 52-91) define the Atlas Search index mappings.
- `searchFinqaCases` (line 143) — direct `$search` over `finqa_cases` with a compound query that boosts question (×8), filename (×4), surrounding text (×3), table (×2).
- `findSimilarFinqaCases` (line 178) — a **two-stage** retrieval: search the granular `finqa_search_units` collection first, then promote to whole cases.
- `setupAtlasSearch.ts` ensures the indexes exist and waits for them to become queryable.

Honest scope: `finqa_cases.hybrid` (registry line 34) currently delegates to lexical search. The README is explicit that `$rankFusion(vectorSearch + search)` is future work; only the **call site** is stable.

---

## 4. The novel-intent path

Two entry points depending on intent shape.

### 4a. Recognised intent families → bespoke chain

`src/runner.ts:runQuery` (the dispatcher around lines 105-422) recognises a handful of intent shapes via predicates in `src/procedures/matcher.ts` (`isTableMathIntent`, `isNegativeOutlookReferencesIntent`, etc.). Each gets a hand-tuned chain. Example — `runTableMathQuery` (`runner.ts:475-521`):

```
finqa_cases.findSimilar  →  finqa_resolve.pickFiling
  →  finqa_table_math.inferPlan  →  finqa_table_math.execute
  →  procedure_store.save  (writes table_math.json + .ts)
```

### 4b. Off-script questions → planner

`src/planner/runner.ts:runPlannedQuery` is the actual ReAct/observer loop. The six-step flow is documented inline at lines 26-33:

1. Pre-fetch a filing (`finqa_cases.findSimilar` + `finqa_resolve.pickFiling`) — context only.
2. `observer.planTrajectory({question, filing, capabilities})` returns an `ExecutionPlan` (`src/planner/types.ts`) plus a list of `MissingPrimitive` gaps.
3. For each gap of `kind: "function"`, call `observer.codifyFunction()` and persist via `LocalFunctionStore` at `functions/<tenant>/<name>.{json,ts}`. Already-known names are reused, not re-codified.
4. Validate every plan step's primitive is reachable (registry ∪ learned functions ∪ learned agents).
5. `runPlan(plan, ctx)` walks `plan.steps`, resolving `JsonRef` bindings (`literal | step | input | array` — `executor.ts:94-118`). Each step is recorded into the trajectory.
6. Crystallise a `planned_chain` procedure (`procedures/store.ts:buildPlannedChainProcedure`) keyed by `fingerprintQuestion(question, filename)` — a normalised FNV-1a hash that strips years/units so siblings collide.

The capability surface is built by `src/datafetch/primitives/capabilities.ts`: registry + tenant's learned functions + tenant's learned agents.

---

## 5. "Endorsements crystallise into procedures/<tenant_id>/<name>.ts"

`src/procedures/store.ts` is the crystallisation step.

- Each intent family has a builder: `buildTableMathProcedure`, `buildNegativeOutlookProcedure`, `buildPlannedChainProcedure`, `buildRevenueShareProcedure`, `buildTaskAgentProcedure`, `buildObserverProcedure`. They all return a `StoredProcedure` (`src/procedures/types.ts`) discriminated by `implementation.kind`.
- `LocalProcedureStore.save` (line 362) writes both `procedures/<tenantId>/<name>.json` (load-bearing) and `<name>.ts` (a cosmetic mirror via `renderProcedureTs`, lines 390-538).
- The `.ts` is real importable TypeScript that calls the typed primitives — this is the elevator's "endorsement is `git add`" claim. The matcher reads JSON; the `.ts` is for humans and `git diff`.

The `StoredProcedure.implementation` union (`types.ts:34-69`) has six kinds, mapping to the three elevator tiers:

| Tier | `implementation.kind` |
|---|---|
| 1: typed primitive (no LLM) | `table_math`, `atlas_aggregation_template` |
| 2: codified observer output | `ts_function`, `agentic_ts_function`, `task_agent` |
| 3: full planner trajectory | `planned_chain` |

---

## 6. "A budget worker compiles each procedure into a single Atlas pipeline"

Two implementations, partial:

- **FinQA path**: `procedures/store.ts:buildAveragePaymentVolumeProcedure` (line 69) emits `kind: "atlas_aggregation_template"` with a literal `pipelineTemplate` of `$match → $project → $project → $divide → $round → $limit` stages. That **is** "single aggregation pipeline, LLM exits the hot path." The pipeline is the same one `mongoAveragePaymentVolume` (`finqa_cases.ts:265`) already runs server-side.
- **Workspace path**: `src/workspace/runtime.ts:budgetWorkspaceProcedure` (line 451) writes `compiled/<tenant>/<proc>.json` with operation/filterField/valueField, stamps `optimisation: {status: "compiled", beforeCost: 3, afterCost: 1}` on the procedure, and the next replay trusts the `verifier.passed` flag to bypass primitives.

Cross-the-board planner-trajectory → aggregation-pipeline compilation is not implemented.

---

## 7. Procedure matching — replay short-circuit

`src/procedures/matcher.ts:matchProcedure` (line 104) is the deterministic fast path. Two modes:

- **Intent-family match**: predicate dispatch (`isTableMathIntent`, etc.) finds the procedure with that `intent` for the tenant. Used for `table_math`, `negative_outlook_*`, `revenue_share`, `document_sentiment`.
- **Fingerprint match for planned chains**: `fingerprintQuestion(question, filename)` (line 88) — same FNV-1a hash used at crystallisation. If a saved `planned_chain` has the same fingerprint, replay it.

When a match hits, `runner.ts:122-340` returns `mode: "procedure"` with one synthetic call `procedures.<name>` and zero new trajectory rows. This is the staircase collapse described in the elevator.

---

## 8. Reusable agents — the second crystal lattice

The negative-outlook path is where the elevator's "agent stays, only glue changes" claim lives:

- `src/datafetch/db/finqa_observe.ts:createAgentPrimitive` is the observer call that mints a `OutlookScorerAgentSpec` (typed input/output schema + prompt) — `src/datafetch/db/finqa_outlook.ts:12-30`.
- `src/agents/store.ts:LocalAgentStore` persists the spec to `agents/<tenantId>/<agentName>.json` and offers `findByCapability` and `findByName`.
- `runner.ts:runNegativeOutlookQuery` (line 716) calls `agentStore.findByCapability("negative_outlook_reference_scoring")` first; only if missing does it call `createAgentPrimitive` + `agent_store.save`.
- The second outlook question (titles/quotes) hits the existing agent and only writes new selection glue via `finqa_observe.codifyTableFunction` — exactly the `Intent 4 → no createAgentPrimitive` line in `kb/DEMO_SCRIPT.md`.

A parallel `LocalLearnedAgentStore` (`src/agents/learned_store.ts`) exists for the planner-driven agent-mint path; the actual Flue dispatch is stubbed with a clear "not yet wired" error in `executor.ts:149-160`.

---

## 9. Two dimensions of adaptation

### Dimension 1 — across tenants (L_n)

- Tenant scoping is enforced at the directory layer: `LocalProcedureStore.tenantDir(tenantId)` (`procedures/store.ts:358`), `LocalAgentStore.tenantDir`, `LocalFunctionStore.tenantDir`. Every persisted artefact lives under `<root>/<artifact-type>/<tenant>/`.
- L_n is computed in `src/workspace/runtime.ts:evalWorkspace` (lines 497-513): Jaccard distance between two tenants' procedure-name sets, written to `eval/ledger.jsonl` alongside three baselines (`vanilla_rag`, `static_typed`, `atlasfs`).
- Two simulated tenants (`data-analyst`, `support-analyst`) run on different fixture domains.

### Dimension 2 — within a tenant over time

- First call to a novel intent: full trajectory recorded.
- Second call: matcher short-circuits to one `procedures.<name>` synthetic call.
- Budget compilation: `optimisation.status: "compiled"` + a JSON pipeline next to the procedure. `evalWorkspace`'s `T_n` row drops from 4 → 1 across baselines.

---

## 10. The two demo staircases (FinQA family functions)

Staged in `src/demo.ts` and narrated in `kb/DEMO_SCRIPT.md`:

**Path A — deterministic crystal**
```
Intent 1: chemical revenue range  → mode:novel, 4 primitive calls, saves table_math procedure
Intent 2: coal revenue range      → mode:procedure, 1 call (procedures.table_math)
```
The `table_math` procedure is parametric over row+years (the elevator's "family function").

**Path B — agent + glue split**
```
Intent 3: Visa negative outlook (sentences) → mode:novel, mints scorer agent + glue
Intent 4: Visa negative outlook (titles)    → mode:novel, REUSES agent, only new glue
Intent 5: same titles question               → mode:procedure, 1 call
```
Watch for `agent_store.findReusable` succeeding and `createOutlookScorerAgentSpec` being absent in Intent 4.

---

## 11. Where the elevator overshoots the code (honest scope)

- **No FUSE/NFS mount** — `/datafetch/` is a TypeScript path convention.
- **`findSimilar` is lexical-only** — Atlas Search `$search`, no Voyage embeddings, no `$rankFusion`.
- **Schema fingerprint pin** lives only in the workspace path (`WorkspaceProcedure.schemaPins`) and `checkWorkspaceDrift`. The FinQA `StoredProcedure` doesn't carry one.
- **Aggregation-pipeline compilation** only exists for the `atlas_aggregation_template` template; planner-trajectory → pipeline is future work.
- **Three "tenants on the same cluster" with diverging libraries** is shown via the workspace runtime's two-tenant fixtures + L_n in the eval ledger; the live FinQA path uses one default tenant (`financial-analyst`).

---

## 12. Suggested reading order

1. `src/datafetch/primitives/registry.ts` — typed surface area in one screen.
2. `src/trajectory/recorder.ts` — what an audit-logged call looks like.
3. `src/runner.ts` — the dispatcher; trace one branch (e.g. `runTableMathQuery`).
4. `src/procedures/store.ts` + `types.ts` — what a crystallised procedure is.
5. `src/procedures/matcher.ts` — how the next call short-circuits.
6. `src/planner/{types,runner,executor}.ts` — the off-script ReAct loop.
7. `src/workspace/runtime.ts` — the no-Atlas mirror, plus L_n + drift + budget.

The strongest single file for the pitch is `src/procedures/store.ts` — its `StoredProcedure` union shows the three tiers, and `renderProcedureTs` is the literal "endorsement is `git add`" artefact.
