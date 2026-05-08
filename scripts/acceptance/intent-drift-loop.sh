#!/usr/bin/env bash
# scripts/acceptance/intent-drift-loop.sh
#
# Live behavior experiment for broad mounted intents. A client agent receives
# a credible open-ended dataset task, works inside a normal intent workspace,
# and must commit a narrower visible trajectory with intent relation metadata.
#
# Required env: ATLAS_URI.
# Optional env: ATLAS_DB_NAME, DF_TEST_PORT, DF_AGENT_DRIVER, DF_TEST_MODEL,
#               DF_TEST_REASONING_EFFORT, AGENT_LOOP_TIMEOUT, DEBUG.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

export DATAFETCH_SKILL_PATH="${DATAFETCH_SKILL_PATH:-$REPO_ROOT/skills/datafetch/SKILL.md}"

show_help() {
  cat <<EOF
intent-drift-loop.sh — live agent test for broad-worktree / narrow-commit behavior.

Required env:
  ATLAS_URI                       MongoDB Atlas connection string

Optional env:
  DF_AGENT_DRIVER                 codex (default) or claude
  DF_TEST_MODEL                   driver model override
  DF_TEST_REASONING_EFFORT        Codex reasoning effort, default: medium
  ATLAS_DB_NAME                   default: datafetch_hackathon
  DF_TEST_PORT                    default: 8090
  AGENT_LOOP_TIMEOUT              budget seconds, default 420
  INTENT_DRIFT_ARTIFACT_DIR       diagnostic output directory
  DEBUG=1                         keep DATAFETCH_HOME and dump tmux logs
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

AGENT_LOOP_TIMEOUT="${AGENT_LOOP_TIMEOUT:-420}"
RUN_STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
INTENT_DRIFT_ARTIFACT_DIR="${INTENT_DRIFT_ARTIFACT_DIR:-$REPO_ROOT/artifacts/intent-drift-loop/$RUN_STAMP}"
PARENT_INTENT="${PARENT_INTENT:-Explore what this FinQA dataset can answer and produce one useful plot-ready summary}"
WORKSPACE=""
SESSION_ID=""
OUT=""

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

write_artifact() {
  local status="$1"
  local dir="$INTENT_DRIFT_ARTIFACT_DIR"
  mkdir -p "$dir"
  printf '{ "status": %s, "workspace": %s }\n' \
    "$(printf '%s' "$status" | jq -Rs .)" \
    "$(printf '%s' "${WORKSPACE:-}" | jq -Rs .)" \
    > "$dir/metadata.json"
  if [[ -n "${WORKSPACE:-}" && -d "$WORKSPACE" ]]; then
    rm -rf "$dir/workspace"
    cp -R "$WORKSPACE" "$dir/workspace"
  fi
  if [[ -f "${OUT:-}" ]]; then
    cp "$OUT" "$dir/client-transcript.txt"
  fi
  if [[ -n "${SERVER_LOG:-}" && -f "$SERVER_LOG" ]]; then
    sed -E 's#mongodb(\+srv)?://[^[:space:]"]+#mongodb://<redacted>#g' "$SERVER_LOG" > "$dir/server.log"
  fi
  if [[ -d "$DATAFETCH_HOME/trajectories" ]]; then
    rm -rf "$dir/trajectories"
    cp -R "$DATAFETCH_HOME/trajectories" "$dir/trajectories"
  fi
  cat > "$dir/README.md" <<EOF
# intent drift loop diagnostic

Status: $status

Inspect:

\`\`\`bash
jq . metadata.json
sed -n '1,220p' client-transcript.txt
jq . workspace/result/answer.json
jq . workspace/result/HEAD.json
jq . workspace/result/tests/replay.json
jq '{phase, crystallisable, calls: [.calls[].primitive], answer}' workspace/result/lineage.json
sed -n '1,220p' workspace/result/source.ts
\`\`\`
EOF
  step "diagnostic artifact written: $dir"
}

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

step "mounting broad intent workspace"
WORKSPACE="$DATAFETCH_HOME/workspaces/finqa-plot-summary"
mkdir -p "$DATAFETCH_HOME/workspaces"
dft mount \
  --tenant test-jay \
  --dataset finqa-2024 \
  --intent "$PARENT_INTENT" \
  --path "$WORKSPACE" \
  --json > "$DATAFETCH_HOME/mount.json"
SESSION_ID="$(jq -r '.sessionId // empty' "$DATAFETCH_HOME/mount.json")"
export SESSION_ID

assert_neq "" "$SESSION_ID" "session id non-empty"
assert_file_exists "$WORKSPACE/AGENTS.md" "workspace AGENTS.md" || true
assert_file_exists "$WORKSPACE/df.d.ts" "workspace df.d.ts" || true
assert_file_exists "$WORKSPACE/db/README.md" "workspace db README" || true
assert_file_glob "$WORKSPACE/db/*/_descriptor.json" "workspace db descriptor" || true
assert_file_exists "$WORKSPACE/scripts/scratch.ts" "workspace scratch template" || true
assert_file_exists "$WORKSPACE/scripts/answer.ts" "workspace answer template" || true

PROMPT=$(cat <<PROMPT_EOF
You are already inside a datafetch intent workspace.

Broad worktree intent:
$PARENT_INTENT

Use the VFS workspace contract only. Do not use \`datafetch session\`, \`datafetch plan\`, or \`datafetch execute\`.

Your task is representative of agentic search:
1. Read \`AGENTS.md\`, \`df.d.ts\`, and inspect \`db/\`, \`lib/\`, and \`scripts/\`.
2. Use \`datafetch apropos "summary plot FinQA revenue metric year"\` and at least one \`datafetch run scripts/scratch.ts\` to understand what the dataset can answer.
3. Choose one narrower useful sub-intent that falls out of discovery and could feed a plot or compact dashboard. It can be a series, range, ratio, or safely unsupported finding, but it must be grounded in the mounted FinQA data.
4. Put the repeatable final logic in \`scripts/answer.ts\` and run \`datafetch commit scripts/answer.ts\`.
5. Because the committed trajectory is narrower than the broad worktree intent, the final \`df.answer(...)\` must include an \`intent\` block with \`name\`, \`parent\`, \`description\`, and \`relation: "derived"\` or \`"sibling"\`.
6. Answer only from \`result/answer.json\` and \`result/validation.json\`.

The committed answer must have evidence and visible derivation. Do not fabricate data and do not answer from \`tmp/runs/N\` output.
PROMPT_EOF
)

OUT="$DATAFETCH_HOME/intent-drift.out"
SENTINEL="$DATAFETCH_HOME/intent-drift.done"

step "spawning tmux pane dft-intent-drift (timeout=${AGENT_LOOP_TIMEOUT}s)"
run_agent_in_tmux dft-intent-drift "$PROMPT" "$OUT" "$SENTINEL" "$WORKSPACE"
if ! wait_for_tmux dft-intent-drift "$AGENT_LOOP_TIMEOUT" "$SENTINEL"; then
  dump_tmux_pane dft-intent-drift "$OUT"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
tmux kill-session -t dft-intent-drift 2>/dev/null || true

if [[ -f "$OUT.exit" && "$(tr -d '\n' < "$OUT.exit")" == "0" ]]; then
  printf '[PASS] agent exited 0\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] agent exit code %s\n' "$(cat "$OUT.exit" 2>/dev/null || echo '<missing>')" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [[ -f "$OUT" ]]; then
  step "transcript head:"
  head -n 40 "$OUT" >&2 || true
fi

assert_file_glob "$WORKSPACE/tmp/runs/[0-9][0-9][0-9]/result.json" "agent wrote exploratory run artifact" || true
assert_file_exists "$WORKSPACE/result/source.ts" "committed source" || true
assert_file_exists "$WORKSPACE/result/answer.json" "answer json" || true
assert_file_exists "$WORKSPACE/result/validation.json" "validation json" || true
assert_file_exists "$WORKSPACE/result/HEAD.json" "HEAD pointer" || true
assert_file_exists "$WORKSPACE/result/tests/replay.json" "replay test" || true
assert_file_exists "$WORKSPACE/result/lineage.json" "lineage json" || true
assert_file_exists "$WORKSPACE/result/workspace/files/scripts/answer.ts" "workspace snapshot source" || true

assert_json_field "$WORKSPACE/result/validation.json" ".accepted" "true" "commit accepted" || true
assert_json_field "$WORKSPACE/result/HEAD.json" ".intent" "$PARENT_INTENT" "HEAD keeps parent worktree intent" || true
if jq -e --arg parent "$PARENT_INTENT" '
  def norm: ascii_downcase | gsub("[[:punct:]]+$"; "") | gsub("[[:space:]]+"; " ");
  (.intent.parent // "" | norm) == ($parent | norm)
' "$WORKSPACE/result/answer.json" >/dev/null 2>&1; then
  printf '[PASS] answer links to parent intent\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] answer links to parent intent\n' >&2
  jq '.intent' "$WORKSPACE/result/answer.json" >&2 || true
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
assert_json_truthy "$WORKSPACE/result/answer.json" '.intent.name != null and (.intent.name | length) > 0' "answer has committed intent name"
assert_json_truthy "$WORKSPACE/result/answer.json" '.intent.description != null and (.intent.description | length) > 0' "answer has committed intent description"
assert_json_truthy "$WORKSPACE/result/answer.json" '.intent.relation == "derived" or .intent.relation == "sibling"' "answer marks derived or sibling relation"
assert_json_truthy "$WORKSPACE/result/answer.json" '.status == "answered" or .status == "partial" or .status == "unsupported"' "answer status allowed"
assert_json_truthy "$WORKSPACE/result/answer.json" '.evidence != null and ((.evidence | type) != "array" or (.evidence | length) > 0)' "answer has evidence"
assert_json_truthy "$WORKSPACE/result/answer.json" '.status == "unsupported" or .derivation != null' "answer has visible derivation"
assert_json_truthy "$WORKSPACE/result/lineage.json" '.phase == "commit"' "lineage phase commit"
assert_json_truthy "$WORKSPACE/result/lineage.json" '[.calls[]? | select(.primitive | startswith("db."))] | length > 0' "lineage records db.* grounding"
assert_json_truthy "$WORKSPACE/result/tests/replay.json" '.expected.intent.relation == "derived" or .expected.intent.relation == "sibling"' "replay captures committed intent relation"

if grep -Fq "df.answer" "$WORKSPACE/result/source.ts"; then
  printf '[PASS] committed source uses df.answer\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] committed source does not contain df.answer\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if (( FAIL_COUNT == 0 )); then
  write_artifact "pass"
else
  write_artifact "fail"
fi

print_summary "intent-drift-loop"
