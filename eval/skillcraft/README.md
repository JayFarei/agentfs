# Datafetch x SkillCraft Full Evaluation

This harness is designed to answer one question:

> On the full SkillCraft scaled-task suite, does datafetch's learned
> `df.lib.*` interface preserve correctness while reducing cost, latency, and
> tool work relative to native SkillCraft base and skill-cache modes?

`pnpm eval:skillcraft` now targets the release-facing harness against upstream
SkillCraft task directories, evaluators, and native modes. The old
SkillCraft-inspired smoke test is still available as
`pnpm eval:skillcraft:synthetic` for local diagnostics only.

## Arms

1. `skillcraft-base`: upstream SkillCraft `base` mode.
2. `skillcraft-skill`: upstream SkillCraft `skill` mode.
3. `datafetch-learned`: datafetch code-mode workspace with learned `df.lib.*`
   interfaces, scored by the official SkillCraft evaluator.

Optional stronger baseline:

4. `skillcraft-static-reuse`: upstream `static-reuse` or `cross-task` mode.

## Reproducible Flow

```bash
bash eval/skillcraft/scripts/prepare-skillcraft.sh
bash eval/skillcraft/scripts/run-native-skillcraft.sh
bash eval/skillcraft/scripts/run-datafetch-skillcraft.sh
pnpm eval:skillcraft:normalize --native-run <native-run-dir> --datafetch-run <datafetch-run-dir>
pnpm eval:skillcraft:analyze --input eval/skillcraft/results/normalized-results.jsonl
pnpm eval:skillcraft:report --analysis eval/skillcraft/reports/analysis.json
pnpm eval:skillcraft:verify
```

The native SkillCraft run requires a configured model/provider in the upstream
SkillCraft environment. If OpenRouter is unavailable, the native arms can also
run through a local OpenAI-compatible `claw-codex` server:

```bash
claw-codex auth status || claw-codex auth login --open-browser
CLAW_CODEX_HOST=127.0.0.1 CLAW_CODEX_PORT=1455 claw-codex serve
pnpm eval:skillcraft:native:claw -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --mode base,skill
```

For long native runs, cap task stalls and continue into the same run directory:

```bash
SKILLCRAFT_NATIVE_TASK_TIMEOUT_CAP=300 \
SKILLCRAFT_NATIVE_REUSE_EVAL_RES=1 \
pnpm eval:skillcraft:native:claw -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --mode base,skill \
  --out-dir eval/skillcraft/results/native/claw-full-126-20260510213113 \
  --continue-run eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115
```

## Current Full Paired Run

The current full paired run uses all 126 official `tasks/scaled_tasks/*` tasks.

Datafetch arm:

```bash
SKILLCRAFT_TOOL_TIMEOUT_MS=60000 pnpm eval:skillcraft -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --live \
  --out-dir eval/skillcraft/results/datafetch/full-126-20260510192951 \
  --timeout-ms 300000
```

Long runs can resume from the same `episodes.jsonl`:

```bash
SKILLCRAFT_TOOL_TIMEOUT_MS=60000 pnpm eval:skillcraft -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --live \
  --out-dir eval/skillcraft/results/datafetch/full-126-20260510192951 \
  --timeout-ms 300000 \
  --resume
```

Native SkillCraft base/skill arm:

```bash
pnpm eval:skillcraft:native:claw -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --mode base,skill \
  --out-dir eval/skillcraft/results/native/claw-full-126-20260510213113
```

Final paired artifacts:

- `eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115`
- `eval/skillcraft/results/datafetch/full-126-20260510192951`
- `eval/skillcraft/results/full-126-claw-paired-normalized.jsonl`
- `eval/skillcraft/reports/full-126-claw-paired-analysis.json`
- `eval/skillcraft/reports/full-126-claw-paired-report.md`
- `eval/skillcraft/reports/completion-audit.md`

The current result is representative but not yet thesis-positive: Datafetch is
materially cheaper in effective tokens, but it trails both SkillCraft native
arms on correctness.

## What Gets Committed

Commit the protocol, scripts, schemas, manifests, and summary reports. Do not
commit raw trajectories, large result dumps, or provider logs from `results/`.
