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

The demo has three front doors:

- **Local filesystem:** self-contained `ATLASFS_HOME` runtime with fixture
  corpora, hooks, review, verifier, budget, drift, and eval ledger.
- **UI:** React/Vite app over the same workspace state, with the old two-pane
  demo slots mapped onto workspace tenants when `workspace.json` exists.
- **CLI:** terminal fallback for both the local filesystem loop and the live
  Atlas + Flue adapter path.

## What It Proves

1. A blank `ATLASFS_HOME` can be initialized and run without Atlas, `.env`, or
   external `data/FinQA` files.
2. Fixture collections are exposed through typed `/datafetch/db/<collection>.ts`
   modules with schema fingerprints and fixed primitives.
3. A novel question records a trajectory of typed primitive calls.
4. Review plus verifier promotion turns a successful trajectory into a reusable
   tenant procedure.
5. Budget compilation, drift checks, and eval ledger rows are local workspace
   artifacts.
6. The Atlas/FinQA path remains available as the first live data adapter.
7. Flue can create a task-specific agent primitive at runtime.
8. A later similar question reuses the saved procedure or agent instead of
   rebuilding the full chain.

## Requirements

- Node.js 24+.
- `pnpm`.
- MongoDB Atlas connection string for the live FinQA adapter path.
- Anthropic API key for the live Flue observer/scorer path.

The local filesystem path does not require MongoDB, Anthropic, `.env`, or
`data/FinQA`.

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

## Run The Local Filesystem Loop

```sh
ATLASFS_HOME=$(mktemp -d)
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs init --fixture all
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs run "what is total revenue for acme?" --local --tenant data-analyst
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs run "how many open support tickets for acme?" --local --tenant support-analyst
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs run "what is the standard deviation of order amounts for acme?" --local --tenant data-analyst
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs review <draft-id> --yes --local
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs run "what is total revenue for beta?" --local --tenant data-analyst
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs budget customer_total_revenue --tenant data-analyst
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs drift check
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs eval --round 0 --tenant data-analyst --tenant support-analyst
ATLASFS_HOME=$ATLASFS_HOME pnpm atlasfs hydrate-atlas --dry-run --db atlasfs_hackathon
```

The workspace owns all runtime state:

```text
workspace.json
data/fixture-finance/orders.jsonl
data/fixture-support/tickets.jsonl
data/fixture-events/events.jsonl
hooks/finance/customer_total_revenue.json
hooks/support/customer_open_tickets.json
trajectories/
drafts/
functions/<tenant>/
procedures/<tenant>/
compiled/<tenant>/
eval/ledger.jsonl
```

## Run The UI Demo

```sh
pnpm demo
```

Open:

```text
http://localhost:5173
```

The API runs on `http://localhost:5174`; the Vite app proxies `/api` to it.

For a clean first-run demo, click `[ start over ]`, or start with a fresh local
memory folder:

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
- The self-contained runtime currently ships tiny fixture corpora; full BIRD and
  supply-chain importers are still future adapters.
- The live Atlas path remains the FinQA adapter. The local acceptance runtime is
  dataset-neutral over the fixture finance/support collections; full adapter
  hydration for other corpora is still future work.
- Repo-root Flue agents are templates plus `tenant-agent-launcher`; generated
  task capability is stored as tenant artifacts rather than new repo-root
  agents.
- Procedure replay is one call at the runner level. Local budget compilation
  records before/after cost and switches replay metadata; Atlas aggregation
  pipeline generation remains an adapter follow-up.
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
