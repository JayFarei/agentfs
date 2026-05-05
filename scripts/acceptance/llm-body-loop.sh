#!/usr/bin/env bash
# scripts/acceptance/llm-body-loop.sh
#
# Drives a task that requires writing an `llm()`-bodied function. Asserts:
#   - the function file exists at the expected path
#   - the trajectory shows mode == "llm-backed" and cost.llmCalls >= 1
#
# Required env: ATLAS_URI, ANTHROPIC_KEY (or ANTHROPIC_API_KEY).
# Optional env: ATLAS_DB_NAME, DF_TEST_PORT, AGENT_LOOP_TIMEOUT, DEBUG.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

show_help() {
  cat <<EOF
llm-body-loop.sh — verify the agent loop produces an llm()-backed function.

Required env:
  ATLAS_URI                     MongoDB Atlas connection string
  ANTHROPIC_KEY or
  ANTHROPIC_API_KEY             Anthropic credential

Optional env:
  ATLAS_DB_NAME (default atlasfs_hackathon)
  DF_TEST_PORT (default 8090)
  AGENT_LOOP_TIMEOUT (default 300s, per-question budget)
  DEBUG=1
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

AGENT_LOOP_TIMEOUT="${AGENT_LOOP_TIMEOUT:-300}"

trap teardown EXIT

normalise_anthropic_env
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  printf '[FAIL] ANTHROPIC_API_KEY (or ANTHROPIC_KEY) is required\n' >&2
  exit 2
fi
if [[ -z "${ATLAS_URI:-}" ]]; then
  printf '[FAIL] ATLAS_URI is required\n' >&2
  exit 2
fi
for tool in claude tmux jq curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '[FAIL] required tool not on PATH: %s\n' "$tool" >&2
    exit 2
  fi
done

require_skill_installed
setup_dataplane

step "session new --tenant test-jay"
SESSION_ID=$(dft session new --tenant test-jay --json | jq -r .sessionId)
export SESSION_ID
assert_neq "" "$SESSION_ID" "session id non-empty"

# Mirror agent-loop.sh's tmux helper.
run_claude_in_tmux() {
  local sess="$1"
  local prompt="$2"
  local outfile="$3"
  local sentinel="$4"

  rm -f "$outfile" "$sentinel" "$outfile.exit"

  local wrap="$DATAFETCH_HOME/$sess.wrap.sh"
  local promptfile="$DATAFETCH_HOME/$sess.prompt.txt"
  printf '%s' "$prompt" > "$promptfile"

  cat > "$wrap" <<WRAP
#!/usr/bin/env bash
set -o pipefail
LIB_DIR="$LIB_DIR"
source "\$LIB_DIR/common.sh"
export ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
export DATAFETCH_HOME="$DATAFETCH_HOME"
export DATAFETCH_SERVER_URL="$DATAFETCH_SERVER_URL"
export PATH="$PATH"
export SESSION_ID="$SESSION_ID"
claude_cmd "\$(cat "$promptfile")" > "$outfile" 2>&1
echo \$? > "$outfile.exit"
touch "$sentinel"
WRAP
  chmod +x "$wrap"

  tmux new-session -d -s "$sess" "bash $wrap"
}

# ---- Step: prompt that REQUIRES an llm() body ------------------------------
PROMPT='Author a function `summariseFiling` at $DATAFETCH_HOME/lib/test-jay/summariseFiling.ts that takes one finqa case (input: { caseId: string }) and returns { caseId: string, narrative: string }. The body MUST use `body: llm({prompt: "...", model: "anthropic/claude-haiku-4-5"})` to generate the narrative as a one-paragraph plain-English summary. Write the file via heredoc (`cat > $DATAFETCH_HOME/lib/test-jay/summariseFiling.ts <<EOF ... EOF`). Then call it on one finqa case via `datafetch tsx -e "console.log(JSON.stringify(await df.lib.summariseFiling({caseId: \"<id>\"})))"` (pick any caseId from `await df.db.finqaCases.findExact({}, 1)`). Print the resulting JSON object on a single line at the end of your response.'
OUT="$DATAFETCH_HOME/llm.out"
SENTINEL="$DATAFETCH_HOME/llm.done"

step "spawning tmux pane dft-llm (timeout=${AGENT_LOOP_TIMEOUT}s)"
run_claude_in_tmux dft-llm "$PROMPT" "$OUT" "$SENTINEL"

if ! wait_for_tmux dft-llm "$AGENT_LOOP_TIMEOUT" "$SENTINEL"; then
  dump_tmux_pane dft-llm "$OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
tmux kill-session -t dft-llm 2>/dev/null || true

if [[ -f "$OUT" ]]; then
  step "transcript head:"
  head -n 30 "$OUT" >&2 || true
fi

# ---- Step: assert the file was authored ------------------------------------
assert_file_exists "$DATAFETCH_HOME/lib/test-jay/summariseFiling.ts" \
  "summariseFiling.ts authored under lib/test-jay/"

# ---- Step: latest trajectory shows llm-backed mode + llmCalls >= 1 ---------
LATEST=$(latest_trajectory)
if [[ -z "$LATEST" ]]; then
  printf '[FAIL] no trajectory written\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  step "latest trajectory: $LATEST"
  # Find the most recent successful trajectory; ignore exploratory errored
  # turns the agent may produce.
  LATEST_GOOD=$(ls -t "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null \
    | while read -r f; do
        if [[ "$(jq -r '.errored // false' "$f")" == "false" ]] && \
           [[ "$(jq -r '.calls | length' "$f")" -gt 0 ]]; then
          echo "$f"
          break
        fi
      done)
  if [[ -z "$LATEST_GOOD" ]]; then
    LATEST_GOOD="$LATEST"
  fi
  step "asserting against: $LATEST_GOOD"
  if [[ "${DEBUG:-0}" == "1" ]]; then
    jq '{id, mode, errored, cost, calls: [.calls[].primitive]}' "$LATEST_GOOD" >&2 || true
  fi
  TRAJ_MODE=$(jq -r '.mode // empty' "$LATEST_GOOD")
  assert_eq "llm-backed" "$TRAJ_MODE" "trajectory mode == llm-backed"
  TRAJ_LLMCALLS=$(jq -r '(.cost.llmCalls // 0)' "$LATEST_GOOD")
  if [[ "$TRAJ_LLMCALLS" =~ ^[0-9]+$ ]] && (( TRAJ_LLMCALLS >= 1 )); then
    printf '[PASS] cost.llmCalls (%s) >= 1\n' "$TRAJ_LLMCALLS"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] cost.llmCalls (%s) is not >= 1\n' "$TRAJ_LLMCALLS" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

print_summary "llm-body-loop"
