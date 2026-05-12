# Datafetch architecture

> Audience: a developer who wants to understand the system well enough
> to build with it, extend it, or integrate it into their own product.
> This document avoids any one dataset's specifics and describes the
> substrate in general terms.

## Mental model

Datafetch turns *agent code* into a recordable, replayable, learnable
execution surface. The agent does not call a chat-style "search for X"
API. It writes a short TypeScript snippet in an episode workspace
against a typed `df.*` runtime, the snippet runs, every primitive call
is captured, and the resulting trajectory is observed for patterns that
can be promoted into typed callable helpers the next agent will see.

The substrate enforces three invariants that everything else rests on:

1. **`df.lib.<name>` is a contract, not a file.** The hook manifest is
   the public artefact. A failing implementation becomes a quarantined
   manifest, not a thrown runtime error.
2. **Trajectories are append-only.** They record the primitives the
   snippet actually called. They never carry the agent's reasoning, so
   they are clean training input regardless of how the agent reasoned.
3. **Learning happens on commit-phase trajectories only.** A
   crystallisation gate refuses to promote anything from a plan or run
   phase, so half-finished thoughts never become institutional memory.

## The four primitives

The agent sees four namespaces under `df`:

### `df.tool.<bundle>.<tool>(input)`

Raw external tools, exposed exactly as the mount adapter registered
them. A bundle is a logical grouping (one REST API, one Python CLI,
one MCP server, etc.). The agent calls a tool the same way it would
call any local function:

```ts
const reply = await df.tool.weather_api.forecast({ city: "London" });
```

Returns whatever the underlying tool returns, with no schema massaging.
The agent is expected to handle shape ambiguity by probing first (see
below).

### `df.db.<dataset>.<method>(query)`

Typed query over a mounted dataset. The mount adapter decides which
methods are exposed; common choices are `findExact`, `search` (BM25 or
similar), `findSimilar` (vector), and `hybrid` (BM25 + vector fusion).

```ts
const docs = await df.db.docs.hybrid("how does X work", { limit: 8 });
```

The point of `df.db` versus `df.tool` is that `df.db` is uniformly
shaped (records in, records out) across datasets, while `df.tool` is
provider-specific.

### `df.lib.<name>(input)`

Learned, callable helpers. Each one is a typed TypeScript function
whose `.ts` source lives on disk, registered through the hook registry
(see below). The agent does not need to know whether a particular
`df.lib.<name>` is a learned helper, a hand-written helper, or a
provider-native bypass; it sees a typed callable.

```ts
const summary = await df.lib.weekly_summary({ from: "2026-04-01" });
```

### `df.answer({...})`

The structured final answer envelope. Required fields include `status`
(`answered` | `partial` | `unsupported`) and `value`; recommended
fields include `evidence`, `derivation`, `coverage`. A quality
heuristic scans the value and attaches `qualityWarnings` if it looks
like a low-confidence answer (lots of placeholder strings, zero
numeric fields, empty arrays).

```ts
return df.answer({
  status: "answered",
  value: summary,
  evidence: docs.map(d => d.id),
  derivation: "Summarised the 8 most relevant docs from this week.",
});
```

## Episode lifecycle

An episode is one query, end to end:

```
              ┌────────────────────── episode workspace ──────────────────────┐
              │                                                                │
   query ─►   │ scripts/answer.ts (agent writes)                              │
              │ scripts/probe*.ts (agent writes, optional)                    │
              │ .datafetch-ctx.json (harness drops in)                        │
              │                                                                │
              │ ┌─ agent (claude / codex / local LLM) ──────────────────────┐ │
              │ │  reads task.md, df.d.ts, lib/                             │ │
              │ │  writes / edits scripts/*.ts                              │ │
              │ │  runs `pnpm datafetch:run scripts/probe.ts` (multi-turn)  │ │
              │ │  finalises scripts/answer.ts                              │ │
              │ └────────────────────────────────────────────────────────────┘ │
              │                                                                │
              │ ┌─ snippet runtime ─────────────────────────────────────────┐ │
              │ │  wraps source in async IIFE                                │ │
              │ │  injects df.* (host global)                                │ │
              │ │  enforces timeout, captures stdout/stderr                  │ │
              │ │  records every df.* call into a Trajectory                 │ │
              │ │  auto-invokes `main()` / `run()` if declared-but-uninvoked │ │
              │ │  fires `onTrajectorySaved` (fire-and-forget)               │ │
              │ └────────────────────────────────────────────────────────────┘ │
              │                                                                │
              │ answer envelope ──► caller                                    │
              └────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                  ┌─ observer ─────────────────────────────────────────────────┐
                  │  loads the saved trajectory                                │
                  │  runs the crystallisation gate                             │
                  │  extracts a CallTemplate (param + step graph)              │
                  │  authors a `.ts` body under lib/<tenant>/                  │
                  │  registers it as a candidate-typescript hook               │
                  └────────────────────────────────────────────────────────────┘
```

Persistent state for the episode and the learning that follows lives
in one place:

```
<baseDir>/
├── lib/<tenantId>/<name>.ts          # learned helper bodies
├── hooks/<tenantId>/<name>.json      # hook manifests (the trust gate)
└── trajectories/<tenantId>/traj_*.json
```

That tree is the entire mutable substrate. Everything else (mounts,
the snippet runtime, the registry) is in-process state derived from
code.

## The learning loop

After every committed episode, the observer:

1. **Gates on phase.** Only `execute` and accepted `commit` phases are
   learnable. Plans and runs are not.
2. **Gates on novelty.** The shape-hash of the trajectory's call
   sequence is checked against the existing tenant snapshot. Already-
   seen shapes are skipped.
3. **Gates on call graph plausibility.** At least two distinct
   primitive calls with at least one data-flow edge (output of one
   feeds input of another). Pure point lookups are not learned.
4. **Extracts a template.** Parameters are inferred from inputs that
   are not derived from other call outputs. Steps are the call
   sequence with input bindings.
5. **Authors a body.** The template is rendered to deterministic TS
   that composes the same primitives in the same order with the same
   data flow. No LLM is involved in this step; it is mechanical.
6. **Registers the hook.** A manifest is written with maturity
   `candidate-typescript` and callability decided by the current
   interface mode.

The agent on the next episode sees `df.lib.<name>` as a typed
callable. If the body succeeds, the manifest accumulates success stats
and (with the smoke-replay gate, on the roadmap) is promoted to
`validated-typescript`. If the body fails, the manifest is
quarantined; the agent gets a structured `unsupported` envelope back
instead of an exception, and the registry keeps the quarantined record
on disk so the next iteration can decide whether to retry, repair, or
abandon.

## The trust gate

Every `df.lib.<name>` call routes through the hook registry. A hook
has three orthogonal axes:

- **Maturity**: `observed` < `draft-agentic` < `candidate-typescript`
  < `validated-typescript` < `provider-native`. Higher maturity means
  more evidence that this hook is correct.
- **Callability**: `not-callable` < `callable-with-fallback` <
  `callable`, or `quarantined`. This is what the agent actually sees.
- **Implementation kind**: `none` (just a shape, no body), `skill`
  (LLM-backed), `typescript` (the learned body), `adapter` (mount-
  provided), `provider` (first-party API bypass).

Mode (`DATAFETCH_INTERFACE_MODE`) controls how aggressively the
registry exposes hooks. The default makes candidate-typescript hooks
callable-with-fallback (they answer if they can, return `unsupported`
if they cannot), and validated-typescript hooks fully callable. The
strictest mode (`hooks-validated-only`) only exposes hooks that have
been positively verified.

When a callable hook crashes at runtime, the registry quarantines it
on the spot and converts the crash into a structured `unsupported`
envelope. The agent never sees an uncaught exception from `df.lib`;
quarantine is the recovery, not deletion.

## Multi-tenant model

Every persistent path is keyed by `tenantId`. A tenant is the unit of
isolation: their hooks cannot poison another tenant's hooks, their
trajectories cannot be observed across tenants, their `df.lib`
namespace is private. The snippet runtime carries a `sessionCtx` that
binds (tenantId, sessionId, mountIds, baseDir, optional bridges) for
the lifetime of one snippet.

Mounts can be shared (everyone gets `df.db.docs`) or tenant-scoped
(one tenant's CRM is not visible to another), depending on how the
mount adapter is registered.

## What is persistent versus ephemeral

| state | persisted? | location |
|---|---|---|
| Learned helper bodies | yes | `<baseDir>/lib/<tenantId>/*.ts` |
| Hook manifests | yes | `<baseDir>/hooks/<tenantId>/*.json` |
| Trajectories | yes | `<baseDir>/trajectories/<tenantId>/traj_*.json` |
| Episode workspace | yes for the run, optional after | `<runDir>/episodes/<family>/<level>/` |
| Mount registry | no, rebuilt at boot | in-process |
| Hook registry cache | no, rebuilt on demand | in-process |
| Agent prompt / system message | no, regenerated per episode | in-process |

The substrate's "memory" lives entirely in those three persisted
subdirectories. Everything else can be torn down and recreated without
losing institutional knowledge.

## Mount adapters

A mount adapter is the integration point for a datasource. It
implements a small interface that lets the runtime resolve
`df.tool.<bundle>` calls and (optionally) `df.db.<ident>` queries
against the source. The substrate ships adapters for local Atlas, a
HuggingFace catalog, and a publish mount used in demos. Adding a new
adapter is the way to make a new datasource agent-visible.

A mount adapter does three things:

1. Registers a bundle name and a typed tool surface (function names +
   inferred input/output schemas).
2. Implements the `MountRuntime` interface for `df.db.*` methods
   (`findExact`, `search`, `findSimilar`, `hybrid`).
3. Optionally seeds a few hand-curated hooks (e.g., a hook that knows
   the dataset's primary key lookup pattern) at registration time, so
   the agent's first episode has something to call.

## Snippet runtime sandbox

The snippet runtime wraps user source in an async IIFE that exports a
promise (`__df_done`). It executes via `tsx` (in-process at present)
with:

- `df` injected as a host global
- `console.log` / `console.warn` captured to per-snippet buffers
- `process.exit` shimmed to throw rather than kill the host
- An optional timeout (default 300 seconds) enforced via
  `withTimeout(promise, timeoutMs)`
- An auto-invoke trailer that calls `main()` / `run()` / `solve()` if
  one of them was declared but not invoked at top level

Production deployments will want stronger isolation (separate process,
seccomp / V8 isolate, no host filesystem outside the workspace). The
isolation boundary is intentionally factored so future work can move
the snippet runtime out-of-process without changing the rest of the
substrate.

## What the substrate is not

- It is not a RAG library. It can use vector retrieval (via `df.db`),
  but the agent reasons over the result with code, not over a
  retrieved-context prompt.
- It is not a tool-orchestration framework. Tools are first-class
  primitives, not nodes in a DAG the framework manages.
- It is not a prompt template. There is no library prompt template
  that branches on dataset / family / tool identity. The agent's
  system prompt is the same shape across all queries; what changes is
  what `df.*` exposes.

## Where to read the code

| concept | implementation |
|---|---|
| df.* binding | `src/snippet/dfBinding.ts` |
| Snippet runtime | `src/snippet/runtime.ts` |
| Hook registry | `src/hooks/*` |
| Observer / learning loop | `src/observer/*` |
| Answer envelope + quality heuristic | `src/snippet/answer.ts` |
| Trajectory recorder | `src/trajectory/recorder.ts` |
| Mount runtime + adapters | `src/adapter/*` |
| Multi-turn probe affordance | `src/eval/runScript.ts` |
| Discovery / `df.d.ts` rendering | `src/sdk/schemaRender.ts`, `src/discovery/*` |
| Persistent paths | `src/paths.ts` |
