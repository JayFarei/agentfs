# How datafetch Works

datafetch is a dataset harness for coding agents. It makes a dataset feel like
a small codebase: the agent reads files, writes TypeScript, runs commands, and
commits an evidence-backed answer.

The core rule is:

```text
The system only learns from data-molding logic that was written into the
workspace and executed by datafetch.
```

Private reasoning is allowed, but it is not reusable institutional memory.

## Current Shape

The product has four surfaces.

1. Server data plane

The server owns dataset registration, mount initialization, runtime execution,
telemetry, sessions, and tenant history.

Typical startup:

```sh
datafetch server --port 8080
```

2. Dataset catalog

The prototype currently supports Hugging Face dataset URLs and a whitelist
file for pre-initialized demo datasets.

```sh
datafetch add https://huggingface.co/datasets/OpenTraces/opentraces-devtime --json
datafetch list --json
datafetch inspect opentraces-devtime --json
```

Dataset initialization samples the source, emits descriptors, creates typed
database handles, and writes source templates for future workspaces.

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

3. Intent workspace

Each mounted intent becomes a worktree-shaped folder.

```sh
datafetch mount opentraces-devtime \
  --tenant demo \
  --intent "Find traces about debugging and produce an evidence-backed summary"
```

The workspace looks like:

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

The important directories are:

- `db/` - immutable dataset context, descriptors, samples, stats, and typed
  collection primitives.
- `lib/` - tenant-local learned interfaces and helper functions.
- `scripts/` - writable user space for visible TypeScript trajectories.
- `tmp/runs/` - exploratory run artifacts.
- `result/` - final committed answer artifacts.

4. Runtime SDK

Committed code uses a small TypeScript surface:

```ts
await df.db.<collection>.search(query, { limit });
await df.db.<collection>.findExact(filter, limit);
await df.lib.<functionName>(input);

return df.answer({
  status: "answered",
  value,
  evidence,
  coverage,
  derivation,
});
```

`df.db.*` grounds work in real dataset primitives. `df.lib.*` exposes learned
or seed interfaces. `df.answer(...)` is the structured final-answer envelope.

## Run Versus Commit

`datafetch run` is exploratory.

```sh
datafetch run scripts/scratch.ts
```

It writes:

```text
tmp/runs/001/
  source.ts
  result.json
  result.md
  lineage.json
```

`datafetch commit` is the accepted answer path.

```sh
datafetch commit scripts/answer.ts
```

It writes:

```text
result/
  answer.json
  answer.md
  validation.json
  lineage.json
  HEAD.json
  tests/replay.json
  commits/001/
```

Only committed visible code that passes validation is eligible for learning.

## Agentic Steps

Some trajectories need judgment. A `df.lib.*` function can call a Flue-backed
agent body through `agent({ skill })` or `agent({ prompt })`.

The design rule is that the probabilistic step must still be visible inside
the committed TypeScript trajectory. A hidden server-side or client-side LLM
answer may help the user once, but it does not teach the dataset harness how to
serve that intent next time.

## Seed Packs

Generic seed functions and skills live under:

```text
seeds/generic/
```

Domain-specific demo or eval packs live under:

```text
seeds/domains/<domain>/
```

By default the runtime installs only generic seeds. Domain packs are opt-in via
code or:

```sh
DATAFETCH_SEED_DOMAINS=finqa
```

This prevents one demo dataset from leaking into the generic agent experience.

## What The Agent Sees

The client agent should experience datafetch as a normal code workspace. The
first useful loop is:

```sh
cat AGENTS.md
cat df.d.ts
ls db lib scripts
datafetch apropos "debugging trace summary"
datafetch run scripts/scratch.ts
datafetch commit scripts/answer.ts
cat result/answer.md
```

The server sees the executable trajectory, lineage, evidence, validation, and
telemetry needed to decide whether anything should be learned.
