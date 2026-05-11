#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

CLAW_CODEX_HOST="${CLAW_CODEX_HOST:-127.0.0.1}"
CLAW_CODEX_PORT="${CLAW_CODEX_PORT:-1455}"
CLAW_CODEX_BASE_URL="${CLAW_CODEX_BASE_URL:-http://${CLAW_CODEX_HOST}:${CLAW_CODEX_PORT}/v1}"
CLAW_CODEX_MODEL="${CLAW_CODEX_MODEL:-claw/codex}"
TOOLATHLON_OPENAI_API_KEY="${TOOLATHLON_OPENAI_API_KEY:-fake-key}"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to check the claw-codex OpenAI-compatible endpoint." >&2
  exit 2
fi

if ! curl -fsS "${CLAW_CODEX_BASE_URL}/models" >/dev/null 2>&1; then
  cat >&2 <<EOF
claw-codex is not reachable at ${CLAW_CODEX_BASE_URL}.

Start and authenticate it first, for example:

  claw-codex auth status || claw-codex auth login --open-browser
  CLAW_CODEX_HOST=${CLAW_CODEX_HOST} CLAW_CODEX_PORT=${CLAW_CODEX_PORT} claw-codex serve

Then rerun this script.
EOF
  exit 2
fi

(
  cd "${ROOT}"
  TOOLATHLON_PROVIDER=unified \
  TOOLATHLON_MODEL="${CLAW_CODEX_MODEL}" \
  TOOLATHLON_OPENAI_BASE_URL="${CLAW_CODEX_BASE_URL}" \
  TOOLATHLON_OPENAI_API_KEY="${TOOLATHLON_OPENAI_API_KEY}" \
  bash eval/skillcraft/scripts/run-native-skillcraft.sh "$@" \
    --provider unified \
    --model "${CLAW_CODEX_MODEL}"
)
