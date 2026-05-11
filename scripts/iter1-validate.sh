#!/usr/bin/env bash
set -euo pipefail
OUT_BASE="eval/skillcraft/results/datafetch/iter3-validate-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_BASE"

env DATAFETCH_AGENT=claude DATAFETCH_INTERFACE_MODE=hooks-draft ANTHROPIC_LOG_LEVEL=error \
  pnpm eval:skillcraft \
    --skillcraft-dir /tmp/skillcraft-official \
    --out-dir "$OUT_BASE" \
    --families university-directory-builder,jikan-anime-analysis \
    --live --model claude-sonnet-4-6 --reasoning low --no-lib-cache \
  > "$OUT_BASE/run.log" 2>&1

echo "Validate output: $OUT_BASE"
