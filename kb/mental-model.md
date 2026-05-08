---
title: "Datafetch, Mental Model"
type: evergreen
tags: [magic-docs]
updated: 2026-05-07
snapshot_commit: ""
---

# Mental Model

Shared vocabulary. If two collaborators (or two future sessions) disagree about
what a word means, this is the source of truth. The first half tells you how
to think about the system. The second half is the authoritative glossary;
every term-of-art the codebase uses appears there with a one-paragraph
definition and, where applicable, a code home.

For the elevator pitch and the canonical end-to-end story, see
`kb/elevator.md`. For how to read those concepts in actual file paths and CLI
verbs, see `kb/product-design.md`. This doc sits between them: it gives you
the words.

---

## Half 1: The mental model

### The arc, in one breath

A tenant's agent is given a bash shell and the `datafetch` CLI. It runs
`datafetch mount` to get an **intent workspace** — a CWD with a typed
`df.d.ts`, a read-only `db/`, a writable `lib/`, and a `scripts/` folder it
edits in. It writes TypeScript snippets that compose `df.db.*` retrievals
with `df.lib.*` reasoning steps and ends with a `df.answer({...})` envelope.
It runs them with `datafetch run` (exploratory) and finally `datafetch commit`
(auditable). Every snippet execution is recorded as a **trajectory**. After a
commit whose answer validates, an in-process **observer** reads the
trajectory and crystallises its call shape into a new typed function at
`lib/<tenant>/<name>.ts`. The next intent against the same shape calls that
function directly — same answer, fewer LLM calls, lower tier, smaller blast
radius.

That is the whole product. Everything else is plumbing for that loop.

### Why bash, not a tool catalog

The agent does not get a JSON tool schema. It gets bash and a four-verb
allowlist (`Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)`). Driving
the system through bash means the agent works in the same medium as a
developer: `cat df.d.ts`, `datafetch apropos`, edit a file, `datafetch run`,
read `tmp/runs/003/result.json`. The "code mode" surface (a typed
`df.d.ts` namespace) replaces the tool catalog.

### Two paths for the same intent

There is a **cold path** and a **warm path**, and the difference is which
shape of TypeScript the agent writes.

- **Cold path (first time).** No learned interface exists for this shape.
  The agent reads `df.d.ts`, runs `datafetch apropos`, and composes the
  workflow by hand: a `df.db.*` retrieval, then several `df.lib.*` primitives
  stitched together, then `df.answer(...)`. The trajectory's `mode` is
  `"novel"` and its `tier` is `4`. Cost panel renders this as the expensive
  column.
- **Warm path (next similar intent).** `apropos` surfaces a learned
  interface (e.g. `rangeTableMetric`). The agent calls it as one line and
  writes a tiny `answer.ts`. The trajectory's `mode` is `"interpreted"` and
  its `tier` collapses to `2`. The server still records the nested calls the
  learned interface made internally, so the audit story is preserved; the
  agent just sees a simpler typed API.

The pitch reduces to one claim: **datafetch does not virtualise the whole
dataset; it virtualises the dataset interface, then improves that interface
from accepted, evidence-backed work.**

### The intent workspace is the unit of work

Every intent gets its own workspace folder. That folder is bound to one
session, one tenant, one dataset, and one intent string. It has its own
`scripts/` (where the agent edits), its own `tmp/runs/` (exploratory
output, append-only), its own `result/` (the auditable view), and its own
`result/HEAD.json` (the **intent workspace head**). When the agent commits,
the workspace's HEAD advances. The observer learns from a commit only if
that commit IS the current head — superseded earlier commits are dropped as
stale. This is what lets an agent iterate, refine, and recommit without
poisoning the library with intermediate attempts.

The workspace is intentionally a normal directory. The agent reads files
with `cat`. Writes files with its editor. Symlinks make `db/` and `lib/`
appear inside the workspace without copying. Bash and the editor are the
agent's IDE.

### `lib/<tenant>/<name>.ts` is private to a tenant

The data plane has two namespaces.

- `db/<mount>/...` is **shared** and **read-only**. One mount serves every
  tenant. The adapter never writes back. The substrate is MongoDB Atlas; in
  the workspace it shows up as `df.db.<ident>.findExact|search|findSimilar|hybrid`.
- `lib/<tenantId>/<name>.ts` is **private** to one tenant. Crystallised
  functions land here. Two tenants who solve identical questions over the
  same data still get separate `lib/` overlays — the typed surface diverges
  per tenant by construction. (`lib/__seed__/` is a reserved overlay for
  seed primitives shared across all tenants; agents do not see it as a
  tenant.)

The cross-tenant promotion story (one tenant's learned interface flowing to
others) is design only. It is not shipped.

### The diagnostic story: client-visible vs server-side

When the agent calls `df.lib.rangeTableMetric(...)`, that is the
client-visible call (depth 0). Inside the body, the function makes its own
nested `df.db.finqaCases.findSimilar`, `df.lib.inferTableMathPlan`,
`df.lib.executeTableMath` calls (depth 1+). The runtime records both layers.
The trajectory preserves the full lineage. The agent's snippet stays small;
the auditable evidence path stays complete. This separation is what makes
"learned" feel like a typed API rather than a black-box prompt.

### `df.answer({...})` is the commit primitive

Commit, in datafetch, is **not git**. `datafetch commit` writes the current
auditable view of an intent: `result/answer.json`, `result/answer.md`,
`result/lineage.json`, `result/validation.json`, a replay test, and an
updated `result/HEAD.json`. Inside the snippet, the act of committing is
the final `return df.answer({status, value, evidence, derivation, ...})`
expression. The runtime validates it (status allowed, value present,
evidence present, derivation visible, lineage non-empty, no zero-fallback)
and only flags it `accepted` if all checks pass. Crystallisation only
fires on accepted commits.

### Cold then warm: the loop, drawn

```
intent
  -> mounted workspace
  -> visible TypeScript in scripts/answer.ts
  -> committed df.answer(...) with passing validation
  -> validated lineage in result/
  -> observer crystallises lib/<tenant>/<name>.ts
  -> next mount discovers it via apropos and reuses it
```

The observer is fire-and-forget from the snippet runtime's perspective. It
runs in the same process, but the snippet returns to the agent before the
observer finishes. By the time the next `mount` happens, `df.d.ts` and
`AGENTS.md` have already been regenerated with the new function visible.

### What this is not

The system does not virtualise the dataset as a real filesystem (no NFS, no
FUSE). It does not compile to Atlas pipelines yet (compiled tier is
reserved). It does not do drift detection, cross-tenant promotion, library
divergence metrics, or a human endorsement step. The MVP collapses
"N >= 3 convergent trajectories" to N=1: every qualifying commit
crystallises immediately, deduped only by shape hash. See
`/tmp/kb-rewrite-brief.md` section 13 for the full deferred list.

---

## Half 2: Glossary

Terms grouped by concept area; alphabetised within each group. Every
glossary entry is one short paragraph. Where a term has a code home, the
file is named.

### People and process

- **agent** — the bash-loop driver of the workflow. Today this is Claude
  Code (or any tool with bash + a four-verb allowlist) authoring TypeScript
  in `scripts/` and shelling out to `datafetch <verb>`. The agent never
  holds LLM credentials — those live on the data plane.
- **gate** — the predicate `shouldCrystallise()` in `src/observer/gate.ts`.
  Decides whether a saved trajectory becomes a learned interface. Checks
  phase, validation, mode, error state, ≥2 distinct calls, a `db.*` →
  `lib.*` data-flow shape, and shape-hash novelty.
- **observer** — the in-process worker in `src/observer/worker.ts` that
  consumes saved trajectories and authors `lib/<tenant>/<name>.ts` files.
  Wired from `src/snippet/runtime.ts` via the `onTrajectorySaved` hook.
- **tenant** — a namespace owner. Tenants share `/db/<mount>/` but get a
  private `/lib/<tenantId>/` overlay. Reserved tenant ids match
  `^__\w+__$` (e.g. `__seed__`). Multi-tenancy in the MVP is namespace
  isolation; auth-isolated multi-tenancy is roadmap.

### Workspace

- **dataset** — synonym for "mount" in the user-facing CLI flag
  (`--dataset finqa-2024`). What the agent thinks of as a published Atlas
  database showing up under `db/`.
- **intent** — the first sentence of a function's purpose, set in
  `fn({intent})`. Also the user-supplied `--intent` flag describing the
  task an agent has been given to solve. Used by `apropos`/`man` and by
  the `df.d.ts` JSDoc.
- **intent workspace** — a CWD-rooted folder created by
  `datafetch mount --tenant --dataset --intent`. Has `.datafetch/workspace.json`,
  `scripts/{scratch.ts,answer.ts,helpers.ts}`, `tmp/runs/`, `result/`,
  symlinked `db/` and `lib/`, plus its own `df.d.ts`, `AGENTS.md`, and
  `CLAUDE.md`. Bound to one session, one tenant, one dataset, one intent.
  Materialised by `src/cli/workspace.ts`.
- **intent workspace head** — the trajectory id currently pointed to by
  `<workspace>/result/HEAD.json`. Only the head's commit can crystallise.
  Older commits whose head has advanced are rejected as `stale`. See
  `src/observer/workspaceHead.ts`.
- **mount** — a registered dataset, identified by `mountId`. Built from a
  `MountSource` (today only `atlasMount({uri, db})`). Lives under
  `<baseDir>/mounts/<mountId>/` and is shared across all tenants. Surfaces
  in the workspace as `df.db.<ident>`.
- **narrative** — the markdown rendering of a session's plan/execute
  artefacts produced by `datafetch session narrative`. Rendered by
  `src/cli/sessionNarrative.ts`. A read-only debug/audit aid; not part of
  the runtime path.
- **session** — a (tenant, mountIds) binding with a unique `sessionId`.
  Persisted at `<baseDir>/sessions/<id>.json`. The CLI's `active-session`
  pointer file is a fallback resolution layer behind `--session` and
  `DATAFETCH_SESSION`.
- **workspace head** — synonym for "intent workspace head". The
  authoritative pointer file is `<workspace>/result/HEAD.json`.

### Layout

- **AGENTS.md / CLAUDE.md** — auto-generated workspace memory files. The
  baseDir copy lives at `<baseDir>/AGENTS.md` and is regenerated by
  `src/bootstrap/workspaceMemory.ts` after every connect, mount publish,
  and observer write. Each intent workspace also gets its own copy at
  mount time. `CLAUDE.md` is an alias of `AGENTS.md` (symlink or copy).
- **db/** — mount-rooted, read-only. Inside the workspace it is a symlink
  to `<baseDir>/mounts/<dataset>/`. Holds typed module files
  (`<coll>.ts`), descriptors (`_descriptor.json`), samples
  (`_samples.json`), and a per-collection `README.md`.
- **df.d.ts** — auto-generated TypeScript declaration manifest at
  `<baseDir>/df.d.ts`, copied into each workspace at mount time. The
  Code-Mode-style typed surface for the agent. Groups library entries
  into "Learned Interfaces" (frontmatter present) and "Primitives" (no
  frontmatter). Regenerated by `src/server/manifest.ts`.
- **lib/** — tenant-private, writable. Inside the workspace it is a
  symlink to `<baseDir>/lib/<tenantId>/`. Holds learned interfaces and
  hand-authored functions, plus `skills/<name>.md` sidecars for `agent`
  bodies.
- **result/** — the workspace's auditable view of the current accepted
  commit. Holds `answer.json`, `answer.md`, `validation.json`,
  `lineage.json`, `tests/replay.json`, `HEAD.json`, plus an append-only
  `result/commits/NNN/` history.
- **scripts/** — the agent's editable surface inside the workspace.
  Materialised at mount time as `scratch.ts` (exploration), `answer.ts`
  (final committable program), and `helpers.ts`.
- **tmp/runs/** — exploratory output of `datafetch run`, append-only,
  numbered (`NNN`). Each entry has `source.ts`, `result.json`,
  `result.md`, `lineage.json`. Never crystallisable.

### Code surface

- **callshape** — the `TemplateStep.callShape` field captured by the
  observer's template extractor. Records how the recorded `input` maps
  back to positional arguments: one of `positional-query-limit`,
  `positional-query-opts`, `positional-filter-limit`, `single-arg`. See
  `src/observer/template.ts`.
- **derived bindings** — input fields on a step's call whose value matches
  an earlier call's output (or a sub-tree of it). Rendered in the
  generated body as `out0`, `out0[0]`, `out0.field`. Internal to the
  body; not exposed in the public input schema. See `src/observer/template.ts`.
- **df.answer** — the commit primitive. `df.answer({status, value?,
  evidence?, derivation?, coverage?, ...})` returns a sealed
  `AnswerEnvelope` (branded with `Symbol.for("datafetch.answer")`).
  Required for a `commit` phase trajectory to be considered crystallisable.
  Validated by `validateAnswerEnvelope` in `src/snippet/answer.ts`.
- **fn** — the factory that authors functions:
  `fn({intent, examples, input, output, body})`. Defined in
  `src/sdk/fn.ts`. Validates I/O via valibot, dispatches the body, returns
  a `Result<O>`. Every learned interface and every seed primitive is an
  `fn(...)` envelope.
- **function** — a typed callable in `<baseDir>/lib/<tenant>/<name>.ts`,
  authored via `fn({...})`. Has `intent`, `examples`, `input`, `output`,
  and one body shape (`pure | llm | agent`). Distinct from "snippet": a
  function declares schemas and intent; a snippet is a one-shot ad-hoc
  composition.
- **HEAD** — the workspace head pointer, `<workspace>/result/HEAD.json`.
  See "intent workspace head".
- **learned interface** — a `<baseDir>/lib/<tenant>/<name>.ts` file
  authored by the observer from a qualifying trajectory. Carries a
  `/* --- ... --- */` YAML frontmatter block (Claude Code skill format)
  and an `@shape-hash:` provenance tag. The presence of the frontmatter
  is what marks a file as a "tool" rather than a "primitive" in
  `df.d.ts`.
- **lineage** — the recorded call list for a trajectory, exposed in the
  committed `result/lineage.json` and inside the trajectory record's
  `calls[]`. Preserves both the client-visible top-level calls and the
  nested calls made inside any learned interface.
- **replay** — the deterministic re-execution test written to
  `result/tests/replay.json` on commit. Pins the snippet's input/output
  shape so a future change can be regression-tested against the accepted
  answer.
- **semantic name** — the post-commit-`6c0d78d` naming style for learned
  interfaces (e.g. `rangeTableMetric`, `compareTableMetric`,
  `ratioTableMetric`, `tableMetric`, `filingQuestion`). Replaces the old
  `crystallise_<hash>_<topic>` style; legacy names are still recognised
  for backwards compat. Picker in `src/observer/template.ts` (`pickTopic`).
- **snippet** — a one-shot `npx tsx`-style TypeScript execution against a
  session. Composes `df.*` calls. Recorded as a trajectory. Has no
  declared schemas; the trajectory is its audit log. Distinct from
  "function". Run by `src/snippet/runtime.ts`.
- **validation** — automated answer-envelope check on commit. Gates:
  `structuredAnswer`, `statusAllowed`, `valuePresent`, `evidencePresent`,
  `derivationVisible`, `unsupportedHasReason`, `lineagePresent`,
  `noDefaultZeroFallback`, `hiddenManipulationDetected`. Implementation
  in `src/snippet/answer.ts`. `accepted = blockers.length === 0`.

### Lifecycle

- **commit** — the datafetch-sense commit, not git. The act of running
  `datafetch commit scripts/answer.ts`, which writes the auditable view
  to `result/`, runs validation, advances `result/HEAD.json` if accepted,
  and fires the observer. Implementation in `src/cli/workspace.ts` and
  `src/snippet/runtime.ts` under `phase:"commit"`.
- **crystallisation** — the observer's act of writing
  `<baseDir>/lib/<tenant>/<name>.ts` from a qualifying trajectory.
  Implemented in `src/observer/worker.ts` and `src/observer/author.ts`.
  In the MVP, crystallisation is N=1: any single trajectory passing the
  gate produces a function. Shape-hash dedup is the only convergence gate.
- **interpreted (mode)** — `mode:"interpreted"`, typically `tier:2`. A
  successful run that called at least one learned interface. The warm
  path's mode.
- **llm-backed (mode)** — `mode:"llm-backed"`, `tier:3`. The per-call
  mode for an `llm`/`agent` body. Set inside the `fn()` factory's
  default for non-pure bodies. Aggregates upward into the snippet's
  cost block.
- **mode** — the `Result.mode` field. One of `"novel" | "interpreted" |
  "llm-backed" | "cache" | "compiled"`. Disjoint from `errored`. See
  `src/sdk/result.ts`.
- **novel (mode)** — `mode:"novel"`, `tier:4`. A successful first-time
  ad-hoc composition with no learned interface called. Treated as a
  success state, not an error state. The cold path's mode.
- **tier** — a 0-4 scalar in the `Cost` block. Max-observed across nested
  calls. **Tier 4** = full ReAct composition (novel). **Tier 2** =
  substrate roundtrip or pure interpreted body. **Tier 3** = LLM dispatch
  through Flue (`llm({...})` or `agent({...})`). **Tier 1** and **tier 0**
  are reserved (compiled and cache-hit respectively); no production code
  emits them today.
- **cache (mode) / compiled (mode)** — `mode:"cache" | "compiled"`.
  Reserved for future tiers (1 and 0). Not emitted today. Aspirational.

### External

- **Anthropic SDK** — `@anthropic-ai/sdk`, pulled in as a dep but not
  imported directly from `src/`. Flue uses it internally when the
  resolved provider is `anthropic`. Credentials are read on the data
  plane only.
- **Atlas mount** — a `MountAdapter` over MongoDB Atlas
  (`src/adapter/atlas/AtlasMountAdapter.ts`). Capabilities reported as
  `{vector:false, lex:true, stream:true, compile:true}`, but only `lex`
  is actually exercised — `compile` (the aggregation-pipeline path) is
  reserved.
- **Claude Code skill** — the `skills/datafetch/SKILL.md` bundle, copied
  to `~/.claude/skills/datafetch/SKILL.md` by `datafetch install-skill`.
  Tells Claude Code to invoke datafetch on any datafetch / FinQA /
  mounted-database / `/db/` / `/lib/` query, and explains the three-tier
  reuse hierarchy (past trajectories → learned interfaces → seed
  primitives).
- **Flue** — used as a library, not a service. `FlueSessionPool` in
  `src/flue/session.ts` constructs a per-tenant `FlueAgent` via
  `@flue/sdk/internal`. Both `llm({...})` and `agent({skill})` bodies
  route through the `FlueBodyDispatcher` in `src/flue/dispatcher.ts`.
  The data plane is the only place LLM credentials are read.

---

## When this doc disagrees with code

The brief at `/tmp/kb-rewrite-brief.md` is the source of truth on what
ships. If a term here drifts from a file:line in the brief, fix this doc.
Specifically: anything labelled "aspirational", "reserved", or "roadmap"
above is design-only — see brief section 13 for the deferred list.
