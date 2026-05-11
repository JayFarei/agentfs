# Datafetch x SkillCraft Full Evaluation Report

Generated: 2026-05-10T16:43:58.598Z

## Task Surface

- Indexed tasks: 126
- Families: 21
- Missing task docs: 0
- Missing evaluators: 0

## Arm Summary

| Arm | Rows | Pass Rate | Avg Score | Avg Effective Tokens | Avg Cost | Avg Latency | Avg Tool Calls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned | 18 | 100% | 100.000 | 3548 | N/A | 15161 | 0.333 |

## Paired Contrasts

| Contrast | Pairs | Pass Delta | Score Delta 95% CI | Effective Token Ratio | Latency Ratio | Tool Call Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned vs skillcraft-base | 0 | N/A | N/A | N/A | N/A | N/A |
| datafetch-learned vs skillcraft-skill | 0 | N/A | N/A | N/A | N/A | N/A |

## Interpretation Rules

- Treat this report as significant only when paired task coverage is representative.
- Datafetch wins only if correctness is non-inferior and efficiency improves on held-out warm/hard tasks.
- Missing upstream task prompts or evaluator gaps must be resolved before using native SkillCraft results as final evidence.
