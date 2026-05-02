```text
    _   _   _             _____ ____
   / \ | |_| | __ _ ___  |  ___/ ___|
  / _ \| __| |/ _` / __| | |_  \___ \
 / ___ \ |_| | (_| \__ \ |  _|  ___) |
/_/   \_\__|_|\__,_|___/ |_|   |____/
```

# AtlasFS

AtlasFS is a hackathon proof that retrieval systems can learn from successful
agent trajectories. A user asks a question, the system searches MongoDB Atlas,
executes typed primitives, observes the successful chain, and saves reusable
procedures or agent primitives for the next similar query.

The demo has two front doors:

- **UI:** React/Vite app showing Alice and Bob's tenant memory evolving.
- **CLI:** terminal fallback that runs the same Atlas + Flue proof loop.

## What It Proves

1. FinQA data lives in MongoDB Atlas.
2. Retrieval uses MongoDB Atlas Search over normalized filing/table units.
3. A novel question records a trajectory of typed primitive calls.
4. The observer turns successful trajectories into reusable procedures.
5. Flue can create a task-specific agent primitive at runtime.
6. A later similar question reuses the saved procedure or agent instead of
   rebuilding the full chain.

## Requirements

- Node.js 24+.
- `pnpm`.
- MongoDB Atlas connection string for a cluster with FinQA loaded.
- Anthropic API key. This is required for the live Flue observer/scorer path.

Create `.env` in the repo root:

```sh
ATLAS_URI='mongodb+srv://...'
ATLAS_DB_NAME='atlasfs_hackathon'
ANTHROPIC_API_KEY='sk-ant-...'

ATLASFS_OBSERVER='flue'
ATLASFS_OUTLOOK_AGENT='flue'
```

Install:

```sh
pnpm install
pnpm web:install
```

Check Atlas:

```sh
pnpm atlasfs atlas-status
```

Expected live target:

- database: `atlasfs_hackathon`
- collections: `finqa_cases`, `finqa_search_units`
- Atlas Search indexes: `finqa_cases_text`, `finqa_units_text`

## Run The UI Demo

```sh
pnpm demo
```

Open:

```text
http://localhost:5173
```

The API runs on `http://localhost:5174`; the Vite app proxies `/api` to it.

For a clean first-run demo, click `[ start over ]` for Alice and Bob, or start
with a fresh local memory folder:

```sh
ATLASFS_HOME=/tmp/atlasfs-demo pnpm demo
```

## Run The CLI Demo

```sh
pnpm atlasfs demo --project ./atlasfs-live-demo --reset
```

The CLI prints each staged intent, the answer, primitive calls, and newly
created artifacts.

## Demo Story

Path A shows deterministic procedure reuse:

```text
chemical revenue range -> search + table math -> saves table_math
coal revenue range     -> replays procedures.table_math
```

Path B shows agent primitive reuse:

```text
Visa negative outlook sentences     -> observer creates scorer agent + procedure
Visa negative outlook titles/quotes -> reuses scorer agent, writes new glue
same title/quote query again        -> replays one saved procedure
```

The important thing to watch is not only the answer. Watch the tenant memory:
procedures and agent primitives appear after successful novel runs, then
shorten later runs.

## Loading Data Yourself

If you are not using a pre-loaded Atlas cluster:

```sh
pnpm atlasfs load-finqa --all --reset
pnpm atlasfs setup-search --timeout-ms=240000
pnpm atlasfs atlas-status
```

## Limitations

This repository is a hackathon proof, not the full system in
`kb/product-design.md`.

- `findSimilar` currently uses Atlas Search lexical relevance via `$search`,
  not the planned Voyage embeddings, reranking, and `$rankFusion` hybrid path.
- Tenant memory is local `.atlasfs` files, not durable multi-tenant storage.
- The demo covers a small FinQA-shaped intent set, not open-ended procedure
  induction.
- Procedure replay is one call at the runner level, but the later worker that
  compiles hot procedures into Atlas aggregation pipelines is not implemented.
- Flue artifacts are created live, but safety review, sandboxing, versioning,
  and promotion are minimal hackathon versions.

## Useful Commands

```sh
pnpm typecheck
pnpm --dir web typecheck
pnpm --dir web build
pnpm exec flue build --target node --workspace ./.flue --output /tmp/atlasfs-flue-build-check
RUN_ATLAS_TESTS=1 pnpm exec vitest run tests/atlas-search-live.test.ts
```
