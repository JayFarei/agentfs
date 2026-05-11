#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENTRYPOINT="${ROOT}/src/eval/skillcraftFullDatafetch.ts"

if [[ ! -f "${ENTRYPOINT}" ]]; then
  cat >&2 <<MSG
Datafetch full SkillCraft adapter is not implemented yet.

Expected entrypoint:
  ${ENTRYPOINT}

Before representative full results, implement:
  1. fixture importer for real SkillCraft task directories
  2. SkillCraft local-tool bridge
  3. official evaluator bridge
  4. arbitrary tool-graph learned-interface promotion
MSG
  exit 2
fi

cd "${ROOT}"
pnpm tsx "${ENTRYPOINT}" "$@"

