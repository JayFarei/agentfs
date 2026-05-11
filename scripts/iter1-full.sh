#!/usr/bin/env bash
set -euo pipefail
OUT_BASE="eval/skillcraft/results/datafetch/iter3-full-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_BASE"

# Run 4 shards in parallel. 21 families. Shards split families.
# Read the ordered family list and split into 4 groups.
FAMILIES=(cat-facts-collector cocktail-menu-generator countries-encyclopedia dnd-campaign-builder dnd-monster-compendium dog-breeds-encyclopedia gitlab-deep-analysis jikan-anime-analysis jsonplaceholder-blog-analyzer local-dna-analysis name-demographics-analyzer openmeteo-weather pokeapi-pokedex random-user-database recipe-cookbook-builder rickmorty-multiverse-explorer tvmaze-series-analyzer university-directory-builder usgs-earthquake-monitor vocabulary-builder world-bank-economic-snapshot)

# Distribute families across 4 shards round-robin.
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
      --live --model claude-sonnet-4-6 --reasoning low --no-lib-cache \
    > "$out_dir/run.log" 2>&1
}

echo "Shards:"
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
