---
title: "feat: Agent-Only CLI + Claude Code skill"
summary: "Drop the developer SDK; ship a client-server CLI that Claude Code drives through bash + a skill, with tenant session lifecycle, fixed cost-panel signal, and a tmux-based acceptance harness."
type: feat
status: proposed
date: 2026-05-05
related_research:
  - kb/plans/004-datafetch-bash-mvp.md
  - kb/prd/design.md
  - kb/prd/decisions.md
  - kb/prd/personas.md
---

# Agent-Only CLI + Claude Code skill

## Overview

Plan 004 shipped the bash-shaped MVP but left the agent loop unproved end-to-end and the cost-panel signal flat. This plan parks the developer persona entirely (no `datafetch.connect()`, no `df.query`, no per-tenant `.d.ts`) and finishes the agent persona by:

1. Splitting the runtime into a long-lived **server** (data plane) and a thin **CLI client** that talks HTTP, matching D-008 / R8.
2. Surfacing the bash session's vocabulary as **real CLI verbs** (`datafetch man`, `datafetch apropos`, `datafetch tsx`) so any plain-bash agent can drive it.
3. Shipping a **Claude Code skill** that orients the model on the CLI surface; we install it at `~/.claude/skills/datafetch/`.
4. Making **tenant sessions** server-side state with `--session` / `--tenant` flags for create / resume / switch.
5. Fixing the **cost-panel signal** so Q1 reports `mode: "novel" / tier: 4` and Q2 reports `mode: "interpreted" / tier: 2`, with fractional ms and a fixture-checked gold-answer assertion.
6. Driving the headline two-question scenario through **Claude Code in a tmux pane** as the acceptance test, with all artefacts (trajectory, crystallised file, answer correctness) asserted from disk.

## Problem Frame

The 004 MVP shows the substrate works but the elevator pitch's left column reads the same as the right (`mode: interpreted` / `tier: 2` in both). The semantic flip happened because `mode: "novel"` was redefined inside the codebase to mean "snippet errored." The fixture-correctness check is missing entirely; the demo's offline path returns 700 / 1000 from a stub but doesn't compare against FinQA gold values. The agent loop has never actually been driven by an LLM end-to-end — every "agent" exercise is either a hand-written snippet or a unit smoke. And the data-plane / agent-client split is structurally absent: `pnpm datafetch agent` runs in-process so credentials sit in the same env as the agent.

This plan closes those gaps in the smallest set of moves, while explicitly parking the developer surface to keep scope tight.

## Requirements Trace

- **R1.** Two binaries from one package: `datafetch server` boots the Hono data plane; `datafetch <subcommand>` is the client. Server holds all secrets + session state + Flue session per tenant + observer.
- **R2.** Server exposes `/v1/mounts` (POST/GET/DELETE/SSE — already shipped), `/v1/bash`, `/v1/connect` (new), `/v1/sessions[/:id]` (new — list/get/end), `/v1/snippets` (new — execute TS).
- **R3.** Client subcommands: `publish`, `server`, `connect`, `session new|list|resume|end|switch`, `agent` (interactive, talks to /v1/bash), `man`, `apropos`, `tsx -e <src>` / `tsx <file>`, `demo` (runs the live two-question scenario), `install-skill`. Every subcommand resolves session via `--session`, then `DATAFETCH_SESSION` env var, then `~/.datafetch/active-session` pointer.
- **R4.** `Result<T>` envelope's `mode` field uses the PRD enum exactly: `cache | compiled | interpreted | llm-backed | novel`. First-time successful ad-hoc composition reports `mode: "novel"` and `cost.tier: 4`. Snippet errors are routed through `escalations > 0` (or a new `errored` boolean) and **do not** flip mode to "novel."
- **R5.** `cost.ms.{hot,cold}` recorded as fractional milliseconds (no integer rounding).
- **R6.** Demo asserts `value` against the active FinQA case's `expectedAnswer`; mismatch fails the demo. Both Q1 and Q2 print `✓ expected=X actual=X`.
- **R7.** Skill bundle at `skills/datafetch/SKILL.md` orients Claude Code on the CLI surface, the orientation files (`~/.datafetch/AGENTS.md`, `/db/<mount>/README.md`), the four verbs, the heredoc authoring pattern, and the leakage convention from D-020.
- **R8.** Acceptance harness drives Claude Code in a tmux pane via `claude --print --bare --allowedTools 'Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)'` against a scripted task. After completion the harness asserts: trajectory file present, crystallised `/lib/<tenant>/<name>.ts` written, answer matches the FinQA fixture. Three harness scripts: agent-loop, llm-body-loop, session-switch.

## Scope Boundaries

- **No developer SDK.** No `datafetch.connect()`, no `df.query({intent, expect})`, no per-tenant `.d.ts` regen, no auto-typed `df.lib.<name>` namespace at the JS level. Plan 004's scope cuts here remain in force.
- **No HTTPS, no auth.** Server binds `localhost:8080` by default; tenant tokens are opaque strings unchecked by the server. Real auth lands when the data plane goes hosted.
- **No compiled tier.** `mode: "compiled"` and `cost.tier: 1` are reserved.
- **No content-addressable pins, drift detection, cross-tenant promotion, additional substrate adapters, vector retrieval upgrade.** All deferred per plan 004.
- **No persistence beyond sessions + lib + trajectories.** Server state is in-memory plus `$DATAFETCH_HOME/sessions/`; restart loses Flue session warm-up but reloads sessions from disk.

## Architecture

```
+------------------------- CLAUDE CODE (host LLM) ------------------------+
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
|                                                                         |
|  In-memory: BashSession per session, Flue session per tenant,          |
|             observer scheduler, mount runtime registry                  |
|  On disk:   $DATAFETCH_HOME/{mounts, lib/<tenant>, sessions, trajectories} |
+------------------------------------------------------------------------+
                                   |
                                   v
                        MongoDB Atlas (FinQA)
```

### File ownership by phase

| Phase | New files | Modified files |
|---|---|---|
| Phase 0 (server) | `src/server/v1connect.ts`, `src/server/v1sessions.ts`, `src/server/v1snippets.ts`, `src/server/sessionStore.ts`, `bin/datafetch.mjs` (later) | `src/server/server.ts`, `src/cli.ts` (server subcommand only) |
| Phase 1 (cost-panel) | — | `src/sdk/result.ts`, `src/observer/gate.ts`, `src/trajectory/recorder.ts`, `src/snippet/runtime.ts`, `src/demo/runDemo.ts` |
| Phase 2+3+4 (client + skill) | `skills/datafetch/SKILL.md`, `src/cli/sessionCmds.ts`, `src/cli/agentVerbs.ts`, `src/cli/installSkill.ts`, `src/cli/httpClient.ts` | `src/cli.ts` (subcommand wiring) |
| Phase 5 (tests) | `scripts/acceptance/agent-loop.sh`, `scripts/acceptance/llm-body-loop.sh`, `scripts/acceptance/session-switch.sh`, `scripts/acceptance/lib/*.sh` | — |
| Phase 6 (packaging) | `bin/datafetch.mjs` | `package.json`, `README.md` |

## Milestones

### Phase 0 — Server foundation

**What to build.** A `datafetch server` subcommand that boots the existing Hono app, plus three new route groups. `/v1/connect` accepts `{tenantId, mountIds?}` and returns `{sessionId, tenantId, mountIds}` (mountIds default to all currently-registered). `/v1/sessions` supports list-all / get-by-id / delete-by-id. `/v1/snippets` accepts `{sessionId, source}`, runs the snippet through `installSnippetRuntime`, returns the `Result<T>` envelope. Sessions persist to `$DATAFETCH_HOME/sessions/<id>.json` on creation; loaded on server boot; the in-memory `BashSession` rehydrates lazily on first use.

**Acceptance criteria.**
- [ ] `datafetch server [--port 8080]` starts the Hono app and prints `[server] listening on http://localhost:8080`.
- [ ] `curl -X POST http://localhost:8080/v1/connect -d '{"tenantId":"t1"}'` returns `{sessionId, tenantId, mountIds}`.
- [ ] `curl http://localhost:8080/v1/sessions` lists sessions; `DELETE /v1/sessions/<id>` removes one.
- [ ] `curl -X POST http://localhost:8080/v1/snippets -d '{"sessionId":"s1","source":"console.log(await df.db.cases.findExact({}, 1))"}'` returns the Result envelope.
- [ ] Restarting the server preserves sessions on disk.

### Phase 1 — Cost-panel signal + gold-answer assertion

**What to build.** Restore PRD-spec `mode` semantics. Today `mode: "novel"` is set by the recorder when a snippet errors. Move that to `escalations > 0` (or a new boolean field if escalations is too overloaded). For successful first-time ad-hoc compositions, the snippet runtime sets `mode: "novel"` and `cost.tier: 4`. For invocations that resolve through `df.lib.<crystallised>`, the runtime keeps `mode: "interpreted"` and `cost.tier: 2`. Update `src/observer/gate.ts` to skip on the new error signal, not on `mode === "novel"`. Record `ms` with `performance.now()` precision (no `Math.round`/`Math.floor`). In `src/demo/runDemo.ts`, after each Q result, look up the originating FinQA case (live mode: `df.db.finqaCases.findExact({id: ...})`; offline stub: the embedded `expectedAnswer`) and print `✓ expected=X actual=X` or `✗`.

**Acceptance criteria.**
- [ ] `pnpm demo` cost panel: Q1 reports `mode: "novel"` `tier: 4`; Q2 reports `mode: "interpreted"` `tier: 2`.
- [ ] `cost.ms.cold` is non-zero for both rows (sub-ms is fine; integer-zero is the failure mode).
- [ ] Both rows print `✓ expected=… actual=…`.
- [ ] Snippet errors still cause the observer to skip — verify by triggering an error and asserting no crystallised file appears.

### Phase 2+3+4 — Client CLI verbs + skill bundle

**What to build.** Three groups of work in one phase because they all modify `src/cli.ts`:

*Session subcommands.* `datafetch session new --tenant <id> [--mount <id>...]` posts to `/v1/connect`, prints `{sessionId, tenant, mounts}` JSON. `datafetch session list` GETs `/v1/sessions`. `datafetch session resume <sessionId>` writes `~/.datafetch/active-session` and prints "active". `datafetch session end <sessionId>` DELETEs. `datafetch session switch --tenant <id>` ends current active session, creates a new one for the given tenant.

*Agent verbs.* `datafetch man <fn>` reads `$DATAFETCH_HOME/lib/<tenant>/<fn>.ts` (resolving tenant from active session), parses the `fn({intent, examples, input, output})` call, renders a man page. `datafetch apropos <kw>` scores all `/lib/<tenant>/*.ts` files by intent-string token overlap and prints matches above a threshold. `datafetch tsx -e '<source>'` and `datafetch tsx <file>` POST to `/v1/snippets` with `{sessionId, source}`. Output is the snippet's stdout/stderr; the `Result<T>` envelope is appended to stdout under a `--- envelope ---` separator (so plain-text consumers can ignore it; structured consumers can parse it).

*Skill bundle.* `skills/datafetch/SKILL.md` is a single markdown file with frontmatter (`name: datafetch`, `description: ...`) and a body that orients Claude Code: how to start (read `~/.datafetch/AGENTS.md`), the four custom verbs, the heredoc authoring pattern (`cat > ~/.datafetch/lib/<tenant>/<name>.ts <<EOF`), the trajectory contract, the leakage convention. `datafetch install-skill [--path ~/.claude/skills/datafetch]` copies the bundle.

**Acceptance criteria.**
- [ ] `datafetch session new --tenant test-jay` returns a session id.
- [ ] `DATAFETCH_SESSION=<id> datafetch tsx -e 'console.log(await df.db.finqaCases.findExact({}, 1))'` prints a row.
- [ ] After authoring `~/.datafetch/lib/test-jay/foo.ts` via heredoc, `datafetch man foo` renders correctly and `datafetch apropos <kw-from-intent>` finds it.
- [ ] `datafetch install-skill` writes a non-empty `~/.claude/skills/datafetch/SKILL.md`.
- [ ] All session subcommands produce JSON output with `--json` flag for scripting.

### Phase 5 — Acceptance test harness

**What to build.** Three bash scripts under `scripts/acceptance/` that drive Claude Code in a tmux session and assert on disk artefacts.

`scripts/acceptance/agent-loop.sh` — the headline:
1. `setup_dataplane`: fresh `$DATAFETCH_HOME=/tmp/df-acceptance`; `datafetch publish finqa-2024 --db atlasfs_hackathon`; `datafetch server &`; `datafetch install-skill`.
2. `session=$(datafetch session new --tenant test-jay --json | jq -r .sessionId)`.
3. Spawn `tmux new-session -d -s dft 'claude --print --bare --allowedTools "Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *) Bash(grep *)" --append-system-prompt "Active datafetch session: $session" "What is the range of chemicals revenue between 2014 and 2018? Use the datafetch CLI."'`.
4. Wait for tmux pane PID to exit (or 5-min timeout).
5. Assert: `~/.datafetch/trajectories/` has at least 1 new file; `~/.datafetch/lib/test-jay/crystallise_*.ts` exists; final answer == expected from FinQA fixture.
6. Re-spawn for Q2 (coal revenue); assert trajectory invokes the wrapper; mode == "interpreted".
7. `teardown`.

`scripts/acceptance/llm-body-loop.sh` — drives a task that requires writing a `body: llm({...})` function. Asserts the result envelope reports `mode: "llm-backed"` and `cost.llmCalls ≥ 1`.

`scripts/acceptance/session-switch.sh` — creates two sessions for two tenants, writes a function in each `/lib/<tenant>/`, switches between them, asserts each tenant only sees its own overlay.

Common helpers in `scripts/acceptance/lib/assertions.sh`.

**Acceptance criteria.**
- [ ] All three scripts pass on a fresh checkout (with `ATLAS_URI` and `ANTHROPIC_KEY` set).
- [ ] Each script runs in <3 minutes.
- [ ] Each script tears down cleanly (server killed, baseDir removed) on success or failure.

### Phase 6 — Packaging

**What to build.** `bin/datafetch.mjs` shim that runs `node --import tsx src/cli.ts` (or `tsx src/cli.ts`). `package.json` gains `"bin": { "datafetch": "./bin/datafetch.mjs" }`. README.md rewritten around the agent flow:

```
1. pnpm install && pnpm link --global
2. datafetch publish finqa-2024 --uri $ATLAS_URI --db atlasfs_hackathon
3. datafetch server &
4. datafetch install-skill
5. datafetch session new --tenant me
6. claude --bare --allowedTools "Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)"
   > "What is the range of chemicals revenue between 2014 and 2018?"
```

**Acceptance criteria.**
- [ ] `pnpm link --global` makes `datafetch` available globally on the dev box.
- [ ] `datafetch --help` lists every subcommand.
- [ ] README walks the five-step quickstart end-to-end.

## Verification

1. `pnpm demo` cost panel shows the diff (mode/tier/ms/✓).
2. `pnpm test` (vitest + smokes) all green.
3. `bash scripts/acceptance/agent-loop.sh` passes against live Atlas.
4. `bash scripts/acceptance/llm-body-loop.sh` passes against live Atlas + Anthropic.
5. `bash scripts/acceptance/session-switch.sh` passes.
6. `pnpm link --global && datafetch --help` works from `/tmp` (i.e., outside repo).
7. Manual: open Claude Code with the skill installed, ask "what's in /db?", confirm it runs `cat ~/.datafetch/AGENTS.md` first.

## Decision Audit Trail

| # | Phase | Decision | Rationale |
|---|---|---|---|
| 1 | Architecture | Client-server, not in-process | Honours D-008 / R8; HTTP server scaffolding already exists; tenant sessions get a natural home as server-side state. |
| 2 | Architecture | Claude Code as agent driver, not bespoke Anthropic-SDK loop | Tool loop already implemented and battle-tested; we exercise the real production loop on day one. |
| 3 | Scope | Park developer SDK | Out-of-scope per user direction; agent persona is the demo target. |
| 4 | Architecture | Real CLI verbs (`man`, `apropos`, `tsx`) instead of just-bash custom commands | Claude Code drives plain shell; real verbs honour D-013 (real bash, not invented vocab) and let any plain-bash agent integrate. |
| 5 | Architecture | Two LLM keys distinct (server-side for Flue body dispatch; agent-side for Claude Code) | Mirrors production roles: data-plane operator owns Flue key; agent client owns its own LLM key (Claude.ai/Pro/etc.). Local dev: same `.env` is fine. |
| 6 | Architecture | Sessions as server-side state, persisted to disk | Survives server restarts; `--session` flag is just an id; no client-side state to corrupt. |
| 7 | Implementation | `mode: "novel"` restored to PRD semantics; error path moves to `escalations > 0` | Plan 004's redefinition silently invalidated the elevator-pitch's left column. |
| 8 | Implementation | Acceptance tests are bash scripts with on-disk assertions | CI-friendly; uses tmux + claude --print headlessly; reproducible from a fresh checkout. |

## Out-of-scope (explicitly)

- Developer SDK (`datafetch.connect`, `df.query`, `df.run` as a user API, per-tenant `.d.ts`).
- HTTPS / auth / multi-tenant access control.
- Compiled tier (mode "compiled" / tier 1).
- Content-addressable pins (`@sha256:` imports), drift detection, verifier replay.
- Cross-tenant promotion (`family-promoted` events, mount-shared `/lib/`).
- Additional substrate adapters (HuggingFace, Postgres, SQLite, JSONL, S3).
- Vector retrieval upgrade (`findSimilar`/`hybrid` stay lexical via Atlas Search).
- True data-plane / agent-client physical separation (everything on `localhost`).
