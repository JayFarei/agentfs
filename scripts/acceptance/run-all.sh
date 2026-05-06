#!/usr/bin/env bash
# scripts/acceptance/run-all.sh
#
# Sequentially runs the three acceptance scripts and prints a final summary.
# Continues past failures (so you see every script's verdict in one log)
# but exits non-zero if any one fails.

set -uo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

show_help() {
  cat <<EOF
run-all.sh — run every acceptance script and report a summary.

Order:
  1. session-switch.sh   (no LLM, no Atlas — fastest smoke)
  2. intent-workspace.sh (no LLM, no Atlas — run/commit workspace smoke)
  3. agent-loop.sh       (Atlas + client agent; opt-in)
  4. llm-body-loop.sh    (Atlas + client agent + Flue LLM body; opt-in)

By default only session-switch.sh runs. Set RUN_AGENT_E2E=1 to include the
agent loops. The default agent driver is DF_AGENT_DRIVER=codex, which uses the
local Codex CLI login. Set DF_AGENT_DRIVER=claude only when you explicitly want
to use Claude Code as the client agent. Claude Code can use either local login
or an Anthropic env key.

Required env if running 2 + 3: ATLAS_URI.
You may also set RUNALL_SKIP="agent-loop llm-body-loop" to skip slow scripts.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

SKIP="${RUNALL_SKIP:-}"
if [[ "${RUN_AGENT_E2E:-0}" != "1" && -z "$SKIP" ]]; then
  SKIP="agent-loop llm-body-loop"
fi

RESULT_SESSION_SWITCH=UNKNOWN
RESULT_INTENT_WORKSPACE=UNKNOWN
RESULT_AGENT_LOOP=UNKNOWN
RESULT_LLM_BODY_LOOP=UNKNOWN

set_result() {
  case "$1" in
    session-switch) RESULT_SESSION_SWITCH="$2" ;;
    intent-workspace) RESULT_INTENT_WORKSPACE="$2" ;;
    agent-loop) RESULT_AGENT_LOOP="$2" ;;
    llm-body-loop) RESULT_LLM_BODY_LOOP="$2" ;;
  esac
}

get_result() {
  case "$1" in
    session-switch) printf '%s' "$RESULT_SESSION_SWITCH" ;;
    intent-workspace) printf '%s' "$RESULT_INTENT_WORKSPACE" ;;
    agent-loop) printf '%s' "$RESULT_AGENT_LOOP" ;;
    llm-body-loop) printf '%s' "$RESULT_LLM_BODY_LOOP" ;;
    *) printf 'UNKNOWN' ;;
  esac
}

run_one() {
  local name="$1"
  if [[ " $SKIP " == *" $name "* ]]; then
    printf '[run-all] SKIP %s\n' "$name"
    set_result "$name" SKIP
    return 0
  fi
  printf '\n========== %s ==========\n' "$name"
  if bash "$ROOT/$name.sh"; then
    set_result "$name" PASS
  else
    set_result "$name" FAIL
  fi
}

run_one session-switch
run_one intent-workspace
run_one agent-loop
run_one llm-body-loop

printf '\n========== summary ==========\n'
overall=0
for name in session-switch intent-workspace agent-loop llm-body-loop; do
  status="$(get_result "$name")"
  printf '%-20s %s\n' "$name" "$status"
  if [[ "$status" == FAIL ]]; then overall=1; fi
done

exit $overall
