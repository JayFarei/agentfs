# datafetch

datafetch is a bash-shaped workspace over a mounted dataset. The agent's only
tool is `bash`; the dataset surfaces as synthesised `/db/<mount>/<coll>.ts`
modules; tenant-authored functions live at `/lib/<name>.ts` written through a
single `fn({...})` factory. LLM-backed bodies dispatch through Flue used as an
in-process library, and an asynchronous observer crystallises convergent
trajectories into new `/lib/` files so the second asking of a related intent
flips from `mode: "novel"` to `mode: "interpreted"` with a measurable cost
drop.

## Layout

```
src/sdk/           public SDK barrel: fn() factory, Result envelope, runtime
                   injection points (LibraryResolver, BodyDispatcher).
src/adapter/       AtlasMountAdapter + publishMount + MountRuntimeRegistry.
src/bootstrap/     sample → infer → synthesise pipeline; emits /db/<mount>/.
src/snippet/       DiskSnippetRuntime + DiskLibraryResolver; binds df.* into
                   `npx tsx` evaluations and records trajectories.
src/flue/          in-process Flue session pool + body dispatcher.
src/observer/      template extraction + crystallisation worker; writes a new
                   /lib/<name>.ts on convergence.
src/bash/          BashSession + the three custom commands (npx tsx, man, apropos).
src/server/        four-route HTTP surface (/v1/mounts, /v1/bash).
src/demo/          headline two-question scenario (runDemo).
src/cli.ts         four subcommands: publish, connect, agent, demo.
seeds/lib/         seed primitives (pickFiling, locateFigure, etc.) authored
                   via fn({...}); mirrored into <baseDir>/lib/__seed__/.
seeds/skills/      seed skill markdown sidecars (codifier, scorers).
```

## Quickstart

```sh
pnpm install
pnpm typecheck
```

Run the offline demo (synthetic chemicals + coal filings, no Atlas required):

```sh
pnpm demo
```

Run the live demo against MongoDB Atlas:

```sh
ATLAS_URI='mongodb+srv://...' pnpm demo
```

The demo runs Q1 (novel multi-step composition over chemicals revenue) and Q2
(same intent shape on coal revenue, calling the function the observer
crystallised after Q1) and prints a side-by-side cost panel showing
`mode: "novel" / tier 4` flipping to `mode: "interpreted" / tier ≤ 2`.

`--no-cache` deletes the crystallised file before Q2 so you can confirm the
cold path still works.

## Other commands

```sh
pnpm datafetch publish finqa-2024 --uri "$ATLAS_URI"   # bootstrap a mount
pnpm datafetch connect --tenant demo-tenant            # print tenant token
pnpm datafetch agent --tenant demo-tenant              # interactive bash
pnpm api                                               # HTTP data plane
```

## Environment

- `DATAFETCH_HOME` (or legacy `ATLASFS_HOME`) — base directory under which
  `/mounts/<id>/`, `/lib/<tenant>/`, and `/trajectories/` live. Defaults to
  `<cwd>/.atlasfs`.
- `ATLAS_URI` — MongoDB Atlas connection string for the live FinQA path.
- `ANTHROPIC_API_KEY` — required for any `llm({...})` or `agent({...})` body
  dispatch on the data plane.

## Status

The Wave 5 rewrite landed Phase 6 of `kb/plans/004-datafetch-bash-mvp.md`: the
prototype's procedures-and-matchers spine is gone, the new bash + `/lib/` spine
is live, and the headline demo runs end-to-end.

Deferred (per the plan's Scope Boundaries): cross-tenant promotion,
content-addressable pins / drift handling, the compiled tier, additional
substrate adapters, typed user-SDK polish, security sandboxing.
