# Datafetch x SkillCraft Full Evaluation Report

Generated: 2026-05-10T18:17:16.050Z

## Task Surface

- Indexed tasks: 126
- Families: 21
- Missing task docs: 0
- Missing evaluators: 0

## Arm Summary

| Arm | Rows | Pass >=70 | Status Pass >=90 | Avg Score | Avg Effective Tokens | Avg Cost | Avg Latency | Avg Tool Calls | Avg Reuse | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned | 12 | 67% | 67% | 64.975 | 17779 | N/A | 20826 | 20.250 | 0.189 | 33% |

## Phase Summary

| Phase | Rows | Pass >=70 | Avg Score | Avg Effective Tokens | Avg Reuse | Avg Interfaces Available | Avg Interface Calls | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train | 6 | 67% | 64.783 | 17539 | 0.211 | 0.000 | 2.333 | 33% |
| warm | 6 | 67% | 65.167 | 18020 | 0.167 | 0.667 | 2.000 | 33% |

## Coverage

- Datafetch vs SkillCraft base paired tasks: 0
- Datafetch vs SkillCraft skill paired tasks: 0
- Official evaluator coverage: datafetch-learned: 12/12

## Paired Contrasts

| Contrast | Pairs | Pass Delta | Score Delta 95% CI | Effective Token Ratio | Latency Ratio | Tool Call Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned vs skillcraft-base | 0 | N/A | N/A | N/A | N/A | N/A |
| datafetch-learned vs skillcraft-skill | 0 | N/A | N/A | N/A | N/A | N/A |

## Interpretation Rules

- This is a pilot report unless every primary arm has the expected official SkillCraft task count and paired contrasts are non-zero.
- `Pass >=70` follows SkillCraft's official `passed` threshold; `Status Pass >=90` follows the stricter status label.
- Treat this report as significant only when paired task coverage is representative.
- Datafetch wins only if correctness is non-inferior and efficiency improves on held-out warm/hard tasks.
- Missing upstream task prompts or evaluator gaps must be resolved before using native SkillCraft results as final evidence.
