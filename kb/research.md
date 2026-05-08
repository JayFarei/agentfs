---
title: "Datafetch, Research"
type: evergreen
tags: [magic-docs]
updated: 2026-05-07
---

# Research

What we read, what landed in code, what didn't, and what's still open.

The repository under `kb/br/` collects the background-research strands consulted
during the design of `datafetch` (the project's working name for what was once
called "AtlasFS"). This file is not a thematic index of those strands, that
job belongs in the br/ directory itself. This file is about influence and
provenance: which strand contributed what to the shipped MVP, where in the
source tree it shows up, and what each strand left on the table.

The load-bearing claim that emerged from the readings, and that the pitch
adopts verbatim, is this:

> Datafetch does not virtualize the whole dataset. It virtualizes the dataset
> *interface*, then improves that interface from accepted, evidence-backed
> work.

Two strands carry that claim into the code: Voyage AI's code-mode data
interface (br/01) provides the typed-namespace shape, and PySyft's force-
intent-declaration model (br/11) provides the submission envelope that turns
each accepted run into an addressable, dedupable unit. Everything else either
supplies validation, trims scope, or queues an open question.

---

## 1. Strands that landed

### 1.1 Code-mode as the agent surface (br/01)

**Contribution.** Cloudflare's Code Mode pattern, by way of br/01, supplied
the design move that everything else rests on: expose the corpus as a typed
TypeScript namespace, not as a tool catalog. The agent reads
`df.db.<mount>.<coll>` declarations as types it has seen millions of times
in training, writes a snippet that chains calls inside a sandbox, and only
the final result returns to its context. Voyage's API was the example used
to show why a 4-verb surface is ideal for this wrapping; the lesson absorbed
was the wrapping shape, not the Voyage stack.

**Where it shows up.**

- `src/server/manifest.ts` writes `<baseDir>/df.d.ts`, the manifest the
  agent sees. Library entries split into "Learned Interfaces" (frontmatter
  present) and "Primitives"; mounts surface as typed `db.<ident>:
  CollectionHandle` declarations; JSDoc carries description and `@example`.
- `src/sdk/adapter.ts` — the four-method retrieval contract on
  `CollectionHandle<T>` (`findExact`, `search`, `findSimilar`, `hybrid`).
- `src/snippet/dfBinding.ts` — `buildDf()` constructs the `df` global and
  injects it onto `globalThis` before `await import(<file>)`. Every nested
  call accumulates cost and trajectory records on the shared
  `DispatchContext`.

**Adopted.** The typed-namespace shape; the single-snippet entry point
(`POST /v1/snippets`); the discipline that intermediate retrieval results
never enter the model's context.

**Adapted.** Cloudflare uses V8 isolates and `runCode(snippet)` as a single
tool. We use `npx tsx` against a workspace folder, with `Bash(...)` as the
agent's only verb (per the bash-only stance from br/12). The semantic
endpoint is the same; the substrate is plain Node and `just-bash`'s in-
memory filesystem.

**Rejected.** Voyage itself, despite being the canonical example in br/01.
`AtlasMountAdapter.capabilities()` returns `vector:false`. No Voyage SDK in
`package.json`. We adopted the wrapping pattern; not the retrieval stack.

### 1.2 Force-intent-declaration (br/11)

**Contribution.** PySyft's `@sy.syft_function` decorator forces a remote
actor to declare intent before it can run. The submission envelope captures
`raw_code`, `signature`, `input_policy`, `output_policy`, and a `code_hash`;
the runtime refuses to execute anything that did not arrive through it. The
strand's structural argument: the envelope itself, not a separate index,
should be the addressable, dedupable, reusable unit.

**Where it shows up.**

- `src/sdk/fn.ts` — the `fn({intent, examples, input, output, body})`
  factory. Every learned interface in `<baseDir>/lib/<tenant>/<name>.ts` is
  a `fn({...})` call.
- `src/snippet/library.ts` — `DiskLibraryResolver` is the only path by
  which a learned interface gets reached; snippets that bypass the envelope
  cannot reuse anything.
- `src/observer/template.ts` — `shapeHash` (FNV-1a 32-bit hex over the
  canonical step list, primitives plus sorted field-binding kinds, NOT
  literal values) is the dedup key. PySyft hashes literal source; we hash
  the call shape, so two trajectories that differ only in arguments
  collapse to one interface.
- `src/snippet/answer.ts` — `validateAnswerEnvelope()` enforces the commit
  contract (`structuredAnswer`, `valuePresent`, `evidencePresent`,
  `derivationVisible`, `lineagePresent`, `noDefaultZeroFallback`). PySyft's
  policy is "the body cannot read an unbound asset"; ours is "the commit
  cannot crystallise without a sealed `df.answer(...)` envelope."

**Adopted.** The submission envelope as the addressable unit; the runtime-
enforced refusal to execute outside it.

**Adapted.** The `fn` envelope adds `intent` and `examples` explicitly because
the discovery surface (br/12) uses them; PySyft has no description, no
intent text, no examples on its `UserCode` record.

**Rejected.** PySyft's `InputPolicy` / `OutputPolicy` runtime classes and
the per-call data-owner approval gate. The privacy-preserving machinery
that gives PySyft most of its complexity is irrelevant to the hackathon
scope.

### 1.3 Agent Workflow Memory and Stanford APC (br/04, br/05)

**Contribution.** Both validate the central thesis (reusable workflows
induced from successful runs cut cost on similar tasks) but did not
contribute new architecture; they confirmed direction. AWM (br/05) gave us
"induce, integrate, utilize" as the loop name. Stanford APC (br/04) supplied
the keyword-exact-match-beats-semantic-similarity finding (56µs vs 148ms at
10^6 entries) and the cost-asymmetry argument (small LM on hit, large LM on
miss).

**Where it shows up.** The observe-on-save loop in `src/observer/worker.ts`
and `src/observer/gate.ts` mirrors AWM's induce-integrate-utilize.
`src/observer/template.ts`'s `shapeHash` plays the same role as APC's
keyword-extraction: a fast, structural, LLM-free dedup primitive.
`src/observer/author.ts`'s `generatePureSource()` is the analogue of AWM's
single-prompt induction, except it rewalks the typed call list
deterministically rather than asking an LM to summarise.

**Adopted.** The loop, the shape-hash as the LLM-free lookup primitive, the
discipline that successful trajectories are themselves valid workflows.

**Adapted.** AWM stores workflows in prompt context; we store them on disk
as typed TS files. APC keys its cache by an LLM-extracted keyword; we key
by `shapeHash`, no LLM in the lookup path.

**Rejected.** AWM's quality metrics (function overlap, coverage, utility
rate) are not wired into anything. APC's auto-disable-on-low-reuse and
cache-size-knee guardrails are not implemented. The MVP collapses N>=3
convergent trajectories to N=1 (every qualifying trajectory crystallises
immediately, `src/observer/worker.ts:11-19`).

### 1.4 Flue as the agent harness (br/07)

**Contribution.** Flue is a small wrapper around Pi (`@mariozechner/pi-
coding-agent`) that ships a `SandboxApi` integration contract, MCP runtime
adapters, and a multi-provider model registry. The strand's bottom line
was "adopt Flue rather than wiring Pi directly."

**Where it shows up.**

- `src/flue/session.ts` — `FlueSessionPool` constructs a per-tenant
  `FlueAgent` via `@flue/sdk/internal`'s `createFlueContext`. This is the
  data plane's credential boundary (the only file that reads
  `ANTHROPIC_API_KEY` and Codex OAuth token paths).
- `src/flue/dispatcher.ts` — `FlueBodyDispatcher`. Both `llm({...})` and
  `agent({skill})` bodies route through the same `runFlueCall` helper.

**Adopted.** Flue as a library; the session-per-tenant pool; the provider
abstraction that gives us OpenAI Codex / Anthropic / Bedrock plug-and-play.

**Adapted.** br/07 anticipated us running `flue build --target node`. We
did not; we use Flue's `internal` entrypoint inside our own Hono server
(`src/server/server.ts`). No `.flue/agents/` directory, no `flue build`.

**Rejected.** br/07's `bashFactoryToSessionEnv` integration where Flue
drives the bash sandbox. We use `just-bash` directly via `BashSession`.

### 1.5 documentdbfuse and the DB-as-FS trend (br/03)

**Contribution.** br/03 was mainly a negative one: it framed three of our
design decisions as deltas worth defending. Read-only `db/` (sidesteps
documentdbfuse's `echo > existing.json` ENOTSUP bug class), NFS-not-FUSE,
typed-TS-with-fingerprint (raw JSON forces field-name guessing).

**Where it shows up.**

- `src/bash/fs/readOnly.ts` wraps an `IFileSystem`, rejects writes/mkdir/
  rm with `EROFS`. `/db/<mountId>/` is mounted via this wrapper.
- `src/adapter/atlas/AtlasMountAdapter.ts` is read-only; every retrieval
  method is a read.
- `src/bootstrap/infer.ts` emits a deterministic `sha256` fingerprint
  over the canonical sorted descriptor.

**Adopted.** The framing (DB-as-FS for agents is recognised), read-only-
by-default, schema-fingerprint as a first-class persisted artefact.

**Adapted.** documentdbfuse's path-segment aggregation DSL becomes our
typed methods on `CollectionHandle<T>`. Both surface a query language; the
verbs differ.

**Rejected.** The actual NFS / FUSE mount. Despite br/03's recommendation,
the shipped MVP has no kernel-level mount. Files at
`<baseDir>/mounts/<mountId>/` are written to local disk; not virtualized.
The "Atlas mounted at /datafetch/ over NFS" pitch in `kb/elevator.md:7` is
stale.

### 1.6 Browser-harness and agent-edits-its-own-helpers (br/12)

**Contribution.** br/12 is the clearest production reference for the two-
zone separation we already committed to: small protected core, writable
seam where the agent extends its own action space, two-tier library. The
strand also surfaced "The Bitter Lesson of Agent Harnesses" essay's
argument that the harness should let the agent write the missing function.

**Where it shows up.**

- `src/bash/session.ts` and `src/bash/fs/` — the two-zone separation.
  `/db/` is read-only over `MountReader`; `/lib/<tenant>/` is the writable
  overlay in an `InMemoryFs` that flushes to disk before every snippet
  (`flushLib()`).
- `src/observer/author.ts` — `generatePureSource()` is the load-bearing
  authoring path. It rewalks the trajectory's call sequence and emits a
  `fn({...})` file. This is the analogue of "the agent isn't writing new
  code from first principles; it's writing the one function that was
  missing."
- `src/discovery/librarySearch.ts` — a five-bucket BM25-flavoured scorer
  over name, intent, description, examples, and source-head tokens. The
  br/12 strand explicitly warned against regressing to a hostname-prefix
  matcher; we have not.
- The bash-only allowlist in `README.md:46-57`: the agent gets
  `Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)`, no tool catalog.

**Adopted.** The two-zone separation; the writable seam; bash-only allow-
list; the discipline that the agent extends `/lib/<tenant>/` by writing
files (whether by hand or via the observer).

**Adapted.** br/12 noted the stub-as-slot pattern (empty markdown files
declaring what the agent should learn). We have not done this yet, but
the manifest could pre-allocate empty typed-module stubs.

**Rejected.** Browser-harness's prose-plus-Python skill files. Our learned
interfaces are TypeScript with valibot schemas plus YAML frontmatter.

---

## 2. Strands explored but not landed

**Voyage AI as the retrieval stack (br/01, partial).** br/01's wrapping
pattern landed; its embedding/reranking stack did not. `package.json` has
`mongodb` and `@anthropic-ai/sdk`; no Voyage SDK. `vector:false` adapter,
`findSimilar`/`hybrid` delegate to `search`. The strand stays valuable as
a queue of upgrades.

**The compiled tier and `$rankFusion` (br/02, br/04-apc).** The contract
is in the codebase (`MountAdapter.runCompiled`, `CostTier=1` reserved,
`capabilities().compile=true`) but no production code emits or consumes
it. `runCompiled` throws "not implemented in MVP"
(`src/adapter/atlas/AtlasMountAdapter.ts:151`). Tier 2 (substrate or pure
TS), tier 3 (LLM), and tier 4 (novel) ship; tier 1 (compiled) and tier 0
are vacant.

**Filesystem virtualization, FUSE / NFS (br/03, br/12).** br/03's design
recommendations (`--ls-limit`, `.count` virtual file, three-format export)
all assumed an actual kernel mount. We virtualize the *interface* (the
typed `df.*` namespace), not the *bytes*. The closest thing to a mount in
our code is the in-memory `MountableFs` inside `BashSession`.

**SkillCraft / ASI Coding Verifier (br/04-skillcraft).** The proposed
50%-null post-execution quality check is absent. Exec-Rate and Reusing-
Rate metrics are not wired into anything.

**Multi-tenant divergence demo (br/02 Dimension 1, br/04-apc per-tenant
L_n).** The plumbing exists (`tests/observer-multi-tenant.test.ts` proves
it works) but no UI, no metric, no two-pane file-tree visualization. The
shipped demo (`src/demo/runDemo.ts`) is single-tenant.

**Pre-registered eval, variance bands, three-baseline comparison.** The
cost panel rendered by `printCostPanel` in `src/demo/runDemo.ts:578` is
anecdotal: one Q1 run, one Q2 run, gold answers asserted, no variance, no
cluster, no baseline. There is no `eval/` directory.

**User endorsement / human review loop.** br/02, br/04-skillcraft, and
the original `kb/elevator.md:14` argued for it (motivated by *Library
Learning Doesn't*, Berlot-Attwell). The shipped MVP has no endorsement.
`validateAnswerEnvelope` is automated; the gate is mechanical;
crystallisation fires on the first qualifying trajectory. Workspace-HEAD
supersession (commits `8c28f31`, `96a474e`, `d1f87b3`, `8473145`) lets a
later commit overwrite an earlier one with the same shape hash, but
supersession is not endorsement.

**AgentFS as the VFS engine.** br/02 and the queued br/52 recommended
adopting Turso AgentFS. We adopted `just-bash` instead. AgentFS's
`OverlayFS` CoW semantics map to our writable-seam model; in practice an
in-memory `MountableFs` plus mtime-tracked `flushLib()` does enough for
the MVP.

---

## 3. Open questions

**3.1 Legacy plan/execute vs intent workspace.** The codebase ships two
flows: the legacy `plan` / `execute` phased verbs (artefacts under
`<baseDir>/sessions/<sessionId>/{plan,execute}/`) and the intent-workspace
flow (`datafetch mount` + `run` + `commit`, artefacts under a CWD-rooted
`<workspace>/`). Both go through `POST /v1/snippets`; both can crystallise.
The intent-workspace flow is what the pitch describes; the older surface
remains and is exercised by `tests/cli-plan-execute.test.ts`. Open: does
the intent workspace fully replace plan/execute, or do they coexist?

**3.2 `datafetch agent` and `datafetch connect` status.** `datafetch agent`
(`src/cli.ts:247`) is an in-process bash REPL that does NOT go through
HTTP, and `datafetch connect` (`src/cli.ts:232`) is described in code as
a "debug helper, not the real session-create path." The real path is
`datafetch session new` through `POST /v1/connect`. Open: are these
shipping verbs or scaffolds?

**3.3 Crystallisation policy: automatic on validation pass?** Today the
gate is mechanical and crystallisation fires on the first qualifying
trajectory. The strands recommended a human endorsement step. Workspace-
HEAD supersession lets a later commit overwrite an earlier one (you can
correct a bad crystallisation by submitting a better one) but is not
endorsement. **Should the gate require an explicit endorsement event
before promoting `<baseDir>/lib/<tenant>/<name>.ts`?** This is the most
load-bearing open question because the deflation-resistant reuse-rate
story in the pitch depends on the answer.

**3.4 Cross-tenant family-function promotion.**
`MountHandle.on("family-promoted", ...)` is on the contract
(`src/adapter/publishMount.ts:80-95`) but never fires. The "family
functions" story in `kb/elevator.md:60-67` (three intents collapsing to
one parameterised family) is design only. Open: when do we promote a
function from a tenant overlay to a shared family? Who endorses? How does
the typed signature widen?

**3.5 Drift detection on convergent shapes.** `MountHandle.on("drift",
...)` is on the contract but never fires. Schema fingerprints are
computed and persisted (`src/bootstrap/infer.ts`); nothing watches for
fingerprint changes. br/04-apc named schema drift as the silent failure
mode of plan caches; we have the same exposure. Open: what is the
mechanism (Atlas Change Stream signal? polled diff?) and which learned
interfaces are invalidated by what kind of change?

**3.6 Lineage audit surface.** The `result/` directory exists
(`lineage.json`, `validation.json`, `tests/replay.json`, `commits/NNN/`).
The trajectory `<baseDir>/trajectories/<id>.json` exists. None are
surfaced in a browseable way. There is no "who endorsed what, when, with
what evidence" UI. Open: how does an auditor walk from a current
`<baseDir>/lib/<tenant>/<name>.ts` file back through every commit that
contributed to it?

**3.7 Trajectory redaction and size.** Trajectory JSON captures literal
call inputs and outputs with no PII filter, no token redaction, no size
cap. `Provenance.pins: Record<string, string>` exists in the type
(content-addressable pins) and is always defaulted to `{}`. Open: what is
the redaction policy when these trajectories are the audit log of an
enterprise-tenanted system? Pins are the natural seam.

**3.8 Codifier-skill fallback in production.** When `generatePureSource()`
returns null, `authorFunction()` falls back to dispatching the
`finqa_codify_table_function` skill via Flue. Open: does this ever fire
in practice? If no, the dependency on Flue for crystallisation can be
removed and crystallisation becomes LLM-free end-to-end (a stronger
story).

---

## Provenance summary

The strand that contributed the most: **br/01 code-mode-data-interface
plus br/11 force-intent-declaration, taken together.** They are the two
halves of the load-bearing claim (interface, not dataset). The typed
namespace gives the agent a surface; the submission envelope gives the
system an addressable, dedupable, reusable unit. Everything else is
plumbing or validation around that joint.

The strand most surprisingly absent from the code: **br/01's Voyage
retrieval stack.** The wrapping pattern landed; the substance under the
wrapping (Voyage embeddings, reranking, multimodal) did not. We ship a
`vector:false` adapter and lex-only `$search` against Atlas. Every
retrieval upgrade the strand recommended is queued, none implemented.

The most load-bearing open question: **3.3, the crystallisation policy.**
The pitch's reuse-rate story depends on the answer. Automatic
crystallisation is faster to demo but exposed to the *Library Learning
Doesn't* deflation; required endorsement makes the pitch language ("user-
endorsed crystallisation") honest but needs a UI we have not built.
