#!/usr/bin/env bash
# scripts/acceptance/run-all.sh
#
# Sequentially runs the default acceptance scripts and prints a final summary.
# Continues past failures (so you see every script's verdict in one log)
# but exits non-zero if any one fails.

set -uo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

show_help() {
  cat <<EOF
run-all.sh — run every acceptance script and report a summary.

See scripts/acceptance/README.md for the harness matrix, environment
variables, artifact locations, and eval-readiness notes.

Order:
  1. session-switch.sh   (no LLM, no Atlas — fastest smoke)
  2. intent-workspace.sh (no LLM, no Atlas — run/commit workspace smoke)
  3. intent-drift.sh     (no LLM, no Atlas — broad intent/sub-intent capture)
  4. whitelist-client.sh (HF whitelist + clean client attach/mount e2e)
  5. agent-loop.sh       (Atlas + client agent; opt-in)
  6. intent-drift-loop.sh (Atlas + client agent; opt-in behavioral experiment)
  7. agent-body-loop.sh  (Atlas + client agent + Flue agent body; opt-in)

By default, session-switch.sh, intent-workspace.sh, intent-drift.sh, and
whitelist-client.sh run. whitelist-client.sh uses the public Hugging Face
Dataset Viewer API but no LLM and no Atlas. The live client agent loops are
skipped. Set RUN_AGENT_E2E=1 to include the agent loops. The default agent
driver is DF_AGENT_DRIVER=codex, which uses the local Codex CLI login. Set
DF_AGENT_DRIVER=claude only when you explicitly want to use Claude Code as the
client agent. Claude Code can use either local login or an Anthropic env key.

Required env for live agent scripts: ATLAS_URI.
You may also set RUNALL_SKIP="agent-loop intent-drift-loop agent-body-loop" to skip slow scripts.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

SKIP="${RUNALL_SKIP:-}"
if [[ "${RUN_AGENT_E2E:-0}" != "1" && -z "$SKIP" ]]; then
  SKIP="agent-loop intent-drift-loop agent-body-loop"
fi

RESULT_SESSION_SWITCH=UNKNOWN
RESULT_INTENT_WORKSPACE=UNKNOWN
RESULT_INTENT_DRIFT=UNKNOWN
RESULT_WHITELIST_CLIENT=UNKNOWN
RESULT_AGENT_LOOP=UNKNOWN
RESULT_INTENT_DRIFT_LOOP=UNKNOWN
RESULT_AGENT_BODY_LOOP=UNKNOWN

set_result() {
  case "$1" in
    session-switch) RESULT_SESSION_SWITCH="$2" ;;
    intent-workspace) RESULT_INTENT_WORKSPACE="$2" ;;
    intent-drift) RESULT_INTENT_DRIFT="$2" ;;
    whitelist-client) RESULT_WHITELIST_CLIENT="$2" ;;
    agent-loop) RESULT_AGENT_LOOP="$2" ;;
    intent-drift-loop) RESULT_INTENT_DRIFT_LOOP="$2" ;;
    agent-body-loop) RESULT_AGENT_BODY_LOOP="$2" ;;
  esac
}

get_result() {
  case "$1" in
    session-switch) printf '%s' "$RESULT_SESSION_SWITCH" ;;
    intent-workspace) printf '%s' "$RESULT_INTENT_WORKSPACE" ;;
    intent-drift) printf '%s' "$RESULT_INTENT_DRIFT" ;;
    whitelist-client) printf '%s' "$RESULT_WHITELIST_CLIENT" ;;
    agent-loop) printf '%s' "$RESULT_AGENT_LOOP" ;;
    intent-drift-loop) printf '%s' "$RESULT_INTENT_DRIFT_LOOP" ;;
    agent-body-loop) printf '%s' "$RESULT_AGENT_BODY_LOOP" ;;
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
run_one intent-drift
run_one whitelist-client
run_one agent-loop
run_one intent-drift-loop
run_one agent-body-loop

printf '\n========== summary ==========\n'
overall=0
for name in session-switch intent-workspace intent-drift whitelist-client agent-loop intent-drift-loop agent-body-loop; do
  status="$(get_result "$name")"
  printf '%-20s %s\n' "$name" "$status"
  if [[ "$status" == FAIL ]]; then overall=1; fi
done

exit $overall
