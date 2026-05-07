#!/usr/bin/env bash
# scripts/acceptance/whitelist-client.sh
#
# Clean-sandbox client/server prototype flow:
#   server whitelist init -> client attach -> list -> mount -> run -> derived commit
#   -> tenant user-space persists across a second mount.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

CLEAN_HOME="$(mktemp -d -t df-client-home-XXXX)"
DATASETS_FILE="$(mktemp -t df-datasets-XXXX.json)"
WORKSPACE=""
WORKSPACE2=""
INTENT_FIXTURE="$REPO_ROOT/tests/fixtures/opentraces-derived-intents.json"
MOUNT_INTENT="$(jq -r '.intents[0].mountIntent' "$INTENT_FIXTURE")"

cleanup_extra() {
  rm -rf "$CLEAN_HOME" "$DATASETS_FILE"
}

trap 'teardown; cleanup_extra' EXIT

cat > "$DATASETS_FILE" <<'JSON'
{
  "datasets": [
    {
      "id": "opentraces-devtime",
      "adapter": "huggingface",
      "url": "https://huggingface.co/datasets/OpenTraces/opentraces-devtime",
      "target": "open"
    }
  ]
}
JSON

export HOME="$CLEAN_HOME"
export DATAFETCH_TELEMETRY=1
export DATAFETCH_TELEMETRY_LABEL="whitelist-client"
export DATAFETCH_SEARCH_MODE="datafetch-whitelist-init"

setup_dataplane --no-publish --datasets="$DATASETS_FILE"

step "installing datafetch skill into disposable home"
dft install-skill --force > "$DATAFETCH_HOME/install-skill.out"
assert_file_exists "$HOME/.claude/skills/datafetch/SKILL.md" "skill installed in clean HOME"

step "attaching disposable client to local datafetch server"
dft attach "$DATAFETCH_SERVER_URL" --tenant test-jay > "$DATAFETCH_HOME/attach.out"
assert_file_exists "$DATAFETCH_HOME/client.json" "client attachment config"
assert_json_field "$DATAFETCH_HOME/client.json" ".tenantId" "test-jay" "attached tenant"
assert_json_field "$DATAFETCH_HOME/client.json" ".serverUrl" "$DATAFETCH_SERVER_URL" "attached server URL"

step "listing initialized whitelist manifest"
dft list --json > "$DATAFETCH_HOME/list.json"
assert_json_truthy "$DATAFETCH_HOME/list.json" '.datasets | map(.id) | index("opentraces-devtime") != null' "manifest lists initialized HF dataset"
assert_json_field "$DATAFETCH_HOME/list.json" '.datasets[0].status' "ready" "manifest dataset ready"
assert_file_exists "$DATAFETCH_HOME/sources/opentraces-devtime/source.json" "server initialized source state"
assert_file_exists "$DATAFETCH_HOME/sources/opentraces-devtime/templates/AGENTS.md" "server initialized AGENTS template"

step "mounting first intent workspace"
WORKSPACE="$DATAFETCH_HOME/client-workspaces/opentraces-debug-map"
dft mount opentraces-devtime \
  --intent "$MOUNT_INTENT" \
  --path "$WORKSPACE" \
  --json > "$DATAFETCH_HOME/mount.json"
assert_file_exists "$WORKSPACE/AGENTS.md" "workspace AGENTS.md"
assert_file_exists "$WORKSPACE/CLAUDE.md" "workspace CLAUDE.md"
assert_file_exists "$WORKSPACE/df.d.ts" "workspace df.d.ts"
assert_file_exists "$WORKSPACE/db/train/_descriptor.json" "workspace train descriptor"
assert_file_exists "$WORKSPACE/scripts/scratch.ts" "workspace scratch template"
assert_json_field "$WORKSPACE/.datafetch/workspace.json" ".tenantId" "test-jay" "workspace tenant from attach"
if grep -q 'df.db.train' "$WORKSPACE/AGENTS.md" && grep -q 'df.db.train' "$WORKSPACE/scripts/scratch.ts"; then
  printf '[PASS] workspace guidance and scratch target df.db.train\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] workspace guidance/scratch did not target df.db.train\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

step "simulated code agent maps the dataset before choosing a derived intent"
cat > "$WORKSPACE/scripts/scratch.ts" <<'EOF'
const broad = await df.db.train.search("trace", { limit: 10 });
const debug = await df.db.train.search("debug", { limit: 10 });
const fields = Object.keys(broad[0] ?? {});
const labels = Array.from(new Set(broad.map((row) => row.label ?? row.category ?? null).filter(Boolean)));
console.log(JSON.stringify({
  mappedDataset: true,
  fields,
  labels,
  broadCount: broad.length,
  debugCount: debug.length,
  derivedIntent: "debugTraceSummary",
}, null, 2));
EOF
(
  cd "$WORKSPACE"
  dft run scripts/scratch.ts --telemetry > "$DATAFETCH_HOME/run.out"
)
assert_file_exists "$WORKSPACE/tmp/runs/001/result.json" "scratch result artifact"
assert_file_exists "$WORKSPACE/tmp/runs/001/lineage.json" "scratch lineage artifact"
assert_json_truthy "$WORKSPACE/tmp/runs/001/lineage.json" '[.calls[]? | select(.primitive == "db.train.search")] | length >= 1' "scratch lineage uses HF search"

step "simulated code agent writes tenant user-space note and derived answer"
cat > "$WORKSPACE/lib/tenant-notes.md" <<'EOF'
# tenant notes

This tenant has mapped OpenTraces devtime enough to know that debugging-related
queries should start with `df.db.train.search("debug", { limit })` and return
row-index evidence refs.
EOF
cat > "$WORKSPACE/scripts/answer.ts" <<'EOF'
const rows = await df.db.train.search("debug", { limit: 5 });
return df.answer({
  intent: {
    name: "debugTraceSummary",
    parent: "Map the trace dataset, then derive a useful debugging summary intent",
    relation: "derived",
    description: "After probing the trace dataset, summarize debugging-related trace rows with row-index evidence.",
  },
  status: rows.length > 0 ? "answered" : "unsupported",
  value: {
    count: rows.length,
    examples: rows.map((row) => ({
      row: row._hfRowIdx,
      traceId: row.trace_id ?? row.session_id ?? null,
      task: row.task ?? row.text ?? row.label ?? null,
    })),
  },
  evidence: rows.map((row) => ({
    ref: `hf:${row._hfDataset}/${row._hfConfig}/${row._hfSplit}/${row._hfRowIdx}`,
  })),
  coverage: {
    query: "debug",
    returned: rows.length,
  },
  derivation: {
    operation: "derived-intent-debug-search-summary",
    planEvidence: "scripts/scratch.ts first mapped fields and row availability",
  },
  ...(rows.length > 0 ? {} : { reason: "No debugging rows were found in the mounted HF search surface." }),
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
assert_json_field "$WORKSPACE/result/answer.json" ".intent.name" "debugTraceSummary" "derived intent name"
assert_json_field "$WORKSPACE/result/answer.json" ".intent.relation" "derived" "derived intent relation"
assert_json_truthy "$WORKSPACE/result/answer.json" '.status == "answered" or .status == "unsupported"' "answer status allowed"
assert_json_truthy "$WORKSPACE/result/lineage.json" '[.calls[]? | select(.primitive == "db.train.search")] | length >= 1' "commit lineage uses HF search"
assert_file_exists "$DATAFETCH_HOME/tenants/test-jay/events.jsonl" "tenant event log"
assert_file_exists "$DATAFETCH_HOME/tenants/test-jay/refs/latest.json" "tenant latest ref"
assert_json_field "$DATAFETCH_HOME/tenants/test-jay/refs/latest.json" ".answerStatus" "answered" "tenant latest answer status"

step "remounting same tenant to prove user-space lib persists"
WORKSPACE2="$DATAFETCH_HOME/client-workspaces/opentraces-debug-remount"
dft mount opentraces-devtime \
  --intent "Find debugging traces again using the mapped environment" \
  --path "$WORKSPACE2" \
  --json > "$DATAFETCH_HOME/remount.json"
assert_file_exists "$WORKSPACE2/lib/tenant-notes.md" "tenant lib note visible on future mount"
assert_file_exists "$WORKSPACE2/db/train/_descriptor.json" "immutable db visible on future mount"

step "checking telemetry"
assert_file_exists "$DATAFETCH_HOME/telemetry/events.jsonl" "telemetry event log"
if jq -e 'select(.label == "whitelist-client" and .searchMode == "datafetch-whitelist-init" and .trajectory != null)' \
    "$DATAFETCH_HOME/telemetry/events.jsonl" >/dev/null; then
  printf '[PASS] telemetry includes label/searchMode/full trajectory\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] telemetry missing label/searchMode/full trajectory\n' >&2
  jq -c '{label, searchMode, kind, hasTrajectory: (.trajectory != null), phase: .response.phase, trajectoryId: .response.trajectoryId}' \
    "$DATAFETCH_HOME/telemetry/events.jsonl" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

print_summary "whitelist-client"
