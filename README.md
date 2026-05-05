# datafetch

datafetch is a bash-shaped workspace over a mounted dataset. A long-lived
data plane (HTTP server on `localhost:8080`) holds the substrate; an agent
(Claude Code, or any tool with a bash loop) drives it through the
`datafetch` CLI. Each tenant gets a session, a private `/lib/` overlay of
typed TypeScript functions, and read-only access to the registered mounts.
Snippets the agent composes are recorded; convergent trajectories
crystallise into reusable `/lib/<tenant>/<name>.ts` files, so the second
asking of a related intent flips from `mode: "novel"` to
`mode: "interpreted"` with a measurable cost drop.

The agent's only tool is bash. The dataset surfaces as `/db/<mount>/<coll>.ts`
modules. Tenant functions live at `/lib/<name>.ts` written through a single
`fn({...})` factory. LLM-backed bodies dispatch through Flue used as an
in-process library.

## Quickstart

```sh
# 1. install + link the global binary
pnpm install
npm link            # or: pnpm link --global (see "pnpm link quirk" below)

# 2. set env (.env is auto-loaded; ATLAS_URI is required for live mode)
cp .env.example .env || true   # create one if you haven't
# edit .env: ATLAS_URI=mongodb+srv://... ; ANTHROPIC_API_KEY=sk-ant-...

# 3. publish a mount (live Atlas; or skip and run `datafetch demo` offline)
datafetch publish finqa-2024 --uri "$ATLAS_URI" --db atlasfs_hackathon

# 4. boot the data plane (foreground or backgrounded)
datafetch server &     # http://localhost:8080

# 5. install the Claude Code skill (~/.claude/skills/datafetch/)
datafetch install-skill
```

Verify the link:

```sh
which datafetch         # path to the linked binary
datafetch --help        # lists every subcommand
```

## Driving the agent loop

Create a session, then either drive it interactively through Claude Code
or run the scripted demo:

```sh
datafetch session new --tenant me

# Interactive: launches Claude Code with bash allowlisted to the four
# verbs the agent needs. Skill is auto-loaded from ~/.claude/skills/.
claude --bare --allowedTools "Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)"
```

The scripted scenario (Q1 over chemicals revenue → observer crystallises
a function → Q2 over coal revenue calls the crystallised function) prints
a side-by-side cost panel:

```sh
datafetch demo                 # live Atlas if ATLAS_URI is set; offline stub otherwise
datafetch demo --no-cache      # delete the crystallised file before Q2 to confirm cold path
```

Q1 reports `mode: "novel" / tier: 4`; Q2 reports `mode: "interpreted" / tier: 2`.
Both rows print `✓ expected=X actual=X` against the FinQA gold value.

## Subcommand reference

```
Server / data plane:
  datafetch server [--port 8080] [--base-dir <path>]
  datafetch publish <mount-id> [--uri <atlas-uri>] [--db <db-name>]

Sessions (talk to the server over HTTP):
  datafetch session new --tenant <id> [--mount <id>...] [--json]
  datafetch session list [--json]
  datafetch session resume <sessionId>
  datafetch session end <sessionId>
  datafetch session switch --tenant <id> [--mount <id>...]
  datafetch session current

Agent verbs (resolve --session / DATAFETCH_SESSION / pointer):
  datafetch tsx -e '<source>' | datafetch tsx <file>
  datafetch man <fn>
  datafetch apropos <kw> [--json]

Skill bundle:
  datafetch install-skill [--path <dir>] [--force]

Misc:
  datafetch connect [--tenant <id>]
  datafetch agent   [--tenant <id>] [--mount <id>]      # in-process bash REPL
  datafetch demo    [--mount finqa-2024] [--no-cache]
```

Common flags: `--server <url>` (default `http://localhost:8080`),
`--session <id>` (override active pointer), `--base-dir <path>` (override
`DATAFETCH_HOME`).

## Where state lives

`$DATAFETCH_HOME` defaults to `~/.atlasfs` (legacy name; the canonical env
var name is `DATAFETCH_HOME`). Subdirectories:

```
$DATAFETCH_HOME/
  mounts/<mount-id>/      substrate-derived per-collection schema modules,
                          samples, READMEs (one folder per registered mount).
  lib/<tenant>/<name>.ts  tenant-private typed functions (fn({...}) factory).
  lib/__seed__/<name>.ts  seed primitives shared across tenants.
  sessions/<id>.json      server-managed session records.
  trajectories/<id>.json  per-`tsx` execution recordings used for crystallisation.
  active-session          plain-text pointer used as the fallback session id.
  AGENTS.md               auto-generated workspace orientation.
```

## Architecture in 30 seconds

```
+------------------------- Claude Code (host LLM) ------------------------+
| Tools: bash (allowlisted to "datafetch *", "cat *", "ls *", "jq *")    |
| Skill: ~/.claude/skills/datafetch/SKILL.md                              |
+------------------------------------------------------------------------+
                                   |
                                   v  shell exec
+------------------------- datafetch CLI (client) ------------------------+
| publish, server, session, agent, man, apropos, tsx, demo, install-skill|
| Resolves --session / DATAFETCH_SESSION / ~/.datafetch/active-session   |
+------------------------------------------------------------------------+
                                   |  HTTP localhost:8080
                                   v
+------------------------- datafetch server (data plane) -----------------+
|  /v1/mounts        publishMount; SSE warm-up; GET list; DELETE teardown|
|  /v1/connect       create session; returns {sessionId, tenant, mounts} |
|  /v1/sessions      GET list / GET :id / DELETE :id                     |
|  /v1/bash          run one bash command in a persistent BashSession    |
|  /v1/snippets      run a TS snippet against a session; returns Result  |
+------------------------------------------------------------------------+
                                   |
                                   v
                        MongoDB Atlas (FinQA)
```

## Environment

- `DATAFETCH_HOME` — base directory for `mounts/`, `lib/`, `sessions/`,
  `trajectories/`. Falls back to `ATLASFS_HOME`, then `<cwd>/.atlasfs`.
- `DATAFETCH_SESSION` — fallback session id when `--session` is absent
  and `active-session` is empty.
- `DATAFETCH_SERVER_URL` — fallback data-plane base URL (default
  `http://localhost:8080`).
- `ATLAS_URI` — MongoDB Atlas connection string for the live FinQA path.
- `ANTHROPIC_API_KEY` — required for any `llm({...})` or `agent({...})`
  body dispatch on the data plane.

## Testing

```sh
pnpm test                           # vitest + the bash/snippet smokes
pnpm typecheck                      # tsc --noEmit
pnpm demo                           # end-to-end Q1/Q2 cost panel

# Bash acceptance harness (run against live Atlas + Anthropic key):
bash scripts/acceptance/agent-loop.sh
bash scripts/acceptance/llm-body-loop.sh
bash scripts/acceptance/session-switch.sh
```

The acceptance scripts drive Claude Code in a tmux pane and assert on
on-disk artefacts (trajectories, crystallised `/lib/` files, gold-value
correctness). Phase 5 of `kb/plans/005-agent-only-cli.md` covers the
harness in detail.

## pnpm link quirk

If `pnpm link --global` errors with `ERR_PNPM_UNEXPECTED_STORE`, your
global pnpm store has drifted from this project's store. Easiest fix:
use `npm link` instead — the `bin` entry in `package.json` is identical
either way. To stick with pnpm, run `pnpm install` to realign stores or
`pnpm config set store-dir <dir> --global` to point at the same store.

## Pointers

- Full product design: [`kb/prd/`](./kb/prd/) — `design.md`, `decisions.md`,
  `personas.md`.
- Plan history: [`kb/plans/`](./kb/plans/) — 004 (bash MVP), 005 (agent-only
  CLI + skill, the current cut).
- Source layout: `src/sdk/` (public SDK), `src/adapter/` (Atlas mount),
  `src/bootstrap/` (sample/infer/synthesise), `src/snippet/` (runtime),
  `src/observer/` (crystallisation worker), `src/bash/` (BashSession),
  `src/server/` (HTTP routes), `src/cli/` (subcommands), `src/cli.ts`
  (entry).

## Status

Hackathon-grade. Plan 005 Phase 6 (this packaging cut) wraps the
client-server split, the four agent verbs, the Claude Code skill, and the
restored `mode: "novel" / tier: 4` cost-panel signal. Deferred per the
plans' Scope Boundaries: HTTPS / auth, compiled tier, content-addressable
pins, drift detection, cross-tenant promotion, additional substrate
adapters, vector retrieval upgrade.
