#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HARNESS_DIR="${ROOT}/eval/skillcraft"
SKILLCRAFT_DIR="${HARNESS_DIR}/vendor/skillcraft"
SKILLCRAFT_REPO="${SKILLCRAFT_REPO:-https://github.com/shiqichen17/SkillCraft}"
SKILLCRAFT_REF="${SKILLCRAFT_REF:-0a9ba8808ba49bbc7bd40ad2e853896b8c3d4764}"
SKIP_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skillcraft-dir)
      SKILLCRAFT_DIR="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
      shift 2
      ;;
    --repo)
      SKILLCRAFT_REPO="$2"
      shift 2
      ;;
    --ref)
      SKILLCRAFT_REF="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "${HARNESS_DIR}/vendor" "${HARNESS_DIR}/manifests"

if [[ ! -d "${SKILLCRAFT_DIR}/.git" ]]; then
  echo "[prepare] cloning ${SKILLCRAFT_REPO} -> ${SKILLCRAFT_DIR}"
  git clone "${SKILLCRAFT_REPO}" "${SKILLCRAFT_DIR}"
else
  current_remote="$(git -C "${SKILLCRAFT_DIR}" remote get-url origin 2>/dev/null || true)"
  if [[ "${current_remote}" != "${SKILLCRAFT_REPO}" ]]; then
    echo "[prepare] existing checkout remote is ${current_remote:-unset}; switching origin to ${SKILLCRAFT_REPO}"
    git -C "${SKILLCRAFT_DIR}" remote set-url origin "${SKILLCRAFT_REPO}"
  fi
fi

echo "[prepare] checking out ${SKILLCRAFT_REF}"
git -C "${SKILLCRAFT_DIR}" fetch --depth 1 origin "${SKILLCRAFT_REF}" >/dev/null 2>&1 || true
git -C "${SKILLCRAFT_DIR}" fetch --depth 1 origin main >/dev/null 2>&1 || true
git -C "${SKILLCRAFT_DIR}" checkout "${SKILLCRAFT_REF}"

if [[ ${SKIP_INSTALL} -eq 0 ]]; then
  if command -v uv >/dev/null 2>&1; then
    echo "[prepare] installing SkillCraft dependencies with uv sync"
    (cd "${SKILLCRAFT_DIR}" && uv sync)
  else
    echo "[prepare] uv not found; skipping dependency install" >&2
  fi
fi

echo "[prepare] indexing SkillCraft tasks"
(cd "${ROOT}" && pnpm tsx eval/skillcraft/scripts/index-skillcraft-tasks.ts --skillcraft-dir "${SKILLCRAFT_DIR}" --out-dir "${HARNESS_DIR}/manifests")

echo "[prepare] done"
