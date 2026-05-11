#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HARNESS_DIR="${ROOT}/eval/skillcraft"
SKILLCRAFT_DIR="${SKILLCRAFT_DIR:-${HARNESS_DIR}/vendor/skillcraft}"
OUT_DIR="${HARNESS_DIR}/results/native"
MODE="${MODE:-base,skill}"
MODEL="${TOOLATHLON_MODEL:-deepseek-v3.2-exp}"
PROVIDER="${TOOLATHLON_PROVIDER:-openrouter}"
FAMILIES=""
LEVELS=""
TASK=""
EXTRA_ARGS=()
ALLOW_MISSING_TASK_DOCS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skillcraft-dir)
      SKILLCRAFT_DIR="$2"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --provider)
      PROVIDER="$2"
      shift 2
      ;;
    --families)
      FAMILIES="$2"
      shift 2
      ;;
    --levels)
      LEVELS="$2"
      shift 2
      ;;
    --task)
      TASK="$2"
      shift 2
      ;;
    --allow-missing-task-docs)
      ALLOW_MISSING_TASK_DOCS=1
      shift
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ! -d "${SKILLCRAFT_DIR}" ]]; then
  echo "SkillCraft checkout missing: ${SKILLCRAFT_DIR}" >&2
  echo "Run: bash eval/skillcraft/scripts/prepare-skillcraft.sh" >&2
  exit 2
fi
SKILLCRAFT_DIR="$(cd "${SKILLCRAFT_DIR}" && pwd)"
case "${OUT_DIR}" in
  /*) ;;
  *) OUT_DIR="${ROOT}/${OUT_DIR}" ;;
esac

if [[ -f "${SKILLCRAFT_DIR}/.env" ]]; then
  while IFS= read -r env_line || [[ -n "${env_line}" ]]; do
    [[ -z "${env_line//[[:space:]]/}" ]] && continue
    [[ "${env_line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${env_line}" != *=* ]] && continue
    env_key="${env_line%%=*}"
    env_value="${env_line#*=}"
    env_key="${env_key//[[:space:]]/}"
    [[ "${env_key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "${env_key}=${env_value}"
  done < "${SKILLCRAFT_DIR}/.env"
fi

mkdir -p "${OUT_DIR}"

preflight=(pnpm tsx eval/skillcraft/scripts/check-native-readiness.ts --skillcraft-dir "${SKILLCRAFT_DIR}" --provider "${PROVIDER}")
if [[ ${ALLOW_MISSING_TASK_DOCS} -eq 1 ]]; then
  preflight+=(--allow-missing-task-docs)
fi
(
  cd "${ROOT}"
  "${preflight[@]}"
)

cmd=(uv run python test_all_tasks.py --scaled-tasks --mode "${MODE}" --model "${MODEL}" --provider "${PROVIDER}")
if [[ -n "${FAMILIES}" ]]; then
  cmd+=(--scaled-base "${FAMILIES}")
fi
if [[ -n "${LEVELS}" ]]; then
  cmd+=(--scaled-level "${LEVELS}")
fi
if [[ -n "${TASK}" ]]; then
  cmd+=(--task "${TASK}")
fi
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  cmd+=("${EXTRA_ARGS[@]}")
fi

echo "[native] ${cmd[*]}"
(
  cd "${SKILLCRAFT_DIR}"
  TOOLATHLON_BASE_OUTPUT_DIR="${OUT_DIR}" "${cmd[@]}"
)
