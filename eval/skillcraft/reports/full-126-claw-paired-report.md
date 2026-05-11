# Datafetch x SkillCraft Full Evaluation Report

Generated: 2026-05-11T05:37:23.176Z

## Task Surface

- Indexed tasks: 126
- Families: 21
- Missing task docs: 0
- Missing evaluators: 0

## Arm Summary

| Arm | Rows | Pass >=70 | Status Pass >=90 | Avg Score | Avg Effective Tokens | Avg Cost | Avg Latency | Avg Tool Calls | Avg Reuse | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned | 126 | 71% | 62% | 69.813 | 18076 | N/A | 21919 | 13.444 | 0.171 | 14% |
| skillcraft-base | 126 | 96% | 94% | 93.796 | 520450 | 0.000 | N/A | 17.389 | N/A | 0% |
| skillcraft-skill | 126 | 94% | 93% | 92.027 | 201844 | 0.000 | N/A | 9.698 | N/A | 0% |

## Phase Summary

| Phase | Rows | Pass >=70 | Avg Score | Avg Effective Tokens | Avg Reuse | Avg Interfaces Available | Avg Interface Calls | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hard | 63 | 76% | 73.929 | 246613 | 0.103 | 0.810 | 3.143 | 6% |
| train | 63 | 90% | 88.413 | 234347 | 0.184 | 0.000 | 2.333 | 3% |
| warm | 252 | 88% | 87.233 | 249946 | 0.185 | 0.810 | 2.619 | 5% |

## Family Summary

| Family | Pass >=70 | Status Pass >=90 | Avg Score | Train | Warm | Hard | Avg Reuse | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cat-facts-collector | 18/18 | 94% | 96.561 | 3/3 | 12/12 | 3/3 | 0.219 | 0 |
| cocktail-menu-generator | 18/18 | 100% | 96.506 | 3/3 | 12/12 | 3/3 | 0.206 | 0 |
| countries-encyclopedia | 14/18 | 72% | 80.611 | 2/3 | 9/12 | 3/3 | 0.225 | 2 |
| dnd-campaign-builder | 13/18 | 72% | 69.444 | 3/3 | 9/12 | 1/3 | 0.226 | 2 |
| dnd-monster-compendium | 9/18 | 50% | 50.917 | 1/3 | 8/12 | 0/3 | 0.150 | 3 |
| dog-breeds-encyclopedia | 17/18 | 94% | 91.756 | 3/3 | 11/12 | 3/3 | 0.058 | 1 |
| gitlab-deep-analysis | 17/18 | 78% | 92.150 | 3/3 | 12/12 | 2/3 | 0.283 | 1 |
| jikan-anime-analysis | 17/18 | 89% | 90.411 | 3/3 | 11/12 | 3/3 | 0.144 | 1 |
| jsonplaceholder-blog-analyzer | 16/18 | 78% | 86.667 | 3/3 | 12/12 | 1/3 | 0.203 | 0 |
| local-dna-analysis | 16/18 | 89% | 87.350 | 3/3 | 11/12 | 2/3 | 0.186 | 1 |
| name-demographics-analyzer | 18/18 | 100% | 99.444 | 3/3 | 12/12 | 3/3 | 0.211 | 0 |
| openmeteo-weather | 16/18 | 89% | 88.150 | 2/3 | 11/12 | 3/3 | 0.144 | 2 |
| pokeapi-pokedex | 15/18 | 72% | 83.489 | 3/3 | 10/12 | 2/3 | 0.206 | 1 |
| random-user-database | 16/18 | 83% | 90.556 | 3/3 | 11/12 | 2/3 | 0.219 | 0 |
| recipe-cookbook-builder | 17/18 | 94% | 89.139 | 3/3 | 11/12 | 3/3 | 0.209 | 1 |
| rickmorty-multiverse-explorer | 18/18 | 89% | 94.228 | 3/3 | 12/12 | 3/3 | 0.214 | 0 |
| tvmaze-series-analyzer | 18/18 | 94% | 98.189 | 3/3 | 12/12 | 3/3 | 0.211 | 0 |
| university-directory-builder | 16/18 | 89% | 91.333 | 3/3 | 11/12 | 2/3 | 0.167 | 2 |
| usgs-earthquake-monitor | 15/18 | 83% | 79.900 | 3/3 | 10/12 | 2/3 | 0.117 | 1 |
| vocabulary-builder | 12/18 | 67% | 66.578 | 2/3 | 8/12 | 2/3 | 0.000 | 0 |
| world-bank-economic-snapshot | 12/18 | 67% | 66.078 | 2/3 | 8/12 | 2/3 | 0.000 | 0 |

## Coverage

- Datafetch vs SkillCraft base paired tasks: 126
- Datafetch vs SkillCraft skill paired tasks: 126
- Official evaluator coverage: datafetch-learned: 126/126, skillcraft-base: 126/126, skillcraft-skill: 126/126
- Native paired comparison status: paired rows present (base=126, skill=126)

## Paired Contrasts

| Contrast | Pairs | Pass Delta | Score Delta 95% CI | Effective Token Ratio | Latency Ratio | Tool Call Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned vs skillcraft-base | 126 | -25% | -23.983 [-32.062, -16.764] | 0.056 [0.046, 0.068] | N/A | 0.775 [0.597, 1.012] |
| datafetch-learned vs skillcraft-skill | 126 | -23% | -22.213 [-30.317, -14.510] | 0.168 [0.145, 0.191] | N/A | 1.697 [1.201, 2.349] |

## Interpretation Rules

- This is a pilot report unless every primary arm has the expected official SkillCraft task count and paired contrasts are non-zero.
- `Pass >=70` follows SkillCraft's official `passed` threshold; `Status Pass >=90` follows the stricter status label.
- Treat this report as significant only when paired task coverage is representative.
- Datafetch wins only if correctness is non-inferior and efficiency improves on held-out warm/hard tasks.
- Missing upstream task prompts or evaluator gaps must be resolved before using native SkillCraft results as final evidence.
