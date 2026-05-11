# Runbook

## 1. Prepare SkillCraft

```bash
bash eval/skillcraft/scripts/prepare-skillcraft.sh
```

By default this clones the official paper repository
`https://github.com/shiqichen17/SkillCraft` at the pinned commit recorded in
`prepare-skillcraft.sh`. Override `--repo` and `--ref` only when deliberately
reproducing another checkout.

Useful options:

```bash
bash eval/skillcraft/scripts/prepare-skillcraft.sh \
  --repo https://github.com/shiqichen17/SkillCraft \
  --ref 0a9ba8808ba49bbc7bd40ad2e853896b8c3d4764 \
  --skillcraft-dir /path/to/skillcraft \
  --skip-install
```

The script writes:

- `eval/skillcraft/manifests/skillcraft-upstream.lock.json`
- `eval/skillcraft/manifests/task-index.json`
- `eval/skillcraft/manifests/tool-index.json`

## 2. Run Native SkillCraft Arms

```bash
bash eval/skillcraft/scripts/run-native-skillcraft.sh \
  --model "$TOOLATHLON_MODEL" \
  --provider "$TOOLATHLON_PROVIDER" \
  --mode base,skill
```

The native runner executes a preflight before spending model calls. If the
upstream checkout is missing `docs/task.md` prompt files, the runner stops with
an actionable error. Use `--allow-missing-task-docs` only for diagnostic runs;
it should not be used for final benchmark evidence.

The preflight also checks provider readiness. For `--provider openrouter`,
`configs/global_configs.py` in the SkillCraft checkout must contain a real
`openrouter_key`; the upstream placeholder `xxx` is rejected before model
calls. Relative `--out-dir` values are resolved from the Datafetch repo root, so
native outputs stay under this harness rather than inside the SkillCraft clone.

Provider notes:

- Upstream `--provider openrouter` reads `configs/global_configs.py`; fill
  `openrouter_key` there or use a checkout that already has it configured.
- `--provider unified` reads `TOOLATHLON_OPENAI_BASE_URL` and
  `TOOLATHLON_OPENAI_API_KEY`, including simple `KEY=value` entries from the
  SkillCraft `.env` file.
- `claw-codex` can be used as the unified OpenAI-compatible endpoint without an
  OpenRouter key. Start `claw-codex serve`, then run:

  ```bash
  pnpm eval:skillcraft:native:claw -- \
    --skillcraft-dir /tmp/skillcraft-official \
    --mode base,skill
  ```

  The wrapper checks `${CLAW_CODEX_BASE_URL:-http://127.0.0.1:1455/v1}/models`
  before invoking SkillCraft, exports `TOOLATHLON_PROVIDER=unified`, and passes
  `${CLAW_CODEX_MODEL:-claw/codex}` through as the model name.
- Long native runs should set `SKILLCRAFT_NATIVE_TASK_TIMEOUT_CAP=300` and
  continue into the same run directory if interrupted. The final 126-task native
  run used:

  ```bash
  SKILLCRAFT_NATIVE_TASK_TIMEOUT_CAP=300 \
  SKILLCRAFT_NATIVE_REUSE_EVAL_RES=1 \
  pnpm eval:skillcraft:native:claw -- \
    --skillcraft-dir /tmp/skillcraft-official \
    --mode base,skill \
    --out-dir eval/skillcraft/results/native/claw-full-126-20260510213113 \
    --continue-run eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115
  ```

  The `claw-codex` checkout used for this run needed Chat Completions tool-call
  compatibility, and the SkillCraft checkout needed terminal timeout/failure
  resume handling. See `reports/completion-audit.md` before attempting an
  exact fresh-machine reproduction.
- The pinned upstream checkout requests Python `3.12.11`. On platforms where uv
  has no `3.12.11` build, use an equivalent `3.12.x` interpreter only for a
  clearly marked diagnostic run, and record the override in the report.

Pilot example:

```bash
bash eval/skillcraft/scripts/run-native-skillcraft.sh \
  --families jsonplaceholder-blog-analyzer,world-bank-economic-snapshot,university-directory-builder \
  --levels e1,e2,e3,m1,m2,h1 \
  --mode base,skill
```

## 3. Run Datafetch Arm

The Datafetch adapter is intentionally separated from the native SkillCraft
runner. Once implemented, use:

```bash
bash eval/skillcraft/scripts/run-datafetch-skillcraft.sh
```

Current adapter status:

```bash
# Inspect selected official tasks without model calls.
bash eval/skillcraft/scripts/run-datafetch-skillcraft.sh --dry-run --limit 5

# Verify fixture mirroring plus official evaluator invocation on one task.
# Failure is expected here because no agent output file is written.
bash eval/skillcraft/scripts/run-datafetch-skillcraft.sh \
  --fixture-smoke \
  --task scaled_tasks/cat-facts-collector/e1

# Live Datafetch execution against official SkillCraft tools/evaluator.
bash eval/skillcraft/scripts/run-datafetch-skillcraft.sh \
  --live \
  --families cat-facts-collector,jsonplaceholder-blog-analyzer \
  --levels e1,e2
```

The fixture smoke uses `SKILLCRAFT_EVAL_PYTHON` when set, otherwise `python3`,
to avoid requiring SkillCraft's full `uv` environment just to invoke evaluator
scripts. The live adapter keeps a per-family `lib-cache/`: earlier passed tasks
can create `lib/*.ts` Datafetch functions, and later levels receive those files
as `df.lib.*` helpers. The protocol treats only `e1` as a training/promotion
episode; `e2`, `e3`, `m1`, `m2`, and `h1` are held-out reuse/generalization
episodes. The representative Datafetch arm is not complete until the adapter is
marked ready by the harness verifier.

Full 126-task Datafetch command:

```bash
SKILLCRAFT_TOOL_TIMEOUT_MS=60000 pnpm eval:skillcraft -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --live \
  --out-dir eval/skillcraft/results/datafetch/full-126-20260510192951 \
  --timeout-ms 300000
```

If the long run is interrupted, continue from the rows already written to
`episodes.jsonl`:

```bash
SKILLCRAFT_TOOL_TIMEOUT_MS=60000 pnpm eval:skillcraft -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --live \
  --out-dir eval/skillcraft/results/datafetch/full-126-20260510192951 \
  --timeout-ms 300000 \
  --resume
```

Representative pilot command used during harness development:

```bash
SKILLCRAFT_TOOL_TIMEOUT_MS=60000 pnpm eval:skillcraft -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --live \
  --families cat-facts-collector,jsonplaceholder-blog-analyzer,countries-encyclopedia,openmeteo-weather,university-directory-builder,world-bank-economic-snapshot \
  --levels e1,e2 \
  --out-dir eval/skillcraft/results/datafetch/pilot-6families-e1e2-v8 \
  --timeout-ms 300000
```

That pilot is diagnostic only: it has 12 official Datafetch rows and zero native
base/skill pairs. It is useful for checking tool bridging, official evaluator
coverage, reuse accounting, and runtime failure modes, not for thesis claims.

Tool bridge diagnostic:

```bash
eval/skillcraft/scripts/invoke-skillcraft-tool.py \
  --skillcraft-dir /path/to/SkillCraft \
  --bundle catfacts_api \
  --list

eval/skillcraft/scripts/invoke-skillcraft-tool.py \
  --skillcraft-dir /path/to/SkillCraft \
  --bundle catfacts_api \
  --tool local-catfacts_breed_profile \
  --args '{"breed_name":"Persian"}'
```

## 4. Normalize

```bash
pnpm eval:skillcraft:normalize \
  --native-run eval/skillcraft/results/native/run_YYYYMMDD_HHMMSS \
  --datafetch-run eval/skillcraft/results/datafetch/run_YYYYMMDD_HHMMSS
```

Final full paired command:

```bash
pnpm eval:skillcraft:normalize \
  --native-run eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115 \
  --datafetch-run eval/skillcraft/results/datafetch/full-126-20260510192951 \
  --out eval/skillcraft/results/full-126-claw-paired-normalized.jsonl
```

## 5. Analyze And Report

```bash
pnpm eval:skillcraft:analyze
pnpm eval:skillcraft:report
pnpm eval:skillcraft:verify
```

Final full paired commands:

```bash
pnpm eval:skillcraft:analyze \
  --input eval/skillcraft/results/full-126-claw-paired-normalized.jsonl \
  --out eval/skillcraft/reports/full-126-claw-paired-analysis.json

pnpm eval:skillcraft:report \
  --analysis eval/skillcraft/reports/full-126-claw-paired-analysis.json \
  --out eval/skillcraft/reports/full-126-claw-paired-report.md
```

For a pilot-only Datafetch run:

```bash
pnpm eval:skillcraft:normalize \
  --datafetch-run eval/skillcraft/results/datafetch/pilot-6families-e1e2-v8 \
  --out eval/skillcraft/results/pilot-6families-e1e2-v8-normalized.jsonl

pnpm eval:skillcraft:analyze \
  --input eval/skillcraft/results/pilot-6families-e1e2-v8-normalized.jsonl \
  --out eval/skillcraft/reports/pilot-6families-e1e2-v8-analysis.json

pnpm eval:skillcraft:report \
  --analysis eval/skillcraft/reports/pilot-6families-e1e2-v8-analysis.json \
  --out eval/skillcraft/reports/pilot-6families-e1e2-v8-report.md
```

## Release Checklist

- SkillCraft lock file points at the evaluated commit.
- Task index contains 126 task configs and 126 evaluator scripts.
- Native base and skill arms both produced normalized rows.
- Datafetch rows use official SkillCraft evaluator output.
- Report includes paired confidence intervals and failure-mode breakdown.
