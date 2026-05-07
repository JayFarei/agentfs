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
NARRATIVE=""
ARTIFACT_DIR="${WHITELIST_CLIENT_ARTIFACT_DIR:-$REPO_ROOT/artifacts/whitelist-client/latest}"
INTENT_FIXTURE="$REPO_ROOT/tests/fixtures/opentraces-derived-intents.json"
INTENT_COUNT="$(jq -r '.intents | length' "$INTENT_FIXTURE")"
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
NARRATIVE="$DATAFETCH_HOME/whitelist-client-narrative.md"
cat > "$NARRATIVE" <<'EOF'
# whitelist client e2e narrative

This artifact records the simulated clean-client interaction against the
whitelisted Hugging Face dataset. Each section is one mounted intent worktree:
the simulated agent first probes the mounted data, then commits a narrower
derived intent through visible TypeScript.

EOF

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

run_derived_intent() {
  local index="$1"
  local intent_id mount_intent workspace probes_json derived_json derived_name relation
  intent_id="$(jq -r ".intents[$index].id" "$INTENT_FIXTURE")"
  mount_intent="$(jq -r ".intents[$index].mountIntent" "$INTENT_FIXTURE")"
  probes_json="$(jq -c ".intents[$index].probeQueries" "$INTENT_FIXTURE")"
  derived_json="$(jq -c ".intents[$index].derivedIntent" "$INTENT_FIXTURE")"
  derived_name="$(jq -r ".intents[$index].derivedIntent.name" "$INTENT_FIXTURE")"
  relation="$(jq -r ".intents[$index].derivedIntent.relation" "$INTENT_FIXTURE")"
  workspace="$DATAFETCH_HOME/client-workspaces/opentraces-$index-$intent_id"

  step "mounting derived-intent workspace: $intent_id"
  dft mount opentraces-devtime \
    --intent "$mount_intent" \
    --path "$workspace" \
    --json > "$DATAFETCH_HOME/mount-$intent_id.json"
  assert_file_exists "$workspace/AGENTS.md" "$intent_id workspace AGENTS.md"
  assert_file_exists "$workspace/scripts/scratch.ts" "$intent_id workspace scratch template"

  step "simulated code agent probes dataset before committing: $intent_id"
  cat > "$workspace/scripts/scratch.ts" <<EOF
const probeQueries = $probes_json;
const probes = [];
const fieldSet = new Set();

for (const query of probeQueries) {
  const rows = await df.db.train.search(query, { limit: 8 });
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) fieldSet.add(key);
  }
  probes.push({
    query,
    count: rows.length,
    sampleRefs: rows.slice(0, 3).map((row) => ({
      row: row._hfRowIdx,
      traceId: row.trace_id ?? null,
      sessionId: row.session_id ?? null,
    })),
  });
}

console.log(JSON.stringify({
  mappedDataset: true,
  fields: Array.from(fieldSet).sort(),
  probes,
  derivedIntent: $derived_json,
}, null, 2));
EOF
  (
    cd "$workspace"
    dft run scripts/scratch.ts --telemetry > "$DATAFETCH_HOME/run-$intent_id.out"
  )
  assert_file_exists "$workspace/tmp/runs/001/result.json" "$intent_id scratch result artifact"
  assert_file_exists "$workspace/tmp/runs/001/lineage.json" "$intent_id scratch lineage artifact"
  assert_json_truthy "$workspace/tmp/runs/001/lineage.json" '[.calls[]? | select(.primitive == "db.train.search")] | length >= 1' "$intent_id scratch lineage uses HF search"

  step "simulated code agent commits visible derived trajectory: $intent_id"
  cat >> "$workspace/lib/tenant-notes.md" <<EOF

## $intent_id

The tenant probed \`$probes_json\` and derived \`$derived_name\`.
Future related work should start from those search terms and preserve row-index
evidence refs.
EOF
  cat > "$workspace/scripts/answer.ts" <<EOF
const probeQueries = $probes_json;
const derivedIntent = $derived_json;
const parentIntent = $(printf '%s' "$mount_intent" | jq -Rs .);
const answerQuery = probeQueries[probeQueries.length - 1] ?? probeQueries[0] ?? "trace";
const rows = await df.db.train.search(answerQuery, { limit: 5 });
const fallbackRows = rows.length > 0 ? [] : await df.db.train.search("trace", { limit: 3 });
const evidenceRows = rows.length > 0 ? rows : fallbackRows;

return df.answer({
  intent: {
    ...derivedIntent,
    parent: parentIntent,
  },
  status: rows.length > 0 ? "answered" : "unsupported",
  value: {
    query: answerQuery,
    count: rows.length,
    examples: rows.map((row) => ({
      row: row._hfRowIdx,
      traceId: row.trace_id ?? null,
      sessionId: row.session_id ?? null,
      title: row.title ?? row.task ?? row.label ?? row.kind ?? null,
    })),
  },
  evidence: evidenceRows.map((row) => ({
    ref: \`hf:\${row._hfDataset}/\${row._hfConfig}/\${row._hfSplit}/\${row._hfRowIdx}\`,
  })),
  coverage: {
    query: answerQuery,
    returned: rows.length,
    fallbackEvidenceReturned: fallbackRows.length,
  },
  derivation: {
    operation: "probe-then-derived-intent-summary",
    probeQueries,
    committedQuery: answerQuery,
    planEvidence: "scripts/scratch.ts mapped available fields and row coverage before this commit",
  },
  ...(rows.length > 0 ? {} : { reason: \`No rows matched \${answerQuery}; returned nearest trace evidence instead.\` }),
});
EOF
  (
    cd "$workspace"
    dft commit scripts/answer.ts --telemetry > "$DATAFETCH_HOME/commit-$intent_id.out"
  )
  assert_file_exists "$workspace/result/answer.json" "$intent_id commit answer json"
  assert_file_exists "$workspace/result/validation.json" "$intent_id commit validation json"
  assert_file_exists "$workspace/result/lineage.json" "$intent_id commit lineage json"
  assert_file_exists "$workspace/result/tests/replay.json" "$intent_id commit replay test"
  assert_json_field "$workspace/result/validation.json" ".accepted" "true" "$intent_id commit accepted"
  assert_json_field "$workspace/result/answer.json" ".intent.name" "$derived_name" "$intent_id derived intent name"
  assert_json_field "$workspace/result/answer.json" ".intent.relation" "$relation" "$intent_id derived intent relation"
  assert_json_truthy "$workspace/result/answer.json" '.status == "answered" or .status == "unsupported"' "$intent_id answer status allowed"
  assert_json_truthy "$workspace/result/answer.json" '(.evidence | length) >= 1' "$intent_id answer carries evidence"
  assert_json_truthy "$workspace/result/lineage.json" '[.calls[]? | select(.primitive == "db.train.search")] | length >= 1' "$intent_id commit lineage uses HF search"
  assert_json_field "$workspace/result/tests/replay.json" ".expected.intent.name" "$derived_name" "$intent_id replay captures derived intent"

  {
    printf '## %s\n\n' "$intent_id"
    printf -- '- mount intent: %s\n' "$mount_intent"
    printf -- '- derived intent: `%s`\n' "$derived_name"
    printf -- '- probe queries: `%s`\n' "$probes_json"
    printf -- '- run trajectory: `%s`\n' "$(jq -r '.trajectoryId // "none"' "$workspace/tmp/runs/001/result.json")"
    printf -- '- commit trajectory: `%s`\n' "$(jq -r '.trajectoryId // "none"' "$workspace/result/HEAD.json" 2>/dev/null || true)"
    printf -- '- answer status: `%s`\n' "$(jq -r '.status' "$workspace/result/answer.json")"
    printf -- '- evidence refs: `%s`\n\n' "$(jq -r '.evidence | length' "$workspace/result/answer.json")"
    printf 'scratch stdout:\n\n```json\n'
    jq -r '.stdout // ""' "$workspace/tmp/runs/001/result.json"
    printf '```\n\n'
  } >> "$NARRATIVE"
}

for ((i = 0; i < INTENT_COUNT; i++)); do
  run_derived_intent "$i"
done

assert_file_exists "$DATAFETCH_HOME/tenants/test-jay/events.jsonl" "tenant event log"
assert_file_exists "$DATAFETCH_HOME/tenants/test-jay/refs/latest.json" "tenant latest ref"
if jq -s -e --argjson n "$INTENT_COUNT" '[.[] | select(.phase == "commit" and .validationAccepted == true)] | length >= $n' \
    "$DATAFETCH_HOME/tenants/test-jay/events.jsonl" >/dev/null; then
  printf '[PASS] tenant history has one accepted commit per derived intent\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] tenant history missing accepted commits for derived intents\n' >&2
  jq -s '.' "$DATAFETCH_HOME/tenants/test-jay/events.jsonl" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
assert_file_exists "$NARRATIVE" "e2e narrative artifact"

step "persisting e2e diagnostic artifacts"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR/intents"
cp "$NARRATIVE" "$ARTIFACT_DIR/narrative.md"
cp "$DATAFETCH_HOME/list.json" "$ARTIFACT_DIR/manifest-list.json"
cp "$DATAFETCH_HOME/client.json" "$ARTIFACT_DIR/client.json"
cp "$DATAFETCH_HOME/tenants/test-jay/events.jsonl" "$ARTIFACT_DIR/tenant-events.jsonl"
cp "$DATAFETCH_HOME/tenants/test-jay/refs/latest.json" "$ARTIFACT_DIR/tenant-latest.json"
cp "$DATAFETCH_HOME/telemetry/events.jsonl" "$ARTIFACT_DIR/telemetry-events.jsonl"
for ((i = 0; i < INTENT_COUNT; i++)); do
  intent_id="$(jq -r ".intents[$i].id" "$INTENT_FIXTURE")"
  workspace="$DATAFETCH_HOME/client-workspaces/opentraces-$i-$intent_id"
  target="$ARTIFACT_DIR/intents/$intent_id"
  mkdir -p "$target"
  cp "$workspace/tmp/runs/001/result.md" "$target/run.md"
  cp "$workspace/tmp/runs/001/lineage.json" "$target/run-lineage.json"
  cp "$workspace/result/answer.json" "$target/answer.json"
  cp "$workspace/result/validation.json" "$target/validation.json"
  cp "$workspace/result/HEAD.json" "$target/HEAD.json"
  cp "$workspace/result/tests/replay.json" "$target/replay.json"
done
assert_file_exists "$ARTIFACT_DIR/narrative.md" "persisted e2e narrative"

step "remounting same tenant to prove user-space lib persists"
WORKSPACE2="$DATAFETCH_HOME/client-workspaces/opentraces-debug-remount"
dft mount opentraces-devtime \
  --intent "Find debugging traces again using the mapped environment" \
  --path "$WORKSPACE2" \
  --json > "$DATAFETCH_HOME/remount.json"
assert_file_exists "$WORKSPACE2/lib/tenant-notes.md" "tenant lib note visible on future mount"
assert_file_exists "$WORKSPACE2/db/train/_descriptor.json" "immutable db visible on future mount"
if grep -q 'debug-trace-summary' "$WORKSPACE2/lib/tenant-notes.md" &&
   grep -q 'activity-shape-map' "$WORKSPACE2/lib/tenant-notes.md" &&
   grep -q 'review-docs-summary' "$WORKSPACE2/lib/tenant-notes.md"; then
  printf '[PASS] future mount sees all derived-intent tenant notes\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] future mount missing one or more derived-intent tenant notes\n' >&2
  cat "$WORKSPACE2/lib/tenant-notes.md" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

step "checking telemetry"
assert_file_exists "$DATAFETCH_HOME/telemetry/events.jsonl" "telemetry event log"
if jq -s -e --argjson n "$INTENT_COUNT" '[.[] | select(.label == "whitelist-client" and .searchMode == "datafetch-whitelist-init" and .trajectory != null)] | length >= ($n * 2)' \
    "$DATAFETCH_HOME/telemetry/events.jsonl" >/dev/null; then
  printf '[PASS] telemetry includes label/searchMode/full trajectory for every run and commit\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] telemetry missing label/searchMode/full trajectory coverage\n' >&2
  jq -c '{label, searchMode, kind, hasTrajectory: (.trajectory != null), phase: .response.phase, trajectoryId: .response.trajectoryId}' \
    "$DATAFETCH_HOME/telemetry/events.jsonl" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

print_summary "whitelist-client"
