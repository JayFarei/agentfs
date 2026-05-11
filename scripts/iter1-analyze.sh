#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <full-run-base-path-without-shard-suffix>" >&2
  echo "  e.g. eval/skillcraft/results/datafetch/iter3-full-20260511-223714" >&2
  exit 2
fi

BASE="$1"
COMBINED="${BASE}-combined"
mkdir -p "$COMBINED/episodes"

# 1. Concatenate episodes.jsonl from each shard
> "$COMBINED/episodes.jsonl"
for shard in 1 2 3 4; do
  d="${BASE}-g${shard}/episodes.jsonl"
  if [ -f "$d" ]; then
    cat "$d" >> "$COMBINED/episodes.jsonl"
  fi
done
echo "combined episodes.jsonl: $(wc -l < "$COMBINED/episodes.jsonl") rows"

# 2. Copy run-info from g1 (any shard's run-info has the relevant config)
[ -f "${BASE}-g1/run-info.json" ] && cp "${BASE}-g1/run-info.json" "$COMBINED/run-info.json"

# 3. Symlink episode directories from each shard
for shard in 1 2 3 4; do
  src="${BASE}-g${shard}/episodes"
  if [ -d "$src" ]; then
    for fam in "$src"/*/; do
      fam_name=$(basename "$fam")
      mkdir -p "$COMBINED/episodes/$fam_name"
      for level in "$fam"*/; do
        level_name=$(basename "$level")
        ln -sf "$(cd "$level" && pwd)" "$COMBINED/episodes/$fam_name/$level_name"
      done
    done
  fi
done

# 4. Normalize → analyze → error-taxonomy
LABEL="iter3-full-$(basename "$BASE" | sed 's/^iter3-full-//')"
NORM_OUT="eval/skillcraft/results/${LABEL}-normalized.jsonl"
ANALYSIS_OUT="eval/skillcraft/reports/${LABEL}-analysis.json"
TAXONOMY_OUT="eval/skillcraft/reports/${LABEL}-error-taxonomy.json"

echo "Normalizing → $NORM_OUT"
pnpm eval:skillcraft:normalize --datafetch-run "$COMBINED" --out "$NORM_OUT"

echo "Analyzing → $ANALYSIS_OUT"
pnpm eval:skillcraft:analyze --input "$NORM_OUT" --out "$ANALYSIS_OUT"

echo "Classifying runtime errors → $TAXONOMY_OUT"
pnpm tsx eval/skillcraft/scripts/classify-runtime-errors.ts --run "$COMBINED" --out "$TAXONOMY_OUT"

echo ""
echo "=== iter1 headline ==="
python3 -c "
import json
d = json.load(open('$ANALYSIS_OUT'))
arm = d['arms']['datafetch-learned']
print(f'  pass ≥70:           {arm[\"passRate\"]*100:.1f}%  ({arm[\"passCount\"]}/{arm[\"count\"]})')
print(f'  status ≥90:         {arm[\"statusPassRateGe90\"]*100:.1f}%')
print(f'  avg eff tokens:     {arm[\"avgEffectiveTokens\"]:.0f}')
print(f'  runtime err rate:   {arm[\"runtimeErrorRate\"]*100:.1f}%')
print()
print('phase breakdown:')
for ph, b in arm['phaseBreakdown'].items():
    if b['count']:
        print(f'  {ph:8} {b[\"passRate\"]*100 if b[\"passRate\"] else 0:.1f}% ({b[\"passed\"]}/{b[\"count\"]})')
print()
print('error taxonomy:')
t = json.load(open('$TAXONOMY_OUT'))
print(f'  total ep: {t[\"totalEpisodes\"]}  with stderr: {t[\"episodesWithStderr\"]}')
for k, v in t['counts'].items():
    if v: print(f'  {k}: {v}')
"
echo ""
echo "Outputs:"
echo "  analysis:  $ANALYSIS_OUT"
echo "  taxonomy:  $TAXONOMY_OUT"
echo "  combined:  $COMBINED"
