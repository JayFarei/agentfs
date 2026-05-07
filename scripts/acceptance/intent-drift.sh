#!/usr/bin/env bash
# scripts/acceptance/intent-drift.sh
#
# Direct no-LLM regression for broad-worktree / narrow-commit semantics.
# It proves the artifact layer can preserve a committed sub-intent without
# rewriting the mounted workspace's parent intent.

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

trap teardown EXIT

setup_dataplane --no-publish

WORKSPACE="$DATAFETCH_HOME/intent-drift"
PARENT_INTENT="Understand this dataset and produce one useful plot-ready summary"

step "mounting broad intent workspace"
dft mount \
  --tenant test-jay \
  --dataset finqa-2024 \
  --intent "$PARENT_INTENT" \
  --path "$WORKSPACE" \
  >/tmp/datafetch-intent-drift.out

assert_file_exists "$WORKSPACE/AGENTS.md" "workspace AGENTS.md"
assert_file_exists "$WORKSPACE/CLAUDE.md" "workspace CLAUDE.md"
assert_file_exists "$WORKSPACE/scripts/scratch.ts" "workspace scratch.ts"
assert_file_exists "$WORKSPACE/scripts/answer.ts" "workspace answer.ts"
assert_file_exists "$WORKSPACE/.datafetch/workspace.json" "workspace metadata"
assert_json_field "$WORKSPACE/.datafetch/workspace.json" ".intent" "$PARENT_INTENT" "workspace stores parent intent"

step "running broad exploratory scratch script"
cat > "$WORKSPACE/scripts/scratch.ts" <<'EOF'
const out = await df.lib.arithmeticDivide({ numerator: 6, denominator: 3 });
console.log(JSON.stringify({
  observedShape: "ratio",
  quotient: out.value.quotient,
}));
EOF
(
  cd "$WORKSPACE"
  dft run scripts/scratch.ts > "$DATAFETCH_HOME/run.out"
)
assert_file_exists "$WORKSPACE/tmp/runs/001/source.ts" "run source artifact"
assert_file_exists "$WORKSPACE/tmp/runs/001/result.json" "run result artifact"
assert_file_exists "$WORKSPACE/tmp/runs/001/lineage.json" "run lineage artifact"
assert_json_field "$WORKSPACE/tmp/runs/001/result.json" ".phase" "run" "run phase"

step "committing narrower derived sub-intent"
PARENT_INTENT_JSON="$(jq -Rn --arg s "$PARENT_INTENT" '$s')"
cat > "$WORKSPACE/scripts/answer.ts" <<EOF
const out = await df.lib.arithmeticDivide({ numerator: 6, denominator: 3 });
return df.answer({
  intent: {
    name: "ratioSmokeSummary",
    parent: $PARENT_INTENT_JSON,
    relation: "derived",
    description: "A plot-ready ratio smoke summary discovered inside the broader dataset summary task.",
  },
  status: "answered",
  value: out.value.quotient,
  unit: "ratio",
  evidence: [{ ref: "df.lib.arithmeticDivide" }],
  coverage: { exact: true },
  derivation: {
    operation: "divide",
    values: [6, 3],
  },
});
EOF
(
  cd "$WORKSPACE"
  dft commit scripts/answer.ts > "$DATAFETCH_HOME/commit.out"
)

assert_file_exists "$WORKSPACE/result/answer.json" "commit answer json"
assert_file_exists "$WORKSPACE/result/validation.json" "commit validation json"
assert_file_exists "$WORKSPACE/result/HEAD.json" "commit HEAD pointer"
assert_file_exists "$WORKSPACE/result/tests/replay.json" "commit replay test"
assert_file_exists "$WORKSPACE/result/lineage.json" "commit lineage"
assert_file_exists "$WORKSPACE/result/workspace/files/scripts/answer.ts" "snapshot captures committed source"
assert_file_exists "$WORKSPACE/result/commits/001/answer.json" "commit history answer"

assert_json_field "$WORKSPACE/result/validation.json" ".accepted" "true" "commit accepted"
assert_json_field "$WORKSPACE/result/answer.json" ".status" "answered" "answer status"
assert_json_field "$WORKSPACE/result/answer.json" ".value" "2" "answer value"
assert_json_field "$WORKSPACE/result/answer.json" ".intent.name" "ratioSmokeSummary" "answer records committed sub-intent name"
assert_json_field "$WORKSPACE/result/answer.json" ".intent.parent" "$PARENT_INTENT" "answer records parent intent"
assert_json_field "$WORKSPACE/result/answer.json" ".intent.relation" "derived" "answer marks derived relation"
assert_json_field "$WORKSPACE/result/HEAD.json" ".intent" "$PARENT_INTENT" "HEAD keeps worktree parent intent"
assert_json_field "$WORKSPACE/result/HEAD.json" ".committedIntent.name" "ratioSmokeSummary" "HEAD records committed sub-intent"
assert_json_field "$WORKSPACE/result/tests/replay.json" ".intent" "$PARENT_INTENT" "replay keeps worktree parent intent"
assert_json_field "$WORKSPACE/result/tests/replay.json" ".expected.intent.relation" "derived" "replay captures committed intent relation"
assert_json_field "$WORKSPACE/result/workspace/manifest.json" '.files | map(.path) | index("scripts/answer.ts") != null' "true" "snapshot includes answer.ts"

if jq -e '.calls[]? | select(.primitive == "lib.arithmeticDivide")' "$WORKSPACE/result/lineage.json" >/dev/null; then
  printf '[PASS] commit lineage records df.lib.arithmeticDivide\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] commit lineage missing df.lib.arithmeticDivide\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

print_summary "intent-drift"
