# Datafetch x SkillCraft Full Evaluation Report

Generated: 2026-05-11T09:44:40.051Z

## Task Surface

- Indexed tasks: 126
- Families: 21
- Missing task docs: 0
- Missing evaluators: 0

## Arm Summary

| Arm | Rows | Pass >=70 | Status Pass >=90 | Avg Score | Avg Effective Tokens | Avg Cost | Avg Latency | Avg Tool Calls | Avg Reuse | Runtime Errors | Infra Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned | 126 | 63% | 58% | 62.933 | 16632 | N/A | 59860 | 11.929 | 0.123 | 33% | 0% |
| skillcraft-base | 126 | 96% | 94% | 93.796 | 520450 | 0.000 | N/A | 17.389 | N/A | 0% | 0% |
| skillcraft-skill | 126 | 94% | 93% | 92.027 | 201844 | 0.000 | N/A | 9.698 | N/A | 0% | 0% |

## Phase Summary

| Phase | Rows | Pass >=70 | Avg Score | Avg Effective Tokens | Avg Reuse | Avg Interfaces Available | Avg Interface Calls | Runtime Errors | Infra Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hard | 63 | 76% | 73.116 | 246177 | 0.112 | 0.429 | 2.857 | 13% | 0% |
| train | 63 | 81% | 79.844 | 233873 | 0.094 | 0.000 | 1.095 | 16% | 0% |
| warm | 252 | 87% | 86.138 | 249451 | 0.132 | 0.429 | 2.226 | 9% | 0% |

## Family Summary

| Family | Pass >=70 | Status Pass >=90 | Avg Score | Train | Warm | Hard | Avg Reuse | Runtime Errors | Infra Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cat-facts-collector | 16/18 | 89% | 94.228 | 3/3 | 10/12 | 3/3 | 0.116 | 0 | 0 |
| cocktail-menu-generator | 18/18 | 100% | 96.322 | 3/3 | 12/12 | 3/3 | 0.101 | 0 | 0 |
| countries-encyclopedia | 14/18 | 72% | 75.250 | 2/3 | 10/12 | 2/3 | 0.042 | 4 | 0 |
| dnd-campaign-builder | 9/18 | 50% | 48.317 | 2/3 | 7/12 | 0/3 | 0.114 | 6 | 0 |
| dnd-monster-compendium | 8/18 | 39% | 44.156 | 1/3 | 7/12 | 0/3 | 0.132 | 4 | 0 |
| dog-breeds-encyclopedia | 16/18 | 89% | 86.217 | 2/3 | 11/12 | 3/3 | 0.089 | 1 | 0 |
| gitlab-deep-analysis | 13/18 | 56% | 70.022 | 2/3 | 9/12 | 2/3 | 0.042 | 5 | 0 |
| jikan-anime-analysis | 15/18 | 83% | 79.944 | 2/3 | 10/12 | 3/3 | 0.066 | 3 | 0 |
| jsonplaceholder-blog-analyzer | 13/18 | 72% | 72.222 | 2/3 | 11/12 | 0/3 | 0.074 | 3 | 0 |
| local-dna-analysis | 15/18 | 83% | 81.789 | 3/3 | 10/12 | 2/3 | 0.122 | 2 | 0 |
| name-demographics-analyzer | 17/18 | 94% | 93.611 | 3/3 | 11/12 | 3/3 | 0.124 | 1 | 0 |
| openmeteo-weather | 17/18 | 89% | 92.778 | 2/3 | 12/12 | 3/3 | 0.164 | 1 | 0 |
| pokeapi-pokedex | 15/18 | 78% | 84.183 | 2/3 | 10/12 | 3/3 | 0.168 | 2 | 0 |
| random-user-database | 16/18 | 78% | 88.611 | 3/3 | 11/12 | 2/3 | 0.214 | 0 | 0 |
| recipe-cookbook-builder | 15/18 | 83% | 78.661 | 2/3 | 10/12 | 3/3 | 0.117 | 3 | 0 |
| rickmorty-multiverse-explorer | 18/18 | 94% | 96.133 | 3/3 | 12/12 | 3/3 | 0.158 | 0 | 0 |
| tvmaze-series-analyzer | 18/18 | 100% | 99.178 | 3/3 | 12/12 | 3/3 | 0.206 | 0 | 0 |
| university-directory-builder | 17/18 | 94% | 91.333 | 3/3 | 11/12 | 3/3 | 0.146 | 1 | 0 |
| usgs-earthquake-monitor | 14/18 | 78% | 74.567 | 2/3 | 10/12 | 2/3 | 0.100 | 4 | 0 |
| vocabulary-builder | 17/18 | 94% | 94.356 | 3/3 | 12/12 | 2/3 | 0.178 | 1 | 0 |
| world-bank-economic-snapshot | 18/18 | 100% | 99.411 | 3/3 | 12/12 | 3/3 | 0.103 | 0 | 0 |

## Coverage

- Datafetch vs SkillCraft base paired tasks: 126
- Datafetch vs SkillCraft skill paired tasks: 126
- Official evaluator coverage: datafetch-learned: 126/126, skillcraft-base: 126/126, skillcraft-skill: 126/126
- Native paired comparison status: paired rows present (base=126, skill=126)

## Paired Contrasts

| Contrast | Pairs | Pass Delta | Score Delta 95% CI | Effective Token Ratio | Latency Ratio | Tool Call Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned vs skillcraft-base | 126 | -33% | -30.863 [-38.890, -23.702] | 0.053 [0.043, 0.064] | N/A | 0.694 [0.631, 0.754] |
| datafetch-learned vs skillcraft-skill | 126 | -30% | -29.094 [-37.171, -21.568] | 0.157 [0.134, 0.182] | N/A | 1.537 [1.303, 1.834] |

## Interpretation Rules

- This is a pilot report unless every primary arm has the expected official SkillCraft task count and paired contrasts are non-zero.
- `Pass >=70` follows SkillCraft's official `passed` threshold; `Status Pass >=90` follows the stricter status label.
- Treat this report as significant only when paired task coverage is representative.
- Datafetch wins only if correctness is non-inferior and efficiency improves on held-out warm/hard tasks.
- Missing upstream task prompts or evaluator gaps must be resolved before using native SkillCraft results as final evidence.
