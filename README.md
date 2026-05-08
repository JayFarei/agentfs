# datafetch

Repository: <https://github.com/JayFarei/datafetch>

datafetch is a dataset harness for coding agents. It exposes a mounted dataset
as a bash-shaped workspace with typed TypeScript handles, writable intent
scripts, structured run artifacts, and tenant-local learned interfaces.

The rule is deliberately narrow:

```text
The system only learns from data-molding logic that was written into the
workspace and executed by datafetch.
```

Agents can inspect freely. Reusable learning comes from committed visible code
that returns `df.answer(...)` with evidence, coverage, derivation, and lineage.

## Quickstart

```sh
pnpm install
npm link            # or: pnpm link --global

datafetch server --port 8080
```

In another shell:

```sh
datafetch attach http://localhost:8080 --tenant demo

datafetch add https://huggingface.co/datasets/OpenTraces/opentraces-devtime --json
datafetch list --json
datafetch inspect opentraces-devtime --json

datafetch mount opentraces-devtime \
  --tenant demo \
  --intent "Find traces about debugging and produce an evidence-backed summary"
```

The mount command creates an intent workspace. `cd` into it and work like a
small code project:

```sh
cat AGENTS.md
cat df.d.ts
ls db lib scripts

datafetch run scripts/scratch.ts
datafetch commit scripts/answer.ts
cat result/answer.md
cat result/validation.json
```

## Workspace Contract

Each mounted intent workspace is a worktree-shaped environment:

```text
AGENTS.md
CLAUDE.md -> AGENTS.md
df.d.ts
db/
lib/
scripts/
  scratch.ts
  answer.ts
  helpers.ts
tmp/runs/
result/
```

The directories have stable meanings:

- `db/` is immutable dataset context and typed collection primitives.
- `lib/` is the tenant-local learned-interface surface.
- `scripts/` is writable user space for visible intent programs.
- `tmp/runs/` contains notebook-style exploratory run artifacts.
- `result/` contains the committed answer, lineage, validation, replay test,
  and worktree commit history.

`datafetch run` is exploratory. `datafetch commit` is the final answer path.
Only committed visible code that passes validation is eligible for learning.

## Dataset Initialization

The server owns dataset initialization. For the current prototype, supported
datasets are registered from Hugging Face dataset URLs or a server whitelist.
Initialization publishes the mount, samples the dataset, writes descriptors and
typed handles, then creates source templates for future workspaces:

```text
$DATAFETCH_HOME/sources/<source-id>/
  source.json
  manifest.json
  adapter-profile.json
  init-context.json
  init-agent.json
  templates/
    AGENTS.md
    CLAUDE.md
    scripts/scratch.ts
    scripts/answer.ts
```

The init template can be deterministic or authored through the Flue-backed
`datafetch_init_mount_template` skill. The client agent does not need to know
which path produced the template; it just receives a normal workspace.

## CLI Surface

```text
Server:
  datafetch server [--port 8080] [--base-dir <path>] [--datasets <file>]

Client/catalog:
  datafetch attach <server-url> --tenant <id>
  datafetch add <dataset-url> [--id <local-id>] [--json]
  datafetch list [--json]
  datafetch inspect <source-id> [--json]

Intent workspace:
  datafetch mount <source-id> --tenant <id> --intent '<intent>' [--path <dir>]
  datafetch run [scripts/scratch.ts]
  datafetch commit [scripts/answer.ts]

Discovery:
  datafetch apropos <query> [--json]
  datafetch man <df.lib.name>

Legacy/demo:
  datafetch session ...
  datafetch plan ...
  datafetch execute ...
  datafetch tsx ...
  datafetch publish <mount-id> --uri <atlas-uri> --db <db-name>
  datafetch demo [--mount finqa-2024] [--no-cache]
```

The default product path is `server -> attach -> add/list/inspect -> mount ->
run -> commit`.

## Seed Packs

Generic seed functions and skills live under:

```text
seeds/generic/
```

Domain-specific demo/eval packs live under:

```text
seeds/domains/<domain>/
```

By default the runtime mirrors only generic seeds into
`$DATAFETCH_HOME/lib/__seed__/`. To expose a domain pack, pass
`seedDomains` in code or set:

```sh
DATAFETCH_SEED_DOMAINS=finqa
```

The FinQA table helpers remain available for the historical demo and live
acceptance scripts, but they are no longer part of every generic dataset mount.

## Test Harnesses

Fast local verification:

```sh
pnpm typecheck
pnpm test
```

Acceptance harnesses:

```sh
bash scripts/acceptance/run-all.sh
```

The default acceptance run covers no-LLM/no-Atlas flows plus the public
Hugging Face catalog path. Live client-agent and Atlas/FinQA loops are opt-in:

```sh
RUN_AGENT_E2E=1 ATLAS_URI='mongodb+srv://...' bash scripts/acceptance/run-all.sh
```

The harness matrix is documented in
[`scripts/acceptance/README.md`](./scripts/acceptance/README.md).

## Telemetry For Evals

Set these during benchmark runs:

```sh
DATAFETCH_TELEMETRY=1
DATAFETCH_TELEMETRY_LABEL=<scenario-or-benchmark-id>
DATAFETCH_SEARCH_MODE=<baseline|learned|adapter-name>
```

Telemetry is written under:

```text
$DATAFETCH_HOME/telemetry/events.jsonl
```

Each event captures the snippet phase, trajectories, call primitives, cost
signals, answer status, validation, and enough labels to compare datafetch
against alternative agentic search baselines.

## Environment

- `DATAFETCH_HOME` - server/workspace state root. Defaults to `<cwd>/.datafetch`.
- `DATAFETCH_SERVER_URL` - client default server URL.
- `DATAFETCH_SESSION` - legacy snippet/session fallback.
- `DATAFETCH_SEED_DOMAINS` - comma-separated optional seed packs.
- `DATAFETCH_INIT_MODEL` - model for LLM-authored dataset init templates.
- `DATAFETCH_LLM_MODEL` / `DF_LLM_MODEL` - fallback model for Flue agent bodies.
- `HF_DATASETS_SERVER_URL` - override Hugging Face Dataset Viewer endpoint.
- `ATLAS_URI` / `MONGODB_URI` - optional Atlas demo/eval connection string.
- `ATLAS_DB_NAME` / `MONGODB_DB_NAME` - optional Atlas database override.
- `DATAFETCH_SKIP_ENV_FILE=1` - skip automatic `.env` loading.

Legacy `ATLASFS_HOME` and `ATLASFS_SKIP_ENV_FILE` are still honored for old
local setups.

## Source Layout

```text
bin/                  CLI binary shim
skills/datafetch/     installable client-agent skill
seeds/generic/        provider-neutral seed functions and Flue skills
seeds/domains/        optional domain/demo seed packs
scripts/acceptance/   end-to-end shell harnesses
tests/                vitest/unit/integration tests

src/adapter/          dataset substrate adapters
src/bootstrap/        sample, infer, synthesize, manifest emit
src/bash/             just-bash session integration
src/cli/              CLI command implementations
src/demo/             FinQA two-question demo
src/discovery/        library search / apropos
src/flue/             Flue dispatcher and skill loading
src/observer/         trajectory gate and learned-interface authoring
src/sdk/              public TypeScript SDK primitives
src/server/           Hono data plane and catalog routes
src/snippet/          TypeScript snippet runtime
src/trajectory/       call-scope and lineage recording
```

Local generated state stays ignored: `.datafetch/`, `.atlasfs/`,
`.snippet-cache/`, `artifacts/`, and `dist/`.

## Status

Prototype. The current useful slice is:

1. local server;
2. Hugging Face source registration;
3. dataset initialization templates;
4. intent workspace mount;
5. run/commit artifacts;
6. telemetry;
7. optional FinQA learned-interface demo.

Next step: run structured evals comparing normal agentic search against the
dataset harness path over repeated intent families.
