#!/usr/bin/env bash
# scripts/acceptance/agent-body-loop.sh
#
# Drives a task that requires writing an `agent({prompt})` function. Asserts:
#   - the function file exists at the expected path
#   - the authored function uses agent({prompt}), not the deprecated llm() alias
#   - the trajectory called the authored function and cost.llmCalls >= 1
#
# Required env: ATLAS_URI.
# Optional env: ATLAS_DB_NAME, DF_TEST_PORT, AGENT_LOOP_TIMEOUT,
#               DF_AGENT_DRIVER (codex default, or claude), DEBUG.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

# The live harness should test the skill from the current worktree, not a
# stale copy previously installed into ~/.claude/skills.
export DATAFETCH_SKILL_PATH="${DATAFETCH_SKILL_PATH:-$REPO_ROOT/skills/datafetch/SKILL.md}"

show_help() {
  cat <<EOF
agent-body-loop.sh — verify the agent loop produces an agent-backed function.

Required env:
  ATLAS_URI                     MongoDB Atlas connection string

Optional env:
  DF_AGENT_DRIVER               codex (default) or claude
  DF_TEST_MODEL                 driver model override
  DF_AGENT_BODY_TEST_MODEL      model written into the agent() body
  DF_CLAUDE_BARE                1 forces claude --bare; default auto only
                                uses bare when an Anthropic API key is set
  ANTHROPIC_KEY or
  ANTHROPIC_API_KEY             optional for DF_AGENT_DRIVER=claude if the
                                Claude Code CLI is locally logged in
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

agent_driver_preflight || exit 2
if [[ -z "${ATLAS_URI:-}" ]]; then
  printf '[FAIL] ATLAS_URI is required\n' >&2
  exit 2
fi
for tool in tmux jq curl rg; do
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
run_agent_in_tmux() {
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
export PATH="$PATH"
export SESSION_ID="$SESSION_ID"
agent_cmd "\$(cat "$promptfile")" > "$outfile" 2>&1
echo \$? > "$outfile.exit"
touch "$sentinel"
WRAP
  chmod +x "$wrap"

  tmux new-session -d -s "$sess" "bash $wrap"
}

# ---- Step: prompt that REQUIRES an agent({prompt}) body --------------------
AGENT_BODY_MODEL="${DF_AGENT_BODY_TEST_MODEL:-${DF_LLM_TEST_MODEL:-${DATAFETCH_LLM_MODEL:-${DF_LLM_MODEL:-openai-codex/gpt-5.3-codex-spark}}}}"
PROMPT='Author a function `summariseFiling` at $DATAFETCH_HOME/lib/test-jay/summariseFiling.ts that takes one finqa case (input: { caseId: string }) and returns { caseId: string, narrative: string }. The body MUST use `body: agent({prompt: "...", model: "'$AGENT_BODY_MODEL'"})` to generate the narrative as a one-paragraph plain-English summary. Write the file via heredoc (`cat > $DATAFETCH_HOME/lib/test-jay/summariseFiling.ts <<EOF ... EOF`). Then call it on one finqa case via `datafetch tsx -e "console.log(JSON.stringify(await df.lib.summariseFiling({caseId: \"<id>\"})))"` (pick any caseId from `await df.db.finqaCases.findExact({}, 1)`). Print the resulting JSON object on a single line at the end of your response.'
OUT="$DATAFETCH_HOME/agent-body.out"
SENTINEL="$DATAFETCH_HOME/agent-body.done"

step "spawning tmux pane dft-agent-body (timeout=${AGENT_LOOP_TIMEOUT}s)"
run_agent_in_tmux dft-agent-body "$PROMPT" "$OUT" "$SENTINEL"

if ! wait_for_tmux dft-agent-body "$AGENT_LOOP_TIMEOUT" "$SENTINEL"; then
  dump_tmux_pane dft-agent-body "$OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
tmux kill-session -t dft-agent-body 2>/dev/null || true

if [[ -f "$OUT" ]]; then
  step "transcript head:"
  head -n 30 "$OUT" >&2 || true
fi

# ---- Step: assert the file was authored ------------------------------------
assert_file_exists "$DATAFETCH_HOME/lib/test-jay/summariseFiling.ts" \
  "summariseFiling.ts authored under lib/test-jay/"
if rg -Uq 'body\s*:\s*agent\s*\(\s*\{[\s\S]*prompt\s*:' "$DATAFETCH_HOME/lib/test-jay/summariseFiling.ts" && \
   ! rg -q 'llm\s*\(' "$DATAFETCH_HOME/lib/test-jay/summariseFiling.ts"; then
  printf '[PASS] summariseFiling.ts uses agent({prompt}) surface\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] summariseFiling.ts did not use agent({prompt}) cleanly\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ---- Step: controlled runtime call proves the body is actually agent-backed --
VERIFY_OUT="$DATAFETCH_HOME/agent-body-verify.out"
VERIFY_JSON="$DATAFETCH_HOME/agent-body-verify.json"
if dft tsx -e '
const rows = await df.db.finqaCases.findExact({}, 1);
const caseId = rows[0]?.id;
const r = await df.lib.summariseFiling({ caseId });
console.log(JSON.stringify(r));
' > "$VERIFY_OUT" 2>&1; then
  awk '/^\{/{ print; exit }' "$VERIFY_OUT" > "$VERIFY_JSON"
  if jq -e '.mode == "llm-backed"' "$VERIFY_JSON" >/dev/null 2>&1; then
    printf '[PASS] controlled call result mode == llm-backed\n'
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] controlled call result mode was not llm-backed\n' >&2
    cat "$VERIFY_OUT" >&2 || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  VERIFY_LLMCALLS=$(jq -r '(.cost.llmCalls // 0)' "$VERIFY_JSON" 2>/dev/null || echo 0)
  if [[ "$VERIFY_LLMCALLS" =~ ^[0-9]+$ ]] && (( VERIFY_LLMCALLS >= 1 )); then
    printf '[PASS] controlled call cost.llmCalls (%s) >= 1\n' "$VERIFY_LLMCALLS"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] controlled call cost.llmCalls (%s) is not >= 1\n' "$VERIFY_LLMCALLS" >&2
    cat "$VERIFY_OUT" >&2 || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  printf '[FAIL] controlled call of df.lib.summariseFiling failed\n' >&2
  cat "$VERIFY_OUT" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ---- Step: latest trajectory shows authored function + llmCalls >= 1 -------
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
  if jq -e '.calls[]? | select(.primitive == "lib.summariseFiling")' "$LATEST_GOOD" >/dev/null; then
    printf '[PASS] trajectory calls lib.summariseFiling\n'
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] trajectory does not call lib.summariseFiling\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  TRAJ_LLMCALLS=$(jq -r '(.cost.llmCalls // 0)' "$LATEST_GOOD")
  if [[ "$TRAJ_LLMCALLS" =~ ^[0-9]+$ ]] && (( TRAJ_LLMCALLS >= 1 )); then
    printf '[PASS] cost.llmCalls (%s) >= 1\n' "$TRAJ_LLMCALLS"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] cost.llmCalls (%s) is not >= 1\n' "$TRAJ_LLMCALLS" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

print_summary "agent-body-loop"
