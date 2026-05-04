---
title: "PRD 002 — Product Design Delta"
summary: "Section-by-section comparison between kb/product-design.md and the prototype, with corners cut called out and ranked"
type: prd
status: stable-snapshot
date: 2026-05-04
related: [001-prototype-walkthrough, 004-substrate-generalisation]
---

# Product Design Delta

`kb/product-design.md` describes the full system. This PRD walks the design top-to-bottom and marks each section: **Design says** / **Prototype does** / **Cut**. At the end it ranks the cuts by how much they bend the pitch.

---

## 1. What it is (the one-paragraph claim)

**Design** — Atlas exposed at `/datafetch/` as virtual TS modules synthesised lazily on read; polymorphic shapes lifted into `oneOf` unions; hand-authored hooks scaffold novel intents; code-mode agent (Pi) writes TS snippets; trajectory crystallises into per-tenant `procedures/`; budget worker compiles each promoted procedure to a single Atlas aggregation pipeline.

**Prototype** — Hand-authored TS modules under `src/datafetch/db/*.ts`. Trajectory is a flat `PrimitiveCallRecord[]` recorded by `src/trajectory/recorder.ts`. Procedures are written to `<root>/procedures/<tenant>/<name>.{json,ts}` by `src/procedures/store.ts`. Compilation exists only as one `atlas_aggregation_template` for `average_payment_volume` and a placebo `optimisation: {status: "compiled"}` flag on the workspace path.

**Cuts**
- No lazy codegen. The `module:` field in `src/datafetch/primitives/registry.ts:13` declares the virtual mount path; nothing resolves it.
- No `oneOf` polymorphism lifting. `src/finqa/types.ts` is one concrete `FinqaCase` shape.
- No `SCHEMA_VERSION` export on the FinQA modules.

---

## 2. Core design principles (eight)

| # | Principle | Status |
|---|---|---|
| 1 | Three tiers (bootstrap / emergent / compiled) | Tier 1 hand-rolled, Tier 2 ✓, Tier 3 mostly stubbed |
| 2 | Schema fingerprint as TS constant, drift detection | **Workspace path only** (`workspace/runtime.ts:626`); FinQA `StoredProcedure` carries no fingerprint |
| 3 | Trajectory IS the procedure (no translate phase) | **Cut.** Per-kind translators in `procedures/store.ts:69-353` extract specific call outputs into a discriminated union |
| 4 | Bindings, not network, inside sandbox | **Cut.** Plain Node process; `src/env.ts` reads `.env` freely; `learned_functions.ts:96` evaluates codified source via `new Function` with full global access |
| 5 | Read-only base, writable delta (CoW overlay) | **Cut.** Tenant scoping is a directory naming convention |
| 6 | Verifier-checked promotion, fail closed | **Workspace path only**. FinQA `endorseTrajectory` writes the procedure with no shadow replay |
| 7 | Pre-registered eval, variance bands | **Cut.** `evalWorkspace` (`workspace/runtime.ts:497`) emits hard-coded T_n/D_n/R_n values per baseline |
| 8 | Per-tenant interface emergence first-class | ✓ structurally. Tenant-keyed dirs across `procedures/`, `agents/`, `functions/`. L_n is computed on the fixture path |

---

## 3. Two dimensions of adaptation

**Dimension 2 (within-tenant cost convergence)** — *holds.* `matcher.matchProcedure` short-circuits a re-asked intent to one synthetic call; the demo's chemical→coal `table_math` replay is the staircase.

**Dimension 1 (cross-tenant library divergence, L_n)** — *partially.* `evalWorkspace` does compute Jaccard distance, but:
- The two tenants on the live FinQA path don't exist; `src/demo.ts` runs only `financial-analyst`.
- Workspace path's two tenants are `data-analyst` (orders) vs `support-analyst` (tickets) — different fixture domains, not the same data plane diverging from intent priors.

**The 2D divergence chart** — not implemented; the eval ledger is a stub.

---

## 4. Bootstrap-to-emergence (the four-step bootstrap)

| Step | Design | Prototype |
|---|---|---|
| 1. Adaptive sampling + `mongodb-schema` inference | Sample N (100→1000), emit interface, presence-frequency JSDoc | **Cut.** No sampling, no inference, no JSDoc |
| 2. Polymorphism lifted into `oneOf` keyed on `kind`/`type`/`_t` | Discriminator detection heuristic | **Cut.** Single concrete types |
| 3. `SCHEMA_VERSION` constant + Change Stream invalidation | sha256 over schema, recomputed on stream event | **Cut on FinQA path; workspace path approximates with on-demand JSONL re-hash** |
| 4. Fixed four-method retrieval surface | All four backed by `$vectorSearch` + `$search` + `$rankFusion` + Voyage rerank | **Surface ✓, implementation cut.** `findSimilar` and `hybrid` both delegate to lexical `$search` |

### Hooks (Decision #17)

**Design** — Hand-authored TS files at `/datafetch/hooks/<domain>/<intent>.ts` with parameter interface + JSDoc derivation chain; ~10–15 for Round 1; matched to user query via embedding cosine.

**Prototype** — Workspace path ships **two JSON hooks** — descriptive metadata, not TS, no derivation chain, never matched. **FinQA path has no hooks at all**; novel-intent dispatch is hard-coded predicates in `src/runner.ts` and `src/procedures/matcher.ts`.

### Primitive modules (Decision #20) — ✓

`src/datafetch/db/finqa_resolve.ts`, `arithmetic.ts`, `document_units.ts`, `finqa_table_math.ts` exist. `pickFiling` and `locateFigure` are flagged `implementation: "future-flue"` in the registry but ship deterministically.

---

## 5. Architecture

**Design** — Vercel + Next.js (UI) → Cloudflare Worker (Flue + Pi in `@cloudflare/sandbox` V8 isolate) → per-tenant Durable Object SQLite + Atlas M10 + Voyage + Anthropic + sibling cron Workers for optimisation + drift.

**Prototype** —
- `pnpm demo` → Hono server on `localhost:5174` + Vite/React UI on `localhost:5173`.
- No Cloudflare Worker, no Durable Object, no `@cloudflare/sandbox`, no `wrangler`.
- No SSE proxy, no MCP adapter, no V8 isolate.
- Per-tenant DO SQLite → flat directories under `$ATLASFS_HOME`.

**Cuts**
- The entire deploy posture (first-90-minutes deploy gate, $25 hosting). Local-only.
- Bindings-not-network unenforced; Node process reads env, network, fs.
- Structural cross-tenant isolation via DO instances. Replaced by directory convention.
- Pi/Flue ReAct with tree-structured trajectory + parallel tool exec. Replaced by flat `TrajectoryRecorder`.
- Sibling cron Workers for optimisation and drift. Both run synchronously in-process (or not at all on FinQA path).

---

## 6. Data flow (eleven stages)

| Stage | Design | Prototype |
|---|---|---|
| 1. Bootstrap | Worker hydrates DO; virtual module resolver registered | Process boot loads MongoDB driver; module paths are `import` statements |
| 2. Discovery | `ls /datafetch/db/`, `cat db/packages.ts` | **Cut.** No filesystem to ls |
| 3. Match check (intent routing) | Embed query, cosine-match against procedure JSDoc; high-confidence skips LLM | **Cut.** Regex/string predicates in `matcher.ts`; planned-chain matcher uses FNV-1a hash |
| 4. Hook lookup → novel ReAct | Embedding match against hooks; agent loads matched hook | **Cut.** No hook lookup; off-script questions go straight to `runPlannedQuery` |
| 5. Hybrid retrieval inside typed call | `$rankFusion(vec, lex)` + optional `voyage-rerank-2.5` | **Cut.** Lexical `$search` only |
| 6. Synthesis | Snippet returns structured payload | ✓ |
| 7. Review prompt | Graph view, green/red coding, three-button decision | Web UI exists; CLI exposes `--confirm/--specify/--yes/--refuse` |
| 8. Crystallisation | Trajectory replayed against shadow input, fingerprints pinned, verifier gates | **FinQA: no verifier, no fingerprint pin.** Workspace: shadow-replay against constant; schema pin via JSONL re-hash |
| 9. Budget allocation | Worker picks pay-out, runs async, swaps body on verifier success | **Cut.** No worker, no async, no body swap |
| 10. Drift handling | Change Stream → fingerprint recompute → ts-morph walk → green/yellow/red | **Cut.** Manual `checkWorkspaceDrift` over JSONL on the workspace path |
| 11. Eval round | Replay task set on three baselines, append metric ledger | **Cut.** Synthetic constants in `evalWorkspace` |

---

## 7. Key components

- **MongoFS** (the novel piece) — *cut.* The "~3 functions: `sample`, `synthesize`, `fingerprint`" don't exist.
- **Hooks** — *largely cut.*
- **Procedure crystallisation pipeline** — *holds*, but with per-kind translators rather than the "trajectory IS the procedure" property.
- **Schema fingerprint + drift workflow** — *cut on FinQA, sketched on workspace.*
- **Eval harness** — *cut.* `evalWorkspace` is a placeholder.
- **Optimisation-budget worker** — *cut.* The two-tier design (primitive-impl improvement → procedure-body compilation) is not built.

---

## 8. Security model

**Design** — V8 isolate, `globalOutbound: null`, bindings only, secrets in AWS SSM, IAM-scoped Lambda role.

**Prototype** —
- No isolate. `learned_functions.ts:96` does `new Function(__args, wrapper)` — same Node VM, full global access. Codified observer source executes with the runtime's full privileges.
- Secrets in `.env` at repo root.
- Verifier shadow-input gate is the workspace fixture comparison only.

**Cut.** Threat model in §Security ("malicious user query exfiltrates secrets via prompt injection… structural defense is bindings-not-network") is unenforced.

---

## 9. Schema / API surface

**Design** — `/datafetch/db/`, `/datafetch/views/`, `/datafetch/hooks/`, `/datafetch/procedures/`, `/datafetch/scratch/`, `/datafetch/_trajectories/`. CLI verbs: `mount`, `branch`, `eval`, `review`, `budget`.

**Prototype** —
- `mount` doesn't exist (no FS).
- `branch` doesn't exist (no DO snapshot).
- `eval` ✓ (writes placeholder rows).
- `review` ✓ (with `--confirm/--specify/--yes/--refuse`).
- `budget` ✓ (workspace path placebo).
- `views/` — no curated query modules.
- `_trajectories/` — trajectories are written but no JSON view path is exposed.

---

## 10. Demo corpus (three-source hybrid)

**Design** — BIRD-SQL subset (~1.5 GB) + FinQA (~36 MB, two collections) + supply-chain micro-set (~10 MB).

**Prototype** —
- BIRD: not loaded. Cross-collection-polymorphism axis is unexercised.
- FinQA: ✓. Two collections per design; **but** the search-units sidecar holds no embeddings (Voyage absent), so the pitched "semantic + lexical" purpose is not delivered.
- Supply-chain: not built.

### Two simulated tenants

**Design** — `data-analyst` and `financial-analyst` with different intent priors over the **same eval set**.

**Prototype** — Workspace path's two tenants run on different fixture domains. FinQA demo runs `financial-analyst` only.

### Worked example (Union Pacific 2017 lease obligations)

**Design** — 8-step chain crystallises into a multi-stage `$match`/`$project`/`$reduce`/`$divide` pipeline.

**Prototype** — `loadLocalDemoCases` loads `UNP/2016/page_52.pdf` for `runRevenueShareQuery`, not lease-obligations. The headline demo uses chemical/coal `table_math` and Visa negative-outlook chains.

---

## 11. Key decisions — status

| # | Decision | Status |
|---|---|---|
| 1, 2 | NFS/AgentFS obsoleted by #15 (DOs) | DOs not built — both NFS and DO paths skipped |
| 3 | MongoFS as only novel infra | **Not built.** Hand-authored modules |
| 4 | Lazy codegen via `readFile` | **Cut.** No resolver |
| 5 | Schema fingerprint as TS constant | **Workspace only** |
| 6 | User-endorsed crystallisation | ✓ |
| 7 | Compile-to-pipeline as v1 budget pay-out | Single instance only; no worker |
| 8 | Pi via Flue | Flue is in `package.json`; deployment target is *not* Cloudflare |
| 9 | Voyage via Atlas Embedding API | **Cut.** No Voyage |
| 10 | Pre-registered intent-clustered eval | **Cut.** Synthetic numbers |
| 11 | Three-baseline comparison | **Cut.** Only "ours" runs; the others are placeholder rows |
| 12 | No DataFetch branding, codename AtlasFS | ✓ |
| 13 | Three-source corpus | **One source built (FinQA)** |
| 14 | Static schema discovery for Round 1 | ✓ (because no dynamic exists either) |
| 15 | `flue build --target cloudflare` for runtime | **Cut.** Local Node only |
| 16 | Custom DO session store + `tool_calls` ETL | **Cut.** Replaced by JSON files |
| 17 | Hand-authored hooks at `/datafetch/hooks/` | **Largely cut** |
| 18 | Embedding-based intent routing | **Cut.** Predicate dispatch + FNV-1a fingerprint |
| 19 | FinQA modelled as nested + sidecar | ✓ |
| 20 | Hand-authored primitive modules as siblings | ✓ |

---

## 12. The cuts ranked by how much they bend the pitch

**Tier A — undermine a load-bearing pitch claim**
1. **No MongoFS / no lazy codegen.** "The novel piece" of the architecture isn't built.
2. **`findSimilar`/`hybrid` are lexical-only.** "Hybrid retrieval, $rankFusion over vector + lex" is the most quoted phrase and the most cut.
3. **No real eval.** Pre-registration was the moat against "p-hacked positive curve"; the ledger is synthetic.
4. **Cross-tenant divergence runs on different domains, not the same data plane.**

**Tier B — important but the demo still tells the story**
5. No budget worker.
6. No verifier on the FinQA path.
7. No drift / Change Streams.
8. No hooks on the live path.
9. No Voyage / multimodal.
10. No `oneOf` polymorphism lifting.

**Tier C — pitch survives, but threat model and ops story don't**
11. No Cloudflare Worker / DO / sandbox.
12. `new Function` runs codified source with full Node privileges.
13. No deploy.

**Tier D — internal-consistency claims that don't quite match**
14. "Trajectory IS the procedure (no translate phase)." We have per-kind translators.
15. "Tree-structured trajectory, parallel tool exec." Flat array.

---

## 13. What's left standing — the parts that hold

The observable behaviour the elevator promises is real on the FinQA Atlas path:

- Trajectory recording with per-call audit (`recorder.ts`).
- Per-tenant procedure files written as both load-bearing JSON and human-readable TS (`procedures/store.ts`, `renderProcedureTs`).
- Match short-circuit on the second asking (`matcher.ts:matchProcedure` + `runQuery` early return).
- Reusable agent specs that survive across procedures (`agents/store.ts`, `runNegativeOutlookQuery`).
- Off-script ReAct loop with explicit gap-mint + plan execution (`planner/runner.ts:runPlannedQuery`).
- Generalisation pass observable in real time: agent created in Intent 3, *not* recreated in Intent 4 — exactly the "cost falls one link at a time" claim.

The hackathon proof works. The full product design — MongoFS, $rankFusion, the budget worker, drift Workers, three-source corpus, three-baseline eval — is what would ship next.
