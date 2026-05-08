---
name: datafetch
description: Use the datafetch CLI to explore mounted dataset workspaces, write visible TypeScript intent programs, commit evidence-backed answers, and reuse tenant-local learned interfaces.
---

# datafetch

Datafetch is a dataset harness for coding agents. A dataset is mounted as a
small bash-shaped TypeScript workspace. You may inspect freely, but the system
only learns from data-molding logic that is written into the workspace and run
through `datafetch`.

The normal loop is:

1. List or add a dataset.
2. Mount an intent workspace.
3. Inspect `AGENTS.md`, `df.d.ts`, `db/`, and `lib/`.
4. Run bounded probes through `scripts/scratch.ts`.
5. Put the repeatable answer logic in `scripts/answer.ts`.
6. Commit the answer with `datafetch commit`.
7. Answer the user from `result/answer.json` and `result/answer.md`.

## Workspace Shape

Read these files first from the mounted workspace root:

- `AGENTS.md` - dataset/workspace guidance generated for this mount.
- `CLAUDE.md` - compatibility alias for agents that look for Claude project instructions.
- `df.d.ts` - exact executable `df.db.*` and `df.lib.*` surface.
- `db/` - immutable dataset descriptors, samples, stats, and collection handles.
- `lib/` - tenant-local learned interfaces and helpers.
- `scripts/scratch.ts` - exploratory code for `datafetch run`.
- `scripts/answer.ts` - final visible intent program for `datafetch commit`.
- `tmp/runs/N/` - run artifacts: source, result, lineage.
- `result/` - committed answer, validation, lineage, replay test, and commit history.

Treat `db/` as read-only substrate context. Treat `lib/` and `scripts/` as the
user-space seam where visible logic can be written and later learned from.

## CLI

Use the local data plane unless instructed otherwise:

```bash
datafetch server --port 8080
datafetch attach http://localhost:8080 --tenant <tenant>
datafetch add <dataset-url> --json
datafetch list --json
datafetch inspect <source-id> --json
datafetch mount <source-id> --tenant <tenant> --intent '<intent>'
```

Inside a mounted workspace:

```bash
datafetch apropos '<intent words>'
datafetch man df.lib.<name>
datafetch run scripts/scratch.ts
datafetch commit scripts/answer.ts
```

Legacy session/snippet verbs may exist (`session`, `plan`, `execute`, `tsx`),
but prefer the intent workspace flow for new work.

## Discovery Order

Use this order before composing from primitives:

1. Read `AGENTS.md` and `df.d.ts`.
2. Inspect `db/README.md`, descriptors, stats, and samples.
3. Run `datafetch apropos '<intent>'`.
4. If a matching `df.lib.*` interface exists, inspect it with `datafetch man`.
5. Try the interface in `scripts/answer.ts`; let it answer, return partial, or abstain.
6. If no interface fits, write the missing trajectory visibly in TypeScript.

Do not assume collection names. Use exactly the identifiers printed in
`df.d.ts`, such as `df.db.train`, `df.db.events`, or whatever the mounted
dataset exposes.

## Run Versus Commit

`datafetch run` is for exploration. It writes numbered artifacts under
`tmp/runs/` and is useful context, but it is not the accepted answer.

`datafetch commit` is the final answer path. The committed script must return
`df.answer(...)`. Datafetch writes:

- `result/answer.json`
- `result/answer.md`
- `result/lineage.json`
- `result/validation.json`
- `result/tests/replay.json`
- `result/HEAD.json`

Only committed visible code that passes validation is eligible for learning.

## Final Answer Contract

`scripts/answer.ts` should return one of these shapes:

```ts
return df.answer({
  status: "answered",
  value,
  unit,
  evidence,
  coverage,
  derivation,
});
```

```ts
return df.answer({
  status: "partial",
  value,
  evidence,
  missing,
  coverage,
  derivation,
});
```

```ts
return df.answer({
  status: "unsupported",
  evidence,
  missing,
  reason,
});
```

Evidence should point back to dataset rows, documents, or handles returned by
`df.db.*`. Derivation should describe the visible transformation, aggregation,
classification, or selection that produced the answer.

## Visible Logic Rule

Raw inspection is allowed. Private reasoning is allowed. Private reasoning is
not learnable.

If you dump rows, solve privately, and answer in chat, the user may get an
answer but datafetch cannot improve. When the answer matters, externalise the
retrieval, selection, normalization, validation, derivation, and formatting in
`scripts/answer.ts`.

Good committed trajectories:

- call `df.db.*` for real substrate data;
- call `df.lib.*` when a learned or seed interface fits;
- use helper functions from `scripts/helpers.ts` when useful;
- return `df.answer(...)` with evidence and derivation;
- abstain with `unsupported` when evidence is insufficient.

Avoid:

- fabricating records or evidence;
- answering from stdout instead of `result/`;
- broad unbounded reads without a sampling or pagination reason;
- changing the workspace intent silently.

## Intent Drift

The mounted intent is the worktree purpose. If exploration produces a narrower
useful sub-intent, declare it in the committed answer:

```ts
return df.answer({
  intent: {
    name: "shortStableName",
    parent: "the mounted worktree intent",
    relation: "same", // same | derived | sibling | drifted | unrelated
    description: "what this committed trajectory actually answers",
  },
  status: "answered",
  value,
  evidence,
  coverage,
  derivation,
});
```

Use `same` when the answer satisfies the mount intent directly. Use `derived`
or `sibling` for useful sub-trajectories discovered inside a broader mount.
Use `drifted` or `unrelated` when the worktree purpose changed.

## Agentic Steps

Some `df.lib.*` functions may call Flue-backed `agent({ skill })` or
`agent({ prompt })` bodies. That is fine when the probabilistic step is part of
the visible committed TypeScript.

Do not call an external LLM privately for the important transformation and then
only commit the final number. If judgment is needed, wrap it in visible code so
lineage can show where the agentic step entered the trajectory.

## What To Tell The User

After a successful commit, answer from the committed result artifacts. Include:

- the answer status;
- the value or reason it is unsupported;
- the evidence basis;
- any important coverage limitation;
- where the committed artifacts are in `result/`.

If validation failed, say what blocked the commit and keep iterating in the
workspace until the final answer path is accepted or safely unsupported.
