# SkillCraft Evaluation Completion Audit

Generated: 2026-05-11

## Objective

Run the full representative SkillCraft evaluation for Datafetch, compare it
against native SkillCraft base and skill-cache modes, and perform one
improvement round so the results can be reproduced from `eval/skillcraft/`.

## Current Status

Status: complete for the full paired 126-task run.

The full Datafetch arm, native SkillCraft base arm, and native SkillCraft skill
arm all ran across the 126 official SkillCraft scaled tasks. All three arms
were normalized into a paired 378-row comparison, and every row has official
SkillCraft evaluator coverage.

## Prompt-To-Artifact Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Release-facing `eval/skillcraft/` harness | `eval/skillcraft/README.md`, `eval/skillcraft/runbook.md`, `eval/skillcraft/protocol.md` | Done |
| Official SkillCraft task surface indexed | `eval/skillcraft/manifests/task-index.json` records 126 tasks and 21 families | Done |
| Datafetch full arm across all tasks | `eval/skillcraft/results/datafetch/full-126-20260510192951/results.json` contains 126 episodes | Done |
| Official evaluator used for Datafetch rows | `eval/skillcraft/reports/full-126-datafetch-report.md` reports 126/126 official evaluator coverage | Done |
| Native SkillCraft base arm | `eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115/test_results_unified_claw_codex.json` contains 126 base results | Done |
| Native SkillCraft skill arm | `eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115/test_results_unified_claw_codex.json` contains 126 skill results | Done |
| Paired Datafetch vs native base/skill comparison | `eval/skillcraft/reports/full-126-claw-paired-report.md` reports 126 paired base tasks and 126 paired skill tasks | Done |
| Per-family learning curve breakdown | `eval/skillcraft/reports/full-126-claw-paired-report.md` includes train/warm/hard family table | Done |
| One improvement round | Added `claw-codex` native wrapper, resume support, IIFE normalization hardening, runtime-error pass gating, and family-summary reporting | Done |

## Final Full Paired Result

From `eval/skillcraft/reports/full-126-claw-paired-report.md`:

| Arm | Rows | Pass >=70 | Status pass >=90 | Average score | Average effective tokens | Average tool calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Datafetch learned | 126 | 71% | 62% | 69.813 | 18,076 | 13.444 |
| SkillCraft base | 126 | 96% | 94% | 93.796 | 520,450 | 17.389 |
| SkillCraft skill | 126 | 94% | 93% | 92.027 | 201,844 | 9.698 |

Paired contrasts:

| Contrast | Pairs | Pass delta | Score delta 95% CI | Effective token ratio | Tool call ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Datafetch learned vs SkillCraft base | 126 | -25% | -23.983 [-32.062, -16.764] | 0.056 [0.046, 0.068] | 0.775 [0.597, 1.012] |
| Datafetch learned vs SkillCraft skill | 126 | -23% | -22.213 [-30.317, -14.510] | 0.168 [0.145, 0.191] | 1.697 [1.201, 2.349] |

Interpretation: Datafetch is much cheaper in effective tokens than both native
arms, but it is not yet correctness-non-inferior to SkillCraft base or
SkillCraft skill. The current result diagnoses an interface quality and runtime
reliability gap, not a validated win.

## Native Run Notes

The native arms were run through `claw-codex` as SkillCraft's `unified`
OpenAI-compatible provider:

```bash
CLAW_CODEX_REQUEST_TIMEOUT_SECONDS=300 \
  uv run python -m claw_codex serve --host 127.0.0.1 --port 1455

SKILLCRAFT_NATIVE_TASK_TIMEOUT_CAP=300 \
SKILLCRAFT_NATIVE_REUSE_EVAL_RES=1 \
pnpm eval:skillcraft:native:claw -- \
  --skillcraft-dir /tmp/skillcraft-official \
  --mode base,skill \
  --out-dir eval/skillcraft/results/native/claw-full-126-20260510213113 \
  --continue-run eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115
```

The local `claw-codex` checkout needed Chat Completions tool-call compatibility
for SkillCraft/Toolathlon:

- emit `delta.tool_calls` in streaming `/v1/chat/completions`
- return `message.tool_calls` and `finish_reason="tool_calls"` in non-streaming
  `/v1/chat/completions`
- convert assistant `tool_calls` and `role="tool"` messages back into
  Responses API items on follow-up turns
- use a finite upstream request timeout via `CLAW_CODEX_REQUEST_TIMEOUT_SECONDS`

The local SkillCraft checkout also needed terminal resume handling for long
native runs:

- cap per-task timeouts with `SKILLCRAFT_NATIVE_TASK_TIMEOUT_CAP`
- treat timeout/failure outcomes as terminal for `--continue-run`
- let resumed runs reuse prior `traj_log.json` plus `eval_res.json` artifacts
  when aggregate result writing is interrupted

These compatibility changes were applied to local checkouts under `/tmp`; they
should be upstreamed or vendored before claiming one-command reproducibility on
a fresh machine.

## Commands Used For Final Pairing

```bash
pnpm eval:skillcraft:normalize \
  --native-run eval/skillcraft/results/native/claw-full-126-20260510213113/run_20260510_213115 \
  --datafetch-run eval/skillcraft/results/datafetch/full-126-20260510192951 \
  --out eval/skillcraft/results/full-126-claw-paired-normalized.jsonl

pnpm eval:skillcraft:analyze \
  --input eval/skillcraft/results/full-126-claw-paired-normalized.jsonl \
  --out eval/skillcraft/reports/full-126-claw-paired-analysis.json

pnpm eval:skillcraft:report \
  --analysis eval/skillcraft/reports/full-126-claw-paired-analysis.json \
  --out eval/skillcraft/reports/full-126-claw-paired-report.md
```

## Verification

Final verification commands:

```bash
pnpm eval:skillcraft:verify
pnpm typecheck
pnpm test
git diff --check
```

