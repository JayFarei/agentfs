# datafetch Acceptance Harnesses

These scripts exercise the product at the CLI/server boundary. They are the
bridge between unit tests and future evals.

Run the default suite:

```sh
bash scripts/acceptance/run-all.sh
```

Show the runner help:

```sh
bash scripts/acceptance/run-all.sh --help
```

## Default Suite

The default runner is designed to be cheap enough for regular development.

| Script | External services | LLM/client agent | Purpose |
|---|---:|---:|---|
| `session-switch.sh` | no | no | Tenant overlay isolation and session lifecycle smoke. |
| `intent-workspace.sh` | no | no | Mount-like workspace run/commit artifacts and validation. |
| `intent-drift.sh` | no | no | Broad intent leading to committed derived sub-intent. |
| `whitelist-client.sh` | Hugging Face Dataset Viewer | no | Clean client/server flow: whitelist init, attach, list, mount, run, commit, remount persistence. |

`huggingface-catalog.sh` is also no-LLM and exercises `datafetch add`, but it
is not in the default runner because `whitelist-client.sh` covers the newer
clean-client path more completely.

## Opt-In Live Agent Suite

Set `RUN_AGENT_E2E=1` to include the live client-agent scripts:

```sh
RUN_AGENT_E2E=1 ATLAS_URI='mongodb+srv://...' bash scripts/acceptance/run-all.sh
```

| Script | External services | Client | Purpose |
|---|---:|---|---|
| `agent-loop.sh` | Atlas FinQA | Codex by default | Full code-agent behavior over the FinQA intent workspace path. |
| `intent-drift-loop.sh` | Atlas FinQA | Codex by default | Behavioral test for broad exploration becoming a narrower committed intent. |
| `agent-body-loop.sh` | Atlas FinQA + Flue model | Codex by default | Verifies visible `agent({ prompt })` / `agent({ skill })` bodies can be part of committed trajectories. |

The default driver is `DF_AGENT_DRIVER=codex`, which uses the local Codex CLI
login. Set `DF_AGENT_DRIVER=claude` only when testing Claude Code as the client
agent.

## Useful Environment

| Variable | Meaning |
|---|---|
| `DATAFETCH_HOME` | Temporary server/workspace state root. Usually created by `common.sh`. |
| `DATAFETCH_SERVER_URL` | Server URL used by CLI client commands. |
| `DATAFETCH_TELEMETRY=1` | Enables telemetry event logging for eval comparisons. |
| `DATAFETCH_TELEMETRY_LABEL` | Scenario or benchmark label written into telemetry. |
| `DATAFETCH_SEARCH_MODE` | Baseline/search-mode label, such as `learned`, `agentic-search`, or `huggingface-dataset-viewer`. |
| `DATAFETCH_SEED_DOMAINS` | Optional comma-separated domain packs. Live FinQA harnesses set this to `finqa`. |
| `HF_ACCEPTANCE_URL` | Override the Hugging Face dataset URL for `huggingface-catalog.sh`. |
| `HF_DATASETS_SERVER_URL` | Override the Hugging Face Dataset Viewer endpoint, useful for local fake servers. |
| `ATLAS_URI` | Required for live Atlas/FinQA scripts. |
| `ATLAS_DB_NAME` | Optional Atlas database name. Defaults to `datafetch_hackathon` in acceptance scripts. |
| `RUNALL_SKIP` | Space-separated script names to skip. |

## Artifacts

Each script writes its own temporary `DATAFETCH_HOME`. Scripts that produce
human-readable narratives copy durable artifacts into `artifacts/` when
configured. `artifacts/` is ignored by git.

Important files to inspect after a run:

```text
$DATAFETCH_HOME/server.log
$DATAFETCH_HOME/telemetry/events.jsonl
<workspace>/tmp/runs/*/result.json
<workspace>/tmp/runs/*/lineage.json
<workspace>/result/answer.json
<workspace>/result/validation.json
<workspace>/result/tests/replay.json
```

## Eval Readiness

For future evals, prefer scenarios that:

1. start from a clean `DATAFETCH_HOME`;
2. mount a dataset by source id, not by local fixture assumptions;
3. declare a broad or repeated intent family;
4. require `datafetch commit` to produce the accepted answer;
5. record telemetry with a stable label and search mode;
6. compare cold path, learned path, and baseline agentic search side by side.

Do not treat stdout as the result surface. Use `result/answer.json`,
`result/validation.json`, lineage, replay tests, and telemetry.
