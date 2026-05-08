---
title: "Datafetch, Roadmap"
type: evergreen
tags: [magic-docs]
updated: 2026-05-07
---

# Roadmap

A truthful map of where datafetch is, what is reserved-but-not-built, and what comes next. The structure is three buckets: **Shipped (MVP)** for the user-runnable surface today, **Reserved but not shipped** for contract surface that exists in types and headers but has no implementation, and **Next** for concrete improvements ordered by leverage.

The product claim, restated: datafetch does not virtualise the whole dataset. It virtualises the dataset interface, then improves that interface from accepted, evidence-backed work. The load-bearing primitive is the audited commit, not the snippet, not the prompt, and not the trajectory. Everything in "Next" is in service of making that primitive richer.

---

## Shipped (MVP)

What an agent can actually do today against a running data plane on `004-datafetch-bash-mvp`. Each item is a thing the user can run end-to-end and watch land on disk.

### The intent workspace

`datafetch mount --tenant <id> --dataset <mount-id> --intent '<text>'` materialises a CWD-rooted folder with `.datafetch/workspace.json`, `scripts/{scratch.ts,answer.ts,helpers.ts}`, `tmp/runs/`, `result/{commits,tests}/`, `df.d.ts`, and symlinks `db/` and `lib/` back to `<baseDir>/mounts/<dataset>` and `<baseDir>/lib/<tenant>`. `AGENTS.md` and `CLAUDE.md` are written into the workspace for orientation. The agent moves through this folder, edits `scripts/answer.ts`, runs `datafetch run` to write notebook-shaped output to `tmp/runs/NNN/`, and then `datafetch commit` to write `result/{answer.json,answer.md,validation.json,lineage.json,tests/replay.json,HEAD.json}` plus an append-only commit at `result/commits/NNN/`. Commit means "this is the final auditable answer for this intent" — it is not a git commit. The append-only commit history plus `HEAD.json` are the workspace's audit primitive: every accepted answer is reproducible from a recorded source plus a recorded substrate access pattern, and the HEAD pointer is the only thing the observer trusts when deciding whether a commit's trajectory is current.

### `df.answer({...})` validation

Validation runs nine gates: `structuredAnswer`, `statusAllowed`, `valuePresent`, `evidencePresent`, `derivationVisible`, `unsupportedHasReason`, `lineagePresent`, `noDefaultZeroFallback`, `hiddenManipulationDetected`. `accepted = blockers.length === 0` and `learnable = accepted` (`src/snippet/answer.ts:128`). The envelope is sealed with a `Symbol.for("datafetch.answer")` brand so the runtime can refuse to crystallise from anything that is not a real `df.answer(...)` return value.

### The bash-loop driver

The shipped agent surface is `claude --bare --allowedTools "Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)"`. No tool catalog. The agent has bash and four allowed verbs. The skill bundle (below) is what teaches it to walk the three-tier reuse hierarchy and author functions in the `fn({...})` shape. `datafetch agent` (in-process bash REPL, does not go through HTTP) exists as an offline mode for hacking on the loop without the server.

### The `fn({...})` factory with semantic learned-interface naming

`fn({intent, examples, input, output, body})` from `@datafetch/sdk` is the only way to author a callable. Body shapes are `pure | llm | agent`; bare functions normalise to `pure`. Validation is valibot on input and output. The factory is in `src/sdk/fn.ts` and the body shapes in `src/sdk/body.ts`. Crystallised functions get semantic names from `pickTopic()`: `rangeTableMetric`, `compareTableMetric`, `ratioTableMetric`, `tableMetric`, `tableMathPlan`, `locateTableFigure`, `filingQuestion`. Shape hash is the dedup key but no longer leaks into the file name. Legacy `crystallise_*` names are still recognised by the gate.

### The cold to warm tier flip on FinQA

`datafetch demo` runs Q1 ("range of chemicals revenue between 2014 and 2018") then Q2 ("range of coal revenue between 2014 and 2018"). Q1 composes four top-level calls (`db.<ident>.findSimilar` then `lib.pickFiling`, `lib.inferTableMathPlan`, `lib.executeTableMath`) and lands as `mode:"novel" tier:4`. The observer crystallises `rangeTableMetric` between Q1 and Q2. Q2 collapses to a single `lib.rangeTableMetric` call and lands as `mode:"interpreted" tier:2`. This flip is pinned by `tests/demo-e2e.test.ts` and is the cost-panel headline.

### Per-tenant `lib/` overlay

Mounts under `<baseDir>/mounts/<mountId>/` are global. Library overlays under `<baseDir>/lib/<tenant>/` are private per tenant. Reserved tenant ids (`__seed__`) hold cross-tenant primitives as re-export shims back to `<repo>/seeds/lib/`. `tests/observer-multi-tenant.test.ts` proves a trajectory's own `tenantId` field decides where its learned interface lands. The observer is not pinned to a tenant in the default `createServer()` path; it routes per-trajectory.

### Trajectory recording into observer crystallisation

Every `df.db.<ident>.<method>` and every `df.lib.<name>` call is recorded as a `PrimitiveCallRecord` with depth, parent, and root. Trajectories land at `<baseDir>/trajectories/<id>.json` with no PII filter, no token redaction, and no size cap (deliberate for hackathon scope). The snippet runtime fires `onTrajectorySaved(id)` after save, the observer reads the trajectory, runs the gate (phase, validation, ≥2 distinct primitives, no error, mode in `{novel, interpreted}`, no learned-interface call already, first call returns a list consumed downstream, shape hash not yet seen), and writes `<baseDir>/lib/<tenant>/<name>.ts`. `df.d.ts` and `AGENTS.md` are regenerated immediately so the next caller sees the new function.

### Workspace HEAD-aware crystallisation

The recent "track intent workspace heads" / "learn from current workspace head" commits (`96a474e`, `d1f87b3`, `8473145`, `8c28f31`) make the observer poll `<workspace>/result/HEAD.json` for up to 2 seconds before deciding whether a commit's trajectory is current. Superseded commits with the same shape hash are rejected as `stale`; current-head commits are allowed to overwrite a previously authored interface. This is what lets a workspace iterate toward a better answer without piling up dead learned interfaces.

### The demo with the cost panel

`datafetch demo [--mount finqa-2024] [--no-cache]` is the load-bearing shipped artefact. The cost panel renders mode, tier, tokens.cold, tokens.hot, ms.cold, ms.hot, llmCalls, function name, and answer with `expected=X actual=X` markers. The call-graph collapse panel shows Q1's four-call chain vs Q2's single call. `assertGoldAnswers` hard-fails on mismatch (700 for chemicals, 1000 for coal).

### The Hono server and session store

`datafetch server` boots `createServer()` (`src/server/server.ts`) with the Hono app over `@hono/node-server`. Routes: `/health`, `/v1/mounts` (POST/GET/DELETE), `/v1/connect`, `/v1/sessions` (GET, GET-by-id, DELETE), `/v1/bash`, `/v1/snippets`. Session records persist as `<baseDir>/sessions/<id>.json`. The CLI's `<baseDir>/active-session` plain-text pointer is the resolution fallback after `--session` flag and `DATAFETCH_SESSION` env. SIGINT/SIGTERM closes mounts cleanly.

### Multi-tenant isolation on a single data plane

A single `createServer()` process serves any number of tenants. Mounts are shared. Library overlays are tenant-private. Sessions bind one tenant to one set of mountIds. `BashSession` instances are cached per-sessionId with a 30-minute TTL and `flushLib()` on eviction. `FlueSessionPool` keeps one persistent Flue agent per tenant, FIFO-evicted at cap 64.

### The `df.d.ts` typed surface

`<baseDir>/df.d.ts` is the Code Mode-style typed manifest. It groups library entries into "Learned Interfaces" (frontmatter present) and "Primitives" (no frontmatter). Mounts surface as typed `db.<ident>: CollectionHandle` declarations. Inline JSDoc carries each function's description block and an `@example` line built from `examples[0].input`. Regenerated on every `/v1/connect` and on every observer `authorFunction`. This is the surface the agent reads to know what is callable.

### Apropos and man

`datafetch apropos <kw>` runs a five-bucket BM25-flavoured scorer (name, intent, description, examples, source-head tokens) over the tenant's overlay and the seed library, returns ranked matches above `SCORE_THRESHOLD = 0.25`, and surfaces frontmatter-bearing tools with a small score bonus. `datafetch man <fn>` renders NAME / SYNOPSIS / INPUT SCHEMA / OUTPUT / EXAMPLES / INVOCATION / SOURCE. These are the agent's discovery primitives before it composes a fresh chain.

### The skill bundle

`datafetch install-skill [--path <dir>] [--force]` copies `skills/datafetch/SKILL.md` (265 lines) to `~/.claude/skills/datafetch/SKILL.md`. The skill teaches the agent the workspace layout, the custom verbs, the three-tier reuse hierarchy (past trajectories then learned interfaces then seed primitives), the "compose your full task in one snippet" rule (fragmented trajectories cannot be learned from), the `df.answer({...})` envelope shape, and the `fn({...})` authoring template via heredoc.

### Test coverage

28 vitest files across SDK, trajectory, snippet runtime, observer (template, gate, author, callshape, derived bindings, multi-tenant, workspace head), bootstrap (idents, infer, workspace memory), bash, server (sessionStore, v1bash, v1connect, v1mounts, v1snippets), CLI (plan-execute, session-narrative), discovery, demo-e2e, paths, util-bounded, flue-skill, adapter-runtime. Smoke harnesses live alongside their modules (`__smoke__.ts` files).

---

## Reserved but not shipped

These appear in the type system, in contract method signatures, in seeded skill files, in the README's deferred list, or in older kb docs. No code path consumes them today. Listed here so contributors can find them without grep, and so the gap between "design surface" and "executed surface" stays visible.

### Compiled aggregation pipeline path (Tier 3 / Tier 1)

`CostTier = 0|1|2|3|4`. The shipped path uses 2 (substrate or pure) and 4 (novel composition) most heavily, with 3 reserved for LLM dispatch through Flue. Tier 1 is reserved for "compiled" — a single Atlas aggregation pipeline that subsumes a typed-call sequence. `Result.mode` includes `"compiled"` and `"cache"` for the same reason. No production code emits these. Tiers 0 and 1 are reserved.

### Atlas aggregation pipeline compiler

`MountAdapter.runCompiled` and `MountAdapter.ensureIndex` are on the contract (`src/sdk/adapter.ts`) but `AtlasMountAdapter.runCompiled` throws "not implemented in MVP" (`src/adapter/atlas/AtlasMountAdapter.ts:151`). `capabilities()` returns `compile:true` as a forward-looking signal but no caller consumes it. The optimisation budget worker that would compile a hot procedure into a single `$rankFusion` aggregate is design only.

### Vector retrieval at query time

`AtlasMountAdapter.capabilities()` returns `vector:false`. `findSimilar` and `hybrid` both delegate to `search` (`src/adapter/atlas/AtlasMountAdapter.ts:307`), which uses Atlas Search compound `$search` queries when an index is detected and falls back to client-side regex+token-overlap otherwise. Voyage is in the dependency wishlist but not pulled in. The bootstrap pipeline detects embedding-shaped fields (role `embedding`) but no retrieval path uses them.

### Drift detection

`MountHandle.on("drift", ...)` is on the contract (`src/adapter/publishMount.ts:80`) but never fires. The bootstrap pipeline computes a deterministic sha256 fingerprint of every collection's descriptor (`fingerprintDescriptor`) and persists it. The reactive path that would re-fingerprint on Atlas Change Stream events and surface stale-pinned learned interfaces is unimplemented.

### Cross-tenant family promotion

`MountHandle.on("family-promoted", ...)` is on the contract but never fires. The "three convergent intents collapse to one parameterised family" story from older kb docs has no implementation. The shipped observer dedupes on shape hash within a single tenant and writes only to that tenant's `lib/<tenantId>/` overlay; nothing cross-promotes.

### N≥3 convergent-trajectories clustering

The design called for the observer to wait for three convergent trajectories before crystallising. The MVP collapses that to N=1: every qualifying trajectory crystallises immediately. Shape-hash dedup is the only convergence gate. See `src/observer/worker.ts:11` and `src/observer/gate.ts:11`.

### User-endorsement / human-in-the-loop review

Older kb docs describe a binary endorsement step before crystallisation, with a small web UI and three review prompts. There is no UI, no endorsement API, and no review verdict on a trajectory. Validation today is automated by `validateAnswerEnvelope` (status, value, evidence, derivation, lineage, no default-zero fallback, no hidden manipulation). On `accepted === true`, crystallisation fires automatically.

### Library divergence metric and two-pane demo

No `L_n` metric is computed anywhere. No two-pane file-tree visual exists. `tests/observer-multi-tenant.test.ts` proves the routing works but no demo or UI surfaces divergence. Single-tenant FinQA is the only shipped demo scenario.

### Pre-registered eval, multi-seed runs, variance bands

No `eval/` directory exists. The cost panel is anecdotal — one run, two questions, hard-coded gold answers. No metric ledger, no multi-seed support, no cluster heatmap, no two-axis divergence chart, no pre-registration commit.

### NFS / FUSE filesystem mount

The "Atlas mounted at /datafetch/ over NFS" pitch from older kb docs is dead. The actual surface is `<baseDir>/mounts/<mountId>/` on local disk plus an in-process `MountableFs` from `just-bash`. AgentFS is not used. There is no real filesystem mount.

### HTTPS, auth, allowlist enforcement

`/v1/connect` returns `dft_<tenant>_<ts>` opaque tokens but they are never validated. No TLS setup. `MountPolicy` exists on the contract but no allowlist is enforced.

### Content-addressable pins

`Provenance.pins: Record<string, string>` and `PrimitiveCallRecord.pin?: string` are in the type and always default to `{}` / undefined. No code path populates them. The intended use is content-addressing the substrate samples a learned interface was crystallised against, for replay-equivalence checks.

### Codifier skill in production use

Five seed skills exist at `seeds/skills/`. Only `finqa_codify_table_function` is referenced from runtime code (the observer's fallback path when pure-composition source generation returns null). The four `mint_*` / `score_*` skills are seeded but never dispatched.

### Browser harness / browser-use integration

Background research only (`kb/br/09`, `kb/br/12`). The architectural pattern (writable seam, two-zone separation) influenced the design but no browser-harness code is integrated.

### OpenTraces dataset publishing

`.opentraces.json` and `.agent-trace/` exist as artefact directories from a separate skill (`.claude/skills/opentraces`). Not part of datafetch's scope.

---

## Next

Concrete next steps, ordered by leverage. Each item names the user-visible behaviour, the rough shape of the change, and the open design question if any. No dates — this is a hackathon project, order is the only commitment.

### 1. Reconcile legacy phased verbs with the intent-workspace shape

The CLI today carries two parallel flows: the legacy `plan` / `execute` / `tsx` verbs (artefacts under `<baseDir>/sessions/<sessionId>/{plan/attempts,execute}/`) and the new `mount` / `run` / `commit` workspace verbs (artefacts under the workspace's `tmp/runs/` and `result/commits/`). Both POST to `/v1/snippets` with different `phase` strings. The observer gate accepts both, but the agent skill bundle and the user-facing pitch only describe the workspace flow. Open question: do we deprecate `plan` / `execute` outright (and migrate `datafetch session narrative` to read from workspaces), keep them as a legacy debug surface, or fold them into the workspace by making `plan` write to a workspace's `tmp/plans/` folder? The cleanest answer reads: workspace flow is canonical, phased verbs become a thin compatibility shim that errors with a pointer to `datafetch mount`. This unlocks simplifying `src/snippet/runtime.ts` artefact writing and removes a layer of conditional logic in the artefact tree.

### 2. Decide the status of `datafetch agent` and `datafetch connect`

`datafetch agent` is an in-process bash REPL using `BashSession` directly without going through HTTP; it is useful for offline mode but is undocumented in the skill bundle. `datafetch connect` is an in-process token+inventory dump, a debug helper that does not actually create a session record (the real path is `datafetch session new` which posts to `/v1/connect`). Open question: do we keep these as labelled debug verbs (rename to `datafetch debug agent` / `datafetch debug connect`), promote `agent` into a first-class offline mode for the demo (so the demo can run without booting `datafetch server`), or remove them? Promoting `agent` to first-class is the most demo-friendly answer because it removes the "two terminals" requirement from the README.

### 3. Persist crystallised functions across sessions with explicit provenance

Today the trajectory file at `<baseDir>/trajectories/<id>.json` holds the call list and the answer; the learned-interface file at `<baseDir>/lib/<tenant>/<name>.ts` holds an `@origin-trajectory:` comment and a YAML `trajectory:` field. There is no index that lets you ask "what trajectories produced this learned interface across its versions" or "which learned interfaces did this trajectory contribute to". A small `<baseDir>/lib/<tenant>/_index.json` (or a SQLite ledger) keyed by shape-hash with versioned entries would make supersession history browsable. This is the foundation for the lineage-browsing item below and for any future endorsement gate.

### 4. Richer commit validation with replay tests

`result/tests/replay.json` is written on every commit but not exercised. The validator checks structural properties of the answer envelope (status, value, evidence, derivation, lineage, no default-zero, no hidden manipulation). It does not re-run the snippet against a frozen version of the substrate. A replay validator that re-imports the committed `source.ts`, dispatches it against a snapshot of the relevant `db.<ident>` results, and asserts the same `df.answer({...})` would close the loop on "auditable answer" — making `commit` mean "this answer is reproducible from these exact substrate reads", which is what the pitch promises. Open question: where does the snapshot live (alongside the commit, or in a content-addressable substrate cache), and how big can the snapshots get before we need eviction.

### 5. Lineage browsing CLI

The artefact tree under `<workspace>/result/commits/NNN/` is rich but invisible without `cat` and `jq`. A `datafetch lineage [--workspace <path>] [--commit NNN]` command that walks `result/commits/` and renders a markdown timeline (timestamp, intent, validation status, learned-interface produced, shape hash, top-level calls) closes the audit story end-to-end. `datafetch session narrative` already does this for the legacy phased verbs; this is the workspace-flow equivalent. Cheap to ship; high demo value because it makes the audit primitive visible without diving into JSON.

### 6. Endorsement gate before promotion

The current pipeline is: validate the answer envelope automatically, then crystallise automatically on `accepted:true`. The reserved-but-not-shipped human-review loop would insert a binary endorsement step between validation and crystallisation. The smallest viable shape: a `datafetch endorse <commit>` verb that flips a `endorsed:true` field on the trajectory, plus an observer gate change that requires `endorsed === true` (or an `auto-endorse:on-validation` flag for backwards compatibility). The bigger version is a small web UI rendering the call graph as a tree; the small version ships first. Open question: does endorsement attach to the workspace HEAD (one endorsement per commit) or to the learned interface (one endorsement per shape hash, accumulating across tenants).

### 7. Cross-tenant family promotion behind a flag

When two tenants independently crystallise the same shape hash (or a near-shape-hash), promote the convergent function to `<baseDir>/lib/__shared__/<name>.ts` with explicit attribution, behind a `DATAFETCH_FAMILY_PROMOTION=1` flag. The shape-hash equality case is mechanical; the near-shape case requires defining a similarity metric over `CallTemplate.steps` (probably a Hamming distance over the canonical step list). Open question: how do we surface `__shared__` functions in `apropos` and `df.d.ts` — do they appear as a separate section above tenant-private learned interfaces, or merged in with a `(shared)` annotation. This item is low priority until at least two tenants are running concurrently in a real deployment.

### 8. Drift detection on convergent shapes

When the bootstrap pipeline re-fingerprints a collection's descriptor and the fingerprint changes, scan `<baseDir>/lib/<tenant>/*.ts` for learned interfaces whose `@shape-hash:` references a step that touches the changed collection. Mark them `status: stale` in the YAML frontmatter. Surface stale interfaces in `apropos` with a yellow flag and downgrade their match score. Open question: when do we re-fingerprint — on `datafetch publish` only, on a scheduled job, or via Atlas Change Streams. Change Streams would be the cleanest signal but pulls in operational complexity. The cheapest first version is "re-fingerprint on every `datafetch publish` and emit a `drift` event on the mount handle" — which makes `MountHandle.on("drift", ...)` actually fire.

### 9. Vector retrieval as a first-class capability

Promote `findSimilar` from a `search` alias to a real vector path when an embedding-role field is detected. This requires an embedding provider (Voyage is the wishlist; OpenAI text-embedding-3-small is a no-extra-credential alternative when `OPENAI_API_KEY` is already set), a `vector_index_<field>` Atlas Search index, and a runtime that knows how to embed the query before issuing `$vectorSearch`. The bootstrap pipeline already detects embedding-shaped fields; the missing piece is the embedding call and the index management. Open question: do we manage the index ourselves (creating it on `datafetch publish` if absent), or document that operators create it once and we read it.

### 10. The compiled tier (the optimisation budget worker)

The most pitchable reserved item. Background task: pick a hot learned interface (one with high invocation count and an LLM-backed inner step), generate a candidate `$rankFusion` / aggregate pipeline that subsumes the typed-call sequence, replay it against shadow inputs, and on success body-swap the function to use `df.db.<ident>.runCompiled(pipeline)` (which would itself need to land). The result envelope flips from `mode:"interpreted" tier:2` to `mode:"compiled" tier:1`, and the cost panel shows the third row of the convergence story. Open question: does the budget worker run as a separate process (background daemon polling trajectory frequency), as a Lambda triggered by an "N invocations of the same shape-hash" threshold, or inline at observer time. The Lambda answer is what older kb docs assumed; the inline answer is what fits the current architecture. This item depends on item 9 (since `$rankFusion` only matters once vector retrieval is real) and on `MountAdapter.runCompiled` being implemented.

---

## What this roadmap does not commit to

No timeline. No "v1.0 in two weeks". No implication that everything in "Next" lands in order — the order is leverage-ranked, not a queue. Items 1, 2, and 5 are cleanup work the codebase wants regardless of demo direction. Items 3 and 4 deepen the audit primitive that the pitch leans on. Item 6 is the human-loop that older kb docs promised. Items 7, 8, 9, 10 are the speculative roadmap and would each be a small project on its own. The honest read is that the MVP shipped the cold-to-warm flip and the audit-on-commit semantics, and everything in "Next" is in service of one of those two primitives — making the warm path richer (3, 6, 7, 9, 10) or making the audit path richer (1, 2, 4, 5, 8).
