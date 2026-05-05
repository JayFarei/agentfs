---
name: datafetch
description: Use the datafetch CLI to drive bash-shaped tenanted sessions over mounted MongoDB Atlas datasets. Triggers when the user asks about datafetch workspaces, the FinQA dataset, mounted databases, /db/ or /lib/ contents, or wants to crystallise a function from a trajectory.
---

# datafetch

Datafetch is a bash-shaped workspace over a mounted dataset. The data plane is a long-lived HTTP server on `localhost:8080`; you drive it from your shell with the `datafetch` CLI. Every tenant gets their own session, their own private `/lib/` overlay of typed TypeScript functions, and a shared read-only view of the registered mounts.

Your job, when given a data question: orient, look for an existing function, call it; if nothing fits, compose a snippet from primitives. The runtime records the trajectory; if it converges with prior runs, the observer crystallises a parameterised `/lib/<tenant>/<name>.ts` for next time.

## Workspace layout

The on-disk root is `$DATAFETCH_HOME` (default `~/.atlasfs` or the cwd's `.atlasfs/`). Read this first if it's present:

- `$DATAFETCH_HOME/AGENTS.md` — workspace orientation (auto-generated).
- `$DATAFETCH_HOME/lib/<tenant>/<name>.ts` — your tenant-private typed functions.
- `$DATAFETCH_HOME/lib/__seed__/<name>.ts` — fallback seeds shared across tenants.
- `$DATAFETCH_HOME/mounts/<mount-id>/` — substrate-derived files for each mount (per-collection schema modules, samples, descriptors).
- `$DATAFETCH_HOME/trajectories/<id>.json` — what the runtime recorded for each `tsx` execution.
- `$DATAFETCH_HOME/sessions/<sessionId>.json` — server-managed session records.
- `$DATAFETCH_HOME/active-session` — plain-text pointer to the current session id (managed by `datafetch session new|resume`).

## Custom verbs

Four real CLI verbs back the agent loop. They all hit the localhost data plane:

```
datafetch session new --tenant <id> [--mount <id>...] [--json]
datafetch session list [--json]
datafetch session resume <sessionId>
datafetch session end <sessionId>
datafetch session switch --tenant <id> [--mount <id>...]
datafetch session current

datafetch tsx -e '<source>'         # run a one-liner
datafetch tsx <file>                # run a saved snippet

datafetch man <fn>                  # render NAME / SYNOPSIS / INPUT / OUTPUT / EXAMPLES
datafetch apropos <kw>              # semantic search across /lib/ intents
```

Resolution order for the active session: `--session <id>` flag, then `DATAFETCH_SESSION` env var, then `$DATAFETCH_HOME/active-session`. `session new` writes the pointer; `session end` clears it if it was active.

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
datafetch tsx -e "console.log(JSON.stringify(await df.lib.<name>(<input>)))"
```

Use the example in the frontmatter as a guide for the input shape. Do
not re-compose the chain by hand; the wrapper already encodes it.

### Tier 3 — Base primitives

The seed functions (`pickFiling`, `executeTableMath`, retrieval handles
on `df.db.<coll>`, etc.) live at `$DATAFETCH_HOME/lib/__seed__/`. These
have no frontmatter. Compose from them only when no trajectory or tool
fits.

```bash
ls $DATAFETCH_HOME/lib/__seed__/
head -25 $DATAFETCH_HOME/lib/__seed__/<name>.ts   # signature + JSDoc
cat   $DATAFETCH_HOME/lib/__seed__/<name>.ts      # full body if you need it as a template
```

Primitives always need to be grounded in the substrate via `df.db.<coll>.*`
calls — never construct filing/case data by hand. If the substrate seems
unavailable, that is the exception worth investigating, not a reason to
fabricate inputs. (See "Don't fabricate" below.)

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
seems off — investigate. Read the error. Try `curl http://localhost:8080/health`.
Read `cat $DATAFETCH_HOME/server.log`. Try a smaller query.

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

## Result envelope

Every `datafetch tsx` run prints the snippet's stdout/stderr, then a separator and the envelope:

```
--- envelope ---
{
  "trajectoryId": "trj_...",
  "mode": "novel" | "interpreted" | "llm-backed" | "cache" | "compiled",
  "functionName": "<name-of-crystallised-fn-if-any>",
  "callPrimitives": ["db.cases.findExact", "lib.pickFiling", ...],
  "cost": { "tier": 0|1|2|3|4, "tokens": {...}, "ms": {...}, "llmCalls": n },
  "exitCode": 0
}
```

`mode: "novel"` and `cost.tier: 4` mean a from-scratch composition. `mode: "interpreted"` and `cost.tier: 2` mean a crystallised `df.lib.<name>` was used. Successful first-time ad-hoc compositions become candidates for crystallisation — re-run a similar query and the next envelope should report `mode: "interpreted"`.

## Compose your full task in one snippet

The data plane records what runs through `df.*`. If you extract data via `df.db.<coll>.findExact(...)` and then process it outside the `datafetch tsx` snippet (calling your own LLM, transforming locally, coming back for the next bit), the trajectory will be fragmented and the observer cannot crystallise a useful function from it. Compose the whole task in one `tsx` snippet whenever you can.

## Pointers

- Full design: `kb/prd/design.md` in the datafetch repo.
- Agent persona walkthrough (six-turn FinQA scenario): `kb/prd/personas.md` §3.
- Locked decisions (real bash; TS files + opt-in skills; etc.): `kb/prd/decisions.md`.
