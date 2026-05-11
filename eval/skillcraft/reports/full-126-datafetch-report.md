# Datafetch x SkillCraft Full Evaluation Report

Generated: 2026-05-10T19:55:59.500Z

## Task Surface

- Indexed tasks: 126
- Families: 21
- Missing task docs: 0
- Missing evaluators: 0

## Arm Summary

| Arm | Rows | Pass >=70 | Status Pass >=90 | Avg Score | Avg Effective Tokens | Avg Cost | Avg Latency | Avg Tool Calls | Avg Reuse | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| datafetch-learned | 126 | 71% | 62% | 69.813 | 18076 | N/A | 21919 | 13.444 | 0.171 | 14% |

## Phase Summary

| Phase | Rows | Pass >=70 | Avg Score | Avg Effective Tokens | Avg Reuse | Avg Interfaces Available | Avg Interface Calls | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hard | 21 | 62% | 60.595 | 17437 | 0.103 | 0.810 | 3.143 | 19% |
| train | 21 | 76% | 71.138 | 17738 | 0.184 | 0.000 | 2.333 | 10% |
| warm | 84 | 71% | 71.787 | 18321 | 0.185 | 0.810 | 2.619 | 14% |

## Family Summary

| Family | Pass >=70 | Status Pass >=90 | Avg Score | Train | Warm | Hard | Avg Reuse | Runtime Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cat-facts-collector | 6/6 | 83% | 93.783 | 1/1 | 4/4 | 1/1 | 0.219 | 0 |
| cocktail-menu-generator | 6/6 | 100% | 96.133 | 1/1 | 4/4 | 1/1 | 0.206 | 0 |
| countries-encyclopedia | 2/6 | 33% | 49.417 | 0/1 | 1/4 | 1/1 | 0.225 | 2 |
| dnd-campaign-builder | 4/6 | 67% | 63.383 | 1/1 | 2/4 | 1/1 | 0.226 | 2 |
| dnd-monster-compendium | 3/6 | 50% | 50.000 | 0/1 | 3/4 | 0/1 | 0.150 | 3 |
| dog-breeds-encyclopedia | 5/6 | 83% | 81.567 | 1/1 | 3/4 | 1/1 | 0.058 | 1 |
| gitlab-deep-analysis | 5/6 | 67% | 81.150 | 1/1 | 4/4 | 0/1 | 0.283 | 1 |
| jikan-anime-analysis | 5/6 | 67% | 76.817 | 1/1 | 3/4 | 1/1 | 0.144 | 1 |
| jsonplaceholder-blog-analyzer | 6/6 | 67% | 93.333 | 1/1 | 4/4 | 1/1 | 0.203 | 0 |
| local-dna-analysis | 4/6 | 67% | 71.283 | 1/1 | 3/4 | 0/1 | 0.186 | 1 |
| name-demographics-analyzer | 6/6 | 100% | 99.167 | 1/1 | 4/4 | 1/1 | 0.211 | 0 |
| openmeteo-weather | 4/6 | 67% | 66.117 | 0/1 | 3/4 | 1/1 | 0.144 | 2 |
| pokeapi-pokedex | 3/6 | 17% | 56.300 | 1/1 | 2/4 | 0/1 | 0.206 | 1 |
| random-user-database | 6/6 | 83% | 96.667 | 1/1 | 4/4 | 1/1 | 0.219 | 0 |
| recipe-cookbook-builder | 5/6 | 83% | 78.983 | 1/1 | 3/4 | 1/1 | 0.209 | 1 |
| rickmorty-multiverse-explorer | 6/6 | 67% | 88.450 | 1/1 | 4/4 | 1/1 | 0.214 | 0 |
| tvmaze-series-analyzer | 6/6 | 83% | 95.767 | 1/1 | 4/4 | 1/1 | 0.211 | 0 |
| university-directory-builder | 4/6 | 67% | 80.667 | 1/1 | 3/4 | 0/1 | 0.167 | 2 |
| usgs-earthquake-monitor | 3/6 | 50% | 47.100 | 1/1 | 2/4 | 0/1 | 0.117 | 1 |
| vocabulary-builder | 0/6 | 0% | 0.000 | 0/1 | 0/4 | 0/1 | 0.000 | 0 |
| world-bank-economic-snapshot | 0/6 | 0% | 0.000 | 0/1 | 0/4 | 0/1 | 0.000 | 0 |

## Coverage

- Datafetch vs SkillCraft base paired tasks: 0
- Datafetch vs SkillCraft skill paired tasks: 0
- Official evaluator coverage: datafetch-learned: 126/126
- Native paired comparison status: blocked/not included; run native SkillCraft base+skill after provider preflight passes

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
