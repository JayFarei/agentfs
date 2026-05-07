#!/usr/bin/env bash
# scripts/acceptance/intent-workspace.sh
#
# Direct no-LLM acceptance test for the VFS-mounted intent workspace flow:
#   mount -> run scratch -> commit answer.ts -> result/* + commit history/tests

set -euo pipefail

LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/lib"
# shellcheck disable=SC1091
source "$LIB_DIR/common.sh"

trap teardown EXIT

setup_dataplane --no-publish

WORKSPACE="$DATAFETCH_HOME/intent-workspace"

step "mounting intent workspace"
dft mount \
  --tenant test-jay \
  --dataset finqa-2024 \
  --intent "Use a seed primitive to prove commit writes a structured answer" \
  --path "$WORKSPACE" \
  >/tmp/datafetch-intent-workspace.out

assert_file_exists "$WORKSPACE/AGENTS.md" "workspace AGENTS.md"
assert_file_exists "$WORKSPACE/CLAUDE.md" "workspace CLAUDE.md"
assert_file_exists "$WORKSPACE/df.d.ts" "workspace df.d.ts"
assert_file_exists "$WORKSPACE/scripts/scratch.ts" "workspace scratch.ts"
assert_file_exists "$WORKSPACE/scripts/answer.ts" "workspace answer.ts"
assert_file_exists "$WORKSPACE/.datafetchignore" "workspace datafetchignore"
assert_file_exists "$WORKSPACE/.datafetch/workspace.json" "workspace metadata"

step "running exploratory scratch script"
cat > "$WORKSPACE/scripts/scratch.ts" <<'EOF'
const out = await df.lib.arithmeticDivide({ numerator: 6, denominator: 3 });
console.log(JSON.stringify({ quotient: out.value.quotient }));
EOF
(
  cd "$WORKSPACE"
  dft run scripts/scratch.ts > "$DATAFETCH_HOME/run.out"
)
assert_file_exists "$WORKSPACE/tmp/runs/001/source.ts" "run source artifact"
assert_file_exists "$WORKSPACE/tmp/runs/001/result.json" "run result artifact"
assert_file_exists "$WORKSPACE/tmp/runs/001/lineage.json" "run lineage artifact"
assert_json_field "$WORKSPACE/tmp/runs/001/result.json" ".phase" "run" "run phase"

step "committing visible answer program"
mkdir -p "$WORKSPACE/lib/skills" "$WORKSPACE/tmp"
cat > "$WORKSPACE/lib/localHelper.ts" <<'EOF'
export function localHelper() {
  return "visible dependency";
}
EOF
cat > "$WORKSPACE/lib/skills/pick_evidence.md" <<'EOF'
# Pick Evidence

Return JSON only.
EOF
printf 'ignored\n' > "$WORKSPACE/tmp/debug.txt"
cat > "$WORKSPACE/scripts/answer.ts" <<'EOF'
const out = await df.lib.arithmeticDivide({ numerator: 6, denominator: 3 });
return df.answer({
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
assert_file_exists "$WORKSPACE/result/source.ts" "commit source artifact"
assert_file_exists "$WORKSPACE/result/answer.md" "commit answer markdown"
assert_file_exists "$WORKSPACE/result/answer.json" "commit answer json"
assert_file_exists "$WORKSPACE/result/validation.json" "commit validation json"
assert_file_exists "$WORKSPACE/result/lineage.json" "commit lineage json"
assert_file_exists "$WORKSPACE/result/HEAD.json" "commit HEAD pointer"
assert_file_exists "$WORKSPACE/result/tests/replay.json" "commit replay test"
assert_file_exists "$WORKSPACE/result/workspace/manifest.json" "commit workspace snapshot manifest"
assert_file_exists "$WORKSPACE/result/workspace/files/scripts/answer.ts" "commit workspace snapshot answer source"
assert_file_exists "$WORKSPACE/result/workspace/files/lib/localHelper.ts" "commit workspace snapshot lib helper"
assert_file_exists "$WORKSPACE/result/workspace/files/lib/skills/pick_evidence.md" "commit workspace snapshot skill sidecar"
assert_file_exists "$WORKSPACE/result/commits/001/answer.json" "commit history answer"
assert_file_exists "$WORKSPACE/result/commits/001/tests/replay.json" "commit history replay test"
assert_file_exists "$WORKSPACE/result/commits/001/workspace/manifest.json" "commit history workspace snapshot"
assert_json_field "$WORKSPACE/result/answer.json" ".status" "answered" "answer status"
assert_json_field "$WORKSPACE/result/answer.json" ".value" "2" "answer value"
assert_json_field "$WORKSPACE/result/validation.json" ".accepted" "true" "commit accepted"
assert_json_field "$WORKSPACE/result/HEAD.json" ".commit" "001" "HEAD points to first accepted commit"
assert_json_field "$WORKSPACE/result/tests/replay.json" ".expected.value" "2" "replay expected answer value"
assert_json_field "$WORKSPACE/result/workspace/manifest.json" '.files | map(.path) | index("scripts/answer.ts") != null' "true" "snapshot records answer.ts"
assert_json_field "$WORKSPACE/result/workspace/manifest.json" '.files | map(.path) | index("lib/skills/pick_evidence.md") != null' "true" "snapshot records skill sidecar"
assert_json_field "$WORKSPACE/result/workspace/manifest.json" '.files | map(.path) | index("tmp/debug.txt") == null' "true" "snapshot ignores tmp debug"
ACCEPTED_HEAD="$(jq -r '.trajectoryId // empty' "$WORKSPACE/result/HEAD.json")"

if jq -e '.calls[]? | select(.primitive == "lib.arithmeticDivide")' "$WORKSPACE/result/lineage.json" >/dev/null; then
  printf '[PASS] commit lineage records df.lib.arithmeticDivide\n'
  PASS_COUNT=$((PASS_COUNT + 1))
else
  printf '[FAIL] commit lineage missing df.lib.arithmeticDivide\n' >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

step "rejecting private/plain answer"
cat > "$WORKSPACE/scripts/answer.ts" <<'EOF'
console.log("2");
EOF
(
  cd "$WORKSPACE"
  if dft commit scripts/answer.ts > "$DATAFETCH_HOME/reject.out" 2>&1; then
    printf '[FAIL] plain commit unexpectedly succeeded\n' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    printf '[PASS] plain commit rejected\n'
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
)
assert_json_field "$WORKSPACE/result/validation.json" ".accepted" "false" "plain commit validation rejected"
assert_file_exists "$WORKSPACE/result/commits/002/validation.json" "rejected commit history validation"
assert_json_field "$WORKSPACE/result/commits/002/validation.json" ".accepted" "false" "rejected attempt is recorded in commit history"
assert_json_field "$WORKSPACE/result/HEAD.json" ".trajectoryId" "$ACCEPTED_HEAD" "rejected commit does not advance HEAD"

printf '\nintent-workspace acceptance: %s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"
if (( FAIL_COUNT > 0 )); then
  exit 1
fi
