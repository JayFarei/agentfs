# Datafetch x SkillCraft Full Evaluation Report

Generated: 2026-05-10T18:26:26.538Z

## Task Surface

- Indexed tasks: 126
- Families: 21
- Missing task docs: 0
- Missing evaluators: 0

## Arm Summary

| Arm | Rows | Pass >=70 | Status Pass >=90 | Avg Score | Avg Effective Tokens | Avg Cost | Avg Latency | Avg Tool Calls | Avg Reuse | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned | 6 | 50% | 50% | 56.250 | 18229 | N/A | 24196 | 35.500 | 0.161 | 17% |

## Phase Summary

| Phase | Rows | Pass >=70 | Avg Score | Avg Effective Tokens | Avg Reuse | Avg Interfaces Available | Avg Interface Calls | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train | 3 | 33% | 45.833 | 20429 | 0.089 | 0.000 | 2.000 | 33% |
| warm | 3 | 67% | 66.667 | 16028 | 0.233 | 0.333 | 3.000 | 0% |

## Coverage

- Datafetch vs SkillCraft base paired tasks: 0
- Datafetch vs SkillCraft skill paired tasks: 0
- Official evaluator coverage: datafetch-learned: 6/6

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
