#!/usr/bin/env bash
# scripts/acceptance/session-switch.sh
#
# Two-tenant overlay smoke test. Does NOT need Atlas or Anthropic — just the
# server, the heredoc-author flow, and `datafetch apropos` returning the
# right tenant slice.
#
#   1. Boot a fresh server (no mount publish needed).
#   2. session new --tenant tenant-a → S1.
#   3. Heredoc-author lib/tenant-a/onlyA.ts.
#   4. apropos finds onlyA.
#   5. session switch --tenant tenant-b → S2.
#   6. apropos must NOT see onlyA.
#   7. Heredoc-author lib/tenant-b/onlyB.ts. apropos finds onlyB.
#   8. session list shows both; session current points at S2.
#
# Exits 0 on PASS, non-zero on any FAIL. Always tears down the server
# and tmp DATAFETCH_HOME.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

show_help() {
  cat <<EOF
session-switch.sh — verify per-tenant /lib/ overlay isolation.

Required tools: datafetch (or bin/datafetch.mjs), tmux is NOT used here.
Required env:   none (no Atlas, no Anthropic).
Optional env:   DF_TEST_PORT (default 8090), DEBUG=1 for verbose teardown.

Steps:
  1. Boot fresh server against tmp DATAFETCH_HOME.
  2. Create two sessions for tenant-a and tenant-b.
  3. Author lib/<tenant>/<fn>.ts via heredoc; verify apropos finds them.
  4. Switching sessions must isolate /lib/ overlays.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

trap teardown EXIT

setup_dataplane --no-publish

# ---- Step: tenant A session + author + apropos -----------------------------
step "tenant-a: session new"
S1=$(dft session new --tenant tenant-a --json | jq -r .sessionId)
assert_neq "" "$S1" "tenant-a session id is non-empty"

step "tenant-a: author lib/tenant-a/onlyA.ts"
mkdir -p "$DATAFETCH_HOME/lib/tenant-a"
cat > "$DATAFETCH_HOME/lib/tenant-a/onlyA.ts" <<'EOF'
import { fn } from "@datafetch/sdk";
import * as v from "valibot";

export const onlyA = fn({
  intent: "tenant-a private widget calibration helper",
  examples: [{ input: { x: 1 }, output: { y: 2 } }],
  input: v.object({ x: v.number() }),
  output: v.object({ y: v.number() }),
  body: async ({ x }) => ({ y: x + 1 }),
});
EOF
assert_file_exists "$DATAFETCH_HOME/lib/tenant-a/onlyA.ts" "tenant-a fn authored"

step "tenant-a: apropos finds onlyA"
A_MATCH=$(dft apropos "widget calibration" --json | jq -r '.matches[] | select(.name == "onlyA") | .name')
assert_eq "onlyA" "$A_MATCH" "tenant-a apropos returns onlyA"

# ---- Step: switch to tenant B ---------------------------------------------
step "switch to tenant-b"
S2=$(dft session switch --tenant tenant-b --json | jq -r .sessionId)
assert_neq "" "$S2" "tenant-b session id is non-empty"
assert_neq "$S1" "$S2" "tenant-b session id differs from tenant-a"

step "tenant-b: apropos must NOT see onlyA"
B_LEAKED=$(dft apropos "widget calibration" --json | jq -r '.matches[] | select(.name == "onlyA") | .name' || true)
assert_eq "" "$B_LEAKED" "tenant-b does NOT see tenant-a's onlyA"

step "tenant-b: author lib/tenant-b/onlyB.ts"
mkdir -p "$DATAFETCH_HOME/lib/tenant-b"
cat > "$DATAFETCH_HOME/lib/tenant-b/onlyB.ts" <<'EOF'
import { fn } from "@datafetch/sdk";
import * as v from "valibot";

export const onlyB = fn({
  intent: "tenant-b unique gizmo flux capacitor adjustment",
  examples: [{ input: { z: 0 }, output: { w: 1 } }],
  input: v.object({ z: v.number() }),
  output: v.object({ w: v.number() }),
  body: async ({ z }) => ({ w: z + 1 }),
});
EOF
assert_file_exists "$DATAFETCH_HOME/lib/tenant-b/onlyB.ts" "tenant-b fn authored"

B_MATCH=$(dft apropos "gizmo flux capacitor" --json | jq -r '.matches[] | select(.name == "onlyB") | .name')
assert_eq "onlyB" "$B_MATCH" "tenant-b apropos returns onlyB"

step "tenant-b: apropos must NOT see onlyA either"
B_LEAKED2=$(dft apropos "widget calibration" --json | jq -r '.matches[] | select(.name == "onlyA") | .name' || true)
assert_eq "" "$B_LEAKED2" "tenant-b still does NOT see tenant-a's onlyA"

# ---- Step: session current / list ------------------------------------------
step "session current points at S2"
CURRENT=$(dft session current)
assert_eq "$S2" "$CURRENT" "session current == $S2"

step "session list shows the live session"
LIST_JSON=$(dft session list --json)
HAS_S2=$(echo "$LIST_JSON" | jq -r --arg s "$S2" '.sessions[] | select(.sessionId == $s) | .sessionId')
assert_eq "$S2" "$HAS_S2" "session list includes $S2 (current)"
# `session switch` deletes the prior session by design (see cmdSessionSwitch);
# S1 should be gone from the list now.
HAS_S1=$(echo "$LIST_JSON" | jq -r --arg s "$S1" '.sessions[] | select(.sessionId == $s) | .sessionId' || true)
assert_eq "" "$HAS_S1" "session list does NOT include the switched-away $S1"

step "create a third session without switching, verify list grows"
S3=$(dft session new --tenant tenant-c --json | jq -r .sessionId)
assert_neq "" "$S3" "tenant-c session id is non-empty"
LIST_JSON2=$(dft session list --json)
COUNT=$(echo "$LIST_JSON2" | jq -r '.sessions | length')
assert_eq "2" "$COUNT" "session list now has 2 sessions (S2 + S3)"

print_summary "session-switch"
