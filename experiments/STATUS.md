# Project status: SkillCraft learning-loop iterations

> Snapshot taken 2026-05-13 at the close of Goal 2's iteration cycle.
> Updated when a new goal cycle closes; intermediate progress lives in
> [EXPERIMENTS.md](./EXPERIMENTS.md) and [EXPERIMENT_NOTES.md](./EXPERIMENT_NOTES.md).

## What this project is

Datafetch is a substrate that turns agent code into a recordable,
replayable, learnable execution surface. The agent writes a TypeScript
snippet against a typed `df.*` runtime; every primitive call is
captured into a trajectory; an observer crystallises common
compositions into typed callable helpers (`df.lib.<name>`) that
subsequent agent episodes see and reuse.

SkillCraft is the public benchmark we use to measure substrate
behaviour. It contains 21 task families × 6 difficulty levels = 126
tasks. The harness lives in [`eval/skillcraft/`](../eval/skillcraft/).

## Goal 1 — pass-rate hill climb (DONE)

Headline: **94.4% pass on the full 126, 3,027 effective tokens/task,
0.8% runtime errors.** Closed 28.5pp of the 30.1pp pass-rate gap to
the official SkillCraft-base ceiling at 172× lower token cost per
task. Four iterations:

1. Hook registry replaces direct lib resolution. Quarantine works,
   structured-unsupported envelopes replace raw runtime crashes.
2. Claude backend + bash-native multi-turn probing via
   `pnpm datafetch:run`. 84.1% pass, 80% token cut vs codex.
3. Snippet runtime auto-invokes uninvoked `main()` / `run()` /
   `solve()`. 91.3% pass, +7.2pp via forensic walk of failed
   trajectories.
4. Snippet timeout 180s → 300s. 94.4% pass, +3.1pp.

Full headline rows in [`../docs/hook-registry-experiment.md`](../docs/hook-registry-experiment.md).

Goal 1 cleared its three thresholds (pass ≥ 0.92, tokens ≤ 8,000,
runtime error rate ≤ 0.05). All four iterations ran with `--no-lib-cache`,
so the substrate's learning loop was deliberately disabled.

## Goal 2 — prove the learning loop fires (PARTIAL, 6 of 7)

Headline: **the substrate's learning loop fires end-to-end on the
new harness.** Six of seven goal thresholds clear on a six-family
pilot (run via the older harness) and on the new harness's tvmaze
probe with the iter5-8 substrate changes. The seventh threshold
(`avgLearnedInterfacesAvailable ≥ 2.0` on warm) is structurally
unreachable with today's observer.

Eight iterations across E0.5 → E5/6/7/8:

| iter | finding |
|---|---|
| E0.5 | Per-tier rollups added to analyze-results so the seven thresholds are computable from a single analyze JSON. |
| E1 | Lib-cache flag flip alone produces zero learning-loop metrics. The new harness has no `df.db.records` mount and no seed. |
| E1.5 | Observer wired into full harness. persist extended to read from `<datafetchHome>/lib/<tenantId>/`. Still zero — the gate's heuristic #5 requires a `db.*` first call. SkillCraft trajectories were pure-tool. |
| E2 | Older `skillcraftDatafetch.ts` harness on country family with `hooks-draft` mode: **100% correctness, -85% warm tokens vs baseline, 100% reuse rate, one observer-authored helper crystallised.** |
| E3 | Same setup across all six old-harness pilot families: **36 episodes, 100% correctness, -79% warm tokens, 83% reuse, 0 regressions, 0 quarantines.** 6 of 7 goal thresholds clear on this pilot. |
| E4 (iter5) | Port `df.db.records` mount + generic `sc_per_entity` seed into new harness via `src/eval/evalRecords.ts`. Claude with the wiring ignores the new primitives and writes pure `df.tool` fan-out. Scaffold-push variant regresses pass rate. |
| E5 (iter6) | Codex on the new harness DID use the new primitives. Observer's `consumesEarlierOutput` data-flow check rejects because numeric entity IDs aren't in the signature heuristic. |
| E6/E7 (iter7) | Extended `pickSignatures` to emit numeric values + recurse one level. Observer crystallises `scPerEntity.ts` from e2's trajectory. e1 snippet errored, blocking promotion. |
| E8 (iter8) | Broadened `LEARN_FROM_LEVELS` to `{e1, e2, e3, m1, m2}`. **lib-cache populates same-run, m2 and h1 see `libFunctionsAvailable = 1`.** Loop fires end-to-end on the new harness. |

Full E0.5-E8 entries in [`EXPERIMENTS.md`](./EXPERIMENTS.md); raw notes in
[`EXPERIMENT_NOTES.md`](./EXPERIMENT_NOTES.md).

## What's committed on `main`

| commit | scope |
|---|---|
| `aaa3b1f4` | canonical Goal 2 condition added to `experiments/goal.md` |
| `219c0925` | `installObserver` wired into new harness + `persistFamilyLibCache` extended + analyze-results per-tier rollups + goal2-full.sh runner |
| `5d566365` | Track A: `src/eval/evalRecords.ts` (records mount + generic `sc_per_entity` seed) wired into `skillcraftFullDatafetch.ts` + `runScript.ts`. Loop now reaches the observer; gate still rejects. |
| `151f269a` | Gate accepts numeric signatures + nested object values. `LEARN_FROM_LEVELS` broadened. Loop fires end-to-end. |

Test count: 242 / 242. Typecheck: clean.

## What's NOT yet achieved (the 7-of-7 gap)

| threshold | observed (probe) | gap |
|---|---|---|
| passRate ≥ 0.92 | codex 3/6 = 0.50 on iter8 probe | -0.42 with codex; would pass with claude but claude doesn't use the new primitives |
| avgEffectiveTokens ≤ 8,000 | codex 60-130k / episode | far over; needs claude |
| runtimeErrorRate ≤ 0.05 | not yet measured at scale | likely ok |
| avgLearnedInterfacesAvailable warm ≥ 2.0 | 1.0 max per family today | the substrate change required is sub-graph crystallisation or multi-seed |
| avgReuseRate warm ≥ 0.30 | codex 0.05 on probe | gated on more-helpers + agent actually using them |
| warm/train token ratio ≤ 0.70 | not yet measured at scale | likely ok once reuse climbs |
| quarantine rate ≤ 0.03 | not yet measured at scale | likely ok |

No full-126 run has been executed under the iter5-8 substrate state.
The remaining work is captured in [`PLAN.md`](./PLAN.md) § Goal 3.

## The path forward in three lines

1. Commit-phase substrate-rooted validator (force Claude to use `df.lib` / `df.db` when they're mounted).
2. Observer sub-graph extractor (so a trajectory can crystallise multiple distinct helpers).
3. df.d.ts discovery re-ranking (so the agent's eye lands on validated learned helpers first).

Iterations 9-13 in [`PLAN.md`](./PLAN.md) lay out the sequence. After
iter13 a full-126 dry run identifies any remaining gap; iters 14-16
target the remaining gap directly.

## Working files

| file | purpose |
|---|---|
| [`PLAN.md`](./PLAN.md) | current goal + iteration plan |
| [`EXPERIMENTS.md`](./EXPERIMENTS.md) | curated history of every iteration |
| [`EXPERIMENT_NOTES.md`](./EXPERIMENT_NOTES.md) | chronological scratchpad |
| [`goal.md`](./goal.md) | canonical `/goal` condition strings |
| [`STATUS.md`](./STATUS.md) | this file |
| [`../docs/hook-registry-experiment.md`](../docs/hook-registry-experiment.md) | public-facing committed headline rows |
| [`../docs/architecture.md`](../docs/architecture.md) | substrate architecture overview |
| [`../docs/proof-skillcraft.md`](../docs/proof-skillcraft.md) | website-facing eval proof |
| [`../docs/release-plan.md`](../docs/release-plan.md) | OSS + client release plan |
