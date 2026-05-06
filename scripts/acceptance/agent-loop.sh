#!/usr/bin/env bash
# scripts/acceptance/agent-loop.sh
#
# Headline acceptance test. Drives a headless client agent inside a tmux pane
# against the FinQA chemicals/coal revenue questions
# and asserts on the disk artefacts:
#
#   - Q1 (chemicals): trajectory file written, mode == "novel",
#                     plan artifact written, execute artifact written,
#                     gold answer == 700.
#   - After observer crystallise: lib/test-jay/crystallise_*.ts on disk.
#   - Q2 (coal):     trajectory file written, mode == "interpreted",
#                    plan artifact written, execute artifact written,
#                    discovery ranks the Q1 learned function first,
#                    callPrimitives include that lib.crystallise_*,
#                    no nested crystallised wrapper is created,
#                    gold answer == 1000.
#
# Required env: ATLAS_URI.
# Optional env: ATLAS_DB_NAME (default atlasfs_hackathon),
#               DF_TEST_PORT (default 8090),
#               DF_AGENT_DRIVER (codex default, or claude),
#               DEBUG=1 (dump tmux pane on failure),
#               AGENT_LOOP_TIMEOUT (per-question seconds; default 300).
#
# This test relies on the model autonomously choosing to drive `datafetch`
# from bash. If Claude Code reliably does that on this machine (likely:
# Sonnet+ models), it passes. If it doesn't (smaller models, agent
# refuses to use bash, etc.), the script will fail with no trajectory on
# disk; check `DEBUG=1` output for the pane transcript.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

# The live harness should test the skill from the current worktree, not a
# stale copy previously installed into ~/.claude/skills.
export DATAFETCH_SKILL_PATH="${DATAFETCH_SKILL_PATH:-$REPO_ROOT/skills/datafetch/SKILL.md}"

show_help() {
  cat <<EOF
agent-loop.sh — drive a headless client agent through the FinQA two-question scenario.

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
  DEBUG=1                         dump tmux pane + server log on failure

Required tools: datafetch (or the bin/datafetch.mjs shim), tmux,
                jq, curl.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

# Per-question budget. Claude --print loops can take a few minutes.
AGENT_LOOP_TIMEOUT="${AGENT_LOOP_TIMEOUT:-300}"
RUN_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RUN_STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
AGENT_LOOP_ARTIFACT_DIR="${AGENT_LOOP_ARTIFACT_DIR:-$REPO_ROOT/artifacts/agent-loop/$RUN_STAMP}"
SESSION_ID=""
Q1_OUT=""
Q2_OUT=""
Q1_PROMPT=""
Q2_PROMPT=""
Q1_LATEST_GOOD=""
Q2_LATEST_GOOD=""
CRYSTALLISED_NAME=""

sanitize_file() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  # Redact common URI/API-key shapes defensively before copying logs into
  # repo-local artefacts.
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

latest_successful_trajectory() {
  local offset="${1:-0}"
  if [[ ! -d "$DATAFETCH_HOME/trajectories" ]]; then
    return 0
  fi
  ls -t "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null \
    | while read -r f; do
        if [[ "$(jq -r '.errored // false' "$f")" == "false" ]] && \
           [[ "$(jq -r '.calls | length' "$f")" -gt 0 ]]; then
          if (( offset > 0 )); then
            offset=$((offset - 1))
            continue
          fi
          echo "$f"
          break
        fi
      done
}

latest_successful_trajectory_phase() {
  local phase="$1"
  if [[ ! -d "$DATAFETCH_HOME/trajectories" ]]; then
    return 0
  fi
  ls -t "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null \
    | while read -r f; do
        if [[ "$(jq -r '.phase // empty' "$f")" == "$phase" ]] && \
           [[ "$(jq -r '.errored // false' "$f")" == "false" ]] && \
           [[ "$(jq -r '.calls | length' "$f")" -gt 0 ]]; then
          echo "$f"
          break
        fi
      done
}

count_session_phase_artifacts() {
  local phase="$1"
  local dir
  if [[ "$phase" == "plan" ]]; then
    dir="$DATAFETCH_HOME/sessions/$SESSION_ID/plan/attempts"
  else
    dir="$DATAFETCH_HOME/sessions/$SESSION_ID/execute"
  fi
  if [[ ! -d "$dir" ]]; then
    echo 0
    return 0
  fi
  find "$dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '
}

count_phase_trajectories() {
  local phase="$1"
  if ! compgen -G "$DATAFETCH_HOME/trajectories/*.json" >/dev/null 2>&1; then
    echo 0
    return 0
  fi
  jq -r --arg phase "$phase" 'select((.phase // "") == $phase) | .id' \
    "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null | wc -l | tr -d ' '
}

count_trajectory_files() {
  if [[ ! -d "$DATAFETCH_HOME/trajectories" ]] ||
     ! compgen -G "$DATAFETCH_HOME/trajectories/*.json" >/dev/null 2>&1; then
    echo 0
    return 0
  fi
  find "$DATAFETCH_HOME/trajectories" -maxdepth 1 -type f -name '*.json' \
    | wc -l | tr -d ' '
}

assert_committed_execute_shape() {
  local file="$1"
  local label="$2"
  local expected="${3:-table-chain}"
  if [[ -z "$file" || ! -f "$file" ]]; then
    printf '[FAIL] %s committed execute shape (missing trajectory)\n' "$label" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return 0
  fi

  local has_db
  local has_lib
  local has_table_math
  local has_crystallised
  has_db=$(jq -r '[.calls[]? | select(.primitive | startswith("db."))] | length > 0' "$file" 2>/dev/null || echo false)
  has_lib=$(jq -r '[.calls[]? | select(.primitive | startswith("lib."))] | length > 0' "$file" 2>/dev/null || echo false)
  has_table_math=$(jq -r '[.calls[]? | select(.primitive == "lib.executeTableMath")] | length > 0' "$file" 2>/dev/null || echo false)
  has_crystallised=$(jq -r '[.calls[]? | select(.primitive | startswith("lib.crystallise_"))] | length > 0' "$file" 2>/dev/null || echo false)

  if [[ "$expected" == "learned-tool" ]]; then
    if [[ "$has_crystallised" == "true" ]]; then
      printf '[PASS] %s committed execute calls a learned tool\n' "$label"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      printf '[FAIL] %s committed execute does not call a learned tool\n' "$label" >&2
      jq '[.calls[]?.primitive]' "$file" >&2 || true
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    return 0
  fi

  if [[ "$has_db" == "true" && "$has_lib" == "true" && "$has_table_math" == "true" ]]; then
    printf '[PASS] %s committed execute is reusable db.* -> lib.* -> table math shape\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] %s committed execute is not a reusable table workflow (db=%s lib=%s tableMath=%s)\n' "$label" "$has_db" "$has_lib" "$has_table_math" >&2
    jq '[.calls[]?.primitive]' "$file" >&2 || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

write_troubleshooting_artifact() {
  local status="$1"
  local dir="$AGENT_LOOP_ARTIFACT_DIR"
  mkdir -p "$dir"

  local trajectories_dir="$dir/trajectories"
  local lib_dir="$dir/lib"
  copy_dir_if_exists "$DATAFETCH_HOME/trajectories" "$trajectories_dir"
  copy_dir_if_exists "$DATAFETCH_HOME/lib/test-jay" "$lib_dir/test-jay"
  copy_dir_if_exists "$DATAFETCH_HOME/sessions" "$dir/sessions"

  sanitize_file "${SERVER_LOG:-}" "$dir/server.log"
  sanitize_file "$DATAFETCH_HOME/publish.log" "$dir/publish.log"
  sanitize_file "${Q1_OUT:-}" "$dir/q1.out"
  sanitize_file "${Q2_OUT:-}" "$dir/q2.out"
  sanitize_file "$DATAFETCH_HOME/AGENTS.md" "$dir/AGENTS.md"
  sanitize_file "$DATAFETCH_HOME/CLAUDE.md" "$dir/CLAUDE.md"
  sanitize_file "$DATAFETCH_HOME/df.d.ts" "$dir/df.d.ts"
  sanitize_file "$DATAFETCH_HOME/active-session" "$dir/active-session"
  printf '%s\n' "${Q1_PROMPT:-}" > "$dir/q1.prompt.txt"
  printf '%s\n' "${Q2_PROMPT:-}" > "$dir/q2.prompt.txt"

  local q1_latest="${Q1_LATEST_GOOD:-}"
  local q2_latest="${Q2_LATEST_GOOD:-}"
  local q1_latest_id=""
  local q2_latest_id=""
  if [[ -n "$q1_latest" && -f "$q1_latest" ]]; then
    q1_latest_id="$(jq -r '.id // empty' "$q1_latest" 2>/dev/null || true)"
  fi
  if [[ -n "$q2_latest" && -f "$q2_latest" ]]; then
    q2_latest_id="$(jq -r '.id // empty' "$q2_latest" 2>/dev/null || true)"
  fi

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
        callCount: (.calls | length),
        calls: [.calls[]?.primitive],
        artifactDir
      })
    ' "$DATAFETCH_HOME/trajectories"/*.json > "$trajectories_summary" 2>/dev/null || true
  else
    printf '[]\n' > "$trajectories_summary"
  fi

  local plan_artifact_count
  local execute_artifact_count
  local plan_trajectory_count
  local execute_trajectory_count
  plan_artifact_count="$(count_session_phase_artifacts plan)"
  execute_artifact_count="$(count_session_phase_artifacts execute)"
  plan_trajectory_count="$(count_phase_trajectories plan)"
  execute_trajectory_count="$(count_phase_trajectories execute)"

  jq -n \
    --arg status "$status" \
    --arg startedAt "$RUN_STARTED_AT" \
    --arg completedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg datafetchSessionId "${SESSION_ID:-}" \
    --arg datafetchHome "$DATAFETCH_HOME" \
    --arg serverUrl "${DATAFETCH_SERVER_URL:-}" \
    --arg artifactDir "$dir" \
    --arg q1LatestTrajectoryId "$q1_latest_id" \
    --arg q2LatestTrajectoryId "$q2_latest_id" \
    --arg crystallisedName "${CRYSTALLISED_NAME:-}" \
    --argjson passCount "$PASS_COUNT" \
    --argjson failCount "$FAIL_COUNT" \
    --argjson planArtifactCount "$plan_artifact_count" \
    --argjson executeArtifactCount "$execute_artifact_count" \
    --argjson planTrajectoryCount "$plan_trajectory_count" \
    --argjson executeTrajectoryCount "$execute_trajectory_count" \
    '{
      status: $status,
      startedAt: $startedAt,
      completedAt: $completedAt,
      datafetchSessionId: $datafetchSessionId,
      datafetchHome: $datafetchHome,
      serverUrl: $serverUrl,
      artifactDir: $artifactDir,
      passCount: $passCount,
      failCount: $failCount,
      q1: { latestTrajectoryId: $q1LatestTrajectoryId },
      q2: { latestTrajectoryId: $q2LatestTrajectoryId },
      crystallisedName: $crystallisedName,
      serverView: {
        planArtifactCount: $planArtifactCount,
        executeArtifactCount: $executeArtifactCount,
        planTrajectoryCount: $planTrajectoryCount,
        executeTrajectoryCount: $executeTrajectoryCount
      },
      files: {
        clientSummary: "client-summary.md",
        serverSummary: "server-summary.md",
        q1Transcript: "q1.out",
        q2Transcript: "q2.out",
        q1Prompt: "q1.prompt.txt",
        q2Prompt: "q2.prompt.txt",
        actionTrajectory: "action-trajectory.md",
        experimentNarrative: "experiment-narrative.md",
        trajectorySummary: "trajectory-summary.json",
        trajectoriesDir: "trajectories/",
        libDir: "lib/",
        sessionsDir: "sessions/",
        serverLog: "server.log",
        publishLog: "publish.log",
        dfManifest: "df.d.ts",
        activeSession: "active-session"
      }
    }' > "$dir/metadata.json"

  {
    printf '# Client view\n\n'
    printf -- '- datafetchSessionId: %s\n' "${SESSION_ID:-}"
    printf -- '- status: %s\n' "$status"
    printf -- '- Q1 transcript: q1.out\n'
    printf -- '- Q2 transcript: q2.out\n\n'
    printf '## Q1 Prompt\n\n```text\n%s\n```\n\n' "${Q1_PROMPT:-}"
    printf '## Q1 Transcript Head\n\n```text\n'
    if [[ -f "$dir/q1.out" ]]; then sed -n '1,120p' "$dir/q1.out"; fi
    printf '\n```\n\n'
    printf '## Q2 Prompt\n\n```text\n%s\n```\n\n' "${Q2_PROMPT:-}"
    printf '## Q2 Transcript Head\n\n```text\n'
    if [[ -f "$dir/q2.out" ]]; then sed -n '1,120p' "$dir/q2.out"; fi
    printf '\n```\n'
  } > "$dir/client-summary.md"

  {
    printf '# Server/VFS view\n\n'
    printf -- '- datafetchSessionId: %s\n' "${SESSION_ID:-}"
    printf -- '- original DATAFETCH_HOME: %s\n' "$DATAFETCH_HOME"
    printf -- '- plan artifacts: %s\n' "$plan_artifact_count"
    printf -- '- execute artifacts: %s\n' "$execute_artifact_count"
    printf -- '- plan trajectories: %s\n' "$plan_trajectory_count"
    printf -- '- execute trajectories: %s\n' "$execute_trajectory_count"
    printf -- '- q1 latest execute trajectory: %s\n' "${q1_latest_id:-}"
    printf -- '- q2 latest execute trajectory: %s\n' "${q2_latest_id:-}"
    printf -- '- crystallisedName: %s\n\n' "${CRYSTALLISED_NAME:-}"
    printf '## Session Record\n\n```json\n'
    if [[ -f "$dir/sessions/${SESSION_ID:-}.json" ]]; then
      jq . "$dir/sessions/${SESSION_ID:-}.json" 2>/dev/null || cat "$dir/sessions/${SESSION_ID:-}.json"
    fi
    printf '\n```\n\n'
    printf '## Trajectory Summary\n\n'
    jq -r '
      .[]
      | "- \(.id) mode=\(.mode // "-") phase=\(.phase // "-") crystallisable=\(.crystallisable // "-") errored=\(.errored // "-") calls=\((.calls // []) | join(" -> "))"
    ' "$trajectories_summary" 2>/dev/null || true
    printf '\n## Plan Artifact Dirs\n\n```text\n'
    find "$DATAFETCH_HOME/sessions/${SESSION_ID:-}/plan/attempts" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort || true
    printf '```\n\n## Execute Artifact Dirs\n\n```text\n'
    find "$DATAFETCH_HOME/sessions/${SESSION_ID:-}/execute" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort || true
    printf '```\n'
  } > "$dir/server-summary.md"

  {
    printf '# Agent action trajectory\n\n'
    printf -- '- datafetchSessionId: %s\n' "${SESSION_ID:-}"
    printf -- '- status: %s\n' "$status"
    printf -- '- pass/fail: %s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"
    printf -- '- plan artifacts: %s\n' "$plan_artifact_count"
    printf -- '- execute artifacts: %s\n' "$execute_artifact_count"
    printf -- '- crystallisedName: %s\n\n' "${CRYSTALLISED_NAME:-}"

    printf '## Client Prompts\n\n'
    printf -- '- Q1 prompt: q1.prompt.txt\n'
    printf -- '- Q1 transcript: q1.out\n'
    printf -- '- Q2 prompt: q2.prompt.txt\n'
    printf -- '- Q2 transcript: q2.out\n\n'

    printf '## VFS Trajectory Timeline\n\n'
    jq -r '
      .[]
      | "- \(.id) phase=\(.phase // "legacy") mode=\(.mode // "-") crystallisable=\(.crystallisable // "-") errored=\(.errored // "-") callCount=\(.callCount // 0)\n  calls: \((.calls // []) | join(" -> "))\n  artifact: \(.artifactDir // "-")\n"
    ' "$trajectories_summary" 2>/dev/null || true

    printf '\n## Execute Sources\n\n'
    if [[ -d "$dir/sessions/${SESSION_ID:-}/execute" ]]; then
      while IFS= read -r src; do
        local rel="${src#$dir/}"
        printf '### %s\n\n```ts\n' "$rel"
        sed -n '1,180p' "$src"
        printf '\n```\n\n'
      done < <(find "$dir/sessions/${SESSION_ID:-}/execute" -name execute.ts -type f 2>/dev/null | sort)
    fi

    printf '## Crystallisation Gate Notes\n\n'
    jq -r '
      map(select((.phase // "") == "execute"))[]
      | "- \(.id): " +
        (if (.errored == true) then
          "blocked: execute errored"
        elif (((.calls // []) | length) < 2) then
          "blocked: only \(((.calls // []) | length)) recorded call(s); observer needs a db.* retrieval plus a downstream lib.* call"
        elif ([.calls[]? | select(startswith("lib."))] | length) == 0 then
          "blocked: no downstream lib.* call recorded"
        else
          "potentially eligible; inspect full trajectory"
        end)
    ' "$trajectories_summary" 2>/dev/null || true
  } > "$dir/action-trajectory.md"

  {
    printf '# Plan/Execute Contract Experiment\n\n'
    printf -- '- datafetchSessionId: %s\n' "${SESSION_ID:-}"
    printf -- '- status: %s\n' "$status"
    printf -- '- hypothesis: stricter prompt wording should make the client keep exploration in plan and reserve execute for one committed, reusable trajectory.\n'
    printf -- '- pass/fail: %s passed, %s failed\n\n' "$PASS_COUNT" "$FAIL_COUNT"

    printf '## What The Client Was Asked To Do\n\n'
    printf 'The prompt allowed repeated `datafetch plan` calls for exploration, but framed `datafetch execute` as a one-shot commitment: if the agent was still uncertain, it should keep planning; once it ran execute, it should stop probing and answer from that committed artifact.\n\n'
    printf 'The committed execute artifact was expected to contain a repeatable workflow, not a bare search: substrate retrieval, filing selection or explicit fallback choice, table-plan inference, table math, and a final printed answer.\n\n'

    printf '## Phase Counts\n\n'
    printf '| Question | Plan artifacts | Execute artifacts |\n'
    printf '| --- | ---: | ---: |\n'
    printf '| Q1 chemicals | %s | %s |\n' "${PRE_Q2_PLAN_ARTIFACT_COUNT:-unknown}" "${PRE_Q2_EXECUTE_ARTIFACT_COUNT:-unknown}"
    if [[ -n "${POST_Q2_PLAN_ARTIFACT_COUNT:-}" && -n "${PRE_Q2_PLAN_ARTIFACT_COUNT:-}" ]]; then
      printf '| Q2 coal | %s | %s |\n' "$((POST_Q2_PLAN_ARTIFACT_COUNT - PRE_Q2_PLAN_ARTIFACT_COUNT))" "$((POST_Q2_EXECUTE_ARTIFACT_COUNT - PRE_Q2_EXECUTE_ARTIFACT_COUNT))"
    else
      printf '| Q2 coal | unknown | unknown |\n'
    fi
    printf '\n'

    printf '## Contract Verdict\n\n'
    if [[ "${PRE_Q2_EXECUTE_ARTIFACT_COUNT:-0}" == "1" ]]; then
      printf -- '- Q1 respected the one-execute boundary.\n'
    else
      printf -- '- Q1 did not respect the one-execute boundary: it produced %s execute artifacts.\n' "${PRE_Q2_EXECUTE_ARTIFACT_COUNT:-unknown}"
    fi
    if [[ -n "${POST_Q2_EXECUTE_ARTIFACT_COUNT:-}" && -n "${PRE_Q2_EXECUTE_ARTIFACT_COUNT:-}" ]]; then
      local q2_exec_delta=$((POST_Q2_EXECUTE_ARTIFACT_COUNT - PRE_Q2_EXECUTE_ARTIFACT_COUNT))
      if [[ "$q2_exec_delta" == "1" ]]; then
        printf -- '- Q2 respected the one-execute boundary.\n'
      else
        printf -- '- Q2 did not respect the one-execute boundary: it produced %s execute artifacts.\n' "$q2_exec_delta"
      fi
    fi
    printf '\n'

    printf '## Execute Artifacts\n\n'
    if [[ -d "$dir/sessions/${SESSION_ID:-}/execute" ]]; then
      while IFS= read -r src; do
        local exec_dir
        local rel
        exec_dir="$(dirname "$src")"
        rel="${src#$dir/}"
        printf '### %s\n\n' "$rel"
        if [[ -f "$exec_dir/result.json" ]]; then
          printf 'Envelope:\n\n```json\n'
          jq '{trajectoryId, phase, crystallisable, mode, exitCode, callPrimitives}' "$exec_dir/result.json" 2>/dev/null || cat "$exec_dir/result.json"
          printf '\n```\n\n'
        fi
        printf 'Source:\n\n```ts\n'
        sed -n '1,180p' "$src"
        printf '\n```\n\n'
        printf 'Stdout head:\n\n```text\n'
        sed -n '1,80p' "$exec_dir/stdout.txt" 2>/dev/null || true
        printf '\n```\n\n'
      done < <(find "$dir/sessions/${SESSION_ID:-}/execute" -name execute.ts -type f 2>/dev/null | sort)
    fi

    printf '## Interpretation Guide\n\n'
    printf 'A good result is not merely `phase=execute`. A good execute artifact should read like a reusable typed interface in miniature: it should retrieve through `df.db.*`, route through reusable `df.lib.*` primitives or a learned `df.lib.crystallise_*` tool, and print the final answer. Multiple execute artifacts, or execute artifacts that only search and print candidates, mean the agent still used execute as exploration.\n'
  } > "$dir/experiment-narrative.md"

  cat > "$dir/README.md" <<EOF
# agent-loop troubleshooting artefact

- status: $status
- datafetchSessionId: ${SESSION_ID:-}
- original DATAFETCH_HOME: $DATAFETCH_HOME
- serverUrl: ${DATAFETCH_SERVER_URL:-}
- q1 latest trajectory: ${q1_latest_id:-}
- q2 latest trajectory: ${q2_latest_id:-}
- crystallisedName: ${CRYSTALLISED_NAME:-}
- plan artifacts: $plan_artifact_count
- execute artifacts: $execute_artifact_count
- pass/fail: $PASS_COUNT passed, $FAIL_COUNT failed

Start with:

\`\`\`bash
jq . metadata.json
sed -n '1,220p' client-summary.md
sed -n '1,260p' server-summary.md
sed -n '1,260p' action-trajectory.md
sed -n '1,260p' experiment-narrative.md
jq 'map({id, mode, phase, crystallisable, errored, calls})' trajectory-summary.json
sed -n '1,120p' q1.out
sed -n '1,120p' q2.out
\`\`\`
EOF

  step "troubleshooting artifact written: $dir"
}

trap teardown EXIT

# ---- Pre-flight checks -----------------------------------------------------
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

# ---- Step: bring up the server + publish mount -----------------------------
setup_dataplane

# ---- Step: open a session for the test tenant ------------------------------
step "session new --tenant test-jay"
SESSION_ID=$(dft session new --tenant test-jay --json | jq -r .sessionId)
export SESSION_ID
assert_neq "" "$SESSION_ID" "session id non-empty"

# ---- Helper: drive the client agent inside tmux + collect pane output -------
# Write a self-contained wrapper script to disk for tmux to launch. This is
# more portable than trying to escape the prompt into a `tmux new-session
# -d "bash -c '...'"` one-liner (macOS bash 3.2 lacks ${var@Q}).
run_agent_in_tmux() {
  local sess="$1"
  local prompt="$2"
  local outfile="$3"
  local sentinel="$4"

  rm -f "$outfile" "$sentinel" "$outfile.exit"

  local wrap="$DATAFETCH_HOME/$sess.wrap.sh"
  local promptfile="$DATAFETCH_HOME/$sess.prompt.txt"

  # Prompt verbatim on disk; the wrapper reads it via $(cat ...).
  printf '%s' "$prompt" > "$promptfile"

  cat > "$wrap" <<WRAP
#!/usr/bin/env bash
set -o pipefail
LIB_DIR="$LIB_DIR"
source "\$LIB_DIR/common.sh"
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
export PATH="$PATH"
export SESSION_ID="$SESSION_ID"
agent_cmd "\$(cat "$promptfile")" > "$outfile" 2>&1
echo \$? > "$outfile.exit"
touch "$sentinel"
WRAP
  chmod +x "$wrap"

  tmux new-session -d -s "$sess" "bash $wrap"
}

# ---- Step: Q1 (chemicals revenue range, expect 700) ------------------------
Q1_PROMPT='What is the range of chemicals revenue between 2014 and 2018? The datafetch CLI is on PATH; the FinQA mount finqa-2024 is published. Do not read repo tests or demo source files for the answer.

You MUST use the plan/execute contract:
1. Orient with `cat $DATAFETCH_HOME/AGENTS.md`, `cat $DATAFETCH_HOME/df.d.ts`, and `datafetch apropos`.
2. Use `datafetch plan -e "..."` for exploration/sampling only. Do not answer from plan output.
3. Commit the repeatable TypeScript trajectory with exactly ONE `datafetch execute -e "..."` call. If you are not ready to commit, keep using `datafetch plan`; do not use execute as a probe.

The single execute snippet must be the minimal reusable chain in one run: query retrieval with `df.db.finqaCases.search(...)` or `df.db.finqaCases.findSimilar(...)` -> `df.lib.pickFiling` -> `df.lib.inferTableMathPlan` -> `df.lib.executeTableMath` -> final print. Do not use `findExact` with a literal discovered question unless the user supplied a stable id; exact filters crystallise brittle one-off wrappers. Resolve fallbacks and candidate-search uncertainty in plan mode before execute; do not put fallback branches, manual candidate scoring, or alternate query attempts inside execute. The execute artifact should read like a reusable typed interface, not a debug script.

Use the exact db identifier listed in df.d.ts for the FinQA cases collection, usually `df.db.finqaCases` in live Atlas. Search for the exact task shape "range of chemicals revenue between 2014 and 2018"; prefer exact 2014-2018 matches over shorter date ranges. If you think the mount is unavailable, verify with `curl "$DATAFETCH_SERVER_URL/v1/mounts"`; do not hard-code localhost:8080. Print the final numeric answer as a single number on its own line at the end, after the execute run.'
Q1_OUT="$DATAFETCH_HOME/q1.out"
Q1_SENTINEL="$DATAFETCH_HOME/q1.done"

step "Q1: spawning tmux pane dft-q1 (timeout=${AGENT_LOOP_TIMEOUT}s)"
run_agent_in_tmux dft-q1 "$Q1_PROMPT" "$Q1_OUT" "$Q1_SENTINEL"

if ! wait_for_tmux dft-q1 "$AGENT_LOOP_TIMEOUT" "$Q1_SENTINEL"; then
  dump_tmux_pane dft-q1 "$Q1_OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Make sure tmux is fully reaped before we move on.
tmux kill-session -t dft-q1 2>/dev/null || true

if [[ -f "$Q1_OUT" ]]; then
  step "Q1 transcript head:"
  head -n 30 "$Q1_OUT" >&2 || true
fi

# Trajectory: must exist.
step "Q1: assert at least one trajectory written"
TRAJ_COUNT=$(count_trajectory_files)
if (( TRAJ_COUNT > 0 )); then
  printf '[PASS] %d trajectory file(s) written\n' "$TRAJ_COUNT"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] no trajectory files in %s\n' "$DATAFETCH_HOME/trajectories" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

LATEST_Q1=$(latest_trajectory)
if [[ -n "$LATEST_Q1" ]]; then
  step "Q1 latest trajectory: $LATEST_Q1"
  if [[ "${DEBUG:-0}" == "1" ]]; then
    jq '{id, mode, phase, crystallisable, errored, calls: [.calls[].primitive]}' "$LATEST_Q1" >&2 || true
  fi
  # New contract: planning may produce many exploratory trajectories, but
  # the answer must come from a committed execute trajectory.
  Q1_PLAN_ARTIFACT_COUNT=$(count_session_phase_artifacts plan)
  Q1_EXECUTE_ARTIFACT_COUNT=$(count_session_phase_artifacts execute)
  if (( Q1_PLAN_ARTIFACT_COUNT > 0 )); then
    printf '[PASS] Q1 wrote %s plan artifact(s)\n' "$Q1_PLAN_ARTIFACT_COUNT"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] Q1 wrote no plan artifacts under sessions/%s/plan/attempts\n' "$SESSION_ID" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  if (( Q1_EXECUTE_ARTIFACT_COUNT > 0 )); then
    printf '[PASS] Q1 wrote %s execute artifact(s)\n' "$Q1_EXECUTE_ARTIFACT_COUNT"
    PASS_COUNT=$((PASS_COUNT + 1))
    if [[ "$Q1_EXECUTE_ARTIFACT_COUNT" == "1" ]]; then
      printf '[PASS] Q1 used exactly one execute artifact\n'
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      printf '[FAIL] Q1 used %s execute artifacts; execute is still being used as exploration\n' "$Q1_EXECUTE_ARTIFACT_COUNT" >&2
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    printf '[FAIL] Q1 wrote no execute artifacts under sessions/%s/execute\n' "$SESSION_ID" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  Q1_LATEST_GOOD=$(latest_successful_trajectory_phase execute)
  if [[ -n "$Q1_LATEST_GOOD" ]]; then
    step "Q1 latest successful execute trajectory: $Q1_LATEST_GOOD"
    Q1_MODE=$(jq -r '.mode // empty' "$Q1_LATEST_GOOD")
    assert_eq "novel" "$Q1_MODE" "Q1 trajectory mode == novel"
    assert_committed_execute_shape "$Q1_LATEST_GOOD" "Q1"
  else
    printf '[FAIL] Q1: no successful execute trajectory found\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# Wait briefly for the observer to crystallise.
step "Q1: waiting up to 5s for observer crystallisation"
crystallise_seen=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  # shellcheck disable=SC2086
  if compgen -G "$DATAFETCH_HOME/lib/test-jay/crystallise_*.ts" >/dev/null 2>&1; then
    crystallise_seen=1
    break
  fi
  sleep 0.5
done
if (( crystallise_seen == 1 )); then
  printf '[PASS] crystallise_*.ts written under lib/test-jay/\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] no crystallise_*.ts under lib/test-jay/ within 5s\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

CRYSTALLISED_FILE=""
CRYSTALLISED_NAME=""
if (( crystallise_seen == 1 )); then
  CRYSTALLISED_FILE=$(ls -t "$DATAFETCH_HOME/lib/test-jay"/crystallise_*.ts 2>/dev/null | head -n 1 || true)
  CRYSTALLISED_NAME=$(basename "$CRYSTALLISED_FILE" .ts)
  step "Q1 crystallised function: $CRYSTALLISED_NAME"
  if [[ "$CRYSTALLISED_NAME" =~ ^crystallise_range_table_metric_[0-9a-f]{8}$ ]]; then
    printf '[PASS] crystallised name is intent-shaped (%s)\n' "$CRYSTALLISED_NAME"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] crystallised name is not intent-shaped: %s\n' "$CRYSTALLISED_NAME" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# Substrate-grounding check: verify the agent's trajectories actually
# touched the data plane via `df.db.*`. Prior runs showed Haiku fabricating
# filing data when given enough context, so a numeric match against the
# expected answer is meaningless without proof the substrate was queried.
step "Q1: assert at least one trajectory invokes df.db.* (substrate grounding)"
Q1_DB_HITS=0
for f in "$DATAFETCH_HOME/trajectories/"*.json; do
  if [[ -f "$f" ]] && jq -e '[.calls[]? | select(.primitive | startswith("db."))] | length > 0' "$f" >/dev/null 2>&1; then
    Q1_DB_HITS=$((Q1_DB_HITS + 1))
  fi
done
if (( Q1_DB_HITS > 0 )); then
  printf '[PASS] %d Q1 trajectory(ies) invoked df.db.* — agent grounded in substrate\n' "$Q1_DB_HITS"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] no Q1 trajectory invoked df.db.* — agent may have fabricated input data\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Q1 gold answer: 700 (chemicals revenue range 2014-2018, FinQA fixture).
# Conditional on substrate grounding: a 700 match without df.db.* calls is
# meaningless (likely hallucinated). Only treat it as a real PASS if the
# substrate was actually touched.
step "Q1: assert gold answer 700 appears in the response"
if [[ -f "$Q1_OUT" ]] && grep -Eq '(^|[^0-9.])700([^0-9.]|$)' "$Q1_OUT"; then
  if (( Q1_DB_HITS > 0 )); then
    printf '[PASS] Q1 response contains "700" (and substrate was queried)\n'
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] Q1 response contains "700" but NO df.db.* call — likely hallucinated\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  printf '[FAIL] Q1 response does NOT contain "700"\n' >&2
  if [[ "${DEBUG:-0}" == "1" && -f "$Q1_OUT" ]]; then
    cat "$Q1_OUT" >&2
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ---- Step: Q2 (coal revenue range, expect 1000) ----------------------------
if [[ -n "$CRYSTALLISED_NAME" ]]; then
  step "Q2 preflight: datafetch apropos ranks the learned function first"
  APROPOS_JSON=$(dft apropos --json "range coal revenue 2014 2018" || true)
  DISCOVERY_TOP=$(printf '%s\n' "$APROPOS_JSON" | jq -r '.matches[0].name // empty' 2>/dev/null || true)
  DISCOVERY_SCORE=$(printf '%s\n' "$APROPOS_JSON" | jq -r '.matches[0].score // empty' 2>/dev/null || true)
  if [[ "$DISCOVERY_TOP" == "$CRYSTALLISED_NAME" ]]; then
    printf '[PASS] apropos top=%s score=%s\n' "$DISCOVERY_TOP" "$DISCOVERY_SCORE"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] apropos top=%s, expected %s\n' "$DISCOVERY_TOP" "$CRYSTALLISED_NAME" >&2
    printf '%s\n' "$APROPOS_JSON" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

Q2_PROMPT='What is the range of coal revenue between 2014 and 2018? The datafetch CLI is on PATH and the active session is already configured. Do not read repo tests or demo source files for the answer.

You MUST use the plan/execute contract:
1. Orient with `cat $DATAFETCH_HOME/AGENTS.md`, then `datafetch apropos --json "range coal revenue 2014 2018"` and inspect the top match.
2. Use `datafetch plan -e "..."` for any exploration/sampling only. Do not answer from plan output.
3. Commit the repeatable final answer path with exactly ONE `datafetch execute -e "..."` call. If the top apropos match fits, that one execute call should invoke the learned tool directly. If no learned tool fits, that one execute call must contain the full db retrieval -> filing selection -> table-plan inference -> table math workflow.

Do not use execute as a second planning surface. If you are uncertain, continue with `datafetch plan`. If the top apropos match is a learned tool, the execute snippet should call that learned function directly; do not recompose the full primitive chain unless no learned tool matches. If you need the raw db surface, run `cat $DATAFETCH_HOME/df.d.ts` and use the exact db identifier listed there. Print the final numeric answer as a single number on its own line at the end, after the execute run.'
Q2_OUT="$DATAFETCH_HOME/q2.out"
Q2_SENTINEL="$DATAFETCH_HOME/q2.done"

step "Q2: spawning tmux pane dft-q2 (timeout=${AGENT_LOOP_TIMEOUT}s)"
# Snapshot trajectory dir so we can find Q2's new trajectory.
PRE_Q2_TRAJ_COUNT=$(count_trajectory_files)
PRE_Q2_CRYSTALLISED_COUNT=$(find "$DATAFETCH_HOME/lib/test-jay" -maxdepth 1 -name 'crystallise_*.ts' 2>/dev/null | wc -l | tr -d ' ' || true)
PRE_Q2_PLAN_ARTIFACT_COUNT=$(count_session_phase_artifacts plan)
PRE_Q2_EXECUTE_ARTIFACT_COUNT=$(count_session_phase_artifacts execute)
run_agent_in_tmux dft-q2 "$Q2_PROMPT" "$Q2_OUT" "$Q2_SENTINEL"

if ! wait_for_tmux dft-q2 "$AGENT_LOOP_TIMEOUT" "$Q2_SENTINEL"; then
  dump_tmux_pane dft-q2 "$Q2_OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
tmux kill-session -t dft-q2 2>/dev/null || true

if [[ -f "$Q2_OUT" ]]; then
  step "Q2 transcript head:"
  head -n 30 "$Q2_OUT" >&2 || true
fi

POST_Q2_TRAJ_COUNT=$(count_trajectory_files)
if (( POST_Q2_TRAJ_COUNT > PRE_Q2_TRAJ_COUNT )); then
  printf '[PASS] Q2 added %d trajectory file(s)\n' "$((POST_Q2_TRAJ_COUNT - PRE_Q2_TRAJ_COUNT))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] Q2 added no trajectory files\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

POST_Q2_PLAN_ARTIFACT_COUNT=$(count_session_phase_artifacts plan)
POST_Q2_EXECUTE_ARTIFACT_COUNT=$(count_session_phase_artifacts execute)
if (( POST_Q2_PLAN_ARTIFACT_COUNT > PRE_Q2_PLAN_ARTIFACT_COUNT )); then
  printf '[PASS] Q2 added %d plan artifact(s)\n' "$((POST_Q2_PLAN_ARTIFACT_COUNT - PRE_Q2_PLAN_ARTIFACT_COUNT))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] Q2 added no plan artifacts\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
if (( POST_Q2_EXECUTE_ARTIFACT_COUNT > PRE_Q2_EXECUTE_ARTIFACT_COUNT )); then
  Q2_EXECUTE_DELTA=$((POST_Q2_EXECUTE_ARTIFACT_COUNT - PRE_Q2_EXECUTE_ARTIFACT_COUNT))
  printf '[PASS] Q2 added %d execute artifact(s)\n' "$Q2_EXECUTE_DELTA"
  PASS_COUNT=$((PASS_COUNT + 1))
  if [[ "$Q2_EXECUTE_DELTA" == "1" ]]; then
    printf '[PASS] Q2 used exactly one execute artifact\n'
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] Q2 used %s execute artifacts; execute is still being used as exploration\n' "$Q2_EXECUTE_DELTA" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  printf '[FAIL] Q2 added no execute artifacts\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

LATEST_Q2=$(latest_trajectory)
if [[ -n "$LATEST_Q2" && "$LATEST_Q2" != "$LATEST_Q1" ]]; then
  step "Q2 latest trajectory: $LATEST_Q2"
  if [[ "${DEBUG:-0}" == "1" ]]; then
    jq '{id, mode, phase, crystallisable, errored, calls: [.calls[].primitive]}' "$LATEST_Q2" >&2 || true
  fi
  Q2_LATEST_GOOD=$(latest_successful_trajectory_phase execute)
  if [[ -n "$Q2_LATEST_GOOD" && "$Q2_LATEST_GOOD" == "${Q1_LATEST_GOOD:-}" ]]; then
    printf '[FAIL] Q2 latest execute trajectory is still Q1 trajectory; Q2 did not commit a new execute run\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  elif [[ -n "$Q2_LATEST_GOOD" ]]; then
    step "Q2 latest successful execute trajectory: $Q2_LATEST_GOOD"
    Q2_MODE=$(jq -r '.mode // empty' "$Q2_LATEST_GOOD")
    # Per the plan: when Q1 crystallised a function, Q2 should hit that
    # function and report mode == "interpreted". If crystallisation didn't
    # fire (likely with the current Phase 1 behaviour) Q2 will also be
    # mode "novel". We assert the spec-correct outcome here so the failure
    # surfaces the gap in the cost-panel signal.
    assert_eq "interpreted" "$Q2_MODE" "Q2 trajectory mode == interpreted"
    if [[ -n "$CRYSTALLISED_NAME" ]]; then
      assert_committed_execute_shape "$Q2_LATEST_GOOD" "Q2" learned-tool
    else
      assert_committed_execute_shape "$Q2_LATEST_GOOD" "Q2"
    fi

    # Should reference the exact learned function discovered above, not just
    # any lib.* helper from the primitive chain.
    if [[ -n "$CRYSTALLISED_NAME" ]] && jq -e --arg name "lib.$CRYSTALLISED_NAME" '[.calls[].primitive] | index($name) != null' "$Q2_LATEST_GOOD" >/dev/null; then
      printf '[PASS] Q2 calls include learned function lib.%s\n' "$CRYSTALLISED_NAME"
      PASS_COUNT=$((PASS_COUNT + 1))
    elif [[ -n "$CRYSTALLISED_NAME" ]]; then
      printf '[FAIL] Q2 calls do NOT include learned function lib.%s\n' "$CRYSTALLISED_NAME" >&2
      if [[ "${DEBUG:-0}" == "1" ]]; then
        jq '[.calls[].primitive]' "$Q2_LATEST_GOOD" >&2 || true
      fi
      FAIL_COUNT=$((FAIL_COUNT + 1))
    else
      printf '[FAIL] Q2 learned-function assertion skipped because Q1 did not crystallise\n' >&2
      if [[ "${DEBUG:-0}" == "1" ]]; then
        jq '[.calls[].primitive]' "$Q2_LATEST_GOOD" >&2 || true
      fi
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    printf '[FAIL] Q2: no successful execute trajectory found\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

step "Q2: assert no nested crystallised wrapper was created"
POST_Q2_CRYSTALLISED_COUNT=$(find "$DATAFETCH_HOME/lib/test-jay" -maxdepth 1 -name 'crystallise_*.ts' 2>/dev/null | wc -l | tr -d ' ' || true)
if [[ "$POST_Q2_CRYSTALLISED_COUNT" == "$PRE_Q2_CRYSTALLISED_COUNT" ]]; then
  printf '[PASS] crystallised function count stayed at %s\n' "$POST_Q2_CRYSTALLISED_COUNT"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] crystallised function count changed from %s to %s after Q2\n' "$PRE_Q2_CRYSTALLISED_COUNT" "$POST_Q2_CRYSTALLISED_COUNT" >&2
  ls -la "$DATAFETCH_HOME/lib/test-jay" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

step "Q2: assert at least one trajectory invokes df.db.* (substrate grounding)"
Q2_DB_HITS=0
# Q2-era trajectories are the (POST - PRE) most recent files in the dir.
Q2_NEW=$((POST_Q2_TRAJ_COUNT - PRE_Q2_TRAJ_COUNT))
if (( Q2_NEW < 0 )); then
  Q2_NEW=0
fi
if (( Q2_NEW > 0 )); then
  while IFS= read -r f; do
    if jq -e '[.calls[]? | select(.primitive | startswith("db."))] | length > 0' "$f" >/dev/null 2>&1; then
      Q2_DB_HITS=$((Q2_DB_HITS + 1))
    fi
  done < <(ls -t "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null | head -n "$Q2_NEW")
fi
if (( Q2_DB_HITS > 0 )); then
  printf '[PASS] %d Q2 trajectory(ies) invoked df.db.* — agent grounded in substrate\n' "$Q2_DB_HITS"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] no Q2 trajectory invoked df.db.* — agent may have fabricated input data\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

step "Q2: assert gold answer 1000 appears in the response"
if [[ -f "$Q2_OUT" ]] && grep -Eq '(^|[^0-9.])1000([^0-9.]|$)' "$Q2_OUT"; then
  if (( Q2_DB_HITS > 0 )); then
    printf '[PASS] Q2 response contains "1000" (and substrate was queried)\n'
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] Q2 response contains "1000" but NO df.db.* call — likely hallucinated\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  printf '[FAIL] Q2 response does NOT contain "1000"\n' >&2
  if [[ "${DEBUG:-0}" == "1" && -f "$Q2_OUT" ]]; then
    cat "$Q2_OUT" >&2
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if (( FAIL_COUNT == 0 )); then
  write_troubleshooting_artifact "pass"
else
  write_troubleshooting_artifact "fail"
fi

print_summary "agent-loop"
