---
title: "Transposable Learnings from the datafetch / AtlasFS Implementation"
date: 2026-05-06
status: live
scope: src/ at HEAD on 004-datafetch-bash-mvp
---

# Transposable Learnings from the datafetch / AtlasFS Implementation

This is a working document of patterns surfaced by reviewing `src/` in full. Each learning describes a choice this codebase made, where to find it, what problem it solves, and the conditions under which it would transfer to another agent-data system. The learnings are organized by layer; cross-cutting meta-patterns sit at the end. Citations point at file:line so future you can verify before lifting. Where the code does not yet match the README's claim, the discrepancy is called out explicitly rather than smoothed over.

---

## Substrate layer (bootstrap, SDK, adapter, Flue)

### S1. Synthesised type stubs as the bridge between an IDE-typed agent surface and a runtime substrate

`<baseDir>/mounts/<mountId>/<coll>.ts` files look like importable TypeScript modules, but they are pure ambient declarations: `export interface <Shape>` plus `export declare const <ident>: CollectionHandle<Shape>` (`src/bootstrap/synthesize.ts:103-117`). The actual `CollectionHandle<T>` is bound at snippet execution time from the in-process `MountRuntimeRegistry`, looked up by ident via `buildIdentIndex()` in `src/snippet/dfBinding.ts:317`. The agent writes code that `tsc` can typecheck against the file on disk; the runtime ignores the file's body and binds handles fresh per snippet.

This is the load-bearing trick for "typed agent code without running the substrate at edit time." It transfers anywhere an agent needs IDE-level types over a remote substrate the framework owns at runtime: write `declare const` stubs to disk, keep the actual handles in a registry, and have the runtime bind on every execution. The contract that makes it work is the ident canonicalization: both the synthesizer and the snippet runtime must share `toIdent()` exactly (`src/bootstrap/idents.ts:7-27`); collisions are resolved with numeric suffixes (`buildIdentMap` lines 47-50) and the inventory is persisted to `_inventory.json` (`src/bootstrap/emit.ts:253-269`).

### S2. Schema fingerprinting with presence bucketing as anti-jitter

`fingerprintDescriptor()` at `src/bootstrap/infer.ts:140-167` produces `sha256:` of a canonical JSON of the schema. The clever bit: presence (the per-field probability that the field is non-null in a sample) is bucketed to 5% increments via `Math.round((f.presence ?? 0) * 20)` before being included in the canonical form (line 149). Two re-samples that differ by a few percentage points on a noisy field still hash identically.

The pattern: when fingerprinting a structural shape derived from sampling, discretize the noisy fields before hashing. The bucket size is the "how much sampling jitter do we tolerate" knob. Atlas's `$sample` is not seedable (`src/adapter/atlas/AtlasMountAdapter.ts:123`), so this isn't a "use a fixed seed" problem; it's a "the sampler is structurally non-deterministic and we still need stable identity" problem. Bucketing solves it without any state.

### S3. Schema pins exist in code but are documentary, not enforced

`SCHEMA_VERSION = "sha256:..." as const` is exported from every synthesised module (`src/bootstrap/synthesize.ts:99`) and stored in `_descriptor.json["@sha256"]`. The `pins: Record<string, string>` field on `DispatchContext` is threaded into `provenance` (`src/sdk/runtime.ts:75`). But no code reads `SCHEMA_VERSION` at execution time and compares it against a live fingerprint; the pin is a string in a file, not an enforced invariant. The mental-model doc and the personas talk about drift detection as a live property; in HEAD it is not.

The transposable lesson is meta: when reviewing a system, separate "the design is here" (a documentary anchor) from "the design is enforced" (a runtime check). Marking documentary fields as such in their own JSDoc prevents future confusion. The other transposable lesson: documentary anchors are still useful, they just need to be labelled as such; do not let a string-on-disk masquerade as a guard.

### S4. The body dispatcher as the SDK's substrate-agnosticism seam

The `fn({...})` factory accepts `body: pure | llm | agent`. For non-pure bodies it calls `getBodyDispatcher().dispatch(body, input, ctx)` (`src/sdk/fn.ts:195-199`); the dispatcher is a module-level singleton set via `setBodyDispatcher()` (`src/sdk/runtime.ts`). The SDK never imports Flue or any other LLM library; only the boot path (`installFlueDispatcher()` at `src/flue/install.ts`) wires them together. If a non-pure body executes without a dispatcher set, `NoBodyDispatcherError` fires.

The pattern: any cross-cutting concern that the SDK should not own (LLM client, telemetry sink, observability shim) gets a setter-getter singleton plus a typed missing-binding error. The substrate-side library declares the shape it expects; the host application wires the implementation at boot. This is dependency injection without a framework, and the missing-binding error is what prevents silent fallbacks at runtime.

### S5. DispatchContext as a mutable shared cost accumulator

`DispatchContext.cost: Cost` (`src/sdk/runtime.ts:55-76`) is a single mutable object shared across every nested `fn()` call within a snippet. Tokens, ms, and llmCalls are additive; tier is `Math.max(prev, observed)`. There is no return-value threading; nested calls just mutate the same object. The dispatcher charges into it on every LLM call (`src/flue/dispatcher.ts:305-310`).

This is the right shape for cost telemetry that needs to roll up across an arbitrary call graph without imposing a return-value protocol on every wrapper. Two preconditions: nested calls must be sequential (not overlapping concurrent), and the accumulator's semantics must be agreed (additive vs max) per field. The pattern transfers to any cross-cut where the producer doesn't know it's being measured. The corollary: never copy the cost object before passing it down; that breaks the rollup.

### S6. Skill loader with per-tenant overlay over a shared seed bundle

`DiskSkillLoader.load(name, tenantId)` (`src/flue/skill.ts`) checks `<baseDir>/lib/<tenantId>/skills/<name>.md` first, then falls back to `<baseDir>/lib/__seed__/skills/<name>.md`. Seeds are mirrored from `<repo>/seeds/skills/` at dispatcher install time (`src/flue/install.ts:90-115`). The reserved `__seed__` tenant id is excluded from agent-facing library listings (`src/paths.ts:18`).

The pattern: when you have shared knowledge that all tenants should see by default and per-tenant knowledge that only that tenant should see, keep them in the same directory shape with a reserved-name shared tier. The resolver always tries the tenant-specific path first; the fallback to `__seed__` is invisible to the agent. This is the same pattern as `/etc/skel` plus per-user home dirs, applied to a content-addressable skill library.

---

## Runtime layer (bash session, snippet runtime, trajectory)

### R1. just-bash as the agent shell substrate, not a custom shell

`BashSession` (`src/bash/session.ts`) imports `Bash, InMemoryFs, MountableFs, Command, IFileSystem` from `just-bash` and delegates `exec()` to it (lines 47, 257-277). The custom commands (`npx`, `pnpm`, `yarn`, `man`, `apropos`) are registered via just-bash's `defineCommand` (lines 399-425). There is zero custom shell parser, no glob handler, no piping logic.

The transposable lesson: when an agent's primary action surface is shell-shaped, lift `just-bash`. You get pipes, redirections, glob expansion, custom commands, and `MountableFs` for free. The cost is one npm dependency. The corollary: don't reimplement bash; the impedance from "model knows bash" to "framework parses bash" is too high to throw away.

### R2. Read-only enforcement at the FS adapter, with real EROFS errors

`ReadOnlyFs` at `src/bash/fs/readOnly.ts` wraps any `IFileSystem`, passes reads through, and rejects every mutation method (`writeFile`, `appendFile`, `mkdir`, `rm`, `cp`, `mv`, `chmod`, `symlink`, `link`, `utimes`) by constructing a real `ErrnoException` with `code: "EROFS"`, `errno: -30`, `syscall: "write"` (lines 127-134). The session applies this at init: each per-mount `InMemoryFs` is wrapped before `MountableFs` mounts it at `/db/<mountId>` (`src/bash/session.ts:355`). `/lib` uses a bare `InMemoryFs` (line 368) and is writable.

The pattern: read-only is a structural property of the adapter, not a doc convention. Throwing the real ENOENT-shaped error means standard tooling (bash itself, error handlers) classifies the failure correctly without special-casing. This is the same pattern Mintlify's ChromaFs uses; documenting it here as the canonical AtlasFS implementation. Transferable wherever an agent reads a substrate but should never write back: wrap the substrate's FS in a tiny adapter that rejects mutations with the right errno.

### R3. Trajectory recording via runtime hook on the `df` proxy, not AST instrumentation

`buildDf({ sessionCtx, dispatchCtx })` at `src/snippet/dfBinding.ts:59` builds the `df` global fresh per snippet. Every `df.db.<ident>.<method>(...)` and `df.lib.<name>(...)` call is wrapped with `trajectory.call(primitiveLabel, input, exec)` so the call is recorded transparently (`src/trajectory/recorder.ts:93-112`). The snippet source is compiled and `await import()`-ed unchanged; `globalThis.df` is patched before the import resolves.

The pattern: instrument by wrapping the global, not by parsing the source. AST instrumentation would require a TypeScript parser, would break on syntax variation, and would not catch dynamic dispatch. Wrapping the global at runtime catches every call by definition because the agent has no way to bypass `df` (the snippet only sees what's in the IIFE scope plus `globalThis`). The corollary: keep `df` the only entry point; if the agent can call the substrate directly, the trajectory misses calls.

### R4. Mode classification post-hoc from the call list

After a snippet executes, `runtime.ts:132-142` (`src/snippet/runtime.ts`) walks the recorded calls. If any primitive matches `lib.crystallise_*`, mode is `"interpreted"`. Otherwise mode is `"novel"` and tier is forced to 4. The agent never declares its mode; the runtime classifies based on what actually ran.

The pattern: trust the trace, not the declaration. The agent may believe it is reusing a learned function; the trajectory tells you whether it actually called one. For any system that wants to measure adherence (R_n, reuse rate, library uptake), classifying after the fact from the call record is honest in a way that asking the agent isn't. The corollary: if you change the prefix convention (e.g., from `crystallise_*` to semantic names), the classifier needs to migrate to a metadata signal (e.g., a frontmatter field on the lib file) rather than a string match. Plan 006 phase 6 calls this out explicitly.

### R5. Trajectory as a self-contained record with `tenantId` as the join key

`TrajectoryRecord` (`src/trajectory/recorder.ts:31-57`) carries the tenant id, the question (first non-empty source line), the full ordered call list, the mode, the cost rollup, the provenance, and the phase (`plan` vs `execute`). Files land at `<baseDir>/trajectories/<id>.json`. There is no external session table joining trajectories to sessions; the session id is implicit through the tenant id.

The pattern: a trajectory record should be self-describing enough to read in isolation. If you need three joins to understand what one row means, the schema is wrong. The cost is one redundant field per record (the tenant id appears in both the session record and every trajectory of that session); the benefit is debuggability and an ergonomic fire-and-forget pipeline.

### R6. Fire-and-forget downstream worker with a Promise map for tests

The snippet runtime saves a trajectory and then fires `onTrajectorySaved(id)` (`src/snippet/runtime.ts:86-218`), which the observer's `install.ts` binds to `(id) => observer.observe(id)`. The observer holds an `observerPromise: Map<string, Promise<ObserveResult>>` capped at 256 entries (`src/observer/worker.ts:69-82`) so tests can `await observer.observerPromise.get(trajectoryId)` without polling.

The pattern: side-effect workers should be fire-and-forget at the producer side; the producer should never wait for the consumer. But the consumer should expose a Promise handle keyed by the same id the producer used, so synchronous tests can introspect without polling sleeps. The cap on the map is critical (insertion-order eviction via `enforceMapCap`, `src/util/bounded.ts`); without it the map grows unbounded.

---

## Crystallisation layer (observer)

### C1. Six-predicate gate as a list, not a function

`gate.ts:54-177` evaluates six independent predicates and returns `{ ok: false, reason: "..." }` on the first failure. Predicates: `phase === "execute"` (or unset, with `crystallisable !== false`); `≥ 2 calls AND ≥ 2 distinct primitives`; no error in the trajectory or in any call output; mode is `"novel"` or `"interpreted"`; no nested crystallisation (no call matches `^lib\.crystallise_`); shape-hash not seen in `readLibrarySnapshot`'s scan; the call chain is substrate-rooted (a `db.*` call returning a list, with at least one downstream `lib.*` call whose input contains a string from the first db output).

The pattern: a gate built as a sequence of predicates, each returning its own reason string, is dramatically more debuggable than one boolean function. When the observer rejects a trajectory in production, the reason field tells you exactly which predicate failed, which is what you need to triage. The list shape also makes it easy to add new predicates without restructuring control flow. Anti-pattern: collapsing all predicates into a single boolean expression to "save lines" loses the explainability.

### C2. Shape hash over canonical step list, NOT over source text

`template.ts:412-440` computes a shape hash via FNV-1a 32-bit (first 8 hex chars) over the canonical step list, where each step is `{ primitive, fields[] }` with field names but **no literal values**. Two trajectories with the same call graph but different query strings hash identically. The hash is embedded in the lib file as a header comment `@shape-hash: <8 hex chars>` (`src/observer/author.ts`), and `readLibrarySnapshot` scans existing files via regex `/@shape-hash:\s*([0-9a-f]{8,})/` (`src/observer/template.ts:540-543`).

The pattern: dedup by structural shape, not source text. A code-hash (PySyft's choice) catches identical source; a shape-hash catches identical shape across paraphrased intents. For a system that learns by observing trajectories, shape-hash is the right key because the agent will phrase the same intent twice with different literal inputs. The corollary: if the user wants source-level dedup as well (e.g., "this exact body is already approved"), add a separate code-hash field; don't try to make one hash do both jobs.

### C3. YAML frontmatter inside a JS block comment

`author.ts:441-477` writes the lib file's metadata as `/* --- ... --- */` wrapping a YAML block. Fields: `name`, `description` (YAML `|` block scalar), `trajectory`, `shape-hash`. The result is a single file that's valid TypeScript (the comment is ignored by the parser) and parseable as YAML by stripping the `/*` and `*/` markers.

The pattern: when you need both the file to run as code and a structured metadata blob to be machine-readable, use a comment-wrapped YAML preamble. This is the same trick Markdown uses with `---` fences; adapted to TypeScript. The cost: a tiny custom parser (or regex) on the read side; the benefit: no separate sidecar file to keep in sync, and the metadata is co-located with the code it describes.

### C4. Trace-shaped naming today is the known weak link

Function names today are `crystallise_${topic}_${shapeHash.slice(0,8)}` (`src/observer/template.ts:141`). `pickTopic` (lines 447-471) picks the first matching primitive in a hardcoded priority list (`lib.executeTableMath`, `lib.inferTableMathPlan`, etc.) and returns a slug. The `intentString` (`src/observer/author.ts:412-415`) is template-rendered: `"reusable learned function for the ${topic} intent shape; internally composes ${seq}"`. No LLM is involved in either.

This is the load-bearing weakness named by plan 006 phase 5: trace-shaped names are not what the model recognises as a useful codebase object when it's looking up apropos. The lesson, transposed: when generating identifiers from observed traces, do NOT use the trace shape as the identifier. The trace shape is the right dedup key (see C2); it is the wrong human-readable name. Names should be intent-shaped (semantic), and intent text should describe the user task shape, not the call graph. If you need an LLM call to do this well, do it once at crystallisation time; the cost is low and the readability win is large.

### C5. Validation by round-tripping through the resolver

After writing the file, the observer calls `LibraryResolver.resolve(name)` (`src/observer/author.ts`) to confirm the file actually parses, exports the right shape, and matches its declared frontmatter. If the resolver fails, the observer either retries via the codifier-skill fallback or aborts crystallisation with an error.

The pattern: validate by using the same code path your consumers will use. The author and the consumer are different processes; the only way to catch a bad file is to read it back the way the consumer reads it. Anti-pattern: parsing the file with a custom validator that diverges from the resolver. The corollary: the resolver's parse logic should be the canonical "is this file valid" answer; everything else is best-effort.

---

## Server / CLI / discovery layer

### SC1. HTTP for stateful work, local filesystem for read-only verbs

The server exposes only what is genuinely stateful: snippet execution, bash session lifecycle, mount publish/teardown, session persistence (`src/server/server.ts:89-107`). The CLI verbs `man`, `apropos`, and `install-skill` are entirely local-filesystem after a single `GET /v1/sessions/:id` call to learn the tenant id (`src/cli/agentVerbs.ts:170-220`). `install-skill` skips the HTTP roundtrip entirely.

The pattern: a CLI verb only needs HTTP if it changes shared state or runs against shared compute. Read-only verbs (search, render docs, copy a file) should be local. The benefit: latency stays low even when the server is on the other side of the network, and the CLI works with the same fidelity offline. The cost: the CLI process needs read access to the same `<baseDir>` the server writes into. Acceptable for a single-machine workflow; bad for a multi-host deployment, where you'd add a thin "fetch this file" route instead.

### SC2. Shared scorer with two thin wrappers, never a parallel implementation

`searchLibrary` lives in `src/discovery/librarySearch.ts:85` and is called identically from the in-VFS bash command (`src/bash/commands/apropos.ts:47`) and the CLI verb (`src/cli/agentVerbs.ts:220`). The scoring is a BM25-flavoured weighted aggregate over five buckets: name (0.9), intent (1.0), description (1.0), examples (0.95), source head (0.55), with a +0.05 tool bonus and a 0.25 cutoff.

The pattern: "the same agent should see the same answer regardless of how it asks." If two surfaces score differently, the agent's choice depends on which path it took, not on the data. The fix is one shared scorer; the entry points are wrappers that supply tenant context and format output. Anti-pattern: two implementations that are "supposed to behave the same"; they diverge within a week. Bonus: when you change the scoring, both surfaces update atomically.

### SC3. df.d.ts as a regenerated idempotent file, triggered at boundaries

`regenerateManifest()` (`src/server/manifest.ts:41`) writes `<baseDir>/df.d.ts` listing every `df.db.<ident>` collection handle and every `df.lib.<name>` function with JSDoc and typed input signatures. The file is left alone if its content hasn't changed (line 53). Triggered: on `/v1/connect` (session creation) AND on every observer authoring (`src/observer/author.ts:121`).

The pattern: agent-facing typed manifests should be regenerated files on disk, not magic modules in some import resolver. The agent's editor can index them, the file is greppable, the diff is reviewable. Idempotent rewrite (no-op if unchanged) means triggering on every boundary is safe. The two triggers (connect and crystallise) cover the "the agent's first session sees current state" and "the agent's next session sees the new function" cases.

### SC4. Three-step active-session resolver

`resolveActiveSession()` (`src/cli/session.ts:81-95`) tries `--session <id>` first, then `DATAFETCH_SESSION` env, then a plain-text file at `<baseDir>/active-session` (written via atomic rename-from-tmp at line 59). The CLI exits with a clear error if all three are empty.

The pattern: any ambient context that a CLI needs but does not own (auth token, active session, preferred environment) should resolve through this three-step priority. CLI flag for explicit override; env var for shell-scope override; on-disk file for ambient default. Atomic rename when writing avoids the half-written file failure mode. The user can always inspect or clear the on-disk file by hand, which is critical for debugging.

### SC5. SSE for long-running bootstrap with observable phases

`POST /v1/mounts` (`src/server/v1mounts.ts:110-147`) returns a real `text/event-stream` emitting `stage`, `inventory`, and `done` events. Stages are: probing, sampling, inferring, synthesising, writing, applying-meta-harness, ready. The bootstrap pipeline (`src/bootstrap/emit.ts:120`) is lazy-started by either consuming `events()` or awaiting `done()`.

The pattern: any long-running job with observable phases is a good fit for SSE. Clients pick the events they care about (status bar, log line, completion gate) without polling. The lazy-start property matters: the server doesn't waste compute if no client is listening. The corollary: design the events as a finite, named stage sequence, not a free-form log stream; clients expect to be able to switch on event type.

### SC6. Stub adapter for offline demo

`src/demo/runDemo.ts` uses `StubMountAdapter` with two hard-coded records when `ATLAS_URI` is missing. Q1 still runs (chemicals revenue → 700), Q2 still runs (coal revenue → 1000), the cost panel still shows mode/tier transitions. The agent can't tell the difference because the substrate adapter contract is the same.

The pattern: every system that depends on a paid or remote service should have an in-process stub that matches the contract. The demo runs without secrets; a new contributor can see the value prop on day zero; tests don't need cloud credentials. The cost is one file with hardcoded data. The benefit is incalculable for onboarding and CI.

### SC7. Skill installation as a file copy, not a runtime registration

`cmdInstallSkill` (`src/cli/installSkill.ts:15-21`) reads `skills/datafetch/SKILL.md` from the repo and copies it to `~/.claude/skills/datafetch/SKILL.md` (default target). `--force` is required to overwrite. No daemon; no central registry; no API call.

The pattern: when integrating with a host system that scans a known directory (`~/.claude/skills/`, `~/.config/...`), installation is just a file copy. Don't build a registration daemon; don't ship a config-merge tool; don't invent a skill protocol. The host scans the dir; you put the file there; you're done. The corollary: prefer hosts that scan known dirs over hosts that require API registration.

---

## Cross-cutting / meta patterns

### M1. Two-substrate split: schema fingerprint vs body dispatch

The system has two substrates that never bleed into each other:

```
+---------------------------- substrate side ---------------------------+
|  bootstrap pipeline: sample, infer, fingerprint, synthesise, write   |
|  per-mount, per-collection, bootstrap-time                           |
|  output: type stubs + descriptors + samples + stats                  |
+----------------------------------------------------------------------+

+----------------------------- runtime side ----------------------------+
|  body dispatcher: pure / llm / agent                                  |
|  per-snippet, per-call, execution-time                                |
|  output: results + cost rollup + trajectory record                    |
+----------------------------------------------------------------------+
```

The SDK provides the seam (`fn({...})` factory, body discriminants, dispatcher singleton). Neither substrate imports the other; both meet at the SDK surface. This split is the architectural reason the bootstrap can be cached and the runtime can be ephemeral; the reason adapters can be swapped without touching dispatchers; the reason the type stubs are stable across model changes.

### M2. Trust the trace, not the declaration

This appears in three places: mode classification (R4), shape-hash dedup (C2), gate predicates (C1). The recurring choice: when the agent's stated intent and the agent's actual behavior disagree, prefer the actual behavior. Names are derived from primitives invoked, not from the question; gates accept or reject based on what the call list contains, not what the snippet meta-claims; reuse is verified by checking whether `df.lib.<name>` was actually called, not whether the snippet imports it.

The transposable lesson: any system that learns by observing should have one source of truth (the trajectory) and treat agent self-report as advisory. The agent may not know what it's doing; the trace says what it did.

### M3. Documentary anchors must be labelled as documentary

`SCHEMA_VERSION = "sha256:..."` exported from synthesised modules; `pins` field threaded into provenance; the README's drift-detection prose. None of these are runtime-enforced. They are anchors for future enforcement and human inspection. The lesson is to label them as such inline, e.g., `// documentary anchor; not enforced at runtime as of 2026-05-06`. Otherwise readers (and reviewers) confuse "the design is here" with "the design is enforced."

The corollary: a lint or test that asserts "every documentary anchor is in the docs index" is cheap insurance against pretending the anchor is a guard.

### M4. Adapter-level invariants beat adapter-aware consumers

EROFS at `ReadOnlyFs` (R2) makes "you cannot write to /db" a structural fact. The consumer (just-bash, the agent, the snippet runtime) doesn't need to know it; the FS adapter rejects writes with the right errno and the standard error-handling paths take it from there. Compare to the alternative: every consumer documents "please do not write here," and you discover the violation only by code review.

The pattern: enforce invariants at the lowest layer that can express them. If the FS can be read-only, make it read-only at the FS, not at every consumer of the FS. If a function must take exactly one asset, encode that in its `InputPolicy`, not in 12 callsite checks. This is the broader form of PySyft's submission-boundary lesson and ChromaFs's EROFS lesson; AtlasFS implements both shapes in different layers.

### M5. The crystallisation pipeline is shape-stable, name-fragile

C2 (shape hash) plus C4 (trace-shaped names) plus R4 (post-hoc classification) reveal a pattern that's currently load-bearing for adherence and badly named for discoverability. The shape side is rock-solid: FNV-1a over canonical steps, dedup by hash, gate by predicate list, the same trajectory shape goes in and the same lib file comes out. The name side is the weak link: `crystallise_${topic}_<hash>` is what the agent sees in apropos and is not what it would recognise as a useful function.

The transposable lesson: separate the dedup key from the human-readable name. Dedup keys should be machine-stable (shape hash, FNV-1a, content hash); names should be human-meaningful (semantic, intent-shaped). Plan 006 phase 5 is about making this split explicit; the dedup logic is fine, only the naming layer needs improvement. When transposing, do not collapse the two; you need both, optimised separately.

### M6. Fire-and-forget producers, observable consumers

R6 plus C1 plus the observer's `observerPromise` map embody this. The producer (snippet runtime) saves a trajectory and forgets; the consumer (observer) picks it up asynchronously; tests can synchronise via the keyed promise map. The producer's latency is unaffected by consumer behaviour. The consumer's correctness is testable in isolation. The bound on the promise map prevents memory leaks.

The pattern: any system with a producer/consumer split where the consumer is slower or optional should be wired this way. The producer fires a function reference (`onTrajectorySaved`); the consumer registers; tests get a Promise handle keyed by the same id. The cap on the introspection map is non-negotiable; without it, long-running processes leak.

---

## What to do with these learnings

These are not project-specific. The intended use is to lift them into the next system you build that has any of: agent code execution, structured retrieval, learned function reuse, typed substrate over a remote DB, multi-tenant overlays. Each learning has a citation; each citation points at a small, isolatable piece of code; each piece of code is a candidate for direct adaptation.

The learnings worth keeping in your head as a checklist when starting a new agent-data system:

1. **Type stubs to disk + handles in registry** (S1). The agent's editor needs types; the runtime needs flexibility; do not conflate them.
2. **Shape fingerprinting with bucketed presence** (S2). If you sample, you will jitter; bucket the noisy fields.
3. **Body dispatcher seam** (S4). Keep the SDK substrate-agnostic; let boot wire the host.
4. **Mutable shared cost context** (S5). Telemetry rolls up via shared object, not return-value threading.
5. **just-bash + EROFS + ReadOnlyFs** (R1, R2). Bash is the right shell; read-only is an adapter property.
6. **Trajectory hooks on the global, not AST instrumentation** (R3). Wrap the entry point; trust the runtime.
7. **Trust the trace** (M2). Agent self-report is advisory; the call list is truth.
8. **Predicate-list gate** (C1). Six small reasons beat one boolean.
9. **Shape hash for dedup, semantic name for humans** (C2, C4, M5). Two keys, optimised separately.
10. **Local CLI verbs over local files** (SC1). Don't HTTP what you don't need to HTTP.
11. **One shared scorer, two thin wrappers** (SC2). Same agent, same answer.
12. **Idempotent regenerated manifest** (SC3). Files on disk over magic modules.
13. **Three-step ambient resolver** (SC4). Flag, env, on-disk.
14. **Stub adapter for offline mode** (SC6). The contract is the contract.
15. **Skill installation = file copy** (SC7). The host scans; you write; done.

The learnings worth not forgetting from the failure mode side:

- **Documentary anchors are not guards** (S3, M3). Label them or enforce them.
- **Trace-shaped names are unfriendly** (C4). Lift the naming step out of the dedup step.
- **Cap your introspection maps** (R6). Or watch them eat memory.

---

## Citations

All file:line references in this document point at the working tree at HEAD on branch `004-datafetch-bash-mvp` as of 2026-05-06. The source-of-truth files are unchanged from the scout reports they were derived from; if a learning's citation goes stale, regenerate from the four-scout review and re-anchor.
