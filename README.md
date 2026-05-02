# AtlasFS Hackathon Proof Loop

Local-first proof of the AtlasFS typed-primitive loop:

1. FinQA data lives in MongoDB Atlas.
2. A single typed-primitive toolbox composes retrieval, resolution, and arithmetic.
3. A first novel run records a trajectory.
4. Endorsement crystallizes the trajectory into a local procedure file.
5. A sibling question replays through the saved procedure.

## Demo App Setup

Use this path if you are judging or running the demo yourself. The demo has two
front doors:

- **UI demo:** a Vite/React app for clicking through Alice and Bob's evolving
  tenant state.
- **CLI demo:** a terminal fallback that runs the same live Atlas + Flue proof
  loop and prints the trajectories/artifacts as it goes.

Both demos use MongoDB Atlas for the FinQA data/search plane and Anthropic via
Flue for the observer-created agent path.

Prerequisites:

- Node.js 24+ or any Node version with `process.loadEnvFile` support.
- `pnpm`.
- A MongoDB Atlas connection string for a cluster with the FinQA data loaded.
- An Anthropic API key. This is required for the live Flue observer/scorer
  path; without it, the agent-creation part of the demo cannot run live.

Create `.env` in the repo root:

```sh
ATLAS_URI='mongodb+srv://...'
ATLAS_DB_NAME='atlasfs_hackathon'
ANTHROPIC_API_KEY='sk-ant-...'

# Required for the UI demo to use live Flue agents instead of fixture runtimes.
ATLASFS_OBSERVER='flue'
ATLASFS_OUTLOOK_AGENT='flue'
```

Install dependencies:

```sh
pnpm install
pnpm web:install
```

Confirm Atlas is reachable and the Search indexes are queryable:

```sh
pnpm atlasfs atlas-status
```

Start the UI demo app:

```sh
pnpm demo
```

Open:

```text
http://localhost:5173
```

The API runs on `http://localhost:5174`; Vite proxies `/api` calls from the web
app to that API server.

Run the CLI demo instead:

```sh
pnpm atlasfs demo --project ./atlasfs-live-demo --reset
```

The CLI path is useful if the UI is not available during judging. It uses the
same Atlas-backed data plane and live Flue observer/scorer path, then prints the
mode, answer, primitive calls, and newly created artifacts for each staged
intent.

For a clean first-run demo, reset Alice and Bob in the UI with `[ start over ]`
or start with a fresh memory folder:

```sh
ATLASFS_HOME=/tmp/atlasfs-demo pnpm demo
```

Demo limitations compared to `kb/product-design.md`:

- Retrieval currently uses Atlas Search lexical relevance via `$search`, not
  the full planned Voyage embedding + reranking + `$rankFusion` hybrid path.
- Tenant evolution is stored in local `.atlasfs` files; the design calls for a
  durable multi-tenant store such as Durable Objects or MongoDB-backed tenant
  state.
- The demo supports a small set of FinQA-shaped intent families instead of a
  broad, open-ended procedure induction surface.
- Procedure replay is typed and one-call at the runner level, but the later
  optimisation worker that compiles hot procedures into cheaper Atlas
  aggregation pipelines is not implemented yet.
- Flue creates the observer/agent artifacts live, but safety review,
  sandboxing, versioning, and promotion workflows are minimal hackathon
  versions rather than the full governance layer in the product design.

## Atlas Setup

Target MongoDB project: `gabriele.farei@gmail.com` / `Sandbox Project` for MongoDB.local London.

Set the Atlas connection string in `.env` or export it before loading data.
The CLI loads `.env` automatically through the Atlas client helper.

```sh
ATLAS_URI='mongodb+srv://...'
ATLAS_DB_NAME='atlasfs_hackathon'
```

Load the first FinQA proof slice:

```sh
pnpm atlasfs load-finqa --filename V/2008/page_17.pdf --limit 2 --reset
pnpm atlasfs load-finqa --dataset private_test --filename UNP/2016/page_52.pdf
```

Load the full available FinQA corpus into Atlas and create the Atlas Search
indexes:

```sh
pnpm atlasfs load-finqa --all --reset
pnpm atlasfs setup-search --timeout-ms=240000
pnpm atlasfs atlas-status
```

Current live proof target:

- database: `atlasfs_hackathon`
- collections: `finqa_cases`, `finqa_search_units`
- search indexes: `finqa_cases_text`, `finqa_units_text`
- gated live test: `RUN_ATLAS_TESTS=1 pnpm exec vitest run tests/atlas-search-live.test.ts`

## Local Proof Loop

Run without Atlas, against the local FinQA fixture:

```sh
pnpm atlasfs run --local "what is the average payment volume per transaction for american express?"
pnpm atlasfs endorse <trajectory-id>
pnpm atlasfs run --local "what is the average payment volume per transaction for jcb?"
```

Expected behavior:

- First run: `mode: "novel"`, answer `127.4`, five primitive calls.
- Endorsement writes `.atlasfs/procedures/financial-analyst/average_payment_volume_per_transaction.{json,ts}`.
- Replay: `mode: "procedure"`, answer `91.67`, one procedure call.

## Live Terminal Submission Demo

For the recording, use the live demo command. It starts from a clean local
project memory folder, but uses MongoDB Atlas for data and Flue-backed agents
for observer/scorer work. It refuses fixture fallback.

```sh
set -a; source .env; set +a
pnpm atlasfs demo --project ./atlasfs-live-demo --reset
```

Expected visible story:

1. Atlas status confirms FinQA cases, search units, and queryable Search indexes.
2. A first table intent calls `finqa_cases.findSimilar`, table manipulation
   primitives, and writes a `table_math` procedure.
3. A sibling table intent replays as one `procedures.table_math` call.
4. A negative-outlook intent uses live Flue agents, writes a reusable
   `negativeOutlookReferenceScorerAgent`, and saves agentic procedure glue.
5. A title/quote variant reuses the stored agent and writes only new procedure
   glue.
6. The final title/quote replay executes as one stored procedure call.

## Observer-Agent Proof Loop

Some intermediate steps need an LLM to codify a reusable table-manipulation
function. The observer primitive keeps the same typed-toolbox shape:

```sh
pnpm atlasfs run --local --observer fixture "which network has the highest average payment volume per transaction?"
pnpm atlasfs endorse <trajectory-id>
pnpm atlasfs run --local "which network has the highest average payment volume per transaction?"
```

Expected behavior:

- First run: `mode: "novel"`, answer `145`, four primitive calls:
  `finqa_cases.findSimilar`, `finqa_resolve.pickFiling`,
  `finqa_observe.codifyTableFunction`, `finqa_observe.executeCodifiedFunction`.
- Endorsement writes
  `.atlasfs/procedures/financial-analyst/largest_average_payment_volume_per_transaction.{json,ts}`.
- Replay: `mode: "procedure"`, answer `145`, one procedure call.

Live observer options:

```sh
# Direct Anthropic SDK observer
set -a; source .env; set +a
ANTHROPIC_API_KEY="$ANTHROPIC_KEY" pnpm atlasfs run --local --observer anthropic \
  "which network has the highest average payment volume per transaction?"

# Flue-backed observer agent
ANTHROPIC_API_KEY="$ANTHROPIC_KEY" pnpm atlasfs run --local --observer flue \
  "which network has the highest average payment volume per transaction?"
```

The Flue agent lives at `.flue/agents/finqa-observer.ts`.

## Task-Specific Agent Proof Loop

For LLM-only intermediary steps, the procedure can preserve a generated typed
task-agent interface instead of generated deterministic code.

```sh
pnpm atlasfs run --local --task-agent fixture \
  "what is the sentiment of Visa's competitive positioning in this document?"
pnpm atlasfs endorse <trajectory-id>
pnpm atlasfs run --local --task-agent fixture \
  "what is the sentiment of Visa's competitive positioning in this document?"
```

Expected behavior:

- First run: `mode: "novel"`, answer `positive`, five primitive calls:
  `finqa_cases.findSimilar`, `finqa_resolve.pickFiling`,
  `finqa_agent.documentText`, `finqa_agent.createSentimentAgentSpec`,
  `finqa_agent.runSentimentAgent`.
- Endorsement writes `.atlasfs/procedures/financial-analyst/document_sentiment.{json,ts}`.
- Replay: `mode: "procedure"`, answer `positive`, one procedure call. The
  procedure is intentionally still LLM-backed via a typed task-agent interface.

Live Flue version:

```sh
set -a; source .env; set +a
ANTHROPIC_API_KEY="$ANTHROPIC_KEY" pnpm atlasfs run --local --task-agent flue \
  "what is the sentiment of Visa's competitive positioning in this document?"
```

The Flue task-agent files are:

- `.flue/agents/finqa-agent-factory.ts`
- `.flue/agents/finqa-task-agent.ts`

## Reusable Agent And Glue Proof Loop

The negative-outlook demo shows one intent creating a reusable specialized
agent plus generated procedure glue, then a second intent reusing the same
agent with different extraction glue.

```sh
pnpm atlasfs run --local --observer fixture --outlook-agent fixture \
  "Find the negative competitive outlook references about Visa, count them, and show evidence sentences."

pnpm atlasfs run --local --observer fixture --outlook-agent fixture \
  "Find the negative competitive outlook references about Visa, but only from titles or quotes."

pnpm atlasfs run --local --outlook-agent fixture \
  "Find the negative competitive outlook references about Visa, but only from titles or quotes."
```

Expected behavior:

- First run creates `.atlasfs/agents/financial-analyst/negativeOutlookReferenceScorerAgent.json`.
- First run also writes
  `.atlasfs/procedures/financial-analyst/negative_outlook_references.{json,ts}`.
- Second run reuses `negativeOutlookReferenceScorerAgent` and writes only new
  title/quote glue:
  `.atlasfs/procedures/financial-analyst/negative_outlook_title_or_quote_references.{json,ts}`.
- Third run replays through one procedure call with the same persisted scorer
  agent.

Live Flue version:

```sh
set -a; source .env; set +a
ANTHROPIC_API_KEY="$ANTHROPIC_KEY" pnpm atlasfs run --local --observer flue --outlook-agent flue \
  "Find the negative competitive outlook references about Visa, count them, and show evidence sentences."
```

The Flue outlook-agent files are:

- `.flue/agents/finqa-outlook-agent-factory.ts`
- `.flue/agents/finqa-outlook-scorer.ts`

## Multi-Turn Review Proof Loop

The revenue-share demo adds a draft review layer before crystallization. The
draft can be confirmed, refined, committed, or refused. The committed procedure
code is generated by the observer runtime from the final reviewed requirements.

```sh
pnpm atlasfs run --local "what portion of revenue came from agricultural products?"
pnpm atlasfs review <draft-id> --confirm "use 2016 and total operating revenues"
pnpm atlasfs review <draft-id> --specify "also include 2015 and show the change" --local
ANTHROPIC_API_KEY="$ANTHROPIC_KEY" pnpm atlasfs review <draft-id> --yes --local --observer flue
pnpm atlasfs run --local "what portion of revenue came from agricultural products?"
```

Expected behavior:

- First run creates `.atlasfs/drafts/<draft-id>.json` and records assumptions:
  use 2016 and total operating revenues.
- `--specify` revises the draft to include 2015 and a year-over-year change.
- `--yes` asks the observer runtime to codify the reviewed procedure and writes
  `.atlasfs/procedures/financial-analyst/revenue_share.{json,ts}`.
- Replay uses one generated procedure call and returns
  `2016: 18.18%; 2015: 16.42%; change: +1.76 pp`.
- `--refuse` marks the draft non-committable; the next run starts over.

## Deferred For Later

The proof loop demonstrates the architecture; a few load-bearing pieces are
stubbed and need their full implementation before the system reaches the design
described in `kb/product-design.md`. Listing them here so the hackathon scope
is explicit and the next-step work is captured.

- **Full Voyage integration for vector retrieval and reranking.**
  `finqa_cases.findSimilar` and `finqa_cases.hybrid` are stable typed
  primitives in the registry, but their bodies currently delegate to Atlas
  lexical search (BM25 via `$search`). The intended contract is
  `voyage-4-large` for text embeddings, `rerank-2.5` for cross-encoder
  reranking, and `$rankFusion` to weight vector vs. lexical — all via the
  native Atlas Embedding & Reranking API (Voyage was acquired by MongoDB in
  Feb 2025). The call sites and signatures are already final; only the
  implementations swap. See `src/datafetch/db/finqa_cases.ts` and
  `kb/product-design.md` (the four-method primitive set documented in
  "Schema is induced at three tiers").

- **Query promotion: cheap replay via compiled aggregation pipelines.**
  Today, an endorsed chain (e.g. `procedures/<tenant>/table_math.ts`) replays
  as one TypeScript call but still issues multiple primitive calls under the
  hood. The design specifies a third tier of crystallisation: a budget
  optimisation worker takes an endorsed chain, compiles its multi-call ReAct
  sequence into a single `db.collection.aggregate([...])` pipeline, validates
  the rewrite against shadow inputs, and swaps the procedure body so the LLM
  leaves the hot path entirely. The cost-convergence metrics (`T_n` trajectory
  length, `D_n` determinism rate, `R_n` reuse rate, `I_n` information rate)
  are all defined to track this transition from expensive to cheap; the
  worker that performs it is not yet built. See `kb/product-design.md`,
  Dimension 2 ("cost convergence within a tenant"), and the "compile path"
  diagram for the full sequence.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm exec flue build --target node --workspace ./.flue --output /tmp/atlasfs-flue-build-check
```
