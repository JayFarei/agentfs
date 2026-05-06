---
title: "feat: VFS-native discovery and learned function reuse"
summary: "Turn the current bash-shaped workspace into an active virtual filesystem surface where flat /lib fn({...}) files are found, inspected, and reused before agents recompose from primitives."
type: feat
status: proposed
date: 2026-05-05
related_research:
  - kb/br/10-mintlify-chromafs-virtual-filesystem.md
  - kb/plans/005-agent-only-cli.md
  - kb/prd/decisions.md
---

# VFS-native Discovery and Learned Function Reuse

## Overview

Plan 005 proved the server, session, bash, snippet, Flue body, observer, and CLI loop, but exposed the central adherence failure: after a first successful trajectory crystallises into `/lib/<tenant>/<name>.ts`, a future agent still tends to recompose from `/db` and seed primitives instead of calling the existing function.

This plan keeps the chosen product model intact: `/db` is the read-only virtual interface to the underlying dataset, `/lib` is the tenant's mutable flat TypeScript function layer, and every reusable unit is a `fn({ intent, examples, input, output, body })` file. The change is to make the VFS itself an active discovery surface, borrowing the ChromaFs pattern of path manifests, adapter-level read-only enforcement, lazy materialisation, and command-level query optimisation, without introducing a new procedure or steps taxonomy.

## Problem Frame

The issue is not that the VFS idea failed. The issue is that the current VFS surface is too passive. A crystallised function exists as a file, but the agent has weak reasons to choose it over transparent primitive recomposition:

- Generated names are trace-shaped, for example `crystallise_pickfiling_<hash>`, rather than intent-shaped.
- Generated `intent` text is often a call graph, not a user-facing contract.
- `apropos` and `man` expose only a thin slice of the information in the file.
- The in-VFS `apropos` and CLI `datafetch apropos` have separate implementations and diverging scoring.
- Reuse can create second-order crystallised wrappers instead of reinforcing the existing function.
- The acceptance harness asserts that Q2 succeeded, but does not strongly assert that the workspace made reuse the natural path.

Mintlify's ChromaFs brief clarifies the design standard. A VFS is useful when normal agent-native commands are backed by substrate-aware indexes and adapters. `ls`, `cat`, `find`, and `grep` should feel like a filesystem while using the backing store intelligently. For AtlasFS, the backing store is not raw data-as-files. It is the typed interface to Atlas plus the tenant's learned `/lib` layer.

## Requirements Trace

- **R1. Flat function model preserved.** No new `/procedures`, `/steps`, `/workflows`, or visible index hierarchy. Reusable behaviour remains flat `/lib/<name>.ts` files exported with `fn({...})`; Flue/Fluid remains an implementation detail of `body: llm({...})` or `body: agent({...})`.
- **R2. Active VFS discovery.** In both the bash session and the CLI, `apropos`, `man`, `cat /lib/<fn>.ts`, `grep -R ... /lib`, and `df.d.ts` must all point the agent toward the same learned function contract.
- **R3. Shared library search engine.** CLI `datafetch apropos` and in-VFS `apropos` must call one shared scorer that reads `fn` metadata, YAML frontmatter, examples, function name, and bounded source comments.
- **R4. Intent-shaped crystallisation.** Observer-authored functions must get semantic names and user-facing `intent` text derived from the task shape, not from the first internal primitive in the trace.
- **R5. Exact invocation surfaced.** Search results and man pages must include the exact `df.lib.<name>(input)` form, with the best available example input, so the model has a low-friction call path.
- **R6. `/db` read-only enforced at the adapter.** Agent writes to `/db` must fail with EROFS-style errors even though `/lib` remains writable through the tenant overlay.
- **R7. Lazy or manifest-backed mount files.** Large mounted interfaces must be representable by a path manifest and lazy file readers, not by eagerly materialising all raw data. The VFS virtualises the interface, not the dataset.
- **R8. Reuse is reinforced, not nested.** A trajectory that already calls a crystallised `df.lib.*` function must not crystallise into a wrapper that replays primitives and then calls the existing function again.
- **R9. Missed reuse is observable.** The runtime or acceptance harness must flag a novel Q2 trajectory when a high-confidence learned function existed for the same intent.
- **R10. Measurable adherence target.** The headline harness must prove: Q1 creates a learned function; Q2 finds it through the VFS discovery path; Q2 invokes it directly; Q2 does not produce a nested crystallised wrapper.

## Scope Boundaries

- **No hidden auto-router.** The system may warn, rank, and surface exact invocations, but this plan does not silently rewrite arbitrary user snippets to call learned functions.
- **No new procedure taxonomy.** Do not add `procedures/`, `steps/`, or a DAG file format. The reusable unit is still the flat typed function.
- **No raw dataset mirroring.** Do not expose every Atlas document as a virtual file. `/db` exposes typed modules, descriptors, samples, stats, and lazy interface files only.
- **No production RBAC.** This plan can introduce adapter-level read-only enforcement and tenant path pruning shape, but real hosted auth remains out of scope.
- **No compiled tier.** This improves discovery and reuse. It does not compile procedures into Atlas aggregation pipelines.
- **No broad UI work.** The proof stays CLI/bash/harness-first.

## Context & Research

- `kb/br/10-mintlify-chromafs-virtual-filesystem.md`: ChromaFs shows the external pattern: a DB-backed VFS over an existing index, just-bash as shell substrate, a path-tree bootstrap manifest, EROFS read-only adapter, lazy file pointers, and command-level query optimisation.
- `kb/plans/005-agent-only-cli.md`: Current baseline: server, sessions, `datafetch tsx`, `datafetch man`, `datafetch apropos`, Claude Code skill, and tmux acceptance harness.
- `kb/prd/decisions.md`: Locks the product shape: functions are the unit; `/db` immutable and `/lib` mutable; LLM-backed work is `llm({...})` or `agent({skill})` behind the same `fn({...})` contract.

## Architecture

The target surface remains small:

```text
+----------------------------- Agent -----------------------------+
| Bash commands: ls, cat, grep, find, datafetch apropos, man, tsx |
+-----------------------------------------------------------------+
                                |
                                v
+----------------------- datafetch BashSession --------------------+
| /AGENTS.md, /README.md, df.d.ts                                  |
| /db/<mount>/        read-only virtual typed mount surface         |
| /lib/               writable tenant overlay of flat fn TS files   |
| /tmp/               ephemeral session scratch                     |
| custom commands     apropos, man, npx/tsx                         |
+-----------------------------------------------------------------+
                                |
                                v
+----------------------- Shared Discovery Core --------------------+
| librarySearch(query, tenant): RankedFunction[]                   |
| Reads: fn.spec, frontmatter, examples, bounded source comments   |
| Returns: score, kind, why, exact invocation, source path          |
+-----------------------------------------------------------------+
                                |
                                v
+------------------------ Runtime/Observer ------------------------+
| Snippet trajectories, mode/tier envelope, missed-reuse warnings  |
| Observer emits better fn files and skips nested crystallisation   |
+-----------------------------------------------------------------+
                                |
                                v
+-------------------------- Atlas Surface -------------------------+
| MountReader, typed modules, descriptors, samples, stats, Atlas   |
+-----------------------------------------------------------------+
```

### Component responsibilities

| Component | Responsibility |
| --- | --- |
| `src/discovery/librarySearch.ts` | New shared scorer for CLI and in-VFS discovery. |
| `src/bash/commands/apropos.ts` | Thin just-bash command wrapper over shared scorer. |
| `src/cli/agentVerbs.ts` | Thin CLI wrapper over shared scorer; JSON output includes exact invocations. |
| `src/bash/commands/man.ts` | Render frontmatter description, intent, schemas, examples, and source path. |
| `src/server/manifest.ts` | Keep `df.d.ts` aligned with the same function metadata and examples. |
| `src/bash/session.ts` | Mount `/db` through a read-only adapter; prepare for lazy mount files. |
| `src/bash/fs/readOnly.ts` | New small wrapper that delegates reads and throws EROFS on writes. |
| `src/observer/template.ts` | Generate semantic names and skip crystallised calls when extracting new templates. |
| `src/observer/author.ts` | Emit intent-shaped `fn({...})` files with strong frontmatter and examples. |
| `src/observer/gate.ts` | Reject interpreted trajectories that call crystallised tools unless used as reinforcement evidence. |
| `scripts/acceptance/agent-loop.sh` | Assert discovery and direct reuse, not just Q2 success. |

## Milestones

### Phase 1 - Make `/lib` discovery one shared engine

**What to build.** Extract the overlapping `apropos` scoring from the CLI and in-VFS command into `src/discovery/librarySearch.ts`. The scorer reads each `FnSpec`, frontmatter description, example input and output strings, function name tokens, and a bounded source head. Results return:

```ts
type RankedFunction = {
  name: string;
  kind: "tool" | "primitive";
  score: number;
  intent: string;
  description?: string;
  why: string[];
  invocation: string;
  sourcePath: string;
};
```

**Acceptance criteria.**
- [ ] `datafetch apropos --json "range of coal revenue 2014 2018"` returns `matches[0].invocation`.
- [ ] In a bash session, `apropos range coal revenue` and CLI `datafetch apropos ... --json` return the same top match for the same tenant.
- [ ] Frontmatter descriptions and example string values affect ranking.
- [ ] Unit tests cover name-only, intent-only, example-value, and frontmatter-only hits.

*Effort: Short (< 4h).*

### Phase 2 - Upgrade man pages and manifests into executable documentation

**What to build.** Update both `man` renderers and `df.d.ts` generation to show the same contract: user-facing description, exact call shape, input schema, output schema, example invocation, source path, and whether the function is a learned tool or primitive. Keep the TypeScript file itself canonical; generated docs are projections.

**Acceptance criteria.**
- [ ] `man <learned>` includes the YAML frontmatter description when present.
- [ ] `man <learned>` includes a copy-pasteable `df.lib.<name>(...)` example.
- [ ] `df.d.ts` groups learned tools first and includes the same example invocation.
- [ ] Snapshot tests cover the rendered `man` and `df.d.ts` output for a learned tool and a seed primitive.

*Effort: Short (< 4h).*

### Phase 3 - Enforce `/db` as a read-only virtual interface

**What to build.** Add a `ReadOnlyFs` wrapper and mount `/db/<mount>` through it. This makes the current comments true at runtime: `/db` can be listed and read, but writes, appends, mkdirs, deletes, and renames fail. `/lib` remains writable and flushed to disk before `tsx`.

**Acceptance criteria.**
- [ ] `cat /db/<mount>/README.md` still works.
- [ ] `echo x > /db/<mount>/x.ts` fails with an EROFS-style message.
- [ ] `cat > /lib/foo.ts <<EOF ... EOF` still writes and flushes before `npx tsx`.
- [ ] Unit coverage verifies mounted read-only behavior directly.

*Effort: Quick (< 1h).*

### Phase 4 - Add a mount path manifest and lazy-read shape

**What to build.** Introduce a mount-level path manifest for interface files, analogous to ChromaFs's `__path_tree__`, but scoped to typed paths rather than raw data. The manifest names README, collection modules, descriptors, samples, stats, and any future lazy interface leaves. For the MVP it can be stored under `$DATAFETCH_HOME/mounts/<mountId>/_path_tree.json`; later it can move substrate-side.

The immediate code path can remain eager for FinQA, but `BashSession` should depend on the manifest shape so larger mounts can lazy materialise files on `cat`.

**Acceptance criteria.**
- [ ] `ls /db/<mount>` is driven by a manifest shape, not hardcoded collection iteration alone.
- [ ] Existing FinQA mount output is unchanged.
- [ ] A test mount can advertise a lazy file that appears in `ls` and resolves only when read.
- [ ] Manifest entries carry enough metadata for future tenant pruning.

*Effort: Medium (< 1d).*

### Phase 5 - Make crystallised functions intent-shaped

**What to build.** Improve observer output so learned files are useful codebase objects. Keep the body as a flat `fn({...})` composition. Improve:

- name generation: prefer semantic names such as `rangeTableMetric` or `compareMetricAcrossPeriods` over `crystallise_pickfiling_<hash>`;
- `intent`: describe the user task shape, not the internal call graph;
- frontmatter `description`: include "Use when" phrasing for similar intents, not only the exact example;
- examples: preserve the originating question and a compact representative input;
- source comments: include shape hash and provenance without dominating the top of the file.

**Acceptance criteria.**
- [ ] After Q1, the generated function name is semantic enough to match query tokens like `range`, `revenue`, or `metric`.
- [ ] `apropos` finds the generated function using a sibling phrasing that does not exactly repeat Q1.
- [ ] `head -40 /lib/<fn>.ts` gives the agent enough information to decide whether to call it.
- [ ] Existing pure TS, `llm({...})`, and `agent({skill})` body support remains unchanged.

*Effort: Medium (< 1d).*

### Phase 6 - Prevent nested crystallisation and record reinforcement

**What to build.** Change the observer gate/template extraction so a trajectory whose main path calls an existing learned tool is not promoted into a second-level wrapper. Instead, treat that trajectory as evidence for the existing function: append or record an example if the input/output shape is compatible, or leave a reinforcement event in trajectory metadata.

**Acceptance criteria.**
- [ ] Q2 direct tool invocation does not create `crystallise_*` wrapper nesting around Q1's function.
- [ ] The original learned function remains the top discovery result after Q2.
- [ ] Existing shape-hash de-dup tests still pass.
- [ ] New tests cover interpreted trajectories with `lib.crystallise*` and semantic learned tool calls.

*Effort: Short (< 4h).*

### Phase 7 - Add missed-reuse warnings and harness assertions

**What to build.** Make missed reuse observable without creating a hidden router. When a novel trajectory contains query-like literals that score above a high-confidence threshold against an existing learned tool, add a warning to the result envelope, for example:

```json
{
  "code": "learned_function_available",
  "message": "rangeTableMetric matched this intent at score 0.82; consider df.lib.rangeTableMetric(...)"
}
```

Then update the acceptance harness to assert the desired behaviour directly.

**Acceptance criteria.**
- [ ] Q2 prompt requires `apropos`/`man` before composition.
- [ ] Harness fails if Q2 is `mode: "novel"` while a learned function scored above the threshold.
- [ ] Harness fails if Q2 call list lacks the selected `lib.*` function.
- [ ] Harness fails if Q2 creates a nested crystallised wrapper.
- [ ] Harness passes when Q2 finds and invokes the learned function directly.

*Effort: Medium (< 1d).*

## Files to Modify

| File | Changes |
| --- | --- |
| `src/discovery/librarySearch.ts` | New shared search/ranking implementation. |
| `src/discovery/librarySearch.test.ts` | Unit coverage for scoring and rendered invocations. |
| `src/bash/commands/apropos.ts` | Delegate to shared scorer. |
| `src/cli/agentVerbs.ts` | Delegate to shared scorer; richer `--json` output. |
| `src/bash/commands/man.ts` | Render richer executable docs. |
| `src/server/manifest.ts` | Align `df.d.ts` JSDoc with richer function metadata. |
| `src/bash/fs/readOnly.ts` | New read-only adapter wrapper. |
| `src/bash/session.ts` | Mount `/db` through read-only wrapper; consume path manifest shape. |
| `src/bash/mountManifest.ts` | New manifest builder/reader for typed mount paths. |
| `src/observer/template.ts` | Better semantic naming and crystallised-call handling. |
| `src/observer/author.ts` | Better frontmatter, intent, examples, and source shape. |
| `src/observer/gate.ts` | Skip nested crystallisation and route reuse evidence. |
| `src/snippet/runtime.ts` | Optional missed-reuse warning after trajectory capture. |
| `scripts/acceptance/agent-loop.sh` | Assert discovery, direct invocation, and no nested wrapper. |
| `tests/*` | Focused tests for search, man, read-only FS, observer skip, and harness helpers. |

## Verification

1. `pnpm test` passes.
2. `ATLASFS_SKIP_ENV_FILE=1 pnpm demo` still shows Q1 novel/tier 4 and Q2 interpreted/tier 2.
3. `bash scripts/acceptance/session-switch.sh` still passes.
4. `bash scripts/acceptance/agent-loop.sh` passes with these additional assertions: Q2 ran discovery, selected a learned function, invoked it, and did not create a nested wrapper.
5. Manual bash session:
   - `ls /db /lib`
   - `echo x > /db/<mount>/x.ts` fails
   - `apropos "range coal revenue"`
   - `man <top-match>`
   - `cat /lib/<top-match>.ts | head -60`
   - `npx tsx -e 'console.log(await df.lib.<top-match>(...))'`
6. For a generated Q1 function, sibling Q2 phrasing ranks the same learned function above seed primitives.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
| --- | --- | --- | --- | --- | --- |
| 1 | Scope | Keep flat `/lib/<name>.ts` functions as the only reusable unit | Product | Simplicity | The repo already decided functions collapse procedures, skills, primitives, and agents into one abstraction. |
| 2 | Architecture | Make discovery VFS-native instead of adding a hidden router | Architecture | Agent-native surface | ChromaFs shows the value of normal commands backed by substrate-aware adapters. |
| 3 | Architecture | Share one library search implementation between CLI and bash | Correctness | Single source of truth | Divergent scoring makes adherence unpredictable and hard to test. |
| 4 | Architecture | Enforce `/db` read-only at the FS adapter | Safety | Structural invariant | The VFS should make illegal writes impossible, not merely discouraged in docs. |
| 5 | Product | Generate intent-shaped functions, not trace-shaped wrappers | UX | Discoverability | The model chooses what it can recognize as a useful codebase object. |
| 6 | Runtime | Warn on missed reuse instead of silently routing | Scope | Explicit behaviour | We want to prove the surface improves agent choice without hiding the choice from the agent. |
| 7 | Testing | Harness asserts direct learned-function invocation | Evaluation | Measure the thesis | Passing answers are not enough; the product claim is workspace improvement over repeated intents. |
