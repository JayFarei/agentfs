#!/usr/bin/env bash
# Goal 2 full-126 runner.
#
# Differences from scripts/iter1-full.sh:
#   1. NO --no-lib-cache flag. Lib-cache is enabled; the harness creates
#      <out-dir>/lib-cache and the observer crystallises learned helpers
#      into it. Per-family scoping is handled inside the harness, so
#      e1's helpers are visible to e2/e3/m1/m2/h1 of the same family
#      but NOT to other families.
#   2. Families execute *sequentially within a shard*. This is to keep
#      learning order canonical (train, then warm, then hard) per
#      family. The harness already orders levels e1->e2->e3->m1->m2->h1
#      inside each family; sequential shard execution preserves that.
#   3. Output dir prefix is iter1-* for the Goal-2 era (Goal 2's
#      iteration counter starts at 1). Use iter1, iter2 ... for Goal 2's
#      own counter; downstream scripts already pattern-match the
#      iter prefix.
set -euo pipefail

ITER_TAG="${ITER_TAG:-goal2-iter1}"
OUT_BASE="eval/skillcraft/results/datafetch/${ITER_TAG}-full-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_BASE"

FAMILIES=(cat-facts-collector cocktail-menu-generator countries-encyclopedia dnd-campaign-builder dnd-monster-compendium dog-breeds-encyclopedia gitlab-deep-analysis jikan-anime-analysis jsonplaceholder-blog-analyzer local-dna-analysis name-demographics-analyzer openmeteo-weather pokeapi-pokedex random-user-database recipe-cookbook-builder rickmorty-multiverse-explorer tvmaze-series-analyzer university-directory-builder usgs-earthquake-monitor vocabulary-builder world-bank-economic-snapshot)

declare -a SHARD0 SHARD1 SHARD2 SHARD3
for i in "${!FAMILIES[@]}"; do
  case $((i % 4)) in
    0) SHARD0+=("${FAMILIES[$i]}");;
    1) SHARD1+=("${FAMILIES[$i]}");;
    2) SHARD2+=("${FAMILIES[$i]}");;
    3) SHARD3+=("${FAMILIES[$i]}");;
  esac
done

run_shard() {
  local shard_id=$1
  shift
  local fams=("$@")
  local fams_csv=$(IFS=,; echo "${fams[*]}")
  local out_dir="${OUT_BASE}-g${shard_id}"
  mkdir -p "$out_dir"
  env DATAFETCH_AGENT=claude DATAFETCH_INTERFACE_MODE=hooks-draft ANTHROPIC_LOG_LEVEL=error \
    pnpm eval:skillcraft \
      --skillcraft-dir /tmp/skillcraft-official \
      --out-dir "$out_dir" \
      --families "$fams_csv" \
      --live --model claude-sonnet-4-6 --reasoning low \
    > "$out_dir/run.log" 2>&1
}

echo "ITER_TAG=$ITER_TAG"
echo "Shards (lib-cache ENABLED, per-family scoped inside harness):"
echo "  g1: ${SHARD0[*]}"
echo "  g2: ${SHARD1[*]}"
echo "  g3: ${SHARD2[*]}"
echo "  g4: ${SHARD3[*]}"

run_shard 1 "${SHARD0[@]}" &
PID1=$!
run_shard 2 "${SHARD1[@]}" &
PID2=$!
run_shard 3 "${SHARD2[@]}" &
PID3=$!
run_shard 4 "${SHARD3[@]}" &
PID4=$!

wait $PID1 && echo "Shard 1 done"
wait $PID2 && echo "Shard 2 done"
wait $PID3 && echo "Shard 3 done"
wait $PID4 && echo "Shard 4 done"

echo "Full output base: $OUT_BASE"
