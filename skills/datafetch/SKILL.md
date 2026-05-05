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

## Discovery flow

When the user asks for something:

1. `cat $DATAFETCH_HOME/AGENTS.md` — what mounts are attached, what's in `/lib/`.
2. `ls $DATAFETCH_HOME/mounts/<mount>/` then `cat .../README.md` — what this dataset is.
3. `datafetch apropos "<keywords>"` — find an existing function by intent.
4. `datafetch man <fn>` — read the structured docs.
5. `cat $DATAFETCH_HOME/lib/<tenant>/<fn>.ts` — read the source if you want to use it as a template.

If a function exists, call it through `datafetch tsx -e "console.log(JSON.stringify(await df.lib.<name>(<input>)))"`.

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
