---
name: datafetch
description: Use the datafetch CLI to drive bash-shaped tenanted sessions over mounted MongoDB Atlas datasets. Triggers when the user asks about datafetch workspaces, the FinQA dataset, mounted databases, /db/ or /lib/ contents, or wants to crystallise a function from a trajectory.
---

# datafetch

Datafetch is a bash-shaped workspace over a mounted dataset. The data plane is a long-lived HTTP server at `$DATAFETCH_SERVER_URL` (default `http://localhost:8080`); you drive it from your shell with the `datafetch` CLI. Every tenant gets their own session, their own private `/lib/` overlay of typed TypeScript functions, and a shared read-only view of the registered mounts.

Your job, when given a data question: orient in plan mode, look for an
existing function, draft the trajectory, then execute the committed
trajectory. Plan runs are scratch work; execute runs are the auditable
answer path. The runtime records the execute trajectory; if it converges
with prior runs, the observer crystallises a parameterised
`/lib/<tenant>/<name>.ts` for next time.

## Workspace layout

The on-disk root is `$DATAFETCH_HOME` (default `~/.atlasfs` or the cwd's `.atlasfs/`). Read these first if present:

- `$DATAFETCH_HOME/AGENTS.md` — server-maintained workspace memory for this dataset.
- `$DATAFETCH_HOME/CLAUDE.md` — compatibility alias for agents that look for Claude project instructions first.
- `$DATAFETCH_HOME/df.d.ts` — typed manifest of the exact `df.db.*` and
  `df.lib.*` names available in this session.
- `$DATAFETCH_HOME/lib/<tenant>/<name>.ts` — your tenant-private typed functions.
- `$DATAFETCH_HOME/lib/__seed__/<name>.ts` — fallback seeds shared across tenants.
- `$DATAFETCH_HOME/mounts/<mount-id>/` — substrate-derived files for each mount (per-collection schema modules, samples, descriptors).
- `$DATAFETCH_HOME/trajectories/<id>.json` — what the runtime recorded for each snippet execution.
- `$DATAFETCH_HOME/sessions/<sessionId>.json` — server-managed session records.
- `$DATAFETCH_HOME/sessions/<sessionId>/plan/attempts/<trajectoryId>/` — non-crystallisable plan artifacts.
- `$DATAFETCH_HOME/sessions/<sessionId>/execute/<trajectoryId>/` — committed execute artifacts eligible for learning.
- `$DATAFETCH_HOME/active-session` — plain-text pointer to the current session id (managed by `datafetch session new|resume`).

## Custom verbs

These CLI verbs back the agent loop. They all hit the localhost data plane:

```
datafetch session new --tenant <id> [--mount <id>...] [--json]
datafetch session list [--json]
datafetch session resume <sessionId>
datafetch session end <sessionId>
datafetch session switch --tenant <id> [--mount <id>...]
datafetch session current

datafetch mount --tenant <id> --dataset <mount-id> --intent '<text>'
                                      # create one intent workspace
datafetch run [scripts/scratch.ts]    # exploratory workspace run; writes tmp/runs/N
datafetch commit [scripts/answer.ts]  # final answer; writes result/

datafetch plan -e '<source>'        # exploratory run; cannot crystallise
datafetch plan <file>               # exploratory saved trajectory

datafetch execute -e '<source>'     # committed run; can crystallise
datafetch execute <file>            # committed saved trajectory

datafetch tsx -e '<source>'         # legacy unphased snippet
datafetch tsx <file>                # legacy unphased saved snippet

datafetch man <fn>                  # render NAME / SYNOPSIS / INPUT / OUTPUT / EXAMPLES
datafetch apropos <kw>              # semantic search across /lib/ intents
```

Resolution order for the active session: `--session <id>` flag, then `DATAFETCH_SESSION` env var, then `$DATAFETCH_HOME/active-session`. `session new` writes the pointer; `session end` clears it if it was active.

Prefer the intent workspace flow for new tasks: `datafetch mount`, `cd` into
the folder, use `datafetch run` while exploring, then `datafetch commit` once
`scripts/answer.ts` returns a structured `df.answer(...)`.

## Hierarchy of reuse — always check higher tiers first

Three tiers of available work, ordered cheapest-to-newest. Walk down them
in order. Stop at the first tier that fits your task. Composing fresh
chains when an existing one fits is wasted work — both for you and for
the next agent — and it doesn't feed the system that crystallises new
tools.

### Tier 1 — Past trajectories

Recent successful task runs live at `$DATAFETCH_HOME/trajectories/<id>.json`.
Each is a complete worked example: question text, the call sequence, the
inputs passed to each call, the outputs returned. This is the cheapest
possible answer — someone (often a prior session of you) already solved
this exact shape.

```bash
ls -t $DATAFETCH_HOME/trajectories/ | head -10
jq '{question, calls: [.calls[].primitive]}' $DATAFETCH_HOME/trajectories/<id>.json
```

If a trajectory's call sequence matches your task, replay it — same
primitives, same arg shapes. Substitute your task's specifics where the
example uses literal values.

### Tier 2 — Crystallised tools

Wrappers the observer has promoted from convergent trajectories. They
live at `$DATAFETCH_HOME/lib/<tenant>/<name>.ts` and carry YAML
frontmatter at the top of the file describing what they do.

```bash
ls $DATAFETCH_HOME/lib/<tenant>/
head -30 $DATAFETCH_HOME/lib/<tenant>/<name>.ts
```

The frontmatter follows Claude Code's skill format: `name`, `description`
(with a *"Use when..."* clause). If a tool's description matches the
user's task, call it directly:

```bash
datafetch execute -e "console.log(JSON.stringify(await df.lib.<name>(<input>)))"
```

Use the example in the frontmatter as a guide for the input shape. Do
not re-compose the chain by hand; the wrapper already encodes it.

### Tier 3 — Base primitives

The seed functions (`pickFiling`, `executeTableMath`, retrieval handles
on `df.db.<ident>`, etc.) live at `$DATAFETCH_HOME/lib/__seed__/`. These
have no frontmatter. Compose from them only when no trajectory or tool
fits.

```bash
cat $DATAFETCH_HOME/df.d.ts                 # exact df.db.* and df.lib.* names
ls $DATAFETCH_HOME/lib/__seed__/
head -25 $DATAFETCH_HOME/lib/__seed__/<name>.ts   # signature + JSDoc
cat   $DATAFETCH_HOME/lib/__seed__/<name>.ts      # full body if you need it as a template
```

Primitives always need to be grounded in the substrate via `df.db.<coll>.*`
calls — never construct filing/case data by hand. If the substrate seems
unavailable, that is the exception worth investigating, not a reason to
fabricate inputs. (See "Don't fabricate" below.)

Use the collection identifiers exactly as `df.d.ts` prints them. For a
live Atlas FinQA mount this is usually `df.db.finqaCases`, not
`df.db.cases`.

## Why this order matters — the compounding effect

Every reuse strengthens the workspace:

- **Trajectories you replay** strengthen the case for crystallisation.
  When the observer sees the same call shape multiple times, it promotes
  it to a tool.
- **Tools you call** get exercised. If their shape converges with a new
  pattern, the observer can promote a higher-level wrapper around them.
- **Base primitives** are the foundation. A warmed-up workspace rarely
  needs to touch them directly.

Composing a fresh chain when an existing one fits doesn't just waste
your work — it bypasses the observer's signal, so future agents won't
see this task pattern in the available tools either. Reuse begets reuse.

## Don't fabricate

If `df.db.<coll>.*` calls fail, your snippets error, or the data plane
seems off — investigate. Read the error. Try
`curl ${DATAFETCH_SERVER_URL:-http://localhost:8080}/health`.
Read `cat $DATAFETCH_HOME/server.log`. Read `cat $DATAFETCH_HOME/df.d.ts`.
Try a smaller query.

What you must NOT do is construct filing or case data inline ("a mock
filing with these values…") to bypass the substrate. That produces
plausible-looking outputs from imagined inputs and corrupts the
trajectory record. The runtime records every `df.*` call; a trajectory
without a `df.db.*` call is structurally suspect.

The `apropos` shortcut: `datafetch apropos "<keywords>"` is a faster
keyword search across all functions in tiers 2 and 3 when you already
know roughly what you're looking for. Output tags each entry as `(tool)`
or `(primitive)`. Useful when many files exist; the tiered `ls`+`head`
walk is the primary path otherwise.

## Authoring a new function

Real bash, real heredocs. The runtime registers `/lib/<tenant>/<name>.ts` on next read; no `register` or `synthesize` step.

```bash
TENANT=$(jq -r .tenantId $DATAFETCH_HOME/sessions/$(cat $DATAFETCH_HOME/active-session).json)
mkdir -p $DATAFETCH_HOME/lib/$TENANT

cat > $DATAFETCH_HOME/lib/$TENANT/myFunction.ts <<'EOF'
import { fn, llm } from "@datafetch/sdk";
import * as v from "valibot";

export const myFunction = fn({
  intent: "<one-sentence description>",
  examples: [{ input: { /* ... */ }, output: { /* ... */ } }],
  input:  v.object({ /* ... */ }),
  output: v.object({ /* ... */ }),
  body:   /* pure TS, llm({prompt, model}), or agent({skill, model}) */,
});
EOF
```

`df.lib.myFunction(input)` is callable from the next `datafetch tsx` snippet.

## Plan, Then Execute

In an intent workspace, use `datafetch run scripts/scratch.ts` to search,
sample, inspect available tools, write helper code, and draft the trajectory.
A run may be broad, but it is not the final answer and it cannot crystallise.

Use `datafetch commit scripts/answer.ts` for the committed trajectory that
answers the user. The committed source must return `df.answer(...)` and should
contain the whole repeatable workflow: retrieval calls, deterministic
transforms, and any skill-driven agent steps. This is the artifact future
agents can find, replay, and learn from.

Do not answer from `tmp/runs/N` output. If exploration identified the right
shape, write or reuse the TypeScript trajectory in `scripts/answer.ts`, run
`datafetch commit`, and answer from `result/answer.json`.

## Result envelope

Every `datafetch run`, `datafetch commit`, legacy `datafetch plan` /
`datafetch execute`, and `datafetch tsx` run prints the snippet's stdout/stderr,
then a separator and the envelope:

```
--- envelope ---
{
  "trajectoryId": "trj_...",
  "mode": "novel" | "interpreted" | "llm-backed" | "cache" | "compiled",
  "functionName": "<name-of-crystallised-fn-if-any>",
  "callPrimitives": ["db.cases.findExact", "lib.pickFiling", ...],
  "phase": "run" | "commit" | "plan" | "execute",
  "crystallisable": true | false,
  "artifactDir": "/path/to/session/artifact",
  "answer": { "status": "answered" | "partial" | "unsupported", ... },
  "validation": { "accepted": true | false, "blockers": [...] },
  "cost": { "tier": 0|1|2|3|4, "tokens": {...}, "ms": {...}, "llmCalls": n },
  "exitCode": 0
}
```

`phase: "run"` and `crystallisable: false` mean exploratory work only.
`phase: "commit"` and `validation.accepted: true` mean the committed answer can
be learned from. `mode: "novel"` and `cost.tier: 4` mean a from-scratch
composition. `mode: "interpreted"` and `cost.tier: 2` mean a crystallised
`df.lib.<name>` was used.

## Compose your full task in one snippet

The data plane records what runs through `df.*`. If you extract data via `df.db.<coll>.findExact(...)` and then process it outside the committed `datafetch commit` script (calling your own LLM, transforming locally, coming back for the next bit), the trajectory will be fragmented and the observer cannot crystallise a useful function from it. Compose the whole committed task in `scripts/answer.ts` whenever you can.

For table-math questions, do not hide the important workflow in ad hoc local
JavaScript. The committed `datafetch commit` run should call the reusable
chain explicitly: retrieve candidates with `df.db.*`, select the filing with a
`df.lib.*` helper or learned function, infer the table plan with
`df.lib.inferTableMathPlan`, and compute with `df.lib.executeTableMath`. Inline
arithmetic is fine only after the reusable primitives have been called and
recorded.

Treat broad reads like `df.db.<coll>.findExact({})` as samples unless you pass
an explicit limit or pagination strategy. A default sample is useful in plan
mode; it is not proof that a term or filing is absent from the full mount.

## Pointers

- Full design: `kb/prd/design.md` in the datafetch repo.
- Agent persona walkthrough (six-turn FinQA scenario): `kb/prd/personas.md` §3.
- Locked decisions (real bash; TS files + opt-in skills; etc.): `kb/prd/decisions.md`.
