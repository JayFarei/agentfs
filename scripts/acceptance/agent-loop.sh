#!/usr/bin/env bash
# scripts/acceptance/agent-loop.sh
#
# Headline acceptance test. Drives Claude Code (in --print --bare mode,
# inside a tmux pane) against the FinQA chemicals/coal revenue questions
# and asserts on the disk artefacts:
#
#   - Q1 (chemicals): trajectory file written, mode == "novel",
#                     gold answer == 700.
#   - After observer crystallise: lib/test-jay/crystallise_*.ts on disk.
#   - Q2 (coal):     trajectory file written, mode == "interpreted",
#                    callPrimitives include lib.crystallise_*,
#                    gold answer == 1000.
#
# Required env: ATLAS_URI, ANTHROPIC_KEY (or ANTHROPIC_API_KEY).
# Optional env: ATLAS_DB_NAME (default atlasfs_hackathon),
#               DF_TEST_PORT (default 8090),
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

show_help() {
  cat <<EOF
agent-loop.sh — drive Claude Code through the FinQA two-question scenario.

Required env:
  ATLAS_URI                       MongoDB Atlas connection string
  ANTHROPIC_KEY or
  ANTHROPIC_API_KEY               Anthropic credential (claude --bare reads
                                  ANTHROPIC_API_KEY strictly)

Optional env:
  ATLAS_DB_NAME                   default: atlasfs_hackathon
  DF_TEST_PORT                    default: 8090
  AGENT_LOOP_TIMEOUT              per-question budget (seconds), default 300
  DEBUG=1                         dump tmux pane + server log on failure

Required tools: datafetch (or the bin/datafetch.mjs shim), claude, tmux,
                jq, curl.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

# Per-question budget. Claude --print loops can take a few minutes.
AGENT_LOOP_TIMEOUT="${AGENT_LOOP_TIMEOUT:-300}"

trap teardown EXIT

# ---- Pre-flight checks -----------------------------------------------------
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

# ---- Step: bring up the server + publish mount -----------------------------
setup_dataplane

# ---- Step: open a session for the test tenant ------------------------------
step "session new --tenant test-jay"
SESSION_ID=$(dft session new --tenant test-jay --json | jq -r .sessionId)
export SESSION_ID
assert_neq "" "$SESSION_ID" "session id non-empty"

# ---- Helper: drive Claude inside tmux + collect the pane output ------------
# Write a self-contained wrapper script to disk for tmux to launch. This is
# more portable than trying to escape the prompt into a `tmux new-session
# -d "bash -c '...'"` one-liner (macOS bash 3.2 lacks ${var@Q}).
run_claude_in_tmux() {
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

# ---- Step: Q1 (chemicals revenue range, expect 700) ------------------------
Q1_PROMPT='What is the range of chemicals revenue between 2014 and 2018? The datafetch CLI is on PATH; the FinQA mount finqa-2024 is published. Use `datafetch apropos` to find an existing /lib/ function (try keywords like "table math", "range", "filing"), then call the chain through `datafetch tsx -e "..."` so the trajectory is contiguous. Search the cases collection for a question about "range of chemicals revenue 2014 2018" and use that case. Print the final numeric answer as a single number on its own line at the end.'
Q1_OUT="$DATAFETCH_HOME/q1.out"
Q1_SENTINEL="$DATAFETCH_HOME/q1.done"

step "Q1: spawning tmux pane dft-q1 (timeout=${AGENT_LOOP_TIMEOUT}s)"
run_claude_in_tmux dft-q1 "$Q1_PROMPT" "$Q1_OUT" "$Q1_SENTINEL"

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
TRAJ_COUNT=$(ls "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null | wc -l | tr -d ' ' || echo 0)
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
    jq '{id, mode, errored, calls: [.calls[].primitive]}' "$LATEST_Q1" >&2 || true
  fi
  # PRD-spec: a successful first-time ad-hoc composition reports mode "novel".
  # Note: the most-recent trajectory may be one of the agent's exploratory
  # turns; pick the latest *successful* one (errored=false, calls > 0).
  Q1_LATEST_GOOD=$(ls -t "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null \
    | while read -r f; do
        if [[ "$(jq -r '.errored // false' "$f")" == "false" ]] && \
           [[ "$(jq -r '.calls | length' "$f")" -gt 0 ]]; then
          echo "$f"
          break
        fi
      done)
  if [[ -n "$Q1_LATEST_GOOD" ]]; then
    step "Q1 latest successful trajectory: $Q1_LATEST_GOOD"
    Q1_MODE=$(jq -r '.mode // empty' "$Q1_LATEST_GOOD")
    assert_eq "novel" "$Q1_MODE" "Q1 trajectory mode == novel"
  else
    printf '[FAIL] Q1: no successful (non-errored, with calls) trajectory found\n' >&2
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

# Q1 gold answer: 700 (chemicals revenue range 2014-2018, FinQA fixture).
# Match against the LAST line of stdout that is a bare number, OR look for
# the canonical "answer=700" suffix.
step "Q1: assert gold answer 700 appears in the response"
if [[ -f "$Q1_OUT" ]] && grep -Eq '(^|[^0-9.])700([^0-9.]|$)' "$Q1_OUT"; then
  printf '[PASS] Q1 response contains "700"\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] Q1 response does NOT contain "700"\n' >&2
  if [[ "${DEBUG:-0}" == "1" && -f "$Q1_OUT" ]]; then
    cat "$Q1_OUT" >&2
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ---- Step: Q2 (coal revenue range, expect 1000) ----------------------------
Q2_PROMPT='What is the range of coal revenue between 2014 and 2018? Use the same approach as before: search /lib/ via `datafetch apropos`, find the FinQA case via `df.db.finqaCases.search("range of coal revenue 2014 2018", 5)`, and run the math chain through `datafetch tsx -e "..."`. Print the final numeric answer as a single number on its own line.'
Q2_OUT="$DATAFETCH_HOME/q2.out"
Q2_SENTINEL="$DATAFETCH_HOME/q2.done"

step "Q2: spawning tmux pane dft-q2 (timeout=${AGENT_LOOP_TIMEOUT}s)"
# Snapshot trajectory dir so we can find Q2's new trajectory.
PRE_Q2_TRAJ_COUNT=$(ls "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null | wc -l | tr -d ' ' || echo 0)
run_claude_in_tmux dft-q2 "$Q2_PROMPT" "$Q2_OUT" "$Q2_SENTINEL"

if ! wait_for_tmux dft-q2 "$AGENT_LOOP_TIMEOUT" "$Q2_SENTINEL"; then
  dump_tmux_pane dft-q2 "$Q2_OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
tmux kill-session -t dft-q2 2>/dev/null || true

if [[ -f "$Q2_OUT" ]]; then
  step "Q2 transcript head:"
  head -n 30 "$Q2_OUT" >&2 || true
fi

POST_Q2_TRAJ_COUNT=$(ls "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null | wc -l | tr -d ' ' || echo 0)
if (( POST_Q2_TRAJ_COUNT > PRE_Q2_TRAJ_COUNT )); then
  printf '[PASS] Q2 added %d trajectory file(s)\n' "$((POST_Q2_TRAJ_COUNT - PRE_Q2_TRAJ_COUNT))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] Q2 added no trajectory files\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

LATEST_Q2=$(latest_trajectory)
if [[ -n "$LATEST_Q2" && "$LATEST_Q2" != "$LATEST_Q1" ]]; then
  step "Q2 latest trajectory: $LATEST_Q2"
  if [[ "${DEBUG:-0}" == "1" ]]; then
    jq '{id, mode, errored, calls: [.calls[].primitive]}' "$LATEST_Q2" >&2 || true
  fi
  Q2_LATEST_GOOD=$(ls -t "$DATAFETCH_HOME/trajectories"/*.json 2>/dev/null \
    | while read -r f; do
        if [[ "$(jq -r '.errored // false' "$f")" == "false" ]] && \
           [[ "$(jq -r '.calls | length' "$f")" -gt 0 ]]; then
          echo "$f"
          break
        fi
      done)
  if [[ -n "$Q2_LATEST_GOOD" ]]; then
    step "Q2 latest successful trajectory: $Q2_LATEST_GOOD"
    Q2_MODE=$(jq -r '.mode // empty' "$Q2_LATEST_GOOD")
    # Per the plan: when Q1 crystallised a function, Q2 should hit that
    # function and report mode == "interpreted". If crystallisation didn't
    # fire (likely with the current Phase 1 behaviour) Q2 will also be
    # mode "novel". We assert the spec-correct outcome here so the failure
    # surfaces the gap in the cost-panel signal.
    assert_eq "interpreted" "$Q2_MODE" "Q2 trajectory mode == interpreted"

    # Should reference a lib.<crystallised> call. The crystallised file
    # name has prefix "crystallise_" in the seed pipeline; allow any
    # lib.* call that matches the test-jay tenant's overlay.
    Q2_LIB_CALLS=$(jq -r '[.calls[].primitive] | map(select(startswith("lib."))) | length' "$Q2_LATEST_GOOD")
    if [[ "$Q2_LIB_CALLS" -ge 1 ]]; then
      printf '[PASS] Q2 calls include a lib.* primitive\n'
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      printf '[FAIL] Q2 calls do NOT include any lib.* primitive\n' >&2
      if [[ "${DEBUG:-0}" == "1" ]]; then
        jq '[.calls[].primitive]' "$Q2_LATEST_GOOD" >&2 || true
      fi
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    printf '[FAIL] Q2: no successful (non-errored, with calls) trajectory found\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

step "Q2: assert gold answer 1000 appears in the response"
if [[ -f "$Q2_OUT" ]] && grep -Eq '(^|[^0-9.])1000([^0-9.]|$)' "$Q2_OUT"; then
  printf '[PASS] Q2 response contains "1000"\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] Q2 response does NOT contain "1000"\n' >&2
  if [[ "${DEBUG:-0}" == "1" && -f "$Q2_OUT" ]]; then
    cat "$Q2_OUT" >&2
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

print_summary "agent-loop"
