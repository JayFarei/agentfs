# AtlasFS Hackathon Proof Loop

Local-first proof of the AtlasFS typed-primitive loop:

1. FinQA data lives in MongoDB Atlas.
2. A single typed-primitive toolbox composes retrieval, resolution, and arithmetic.
3. A first novel run records a trajectory.
4. Endorsement crystallizes the trajectory into a local procedure file.
5. A sibling question replays through the saved procedure.

## Atlas Setup

Target MongoDB project: `gabriele.farei@gmail.com` / `Sandbox Project` for MongoDB.local London.

Set the Atlas connection string before loading data:

```sh
export MONGODB_URI='mongodb+srv://...'
export ATLAS_DB_NAME='atlasfs_hackathon'
```

Load the first FinQA proof slice:

```sh
pnpm atlasfs load-finqa --filename V/2008/page_17.pdf --limit 2 --reset
```

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

## Verification

```sh
pnpm typecheck
pnpm test
```
