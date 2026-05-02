# AtlasFS Hackathon Proof Loop

Local-first proof of the AtlasFS typed-primitive loop:

1. FinQA data lives in MongoDB Atlas.
2. A single typed-primitive toolbox composes retrieval, resolution, and arithmetic.
3. A first novel run records a trajectory.
4. Endorsement crystallizes the trajectory into a local procedure file.
5. A sibling question replays through the saved procedure.

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

## Verification

```sh
pnpm typecheck
pnpm test
pnpm exec flue build --target node --workspace ./.flue --output /tmp/atlasfs-flue-build-check
```
