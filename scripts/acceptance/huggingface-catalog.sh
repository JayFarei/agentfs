#!/usr/bin/env bash
# scripts/acceptance/huggingface-catalog.sh
#
# No-LLM external-adapter acceptance test:
#   add HF URL -> list/inspect -> mount by id -> run/commit -> telemetry.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

trap teardown EXIT

export DATAFETCH_TELEMETRY=1
export DATAFETCH_TELEMETRY_LABEL="hf-catalog-acceptance"
export DATAFETCH_SEARCH_MODE="huggingface-dataset-viewer"

setup_dataplane --no-publish

SOURCE_URL="${HF_ACCEPTANCE_URL:-https://huggingface.co/datasets/OpenTraces/opentraces-devtime}"
SOURCE_ID="${HF_ACCEPTANCE_ID:-opentraces-devtime}"
WORKSPACE="$DATAFETCH_HOME/hf-workspace"

step "adding Hugging Face source"
dft add "$SOURCE_URL" --json > "$DATAFETCH_HOME/add.json"
assert_json_field "$DATAFETCH_HOME/add.json" ".source.id" "$SOURCE_ID" "catalog source id"
assert_json_field "$DATAFETCH_HOME/add.json" ".source.adapter" "huggingface" "catalog adapter"

step "listing catalog"
dft list --json > "$DATAFETCH_HOME/list.json"
assert_json_field "$DATAFETCH_HOME/list.json" '.sources | map(.id) | index("opentraces-devtime") != null' "true" "catalog list includes HF source"

step "inspecting catalog source"
dft inspect "$SOURCE_ID" --json > "$DATAFETCH_HOME/inspect.json"
assert_json_field "$DATAFETCH_HOME/inspect.json" ".source.uri" "hf://OpenTraces/opentraces-devtime" "inspect source uri"

step "mounting HF intent workspace"
dft mount "$SOURCE_ID" \
  --tenant test-jay \
  --intent "Find traces about debugging and produce a small evidence-backed summary" \
  --path "$WORKSPACE" \
  --json > "$DATAFETCH_HOME/mount.json"
assert_file_exists "$WORKSPACE/AGENTS.md" "workspace AGENTS.md"
assert_file_exists "$WORKSPACE/df.d.ts" "workspace df.d.ts"
assert_file_exists "$WORKSPACE/db/README.md" "workspace db README"
assert_file_exists "$WORKSPACE/db/train/_descriptor.json" "workspace train descriptor"
assert_json_field "$WORKSPACE/.datafetch/workspace.json" ".dataset" "$SOURCE_ID" "workspace dataset id"

step "running exploratory HF search"
cat > "$WORKSPACE/scripts/scratch.ts" <<'EOF'
const rows = await df.db.train.search("debug", { limit: 3 });
console.log(JSON.stringify({ count: rows.length, first: rows[0]?._hfRowIdx ?? null }));
EOF
(
  cd "$WORKSPACE"
  dft run scripts/scratch.ts --telemetry > "$DATAFETCH_HOME/run.out"
)
assert_file_exists "$WORKSPACE/tmp/runs/001/result.json" "run result artifact"
assert_file_exists "$WORKSPACE/tmp/runs/001/lineage.json" "run lineage artifact"
assert_json_field "$WORKSPACE/tmp/runs/001/result.json" ".phase" "run" "run phase"

step "committing HF answer"
cat > "$WORKSPACE/scripts/answer.ts" <<'EOF'
const rows = await df.db.train.search("debug", { limit: 5 });
return df.answer({
  intent: {
    name: "debugTraceSummary",
    parent: "Find traces about debugging and produce a small evidence-backed summary",
    relation: "same",
    description: "Select a small set of debugging-related OpenTraces rows from the HF-mounted dataset.",
  },
  status: rows.length > 0 ? "answered" : "unsupported",
  value: {
    count: rows.length,
    examples: rows.map((row) => ({
      row: row._hfRowIdx,
      traceId: row.trace_id ?? row.session_id ?? null,
      task: row.task ?? null,
    })),
  },
  evidence: rows.map((row) => ({
    ref: `hf:${row._hfDataset}/${row._hfConfig}/${row._hfSplit}/${row._hfRowIdx}`,
  })),
  coverage: {
    query: "debug",
    limit: 5,
    returned: rows.length,
  },
  derivation: {
    operation: "hf-search-debug-summary",
    source: "df.db.train.search",
  },
  ...(rows.length > 0 ? {} : { reason: "No rows matched debug in the mounted HF search surface." }),
});
EOF
(
  cd "$WORKSPACE"
  dft commit scripts/answer.ts --telemetry > "$DATAFETCH_HOME/commit.out"
)
assert_file_exists "$WORKSPACE/result/answer.json" "commit answer json"
assert_file_exists "$WORKSPACE/result/validation.json" "commit validation json"
assert_file_exists "$WORKSPACE/result/lineage.json" "commit lineage json"
assert_file_exists "$WORKSPACE/result/tests/replay.json" "commit replay test"
assert_json_field "$WORKSPACE/result/validation.json" ".accepted" "true" "commit accepted"
assert_json_truthy "$WORKSPACE/result/answer.json" '.status == "answered" or .status == "unsupported"' "answer status allowed"
assert_json_truthy "$WORKSPACE/result/answer.json" '.intent.name == "debugTraceSummary"' "answer intent recorded"
assert_json_truthy "$WORKSPACE/result/lineage.json" '[.calls[]? | select(.primitive == "db.train.search")] | length >= 1' "lineage records HF db search"

step "checking telemetry"
assert_file_exists "$DATAFETCH_HOME/telemetry/events.jsonl" "telemetry event log"
TELEMETRY_COUNT="$(wc -l < "$DATAFETCH_HOME/telemetry/events.jsonl" | tr -d ' ')"
if [[ "$TELEMETRY_COUNT" =~ ^[0-9]+$ ]] && (( TELEMETRY_COUNT >= 2 )); then
  printf '[PASS] telemetry recorded %s snippet events\n' "$TELEMETRY_COUNT"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] telemetry event count too low: %s\n' "$TELEMETRY_COUNT" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
if jq -e 'select(.label == "hf-catalog-acceptance" and .searchMode == "huggingface-dataset-viewer" and .trajectory != null)' \
    "$DATAFETCH_HOME/telemetry/events.jsonl" >/dev/null; then
  printf '[PASS] telemetry includes label/searchMode/full trajectory\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] telemetry missing label/searchMode/full trajectory\n' >&2
  jq -c '{label, searchMode, kind, hasTrajectory: (.trajectory != null), phase: .response.phase, trajectoryId: .response.trajectoryId}' \
    "$DATAFETCH_HOME/telemetry/events.jsonl" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

print_summary "huggingface-catalog"
