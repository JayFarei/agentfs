#!/usr/bin/env bash
# scripts/acceptance/agent-loop.sh
#
# Headline live acceptance test. Drives a headless client agent through the
# VFS-mounted intent workspace flow against live Atlas:
#
#   Q1: mount an intent workspace, explore with datafetch run, commit visible
#       scripts/answer.ts through df.answer(...), and assert the observer writes
#       a semantic learned interface under lib/test-jay/ from that committed
#       trajectory.
#   Q2: mount a second intent workspace for a similar intent, require discovery
#       through apropos/man, commit a final answer, and assert the committed
#       lineage invokes the learned interface instead of recomposing from scratch.
#
# Required env: ATLAS_URI.
# Optional env: ATLAS_DB_NAME (default atlasfs_hackathon),
#               DF_TEST_PORT (default 8090),
#               DF_AGENT_DRIVER (codex default, or claude),
#               DEBUG=1 (dump tmux pane on failure),
#               AGENT_LOOP_TIMEOUT (per-question seconds; default 300).

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

# The live harness should test the skill from the current worktree, not a
# stale copy previously installed into ~/.claude/skills.
export DATAFETCH_SKILL_PATH="${DATAFETCH_SKILL_PATH:-$REPO_ROOT/skills/datafetch/SKILL.md}"

show_help() {
  cat <<EOF
agent-loop.sh — drive a headless client agent through the VFS intent workspace scenario.

Required env:
  ATLAS_URI                       MongoDB Atlas connection string

Optional env:
  DF_AGENT_DRIVER                 codex (default) or claude
  DF_TEST_MODEL                   driver model override
  DF_TEST_REASONING_EFFORT        Codex reasoning effort, default: medium
  DF_CLAUDE_BARE                  1 forces claude --bare; default auto only
                                  uses bare when an Anthropic API key is set
  ANTHROPIC_KEY or
  ANTHROPIC_API_KEY               optional for DF_AGENT_DRIVER=claude if the
                                  Claude Code CLI is locally logged in
  ATLAS_DB_NAME                   default: atlasfs_hackathon
  DF_TEST_PORT                    default: 8090
  AGENT_LOOP_TIMEOUT              per-question budget (seconds), default 300
  AGENT_LOOP_ARTIFACT_DIR         where to preserve troubleshooting artefacts
                                  (default: artifacts/agent-loop/<timestamp>)
  Q1_INTENT/Q2_INTENT             override the default derived FinQA intents
  Q1_EXPECTED_STATUS/VALUE        expected committed Q1 answer quality gate
  Q2_EXPECTED_STATUS/VALUE        expected committed Q2 answer quality gate
  DEBUG=1                         dump tmux pane + server log on failure

Required tools: datafetch (or the bin/datafetch.mjs shim), tmux,
                jq, curl.

Default intents are derived from
scripts/acceptance/fixtures/finqa-intent-batch.json.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

AGENT_LOOP_TIMEOUT="${AGENT_LOOP_TIMEOUT:-300}"
RUN_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RUN_STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
AGENT_LOOP_ARTIFACT_DIR="${AGENT_LOOP_ARTIFACT_DIR:-$REPO_ROOT/artifacts/agent-loop/$RUN_STAMP}"

SESSION_ID=""
Q1_INTENT="${Q1_INTENT:-What is the range of chemicals revenue between 2014 and 2016?}"
Q2_INTENT="${Q2_INTENT:-What is the range of coal revenue between 2014 and 2016?}"
Q1_EXPECTED_STATUS="${Q1_EXPECTED_STATUS:-answered}"
Q1_EXPECTED_VALUE="${Q1_EXPECTED_VALUE:-190}"
Q2_EXPECTED_STATUS="${Q2_EXPECTED_STATUS:-answered}"
Q2_EXPECTED_VALUE="${Q2_EXPECTED_VALUE:-1687}"
Q1_WORKSPACE=""
Q2_WORKSPACE=""
Q1_OUT=""
Q2_OUT=""
Q1_PROMPT=""
Q2_PROMPT=""
CRYSTALLISED_FILE=""
CRYSTALLISED_NAME=""
PRE_Q2_CRYSTALLISED_COUNT=0
POST_Q2_CRYSTALLISED_COUNT=0
MOUNTED_WORKSPACE=""

sanitize_file() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  sed -E \
    -e 's#mongodb(\+srv)?://[^[:space:]"]+#mongodb://<redacted>#g' \
    -e 's#(ANTHROPIC(_API)?_KEY=)[^[:space:]"]+#\1<redacted>#g' \
    -e 's#(OPENAI(_CODEX)?_API_KEY=)[^[:space:]"]+#\1<redacted>#g' \
    -e 's#(CLAW_CODEX_ACCESS_TOKEN=)[^[:space:]"]+#\1<redacted>#g' \
    "$src" > "$dst"
}

copy_dir_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -d "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    rm -rf "$dst"
    cp -R "$src" "$dst"
  fi
}

assert_json_truthy() {
  local file="$1"
  local jq_expr="$2"
  local label="$3"
  if [[ -f "$file" ]] && jq -e "$jq_expr" "$file" >/dev/null 2>&1; then
    printf '[PASS] %s\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] %s\n' "$label" >&2
    if [[ -f "$file" ]]; then jq . "$file" >&2 || true; fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_answer_expectation() {
  local label="$1"
  local workspace="$2"
  local expected_status="$3"
  local expected_value="$4"
  local answer="$workspace/result/answer.json"

  if [[ -n "$expected_status" ]]; then
    assert_json_field "$answer" ".status" "$expected_status" "$label answer status is $expected_status" || true
  fi
  if [[ -n "$expected_value" ]]; then
    if [[ ! -f "$answer" ]]; then
      printf '[FAIL] %s answer value is %s (file missing: %s)\n' "$label" "$expected_value" "$answer" >&2
      FAIL_COUNT=$((FAIL_COUNT + 1))
      return 0
    fi
    local actual_value
    actual_value="$(
      jq -r '
        if (.value | type) == "object" and (.value.value != null) then
          .value.value
        else
          .value
        end
      ' "$answer" 2>/dev/null || echo "<jq-error>"
    )"
    if [[ "$actual_value" == "$expected_value" ]]; then
      printf '[PASS] %s answer value is %s\n' "$label" "$expected_value"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      printf '[FAIL] %s answer value is %s (expected=%q actual=%q)\n' "$label" "$expected_value" "$expected_value" "$actual_value" >&2
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  fi
}

workspace_run_count() {
  local workspace="$1"
  if [[ ! -d "$workspace/tmp/runs" ]]; then
    echo 0
    return 0
  fi
  find "$workspace/tmp/runs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | wc -l | tr -d ' '
}

workspace_commit_count() {
  local workspace="$1"
  if [[ ! -d "$workspace/result/commits" ]]; then
    echo 0
    return 0
  fi
  find "$workspace/result/commits" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | wc -l | tr -d ' '
}

workspace_head_trajectory() {
  local workspace="$1"
  jq -r '.trajectoryId // empty' "$workspace/result/HEAD.json" 2>/dev/null || true
}

mount_workspace() {
  local slug="$1"
  local intent="$2"
  local workspace="$DATAFETCH_HOME/workspaces/$slug"
  local mount_json="$DATAFETCH_HOME/$slug.mount.json"

  mkdir -p "$DATAFETCH_HOME/workspaces"
  step "mounting intent workspace $slug"
  dft mount \
    --tenant test-jay \
    --dataset finqa-2024 \
    --intent "$intent" \
    --path "$workspace" \
    --json > "$mount_json"

  SESSION_ID="$(jq -r '.sessionId // empty' "$mount_json")"
  export SESSION_ID
  assert_neq "" "$SESSION_ID" "$slug session id non-empty"
  assert_file_exists "$workspace/AGENTS.md" "$slug AGENTS.md" || true
  assert_file_exists "$workspace/CLAUDE.md" "$slug CLAUDE.md" || true
  assert_file_exists "$workspace/df.d.ts" "$slug df.d.ts" || true
  assert_file_exists "$workspace/db/README.md" "$slug db README" || true
  assert_file_glob "$workspace/db/*/_descriptor.json" "$slug db collection descriptor" || true
  assert_file_exists "$workspace/scripts/scratch.ts" "$slug scratch template" || true
  assert_file_exists "$workspace/scripts/answer.ts" "$slug answer template" || true
  assert_file_exists "$workspace/.datafetch/workspace.json" "$slug workspace metadata" || true

  MOUNTED_WORKSPACE="$workspace"
}

assert_workspace_commit() {
  local label="$1"
  local workspace="$2"
  local expected_learned="${3:-}"
  local answer="$workspace/result/answer.json"
  local validation="$workspace/result/validation.json"
  local lineage="$workspace/result/lineage.json"
  local head="$workspace/result/HEAD.json"
  local replay="$workspace/result/tests/replay.json"

  assert_file_exists "$workspace/result/source.ts" "$label committed source" || true
  assert_file_exists "$workspace/result/answer.md" "$label answer markdown" || true
  assert_file_exists "$answer" "$label answer json" || true
  assert_file_exists "$validation" "$label validation json" || true
  assert_file_exists "$lineage" "$label lineage json" || true
  assert_file_exists "$head" "$label HEAD pointer" || true
  assert_file_exists "$replay" "$label replay test" || true
  assert_file_glob "$workspace/result/commits/[0-9][0-9][0-9]/answer.json" "$label commit history" || true

  assert_json_field "$validation" ".accepted" "true" "$label commit accepted" || true
  assert_json_truthy "$answer" '.status == "answered" or .status == "partial" or .status == "unsupported"' "$label answer status allowed"
  assert_json_truthy "$answer" '.evidence != null and ((.evidence | type) != "array" or (.evidence | length) > 0)' "$label answer has evidence"
  assert_json_truthy "$answer" '.status == "unsupported" or .derivation != null' "$label answer has visible derivation"
  assert_json_truthy "$lineage" '.phase == "commit"' "$label lineage phase commit"
  assert_json_truthy "$lineage" '[.calls[]? | select(.primitive | startswith("lib."))] | length > 0' "$label lineage records lib.* call"
  assert_json_truthy "$head" '.commit != null and .trajectoryId != null' "$label HEAD records current commit"
  assert_json_truthy "$replay" '.kind == "workspace-head-replay" and .expected.status != null' "$label replay captures answer status"

  local head_traj replay_traj lineage_traj
  head_traj="$(workspace_head_trajectory "$workspace")"
  replay_traj="$(jq -r '.trajectoryId // empty' "$replay" 2>/dev/null || true)"
  lineage_traj="$(jq -r '.id // .trajectoryId // empty' "$lineage" 2>/dev/null || true)"
  assert_eq "$head_traj" "$replay_traj" "$label replay is generated from HEAD" || true
  assert_eq "$head_traj" "$lineage_traj" "$label lineage is current accepted HEAD" || true

  if [[ -n "$expected_learned" ]]; then
    if jq -e --arg name "lib.$expected_learned" '[.calls[]?.primitive] | index($name) != null' "$lineage" >/dev/null 2>&1; then
      printf '[PASS] %s lineage calls learned interface lib.%s\n' "$label" "$expected_learned"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      printf '[FAIL] %s lineage does not call learned interface lib.%s\n' "$label" "$expected_learned" >&2
      jq '[.calls[]?.primitive]' "$lineage" >&2 || true
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    assert_json_truthy "$lineage" '[.calls[]? | select(.primitive | startswith("db."))] | length > 0' "$label lineage records db.* call"
  fi
}

assert_workspace_run_written() {
  local label="$1"
  local workspace="$2"
  local count
  count="$(workspace_run_count "$workspace")"
  if (( count > 0 )); then
    printf '[PASS] %s wrote %s exploratory run artifact(s)\n' "$label" "$count"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] %s wrote no tmp/runs artifacts\n' "$label" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

learned_interface_count() {
  local dir="$DATAFETCH_HOME/lib/test-jay"
  local count=0
  [[ -d "$dir" ]] || {
    printf '0\n'
    return
  }
  local file
  while IFS= read -r -d '' file; do
    if grep -Eq '@shape-hash:\s*[0-9a-f]{8,}' "$file" 2>/dev/null; then
      count=$((count + 1))
    fi
  done < <(find "$dir" -maxdepth 1 -type f -name '*.ts' -print0 2>/dev/null)
  printf '%s\n' "$count"
}

wait_for_learned_interface() {
  local timeout_ticks="${1:-20}"
  local expected_origin="${2:-}"
  CRYSTALLISED_FILE=""
  CRYSTALLISED_NAME=""
  for _ in $(seq 1 "$timeout_ticks"); do
    local latest=""
    local file
    while IFS= read -r -d '' file; do
      if grep -Eq '@shape-hash:\s*[0-9a-f]{8,}' "$file" 2>/dev/null; then
        if [[ -n "$expected_origin" ]] && ! grep -Fq "@origin-trajectory: $expected_origin" "$file"; then
          continue
        fi
        if [[ -z "$latest" || "$file" -nt "$latest" ]]; then
          latest="$file"
        fi
      fi
    done < <(find "$DATAFETCH_HOME/lib/test-jay" -maxdepth 1 -type f -name '*.ts' -print0 2>/dev/null)
    if [[ -n "$latest" ]]; then
      CRYSTALLISED_FILE="$latest"
      CRYSTALLISED_NAME="$(basename "$CRYSTALLISED_FILE" .ts)"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

assert_agent_exit() {
  local label="$1"
  local exit_file="$2"
  local code="<missing>"
  if [[ -f "$exit_file" ]]; then
    code="$(tr -d '\n' < "$exit_file")"
  fi
  if [[ "$code" == "0" ]]; then
    printf '[PASS] %s agent exited 0\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] %s agent exit code %s\n' "$label" "$code" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

write_troubleshooting_artifact() {
  local status="$1"
  local dir="$AGENT_LOOP_ARTIFACT_DIR"
  mkdir -p "$dir"

  copy_dir_if_exists "$DATAFETCH_HOME/trajectories" "$dir/trajectories"
  copy_dir_if_exists "$DATAFETCH_HOME/lib/test-jay" "$dir/lib/test-jay"
  copy_dir_if_exists "$DATAFETCH_HOME/sessions" "$dir/sessions"
  copy_dir_if_exists "$DATAFETCH_HOME/workspaces" "$dir/workspaces"

  sanitize_file "${SERVER_LOG:-}" "$dir/server.log"
  sanitize_file "$DATAFETCH_HOME/publish.log" "$dir/publish.log"
  sanitize_file "${Q1_OUT:-}" "$dir/q1.out"
  sanitize_file "${Q2_OUT:-}" "$dir/q2.out"
  printf '%s\n' "${Q1_PROMPT:-}" > "$dir/q1.prompt.txt"
  printf '%s\n' "${Q2_PROMPT:-}" > "$dir/q2.prompt.txt"

  local trajectories_summary="$dir/trajectory-summary.json"
  if compgen -G "$DATAFETCH_HOME/trajectories/*.json" >/dev/null 2>&1; then
    jq -s '
      map({
        id,
        question,
        mode,
        phase,
        crystallisable,
        errored,
        answerValidation,
        callCount: (.calls | length),
        calls: [.calls[]?.primitive],
        clientCallCount: ([.calls[]? | select((.scope.depth // 0) == 0)] | length),
        clientCalls: [.calls[]? | select((.scope.depth // 0) == 0) | .primitive],
        nestedCallCount: ([.calls[]? | select((.scope.depth // 0) > 0)] | length),
        nestedCalls: [
          .calls[]?
          | select((.scope.depth // 0) > 0)
          | {
              primitive,
              parent: (.scope.parentPrimitive // "unknown"),
              root: (.scope.rootPrimitive // "unknown"),
              depth: (.scope.depth // 0)
            }
        ],
        nestedByRoot: (
          [.calls[]? | select((.scope.depth // 0) > 0) | (.scope.rootPrimitive // "unknown")]
          | group_by(.)
          | map({root: .[0], count: length})
        ),
        sourcePath,
        artifactDir
      })
    ' "$DATAFETCH_HOME/trajectories"/*.json > "$trajectories_summary" 2>/dev/null || true
  else
    printf '[]\n' > "$trajectories_summary"
  fi

  jq -n \
    --arg status "$status" \
    --arg startedAt "$RUN_STARTED_AT" \
    --arg completedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg datafetchHome "$DATAFETCH_HOME" \
    --arg serverUrl "${DATAFETCH_SERVER_URL:-}" \
    --arg artifactDir "$dir" \
    --arg q1Intent "$Q1_INTENT" \
    --arg q2Intent "$Q2_INTENT" \
    --arg q1ExpectedStatus "$Q1_EXPECTED_STATUS" \
    --arg q1ExpectedValue "$Q1_EXPECTED_VALUE" \
    --arg q2ExpectedStatus "$Q2_EXPECTED_STATUS" \
    --arg q2ExpectedValue "$Q2_EXPECTED_VALUE" \
    --arg q1Workspace "${Q1_WORKSPACE:-}" \
    --arg q2Workspace "${Q2_WORKSPACE:-}" \
    --arg learnedInterfaceName "${CRYSTALLISED_NAME:-}" \
    --argjson passCount "$PASS_COUNT" \
    --argjson failCount "$FAIL_COUNT" \
    '{
      status: $status,
      startedAt: $startedAt,
      completedAt: $completedAt,
      datafetchHome: $datafetchHome,
      serverUrl: $serverUrl,
      artifactDir: $artifactDir,
      passCount: $passCount,
      failCount: $failCount,
      q1: {
        intent: $q1Intent,
        expected: { status: $q1ExpectedStatus, value: $q1ExpectedValue },
        workspace: $q1Workspace
      },
      q2: {
        intent: $q2Intent,
        expected: { status: $q2ExpectedStatus, value: $q2ExpectedValue },
        workspace: $q2Workspace
      },
      learnedInterfaceName: $learnedInterfaceName,
      files: {
        clientSummary: "client-summary.md",
        serverSummary: "server-summary.md",
        actionTrajectory: "action-trajectory.md",
        diagnosticNarrative: "diagnostic-narrative.md",
        episodeMetrics: "episode-metrics.json",
        promotionVerdict: "promotion-verdict.json",
        callScopeSummary: "call-scope-summary.json",
        trajectorySummary: "trajectory-summary.json",
        workspacesDir: "workspaces/",
        trajectoriesDir: "trajectories/",
        libDir: "lib/",
        sessionsDir: "sessions/",
        q1Transcript: "q1.out",
        q2Transcript: "q2.out",
        serverLog: "server.log",
        publishLog: "publish.log"
      }
    }' > "$dir/metadata.json"

  {
    printf '# Client view\n\n'
    printf -- '- status: %s\n' "$status"
    printf -- '- Q1 intent: %s\n' "$Q1_INTENT"
    printf -- '- Q1 expected: status=%s value=%s\n' "$Q1_EXPECTED_STATUS" "$Q1_EXPECTED_VALUE"
    printf -- '- Q1 workspace: %s\n' "${Q1_WORKSPACE:-}"
    printf -- '- Q2 intent: %s\n' "$Q2_INTENT"
    printf -- '- Q2 expected: status=%s value=%s\n' "$Q2_EXPECTED_STATUS" "$Q2_EXPECTED_VALUE"
    printf -- '- Q2 workspace: %s\n' "${Q2_WORKSPACE:-}"
    printf -- '- learned interface: %s\n\n' "${CRYSTALLISED_NAME:-}"
    printf '## Q1 Transcript Head\n\n```text\n'
    if [[ -f "$dir/q1.out" ]]; then sed -n '1,160p' "$dir/q1.out"; fi
    printf '\n```\n\n'
    printf '## Q2 Transcript Head\n\n```text\n'
    if [[ -f "$dir/q2.out" ]]; then sed -n '1,160p' "$dir/q2.out"; fi
    printf '\n```\n'
  } > "$dir/client-summary.md"

  {
    printf '# Server/VFS view\n\n'
    printf -- '- original DATAFETCH_HOME: %s\n' "$DATAFETCH_HOME"
    printf -- '- learned interface: %s\n\n' "${CRYSTALLISED_NAME:-}"
    printf '## Workspace Results\n\n'
    for pair in "q1:${Q1_WORKSPACE:-}" "q2:${Q2_WORKSPACE:-}"; do
      local label="${pair%%:*}"
      local workspace="${pair#*:}"
      [[ -z "$workspace" ]] && continue
      printf '### %s\n\n' "$label"
      printf -- '- tmp runs: %s\n' "$(workspace_run_count "$workspace")"
      printf -- '- commits: %s\n' "$(workspace_commit_count "$workspace")"
      printf -- '- current accepted HEAD: %s\n' "$(workspace_head_trajectory "$workspace")"
      if [[ -f "$workspace/result/answer.json" ]]; then
        printf '\nanswer.json:\n\n```json\n'
        jq . "$workspace/result/answer.json" 2>/dev/null || cat "$workspace/result/answer.json"
        printf '\n```\n\n'
      fi
      if [[ -f "$workspace/result/validation.json" ]]; then
        printf 'validation.json:\n\n```json\n'
        jq . "$workspace/result/validation.json" 2>/dev/null || cat "$workspace/result/validation.json"
        printf '\n```\n\n'
      fi
    done
    printf '## Trajectory Summary\n\n'
    jq -r '
      .[]
      | "- \(.id) mode=\(.mode // "-") phase=\(.phase // "-") crystallisable=\(.crystallisable // "-") accepted=\(.answerValidation.accepted // "-") client=\((.clientCalls // []) | join(" -> ")) nested=\(.nestedCallCount // 0)"
    ' "$trajectories_summary" 2>/dev/null || true
  } > "$dir/server-summary.md"

  {
    printf '# Agent action trajectory\n\n'
    printf -- '- status: %s\n' "$status"
    printf -- '- pass/fail: %s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"
    printf -- '- learned interface: %s\n\n' "${CRYSTALLISED_NAME:-}"
    printf '## Q1 Committed Source\n\n```ts\n'
    sed -n '1,220p' "${Q1_WORKSPACE:-}/result/source.ts" 2>/dev/null || true
    printf '\n```\n\n'
    printf '## Q2 Committed Source\n\n```ts\n'
    sed -n '1,220p' "${Q2_WORKSPACE:-}/result/source.ts" 2>/dev/null || true
    printf '\n```\n\n'
    printf '## VFS Timeline\n\n'
    jq -r '
      .[]
      | "- \(.id) phase=\(.phase // "legacy") mode=\(.mode // "-") crystallisable=\(.crystallisable // "-") accepted=\(.answerValidation.accepted // "-") clientCallCount=\(.clientCallCount // 0) nestedCallCount=\(.nestedCallCount // 0)\n  client: \((.clientCalls // []) | join(" -> "))\n  nestedByRoot: \((.nestedByRoot // []) | map("\(.root):\(.count)") | join(", "))\n  artifact: \(.artifactDir // "-")\n"
    ' "$trajectories_summary" 2>/dev/null || true
  } > "$dir/action-trajectory.md"

  local q1_head q2_head learned_origin
  q1_head="$(workspace_head_trajectory "${Q1_WORKSPACE:-}")"
  q2_head="$(workspace_head_trajectory "${Q2_WORKSPACE:-}")"
  learned_origin=""
  if [[ -n "${CRYSTALLISED_FILE:-}" && -f "$CRYSTALLISED_FILE" ]]; then
    learned_origin="$(sed -n 's/^\/\/ @origin-trajectory: //p' "$CRYSTALLISED_FILE" | head -n 1)"
  fi

  {
    printf '# Diagnostic narrative\n\n'
    printf '## Scenario\n\n'
    printf -- '- status: %s\n' "$status"
    printf -- '- Q1 intent: %s\n' "$Q1_INTENT"
    printf -- '- Q1 expected: status=%s value=%s\n' "$Q1_EXPECTED_STATUS" "$Q1_EXPECTED_VALUE"
    printf -- '- Q2 intent: %s\n' "$Q2_INTENT"
    printf -- '- Q2 expected: status=%s value=%s\n' "$Q2_EXPECTED_STATUS" "$Q2_EXPECTED_VALUE"
    printf -- '- learned interface: %s\n\n' "${CRYSTALLISED_NAME:-none}"

    printf '## Q1 worktree\n\n'
    printf -- '- workspace: %s\n' "${Q1_WORKSPACE:-}"
    printf -- '- exploratory runs: %s\n' "$(workspace_run_count "${Q1_WORKSPACE:-}")"
    printf -- '- commit attempts: %s\n' "$(workspace_commit_count "${Q1_WORKSPACE:-}")"
    printf -- '- current accepted HEAD: %s\n\n' "$q1_head"
    if [[ -f "${Q1_WORKSPACE:-}/result/answer.json" ]]; then
      printf 'Final answer envelope:\n\n```json\n'
      jq '{status, value, unit, evidence, coverage, missing, derivation}' "${Q1_WORKSPACE:-}/result/answer.json" 2>/dev/null || cat "${Q1_WORKSPACE:-}/result/answer.json"
      printf '\n```\n\n'
    fi

    printf '## Learned Interface Promotion\n\n'
    printf -- '- learned interface file: %s\n' "${CRYSTALLISED_FILE:-none}"
    printf -- '- origin trajectory in learned file: %s\n' "${learned_origin:-none}"
    if [[ -n "$q1_head" && "$learned_origin" == "$q1_head" ]]; then
      printf -- '- verdict: learned from current Q1 HEAD\n\n'
    else
      printf -- '- verdict: learning origin differs from Q1 HEAD\n\n'
    fi

    printf '## Q2 worktree\n\n'
    printf -- '- workspace: %s\n' "${Q2_WORKSPACE:-}"
    printf -- '- exploratory runs: %s\n' "$(workspace_run_count "${Q2_WORKSPACE:-}")"
    printf -- '- commit attempts: %s\n' "$(workspace_commit_count "${Q2_WORKSPACE:-}")"
    printf -- '- current accepted HEAD: %s\n\n' "$q2_head"
    if [[ -f "${Q2_WORKSPACE:-}/result/source.ts" ]]; then
      printf 'Committed source:\n\n```ts\n'
      sed -n '1,220p' "${Q2_WORKSPACE:-}/result/source.ts" 2>/dev/null || true
      printf '\n```\n\n'
    fi
    if [[ -f "${Q2_WORKSPACE:-}/result/answer.json" ]]; then
      printf 'Final answer envelope:\n\n```json\n'
      jq '{status, value, unit, evidence, coverage, missing, derivation}' "${Q2_WORKSPACE:-}/result/answer.json" 2>/dev/null || cat "${Q2_WORKSPACE:-}/result/answer.json"
      printf '\n```\n\n'
    fi

    printf '## Server trajectory timeline\n\n'
    jq -r '
      .[]
      | "- \(.id) phase=\(.phase // "legacy") accepted=\(.answerValidation.accepted // "-") client=\((.clientCalls // []) | join(" -> ")) nested=\(.nestedCallCount // 0)\n  nestedByRoot: \((.nestedByRoot // []) | map("\(.root):\(.count)") | join(", "))"
    ' "$trajectories_summary" 2>/dev/null || true
  } > "$dir/diagnostic-narrative.md"

  jq '
    map({
      id,
      phase,
      accepted: (.answerValidation.accepted // null),
      clientCallCount,
      clientCalls,
      nestedCallCount,
      nestedCalls,
      nestedByRoot
    })
  ' "$trajectories_summary" > "$dir/call-scope-summary.json" 2>/dev/null || printf '[]\n' > "$dir/call-scope-summary.json"

  jq -n \
    --arg q1Head "$q1_head" \
    --arg q2Head "$q2_head" \
    --arg learnedOrigin "$learned_origin" \
    --arg learnedName "${CRYSTALLISED_NAME:-}" \
    --argjson q1Runs "$(workspace_run_count "${Q1_WORKSPACE:-}")" \
    --argjson q1Commits "$(workspace_commit_count "${Q1_WORKSPACE:-}")" \
    --argjson q2Runs "$(workspace_run_count "${Q2_WORKSPACE:-}")" \
    --argjson q2Commits "$(workspace_commit_count "${Q2_WORKSPACE:-}")" \
    '{
      q1: {runs: $q1Runs, commitAttempts: $q1Commits, currentAcceptedHead: $q1Head},
      q2: {runs: $q2Runs, commitAttempts: $q2Commits, currentAcceptedHead: $q2Head},
      learnedInterfacePromotion: {
        learnedInterfaceName: $learnedName,
        originTrajectory: $learnedOrigin,
        originMatchesQ1Head: ($learnedOrigin != "" and $learnedOrigin == $q1Head)
      }
    }' > "$dir/episode-metrics.json"

  jq -n \
    --arg q1Head "$q1_head" \
    --arg learnedOrigin "$learned_origin" \
    --arg learnedName "${CRYSTALLISED_NAME:-}" \
    '{
      learnedInterfaceName: $learnedName,
      q1HeadTrajectory: $q1Head,
      learnedOriginTrajectory: $learnedOrigin,
      learnedFromHead: ($learnedOrigin != "" and $learnedOrigin == $q1Head),
      check: "learned interface origin should match the current Q1 workspace HEAD"
    }' > "$dir/promotion-verdict.json"

  cat > "$dir/README.md" <<EOF
# agent-loop troubleshooting artefact

- status: $status
- original DATAFETCH_HOME: $DATAFETCH_HOME
- serverUrl: ${DATAFETCH_SERVER_URL:-}
- q1 workspace: ${Q1_WORKSPACE:-}
- q2 workspace: ${Q2_WORKSPACE:-}
- learned interface: ${CRYSTALLISED_NAME:-}
- pass/fail: $PASS_COUNT passed, $FAIL_COUNT failed

Start with:

\`\`\`bash
jq . metadata.json
sed -n '1,220p' client-summary.md
sed -n '1,260p' server-summary.md
sed -n '1,260p' action-trajectory.md
sed -n '1,320p' diagnostic-narrative.md
jq . episode-metrics.json
jq . promotion-verdict.json
jq . call-scope-summary.json
jq 'map({id, mode, phase, crystallisable, answerValidation, calls})' trajectory-summary.json
\`\`\`
EOF

  step "troubleshooting artifact written: $dir"
}

trap teardown EXIT

agent_driver_preflight || exit 2
if [[ -z "${ATLAS_URI:-}" ]]; then
  printf '[FAIL] ATLAS_URI is required\n' >&2
  exit 2
fi
for tool in tmux jq curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '[FAIL] required tool not on PATH: %s\n' "$tool" >&2
    exit 2
  fi
done

require_skill_installed
setup_dataplane

# Write a self-contained wrapper script to disk for tmux to launch. This is
# more portable than trying to escape the prompt into a one-liner.
run_agent_in_tmux() {
  local sess="$1"
  local prompt="$2"
  local outfile="$3"
  local sentinel="$4"
  local cwd="$5"

  rm -f "$outfile" "$sentinel" "$outfile.exit"

  local wrap="$DATAFETCH_HOME/$sess.wrap.sh"
  local promptfile="$DATAFETCH_HOME/$sess.prompt.txt"
  printf '%s' "$prompt" > "$promptfile"

  cat > "$wrap" <<WRAP
#!/usr/bin/env bash
set -o pipefail
LIB_DIR="$LIB_DIR"
source "\$LIB_DIR/common.sh"
cd "$cwd" || exit 1
export DF_AGENT_DRIVER="${DF_AGENT_DRIVER:-codex}"
export DF_TEST_MODEL="${DF_TEST_MODEL:-}"
export DF_TEST_REASONING_EFFORT="${DF_TEST_REASONING_EFFORT:-}"
export DF_CODEX_SANDBOX="${DF_CODEX_SANDBOX:-}"
export DF_CODEX_APPROVAL="${DF_CODEX_APPROVAL:-}"
export DF_CLAUDE_BARE="${DF_CLAUDE_BARE:-}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
export ANTHROPIC_KEY="${ANTHROPIC_KEY:-}"
export DATAFETCH_HOME="$DATAFETCH_HOME"
export DATAFETCH_SERVER_URL="$DATAFETCH_SERVER_URL"
export DATAFETCH_SKILL_PATH="$DATAFETCH_SKILL_PATH"
export DF_AGENT_CWD="$cwd"
export PATH="$PATH"
export SESSION_ID="$SESSION_ID"
agent_cmd "\$(cat "$promptfile")" > "$outfile" 2>&1
echo \$? > "$outfile.exit"
touch "$sentinel"
WRAP
  chmod +x "$wrap"

  tmux new-session -d -s "$sess" "bash $wrap"
}

# ---- Q1: create a visible intent program -----------------------------------
mount_workspace q1-chemicals "$Q1_INTENT"
Q1_WORKSPACE="$MOUNTED_WORKSPACE"
Q1_PROMPT=$(cat <<PROMPT
You are already inside a datafetch intent workspace.

Task: $Q1_INTENT

Use the VFS workspace contract only. Do not use \`datafetch session\`, \`datafetch plan\`, or \`datafetch execute\`.

Required workflow:
1. Read \`AGENTS.md\`, \`df.d.ts\`, and inspect \`db/\`, \`lib/\`, and \`scripts/\`.
2. Run \`datafetch apropos "$Q1_INTENT"\`.
3. Use \`scripts/scratch.ts\` plus \`datafetch run scripts/scratch.ts\` for broad search, sampling, and output-shape checks. You may edit scratch as many times as needed.
4. Put the repeatable final logic in \`scripts/answer.ts\`.
5. Run \`datafetch commit scripts/answer.ts\`.
6. Answer only from \`result/answer.json\` and \`result/validation.json\`.

The committed answer must return \`df.answer(...)\` with evidence and derivation. For this FinQA table task, prefer a visible chain like:
\`df.db.finqaCases.findSimilar(...)\` -> \`df.lib.pickFiling(...)\` -> \`df.lib.inferTableMathPlan(...)\` -> \`df.lib.executeTableMath(...)\` -> \`df.answer(...)\`.

If exact coverage for the requested entity/years is missing, commit \`partial\` or \`unsupported\` with nearest evidence, missing coverage, and reason. Do not fabricate a number and do not answer from tmp run output.
PROMPT
)
Q1_OUT="$DATAFETCH_HOME/q1.out"
Q1_SENTINEL="$DATAFETCH_HOME/q1.done"

step "Q1: spawning tmux pane dft-q1 (timeout=${AGENT_LOOP_TIMEOUT}s)"
run_agent_in_tmux dft-q1 "$Q1_PROMPT" "$Q1_OUT" "$Q1_SENTINEL" "$Q1_WORKSPACE"
if ! wait_for_tmux dft-q1 "$AGENT_LOOP_TIMEOUT" "$Q1_SENTINEL"; then
  dump_tmux_pane dft-q1 "$Q1_OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
tmux kill-session -t dft-q1 2>/dev/null || true
assert_agent_exit "Q1" "$Q1_OUT.exit"
if [[ -f "$Q1_OUT" ]]; then
  step "Q1 transcript head:"
  head -n 40 "$Q1_OUT" >&2 || true
fi
assert_workspace_run_written "Q1" "$Q1_WORKSPACE"
assert_workspace_commit "Q1" "$Q1_WORKSPACE"
assert_answer_expectation "Q1" "$Q1_WORKSPACE" "$Q1_EXPECTED_STATUS" "$Q1_EXPECTED_VALUE"

Q1_HEAD_TRAJ="$(workspace_head_trajectory "$Q1_WORKSPACE")"
step "Q1: waiting up to 10s for observer learned-interface write from HEAD $Q1_HEAD_TRAJ"
if wait_for_learned_interface 20 "$Q1_HEAD_TRAJ"; then
  printf '[PASS] observer wrote learned interface %s\n' "$CRYSTALLISED_NAME"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] no learned interface with @shape-hash and @origin-trajectory %s under lib/test-jay/ within 10s\n' "$Q1_HEAD_TRAJ" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [[ -n "$CRYSTALLISED_NAME" && "$CRYSTALLISED_NAME" == "rangeTableMetric" ]]; then
  printf '[PASS] learned interface name is semantic (%s)\n' "$CRYSTALLISED_NAME"
  PASS_COUNT=$((PASS_COUNT + 1))
elif [[ -n "$CRYSTALLISED_NAME" ]]; then
  printf '[FAIL] learned interface name is not semantic: %s\n' "$CRYSTALLISED_NAME" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [[ -n "${CRYSTALLISED_FILE:-}" && -f "$CRYSTALLISED_FILE" ]]; then
  if grep -Fq "@origin-trajectory: $Q1_HEAD_TRAJ" "$CRYSTALLISED_FILE"; then
    printf '[PASS] learned interface originated from Q1 workspace HEAD %s\n' "$Q1_HEAD_TRAJ"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] learned interface did not originate from Q1 workspace HEAD %s\n' "$Q1_HEAD_TRAJ" >&2
    grep -F '@origin-trajectory:' "$CRYSTALLISED_FILE" >&2 || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# ---- Q2: discover and reuse the learned interface --------------------------
PRE_Q2_CRYSTALLISED_COUNT=$(learned_interface_count)
mount_workspace q2-coal "$Q2_INTENT"
Q2_WORKSPACE="$MOUNTED_WORKSPACE"

if [[ -n "$CRYSTALLISED_NAME" ]]; then
  step "Q2 preflight: apropos should surface $CRYSTALLISED_NAME"
  APROPOS_JSON=$(dft apropos --json "$Q2_INTENT" || true)
  DISCOVERY_TOP=$(printf '%s\n' "$APROPOS_JSON" | jq -r '.matches[0].name // empty' 2>/dev/null || true)
  if [[ "$DISCOVERY_TOP" == "$CRYSTALLISED_NAME" ]]; then
    printf '[PASS] apropos top match is %s\n' "$DISCOVERY_TOP"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] apropos top=%s, expected %s\n' "$DISCOVERY_TOP" "$CRYSTALLISED_NAME" >&2
    printf '%s\n' "$APROPOS_JSON" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

Q2_PROMPT=$(cat <<PROMPT
You are already inside a fresh datafetch intent workspace.

Task: $Q2_INTENT

Use the VFS workspace contract only. Do not use \`datafetch session\`, \`datafetch plan\`, or \`datafetch execute\`.

Required workflow:
1. Read \`AGENTS.md\`, \`df.d.ts\`, and inspect \`lib/\`.
2. Run \`datafetch apropos --json "range coal revenue 2014 2018"\`.
3. If a learned interface fits, inspect it with \`datafetch man <name>\` and write \`scripts/answer.ts\` so the committed code calls that learned \`df.lib.<name>\` interface directly.
4. You may use \`datafetch run scripts/scratch.ts\` once to inspect output shape, but the final answer must come from \`datafetch commit scripts/answer.ts\`.
5. Answer only from \`result/answer.json\` and \`result/validation.json\`.

The learned interface from Q1, if present, is: ${CRYSTALLISED_NAME:-none}.

If no learned interface fits, commit a visible full chain with db retrieval, filing selection, table-plan inference, table math, and \`df.answer(...)\`. If exact coverage is missing, return \`partial\` or \`unsupported\` with evidence and reason. Do not fabricate a number and do not answer from tmp run output.
PROMPT
)
Q2_OUT="$DATAFETCH_HOME/q2.out"
Q2_SENTINEL="$DATAFETCH_HOME/q2.done"

step "Q2: spawning tmux pane dft-q2 (timeout=${AGENT_LOOP_TIMEOUT}s)"
run_agent_in_tmux dft-q2 "$Q2_PROMPT" "$Q2_OUT" "$Q2_SENTINEL" "$Q2_WORKSPACE"
if ! wait_for_tmux dft-q2 "$AGENT_LOOP_TIMEOUT" "$Q2_SENTINEL"; then
  dump_tmux_pane dft-q2 "$Q2_OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
tmux kill-session -t dft-q2 2>/dev/null || true
assert_agent_exit "Q2" "$Q2_OUT.exit"
if [[ -f "$Q2_OUT" ]]; then
  step "Q2 transcript head:"
  head -n 40 "$Q2_OUT" >&2 || true
fi
assert_workspace_commit "Q2" "$Q2_WORKSPACE" "$CRYSTALLISED_NAME"
assert_answer_expectation "Q2" "$Q2_WORKSPACE" "$Q2_EXPECTED_STATUS" "$Q2_EXPECTED_VALUE"

step "Q2: assert no nested learned interface was created"
POST_Q2_CRYSTALLISED_COUNT=$(learned_interface_count)
if [[ "$POST_Q2_CRYSTALLISED_COUNT" == "$PRE_Q2_CRYSTALLISED_COUNT" ]]; then
  printf '[PASS] learned interface count stayed at %s\n' "$POST_Q2_CRYSTALLISED_COUNT"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] learned interface count changed from %s to %s after Q2\n' "$PRE_Q2_CRYSTALLISED_COUNT" "$POST_Q2_CRYSTALLISED_COUNT" >&2
  ls -la "$DATAFETCH_HOME/lib/test-jay" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if (( FAIL_COUNT == 0 )); then
  write_troubleshooting_artifact "pass"
else
  write_troubleshooting_artifact "fail"
fi

print_summary "agent-loop"
