# Datafetch — the elevator pitch

> **Datafetch does not virtualize the whole dataset.
> It virtualizes the dataset *interface*, then improves that interface from
> accepted, evidence-backed work.**

## The one-line claim

`datafetch` mounts a dataset as an **intent workspace**. The agent works in
files. The server learns only from committed, executable TypeScript.

## The flip

The same question, two days apart, runs in two different shapes:

- **Cold (first time).** No learned interface exists for this intent shape.
  The agent composes the workflow itself: `db.<coll>.findSimilar`, then
  whichever `lib.*` primitives fit — pick a filing, infer a plan, execute it.
  Trajectory is `mode:"novel"`, `tier:4`. Expensive on purpose.
- **Warm (next similar intent).** An observer has crystallised the accepted
  trajectory into `lib/<tenant>/rangeTableMetric.ts`. The agent finds it via
  `datafetch apropos`, calls it directly. Trajectory is `mode:"interpreted"`,
  `tier:2`. The four-step chain collapses to one client-visible call. The
  server still records the nested evidence path; the agent sees a typed API.

That flip is not a cache. The warm-path file is plain TypeScript an engineer
can read, edit, and replay — generated from the recorded shape of the
trajectory, not from a prompt.

## Why anyone should care

The observer learns **only** from work the runtime has already accepted: a
committed `df.answer({...})` with structured value, evidence, derivation, and
a passing validation. No prompt-stuffing, no review queue, no endorsement UI.
If the answer was auditable, the learned interface is auditable; if it
wasn't, nothing crystallises. Per-tenant overlays mean two tenants on the
same cluster end up with two different libraries, shaped by the intents each
tenant actually exercises.

## A taste of the workspace

```sh
datafetch mount \
  --tenant acme \
  --dataset finqa \
  --intent "What is the range of chemicals revenue between 2014 and 2016?"

cd ./finqa-range-chemicals
```

The workspace looks like:

```
AGENTS.md           # auto-generated orientation
df.d.ts             # typed surface: db.*, lib.*, df.answer

db/                 # symlink to the mounted dataset (read-only)
lib/                # symlink to lib/<tenant>/ — learned interfaces + seeds

scripts/
  scratch.ts        # exploration (datafetch run)
  answer.ts         # final visible intent program (datafetch commit)

tmp/runs/           # per-run notebook output
result/             # current accepted answer + commit history + HEAD.json
```

### Cold path

```ts
// scripts/answer.ts
const candidates = await df.db.finqaCases.findSimilar(
  "range chemicals revenue 2014 2016", 10,
);
const { value: filing } = await df.lib.pickFiling({
  question, candidates, priorTickers: [],
});
const { value: plan } = await df.lib.inferTableMathPlan({ question, filing });
const { value: result } = await df.lib.executeTableMath({ filing, plan });

return df.answer({
  status: "answered",
  value: result.roundedAnswer,
  evidence: result.evidence,
  coverage: { years: ["2014", "2016"], metric: "chemicals revenue" },
  derivation: { operation: "range", via: ["findSimilar", "pickFiling", "inferTableMathPlan", "executeTableMath"] },
});
```

```sh
datafetch commit scripts/answer.ts
```

Commit means **"this is the final auditable answer for this intent."** Not a
git commit. It writes `result/{answer.json, answer.md, validation.json,
lineage.json, HEAD.json, tests/replay.json}` and an append-only entry under
`result/commits/`. If validation passes, the observer reads the trajectory
from the current `HEAD` and writes `lib/acme/rangeTableMetric.ts`.

### Warm path

New mount, similar intent. `datafetch apropos "range coal revenue"` surfaces
`rangeTableMetric` as a tool. `scripts/answer.ts` shrinks to one call
(`df.lib.rangeTableMetric({query, limit})`) wrapped in `df.answer({...})`.
`datafetch commit` again. `mode:"interpreted"`, `tier:2`, one top-level
call.

## The mechanism in one chain

```
intent
  → mounted workspace
  → visible TypeScript in scripts/answer.ts
  → committed df.answer(...)
  → validated lineage
  → learned lib function (lib/<tenant>/<name>.ts)
  → next mount discovers and reuses it
```

## What you actually run

`datafetch demo` is the load-bearing artefact: two FinQA questions
back-to-back, the cost panel on the second showing `mode=interpreted tier=2`,
the call-graph collapsing from four top-level calls to one. Everything in
this doc is what that demo exercises.
