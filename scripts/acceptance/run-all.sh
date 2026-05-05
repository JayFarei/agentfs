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
  2. agent-loop.sh       (Atlas + Anthropic; ~3 min)
  3. llm-body-loop.sh    (Atlas + Anthropic; ~3 min)

Required env if running 2 + 3: ATLAS_URI and ANTHROPIC_KEY/ANTHROPIC_API_KEY.
You may set RUNALL_SKIP="agent-loop llm-body-loop" to skip slow scripts.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

SKIP="${RUNALL_SKIP:-}"
declare -A RESULTS=()

run_one() {
  local name="$1"
  if [[ " $SKIP " == *" $name "* ]]; then
    printf '[run-all] SKIP %s (RUNALL_SKIP)\n' "$name"
    RESULTS["$name"]=SKIP
    return 0
  fi
  printf '\n========== %s ==========\n' "$name"
  if bash "$ROOT/$name.sh"; then
    RESULTS["$name"]=PASS
  else
    RESULTS["$name"]=FAIL
  fi
}

run_one session-switch
run_one agent-loop
run_one llm-body-loop

printf '\n========== summary ==========\n'
overall=0
for name in session-switch agent-loop llm-body-loop; do
  status="${RESULTS[$name]:-UNKNOWN}"
  printf '%-20s %s\n' "$name" "$status"
  if [[ "$status" == FAIL ]]; then overall=1; fi
done

exit $overall
