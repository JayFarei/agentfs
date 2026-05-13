# Experiments

> Curated, chronological list of substrate-level experiments against
> the SkillCraft 126-task surface. Each entry captures hypothesis,
> change, expected delta, actual delta, status, and lessons. Both
> successful and failed attempts go here. This file is the first thing
> the next iteration should read.

## Format

```
### EN: <one-line title>
- Date: YYYY-MM-DD
- Goal: <which goal this iteration was working towards>
- Hypothesis: <one sentence claim>
- Lever: <hook registry / observer / snippet runtime / prompt template / discovery>
- Change: <what was actually implemented; commit ref>
- Probe: <family, pass before, pass after, delta, learning-loop metrics if relevant>
- Validate: <combined pass before, after, delta, learning-loop metrics>
- Full-126: <pass rate, avg tokens, runtime err rate, learning-loop metrics>
- Status: PASSED | FAILED | INCONCLUSIVE
- Lessons: <what we learned, what surprised us, what to do differently>
- Artefacts: <paths to analysis JSON, error taxonomy, headline row>
```

---

## Prior experiments (Goal 1: pass ≥ 92% with lib-cache disabled)

### E0: Pre-substrate baseline (iter2, from the prior session)
- Date: 2026-05-11
- Goal: previously committed baseline
- Hypothesis: claude backend + bash-native multi-turn probing improves
  on the codex hooks-draft baseline
- Lever: prompt template + new `pnpm datafetch:run` affordance
- Change: claude agent driver, `--no-lib-cache` flag in full-126
  scripts, `src/eval/runScript.ts` for the probe affordance
- Full-126: 84.1% pass, 3,329 avg tokens, 4.8% runtime err
- Status: PASSED (baseline for the hill climb)
- Lessons: multi-turn probing collapses the "agent guesses wrong about
  tool response shape and throws" failure mode. Adds ~2× LLM call
  count per task but Claude's prompt caching absorbs it; effective
  tokens per task *drop* by ~80% vs the codex baseline.
- Artefacts: `eval/skillcraft/reports/iter2-full-20260511-201102-analysis.json`

### E1: Snippet runtime auto-invokes uninvoked `main()` / `run()` / `solve()`
- Date: 2026-05-11
- Goal: Goal 1 (≥ 92% pass)
- Hypothesis: 9 of iter2's 18 failures (50%) are agent scripts that
  declared `async function main()` without invoking it at the top
  level. The IIFE wrapper resolves with zero `df.*` calls and the
  workspace output is never written. Auto-invoking a declared entry
  point should rescue most of those.
- Lever: snippet runtime
- Change: `buildAutoInvokeTrailer` in `src/snippet/runtime.ts` scans
  the wrapped body for declared-but-uninvoked `main` / `run` /
  `solve`, appends a runtime-guarded `if (typeof name === "function")
  await name()` trailer. Opt-out via
  `DATAFETCH_DISABLE_AUTO_INVOKE=1`. Commit `9e7643b0`.
- Probe (tvmaze-series-analyzer): 6/6 pass vs baseline 4/6,
  +33.3pp. h1 actually fired the auto-invoke trailer and scored 100%.
- Validate (univ + jikan): 12/12 vs 11/12, +8.3pp. Auto-invoke
  fired on university-directory-builder/e1.
- Full-126: 91.3% pass (115/126), 84.9% strict, 2.4% runtime err,
  2,618 avg tokens. Trailer fired on 24/126 episodes; all 24 scored
  ≥ 70.
- Phase deltas vs iter2: train -9.5pp (small-sample noise from
  normalize-script artefact, see Lessons), warm +9.6pp, hard +14.2pp.
- Status: PASSED probe, PASSED validate, PASSED on the substrate side
  of the full-126 but did *not* clear the 92% goal on the analyze
  output alone. The hard tier flipped from base's 82.6% to 95.2%,
  beating the ceiling, which is the result we will keep citing.
- Lessons:
  1. The 24/24 trailer-rescue rate is the strongest piece of
     evidence: this fix is doing the work it was designed to do, no
     stochastic mush.
  2. The train regression (-9.5pp on n=21) was an analyze artefact,
     not a real regression. Two evaluator-passing tasks
     (`university-directory-builder/e1` score 96, `countries-
     encyclopedia/m2` score 95.8) were demoted to
     `infrastructure_error` by `normalize-results.ts`'s
     `agentExitCode != 0 && llmCalls === 0 && totalTokens === 0`
     heuristic. The agent was SIGTERM'd at the harness boundary while
     its on-disk output had already scored as a pass. Honouring
     `officialStatus === "pass"` over the heuristic would have shown
     117/126 = 92.9% on the same run. We did not patch normalize
     because the goal definition pins the score to the analyze
     output, and moving the goalposts mid-run is the wrong precedent.
  3. The auto-invoke trailer is the kind of "trivial fix, large
     real-world impact" substrate change that is hard to spot until
     you do forensic walks of stderr and prepared-answer files. The
     forensic walk script (`scripts/audit-autoinvoke.mts`) is now
     part of the toolkit; reuse it.
- Artefacts:
  - Analysis: `eval/skillcraft/reports/iter3-full-20260511-223714-analysis.json`
  - Taxonomy: `eval/skillcraft/reports/iter3-full-20260511-223714-error-taxonomy.json`
  - Headline row: see `docs/hook-registry-experiment.md` § "Iteration 3"

### E2: Snippet timeout 180s → 300s
- Date: 2026-05-12
- Goal: Goal 1 (≥ 92% pass)
- Hypothesis: 4 of E1's 9 surviving failures were snippet-runtime
  timeouts on heavy-iteration tasks
  (`dnd-campaign-builder/{e1,e2,h1}`, `university-directory-builder/m2`).
  Each was the heavy-iteration pattern (6+ entities × 4-10 sub-calls
  per entity). The agent was making real progress when killed.
  Raising the timeout to 300s should rescue ≥ 3 of those 4. Generic;
  no family or task awareness.
- Lever: snippet runtime
- Change: bumped default `snippetTimeoutMs` from 180_000 to 300_000
  in `src/eval/skillcraftFullDatafetch.ts` and `src/eval/runScript.ts`.
  Configurable via `DF_SKILLCRAFT_SNIPPET_TIMEOUT_MS` /
  `--snippet-timeout-ms`. Commit `a76e8c65`.
- Probe (dnd-campaign-builder): 5/6 pass vs baseline 2/6,
  +50pp. Three of the four timeout-killed tasks now finish cleanly.
- Validate (univ + jikan): 11/12 vs 11/12, flat. Single regression
  (jikan-anime-analysis/m2 score 0; score variance, not a timeout).
  Probe's +50pp signal so strong we ran full-126 anyway.
- Full-126: **94.4% pass (119/126), 88.1% strict, 0.8% runtime err,
  3,027 avg tokens.** Goal 1 met on all three thresholds
  simultaneously.
- Phase deltas vs E1 (iter3): train **+19.0pp** (now 100% perfect),
  warm +1.1pp, hard -4.7pp.
- Status: **PASSED**, goal cleared.
- Lessons:
  1. Cost: ~15% more tokens/task than E1 (2,618 → 3,027), bought
     +3.1pp pass rate. Worth it on this benchmark; question for next
     goal is whether reuse can recover that token cost.
  2. The train phase going to 100% is partly because the normalize
     artefact from E1 disappears when the agent has more budget and
     does not get SIGTERM'd mid-task.
  3. The 300s budget did NOT regress any task. The hard-phase drop
     (-4.7pp) is one regression (dnd-campaign-builder/h1) that scored
     100 by the evaluator but got demoted to `runtime_error` by
     normalize because of a non-empty stderr line. Counting by
     evaluator alone gives 122/126 = 96.8% on the full-126, within
     0.2pp of the skillcraft-base ceiling.
  4. **Critical finding for the next goal**: `avgReuseRate` and
     `avgLearnedInterfacesCreated` are both **0** on this run because
     every full-126 invocation passed `--no-lib-cache`. The 94.4% was
     achieved without the learning loop firing once. That is the
     entire premise of the next goal.
- Artefacts:
  - Analysis: `eval/skillcraft/reports/iter3-full-20260512-075046-analysis.json`
  - Taxonomy: `eval/skillcraft/reports/iter3-full-20260512-075046-error-taxonomy.json`
  - Headline row: `docs/hook-registry-experiment.md` § "Iteration 4"

### Cross-experiment lessons (Goal 1 retrospective)

- **Forensic stderr / prepared-answer walks paid off.** Both E1 and
  E2 originated from manually inspecting failure stderr instead of
  trusting the error-taxonomy classifier. The classifier's "other"
  bucket and empty-stderr-with-zero-trajectory cases are where the
  interesting substrate gaps hide.
- **Probe → validate → full-126 cadence held up under pressure.**
  When iter2's full-126 was credit-exhausted partway through, the
  probe and validate data we already had let us confidently re-run
  full-126 with the same substrate the next morning rather than
  ablate from scratch.
- **`--no-lib-cache` was an honest scientific choice for Goal 1
  (isolate substrate-level wins from learning-loop wins) but it
  hides the product thesis from the data.** Goal 2 inverts this.
- **The normalize script's `infrastructure_error` heuristic is too
  aggressive** for the harness-boundary SIGTERM case. We did not fix
  it because the goal pinned the score to the analyze output, but
  this is on the substrate roadmap as a measurement bug, not a
  substrate bug.
- **Token budgets are not a constraint at the current operating
  point.** All iterations landed at 2.6k-3.4k effective tokens per
  task; the goal's 8k cap was never threatened. Future iterations
  can spend tokens on quality without budget pressure.

---

## Current goal (Goal 2: learning loop fires)

(See [PLAN.md](./PLAN.md) § Initial direction for E1..E7 seeded
hypotheses. Append new entries here as they execute.)

### E0.5: Instrumentation prelude (per-tier learning-loop rollups)
- Date: 2026-05-12
- Goal: Goal 2 (learning loop fires)
- Hypothesis: the goal's seven thresholds cannot be evaluated from the existing analyze output because it does not roll up `learnedInterfacesAvailable`, `learnedInterfacesCreated`, `reuseRate`, or `effectiveTokens` per tier. Add per-tier rollups + an arm-level `learningLoop` summary so a single `pnpm eval:skillcraft:analyze` run reports the seven numbers needed.
- Lever: analyze script (`eval/skillcraft/scripts/analyze-results.ts`)
- Change: extend `phaseBreakdown` with `avgTokens`, `avgEffectiveTokens`, `avgLearnedInterfacesAvailable`, `avgLearnedInterfacesCreated`, `avgReuseRate`. Add a new `learningLoopSummary` per arm exposing `trainAvgEffectiveTokens`, `warmAvgEffectiveTokens`, `hardAvgEffectiveTokens`, `warmVsTrainEffectiveTokenRatio`, `warmAvgLearnedInterfacesAvailable`, `warmAvgReuseRate`, `trainAvgLearnedInterfacesCreated`, `overallAvgLearnedInterfacesAvailable`, `overallAvgReuseRate`.
- Probe: n/a (analyze-only change; validated by re-running analyze on the iter4 full-126 JSON and confirming the new fields appear with sensible zeros under `--no-lib-cache`).
- Validate: n/a
- Full-126: n/a
- Status: PASSED (pure instrumentation, no substrate change, no risk to pass rate)
- Lessons:
  1. Adding the `learningLoop` aggregate at the arm level avoids forcing every downstream consumer to traverse `phaseBreakdown.warm` and recompute ratios.
  2. Quarantine rate (the seventh goal threshold) is not yet captured in the row schema. Today we count quarantines by grep'ing `<artifact>/episodes/*/datafetch-home/hooks/skillcraft-full/*.json` for `"callability":"quarantined"`. This is a known gap to fix later if quarantine rate becomes a controlling constraint.
- Artefacts: `eval/skillcraft/scripts/analyze-results.ts` diff in current branch

### E1: Baseline with lib-cache enabled (no substrate change)
- Date: 2026-05-12
- Goal: Goal 2 (learning loop fires)
- Hypothesis: turning lib-cache on with the iter4 substrate untouched produces non-zero `avgLearnedInterfacesAvailable` and non-zero `avgReuseRate` on warm, with pass rate within 2pp of iter4's 94.4%.
- Lever: none (config-only: drop `--no-lib-cache` from the runner)
- Change: new `scripts/goal2-full.sh` is `scripts/iter1-full.sh` minus `--no-lib-cache`. Keeps Goal 1's iter4 reproducer runnable.
- Probe (tvmaze-series-analyzer): **6/6 evaluator pass, score 100 across all six levels**, but `libFunctionsAvailable`, `libFunctionsCreated`, and `reuseRate` are **0 on every level**. Warm-tier avg effective tokens 7,792 vs train 7,147; **warm/train ratio = 1.09** (warm is more expensive than train, the wrong direction). Probe dir: `eval/skillcraft/results/datafetch/goal2-iter1-probe-tvmaze-20260512-203818/`.
- Validate: SKIPPED, see Lessons.
- Full-126: SKIPPED, see Lessons.
- Status: **INCONCLUSIVE** (pass rate fine, learning-loop metrics null because the observer is not wired into this harness path)
- Lessons:
  1. **The observer is not installed in the full SkillCraft harness.** `src/eval/skillcraftFullDatafetch.ts` and `src/eval/runScript.ts` both call `installSnippetRuntime` but never `installObserver`. Trajectories are saved (we counted 6 on disk for the e1 episode) but nothing observes them. Every iter1-4 measurement was on the same dead path; `--no-lib-cache` was a redundant flag on a learning loop that was already disconnected.
  2. **The lib-cache promotion path only reads from `workspace/lib/`, not from the observer's `<datafetch-home>/lib/<tenant>/`.** Even if we wire the observer up, its output will not feed the cross-episode cache without also extending `persistFamilyLibCache`. Two changes are required, not one.
  3. **The agent does not spontaneously author `workspace/lib/<helper>.ts` files in e1** even though the prompt template instructs it to. e1 ran 9 raw `df.tool` calls and zero helper writes. The current lib-cache mechanism is essentially "did the agent voluntarily write a helper file?", which is a weak signal.
  4. Skipped validate + full-126 for E1 because the result is mechanically identical to iter4 (no substrate change other than a dropped flag whose feature was already dead). Burning 4 shards × ~60 min to confirm zero on a known-disconnected path is bad ROI.
- Next: E1.5 — wire the observer in + extend persist + re-probe.
- Artefacts:
  - Probe dir: `eval/skillcraft/results/datafetch/goal2-iter1-probe-tvmaze-20260512-203818/`
  - Runner: `scripts/goal2-full.sh`
  - Forensic walk: `EXPERIMENT_NOTES.md` § "2026-05-12 21:05 [analyze, E1 null result]"

### E4 (iter5): Port substrate-mount + seed into new harness (loop wiring lands, agent ignores)
- Date: 2026-05-13
- Goal: Goal 2 (learning loop fires on the full 126-task surface)
- Hypothesis: porting the older harness's per-family `df.db.records` mount + a generic `sc_per_entity` seed into `skillcraftFullDatafetch.ts` makes the new harness's trajectories contain `db.records.findExact -> lib.sc_per_entity` chains, the observer's existing gate fires, helpers crystallise per family, and the agent reuses them in warm episodes. Expected: `avgLearnedInterfacesAvailable` on warm climbs above 1, reuse-rate climbs above 0.30, pass rate stays near iter4's 94.4%.
- Lever: prompt template + harness wiring (df.db mount, __seed__ drop, df.d.ts surface).
- Change:
  1. New `src/eval/evalRecords.ts`: family-agnostic `extractFamilyEntities` (finds the single array-valued top-level key in `initial_workspace/*.json` that isn't `output_file` and normalises to generic `EvalRecord`); `EvalRecordsMount` adapter implementing `findExact / search / findSimilar / hybrid`; `renderPerEntitySeed` returning a body that fans out a configurable `toolBundle`/`toolNames`/`paramName` over an entity list and aggregates results.
  2. `src/eval/skillcraftFullDatafetch.ts`: extract entities from workspace, register `EvalRecordsMount` with `mountId = "skillcraft-<family>"`, pass `mountIds: [mountId]` in `sessionCtx`, drop `sc_per_entity` seed under `<datafetchHome>/lib/__seed__/sc_per_entity.ts`, extend `renderLiveDfDts` to expose `df.db.records` + the seed, unregister the mount after the episode runs.
  3. `src/eval/runScript.ts` (multi-turn probe path): same mount registration on every invocation, ctx.json carries family/mountId/records.
  4. Tried two scaffold variants for `scripts/answer.ts` to nudge the agent toward the new primitives.
- Probe variant A (no scaffold change): 6/6 evaluator pass, scores 80-100, but `libFunctionsAvailable`, `libFunctionsCreated`, `reuseRate` all zero on every level. The agent ignored the new primitives in `df.d.ts` and wrote `df.tool.*` fan-out by hand. The seed is on disk at `<datafetchHome>/lib/__seed__/sc_per_entity.ts`, mount is registered (verified in df.d.ts which exposes `df.db.records`), prompt mentions both, agent went pure-tool anyway. Probe dir: `eval/skillcraft/results/datafetch/goal2-iter5-probe-tvmaze-20260513-065558/`.
- Probe variant B (strong scaffold replacing answer.ts with a primer that calls `df.db.records.findExact` and `df.lib.sc_per_entity` with replace-this-section markers): **3/6 evaluator pass**, scores 0-100, reuse-rate climbed to 0.03-0.06 on three levels (the agent did call `df.lib.*` on those), but **pass rate regressed from 6/6 to 3/6 because the scaffold confused the agent into hybrid code paths**. Probe dir: `eval/skillcraft/results/datafetch/goal2-iter5b-probe-tvmaze-20260513-070444/`. Reverted the scaffold.
- Validate: SKIPPED (probe didn't hit the cadence's "≥1 helper authored in e1, ≥1 helper reused in e2-m2" gate).
- Full-126: SKIPPED.
- Status: **INCONCLUSIVE.** The mount + seed + df.d.ts surface are functioning end-to-end (verified on disk and in df.d.ts), but the claude-sonnet-4-6 agent has a strong prior to write `df.tool.*` fan-out by hand and ignores the new affordances even when present and prompted. The scaffold approach to push it toward `df.lib.sc_per_entity` regressed pass rate.
- Lessons:
  1. **The substrate plumbing is correct.** `df.db.records.findExact()` works, the seed is callable as `df.lib.sc_per_entity({...})`, the observer's gate would fire on a `db.* -> lib.*` chain — but the agent is the rate limiter on whether that chain ever appears in the trajectory.
  2. **The agent prefers familiar primitives over advertised ones.** Goal 1's iterations trained both me and the prompt template into a `df.tool`-only pattern. Surfacing new primitives in df.d.ts and the prompt is not sufficient to flip the pattern; the agent's strong prior dominates.
  3. **Forcing the new primitives via scaffold backfires.** A scaffold that says "call df.db.records.findExact then df.lib.sc_per_entity" produces hybrid code that crashes more than it works. The agent treats the scaffold as advisory and patches in its own pattern around it.
  4. **The proof on the OLD harness still stands.** E3's 6-family pilot (-79% warm tokens, 83% reuse, 100% correctness) used the *codex* agent with prompts that lacked the `df.tool`-fan-out prior — that agent used the new primitives naturally. Claude on the new harness is the harder case because it brings Goal-1's optimised behaviour.
  5. **The right next move is not more prompt engineering.** Three options that actually move this: (a) a commit-phase validator that rejects answer.ts not calling any `df.lib.*`, forcing the agent to use the seed; (b) E7-style sub-graph crystallisation in `src/observer/template.ts` so SkillCraft's pure-tool fan-out trajectories become learnable shapes too; (c) re-run the same single-family probe with the codex driver instead of claude (cheap to test if the agent prior is the only blocker).
- Next: E5 — try (c) first (codex on the new harness with iter5 wiring). If codex uses the new primitives, the gap is purely Claude's prior and fixable with stronger prompt engineering. If codex still ignores them, the prompt-only approach is dead.
- Artefacts:
  - Probe variant A: `eval/skillcraft/results/datafetch/goal2-iter5-probe-tvmaze-20260513-065558/`
  - Probe variant B: `eval/skillcraft/results/datafetch/goal2-iter5b-probe-tvmaze-20260513-070444/`
  - Substrate edits: `src/eval/evalRecords.ts` (NEW), `src/eval/skillcraftFullDatafetch.ts` (mount/seed/df.d.ts wiring around line 530 and 1013, mount cleanup at ~694), `src/eval/runScript.ts` (mount on probe path)

### E5/E6/E7/E8 (iter6-8): codex on new harness + gate numeric signatures + LEARN_FROM_LEVELS relax — loop fires end-to-end
- Date: 2026-05-13
- Goal: Goal 2 (learning loop fires)
- Hypothesis (E5): swap claude for codex on the new harness with iter5 wiring. Codex was the agent for E3's old-harness proof and used the new primitives naturally; if codex uses them here, the iter5 wiring is fine and Claude's strong df.tool prior was the only blocker.
- Lever: agent selection (env), then observer gate (signature heuristic), then promotion gate (LEARN_FROM_LEVELS).
- Change:
  1. **iter6**: re-ran iter5 probe with `DATAFETCH_AGENT=codex`. Confirmed codex uses df.db.records and df.lib.sc_per_entity. e1 trajectory: `db.records.findExact -> 9× tool.tvmaze_api.* -> lib.sc_per_entity`. Score 100 on all 6 episodes. But observer crystallised nothing — `<datafetchHome>/lib/skillcraft-full/` was empty across all episodes. Forensic: the observer's `consumesEarlierOutput` data-flow check rejected the trajectory because `pickSignatures` only emits string-valued fields ≥ 4 chars. The codex agent extracted entityIds (numbers 169, 82, 526) from `attributes.tvmaze_id` and passed them to tool calls; the strings `"169"` etc. are 3 chars and never become signatures, and the bare numeric values weren't either. So a real data flow existed in the trajectory but the gate's substring check couldn't see it.
  2. **iter7 (substrate change `src/observer/gate.ts`)**: extended `pickSignatures` to emit numeric values (>= 2 digits) in both bare and JSON-quoted form, AND to recurse one level into nested object values (covers `attributes: {tvmaze_id: 169}` style records). Re-ran. Observer fired this time: e2's trajectory crystallised `scPerEntity.ts` under `<e2>/datafetch-home/lib/skillcraft-full/`. But the helper didn't reach the cross-episode lib-cache because the persist function only runs for levels in `LEARN_FROM_LEVELS={e1}`, and e1's snippet had crashed with a path-doubling bug (codex hardcoded an absolute path in TARGET_IDS that got resolved relative to the workspace, doubling it).
  3. **iter8 (substrate change `LEARN_FROM_LEVELS`)**: relaxed `LEARN_FROM_LEVELS` from `{e1}` to `{e1, e2, e3, m1, m2}` so any non-hard passing episode promotes its crystallised helper to the family lib-cache. Re-ran. The lib-cache populated: `<probe-dir>/lib-cache/tvmaze-series-analyzer/scPerEntity.ts`. m2 and h1 each saw `libFunctionsAvailable = 1`. Helpers are persisted same-run, observer-crystallised, callable in subsequent episodes.
- Probe (tvmaze-series-analyzer, codex driver, iter8 final state):
  | level | pass | score | eff tokens | helpers avail | reuse | promoted |
  |---|---|---|---|---|---|---|
  | e1 | ✓ | 100 | 63,268 | 0 | 0.00 | yes |
  | e2 | ✗ | 30 | 126,631 | 0 | 0.00 | no |
  | e3 | ✗ | 30 | 79,470 | 0 | 0.08 | no |
  | m1 | ✓ | 100 | 76,712 | 0 | 0.06 | yes |
  | m2 | ✓ | 100 | 97,251 | **1** | 0.06 | yes |
  | h1 | ✗ | 30 | 71,404 | **1** | 0.00 | no |
- Status: **LOOP CONFIRMED FIRING END-TO-END ON THE NEW HARNESS** but the specific codex+iter8 numbers do NOT clear Goal 2's seven thresholds on a single-family probe. Codex effective tokens (60k-130k/episode) exceed the 8k threshold by an order of magnitude; pass rate 3/6 (50%) misses the 92% target; helpers-available warm avg = 0.2 misses the 2.0 target; reuse-rate warm avg = 0.05 misses 0.30.
- Validate: SKIPPED for this iteration (single-family result not strong enough to justify validate or full-126 burn).
- Full-126: SKIPPED.
- Lessons:
  1. **The substrate plumbing for the loop is now complete on the new harness** end-to-end: df.db.records mounted from initial_workspace; sc_per_entity seed dropped under `__seed__/`; observer's gate accepts the resulting db→tool*→lib chain with numeric-signature data-flow detection; promotion fires from any non-hard passing episode; observer-crystallised helpers reach the cross-episode lib-cache and become callable in later episodes.
  2. **Codex on the new harness uses the new primitives naturally but is ~10-20× more expensive per episode than claude.** ~80-130k effective tokens per episode vs claude's 3-8k. The token budget threshold (≤8k) cannot be cleared with codex on tasks of SkillCraft's complexity.
  3. **Claude on the new harness ignores the new primitives even when they're visible in df.d.ts and surfaced in the prompt.** Goal 1's 4 iterations trained the prompt template into a `df.tool`-only pattern that Claude follows. Forcing Claude via the answer.ts scaffold (variant B in E4) regressed pass rate from 6/6 to 3/6. Convincing Claude to use df.db + df.lib requires either (a) a commit-phase validator that rejects answer.ts with no df.lib.* call, or (b) prompt-engineering work that hasn't been done.
  4. **The path forward to ≥2.0 helpers-available on warm is multi-shape crystallisation.** Today the observer produces one helper per family because the shape-hash dedup catches similar trajectories. To get to 2+, either (a) sub-graph crystallisation (E7 in PLAN.md, extract multiple helpers per trajectory), or (b) tasks within a family have distinct enough trajectory shapes that the dedup doesn't collapse them. SkillCraft's e1→h1 progression might produce 2-3 shapes per family naturally on the full 126 surface, worth measuring.
- Artefacts:
  - iter6 probe (codex, gate-pre-fix): `eval/skillcraft/results/datafetch/goal2-iter6-probe-tvmaze-codex-20260513-071957/`
  - iter7 probe (codex, gate-fixed): `eval/skillcraft/results/datafetch/goal2-iter7-probe-tvmaze-codex-gate-20260513-073744/`
  - iter8 probe (codex, gate+promote): `eval/skillcraft/results/datafetch/goal2-iter8-probe-tvmaze-codex-promote-20260513-075808/`
  - Substrate changes: `src/observer/gate.ts` (pickSignatures numeric+nested), `src/eval/skillcraftFullDatafetch.ts` (LEARN_FROM_LEVELS relax)
  - Per-family crystallised helper: `<iter8-probe-dir>/lib-cache/tvmaze-series-analyzer/scPerEntity.ts`

### E2: Old-harness single-family experiment on `country` (proves the loop)
- Date: 2026-05-12
- Goal: Goal 2 (learning loop fires)
- Hypothesis: the older `skillcraftDatafetch.ts` (which mounts `df.db.records`, ships a per-family seed `df.lib.<seedFunction>`, and installs the observer) will fire the learning loop on a single family. Compare baseline (no seed, no observer) vs datafetch (seed + observer) across cold/warm/hard rounds to extrapolate the substrate's seed-value and learning-value contributions.
- Lever: configuration only (no code change). `DATAFETCH_INTERFACE_MODE=hooks-draft` + `pnpm eval:skillcraft:synthetic --live --families=country`.
- Probe: n/a (single-family experiment IS the probe).
- Result on country family (3 rounds per arm, codex `gpt-5.4-mini` agent):
  | Metric | Baseline | Datafetch-Cold | Datafetch-Warm | Delta Warm vs Baseline |
  |---|---|---|---|---|
  | Correctness | 100% | 100% | 100% | +0% |
  | Avg effective tokens | 15,827 | 6,870 | 2,319 | **-85%** |
  | Reuse rate | N/A | 0% | **100%** | - |
  | Regressions | N/A | N/A | 0% | - |
  - Cold trajectory crystallised one observer-authored helper, `scCountryRegionDigest`, wrapping `db.records.search → lib.sc_country_region_digest`.
  - Warm trajectory's primitive sequence: `db.records.search`, `lib.sc_country_region_digest` (seed, called inside the crystallised helper), `lib.scCountryRegionDigest` (the crystallised helper itself, called by the agent).
- First-run gotcha (caught and fixed): without `DATAFETCH_INTERFACE_MODE=hooks-draft`, the registry defaults to `hooks-candidate-only` and exposes crystallised helpers as `not-callable`. Symptom: `Error: df.lib.scCountryRegionDigest: hook is observed only (no callable implementation)`. The crystallised helper *was on disk*; the registry refused to expose it. One env var fix.
- Status: **PASSED.** The substrate's learning loop fires cleanly on `country` when the harness mounts `df.db.records` + ships a seed and the registry runs in `hooks-draft` mode.
- Lessons:
  1. **Seed-value vs learning-value decompose cleanly.** Seed alone reduces cold tokens vs baseline (~half). Learning further reduces warm/hard tokens by ~two-thirds beyond cold. The two effects compose multiplicatively into the -85% headline.
  2. **Goal 2's E1+E1.5 null result was a missing-mount + missing-seed problem, not a gate problem.** The new harness (`skillcraftFullDatafetch.ts`) strips `df.db.records` mounting and seed setup; the old harness retains both. With both in place and `hooks-draft` mode, the existing gate (`src/observer/gate.ts`) fires correctly on the resulting trajectories.
  3. **The user's reframing was right.** Single-family experiments at the pilot scale (3-6 episodes per arm) are enough to extrapolate substrate behaviour, much cheaper than full-126 sweeps and faster to iterate on. Each old-harness single-family run is ~3 minutes wall-clock with the codex driver.
- Next: E3 — run the same setup across all six old-harness families to check the pattern generalises. Then port the missing `df.db.records` mount + seed-drop into the new harness so Goal 1's substrate gains (auto-invoke trailer, 300s timeout) compose with the loop's token gains.
- Artefacts:
  - Probe dir (failed mode): `eval/skillcraft/results/datafetch/goal2-e2-old-harness-country-20260512-213256/`
  - Probe dir (working mode): `eval/skillcraft/results/datafetch/goal2-e2b-old-harness-country-draft-20260512-213649/`
  - Crystallised helper: `<working-probe-dir>/libraries/country/scCountryRegionDigest.ts`
  - Forensic on first-run mode gotcha: stderr at `<failed-probe-dir>/episodes/datafetch/warm/country-warm/stderr.txt`

### E3: Old-harness all-six-families sweep (loop generalises)
- Date: 2026-05-12
- Goal: Goal 2 (learning loop fires)
- Hypothesis: the country-family E2 result was not family-specific. Run the same setup across all six old-harness pilot families to confirm the loop fires across the substrate's full pilot surface.
- Lever: configuration only. `DATAFETCH_INTERFACE_MODE=hooks-draft` + `pnpm eval:skillcraft:synthetic --live` (no `--families` flag, runs all six).
- Result (36 episodes, ~14 min wall-clock, codex `gpt-5.4-mini`):
  | Metric | Baseline | Datafetch-Cold | Datafetch-Warm | Delta Warm vs Baseline |
  |---|---|---|---|---|
  | Correctness | 100% | 100% | 100% | +0% |
  | Evidence recall | 100% | 100% | 100% | +0% |
  | Avg effective tokens | 10,803 | 6,020 | 2,542 | **-79%** |
  | Avg latency (ms) | 31,314 | 20,651 | 11,717 | -63% |
  | Reuse rate | N/A | 0% | **83%** | - |
  | Regressions | N/A | N/A | 0% | - |
  - One crystallised helper per family: `scEconomicSnapshot`, `scBlogUserAnalysis`, `scCountryRegionDigest`, `scProfileDemographics`, `scUniversityDirectory`, `scWeatherRiskSummary`.
  - Per-family reuse on warm: 5/6 at 100%, blog at 0% (one warm-round episode used a different path). Hard: 6/6 at 100%.
  - Regressions: 0% (no warm/hard task scored worse than its baseline counterpart).
- Status: **PASSED.** The substrate's learning loop fires across all six pilot families. Goal 2's seven thresholds, evaluated against this pilot (caveats: smaller surface than full-126; metrics aggregated):
  | Threshold | Target | Observed | Pass? |
  |---|---|---|---|
  | passRate | ≥ 0.92 | 1.00 | ✓ |
  | avgEffectiveTokens (warm) | ≤ 8,000 | 2,542 | ✓ |
  | runtimeErrorRate | ≤ 0.05 | 0.00 | ✓ |
  | avgLearnedInterfacesAvailable (warm) | ≥ 2.0 | 1.00 | ✗ |
  | avgReuseRate (warm) | ≥ 0.30 | 0.83 | ✓ |
  | warmAvgEffectiveTokens / trainAvgEffectiveTokens | ≤ 0.70 | 0.42 | ✓ |
  | quarantine rate | ≤ 0.03 | 0.00 | ✓ |
- Lessons:
  1. **The loop fires reliably on the substrate's intended pattern (db.* → lib.*).** One helper per family is what the observer crystallises today. The shape-hash de-dup means a second helper would only land if a meaningfully different trajectory shape appears, which doesn't happen with the seed-shaped tasks the old harness ships.
  2. **The one miss (`avgLearnedInterfacesAvailable ≥ 2.0`) is structural to today's observer**, not a config issue. To clear it we need either (a) E7-style sub-graph crystallisation (extract multiple sub-helpers from a single trajectory), or (b) tasks that genuinely have multiple distinct composition shapes per family, so the observer learns >1 helper. Neither is necessary to demonstrate "the loop fires"; both are real Goal-2 follow-ons if the headline number `≥ 2.0` is load-bearing.
  3. **Decomposed answer to the user's two-track question:**
     - Seed value: baseline 10,803 → cold 6,020 = **-44% tokens at first use**. Seed lets the agent answer immediately via `df.lib.<seed>` instead of composing in TS.
     - Learning value: cold 6,020 → warm 2,542 = **-58% additional tokens after one observation**. Reuse rate climbs from 0% (cold) to 83% (warm). The observer's crystallised helper is strictly cheaper than the seed alone because it bypasses the cold-round reasoning.
     - Composed: baseline 10,803 → warm 2,542 = **-77%** with correctness held at 100%.
  4. **`hooks-draft` is load-bearing.** Without `DATAFETCH_INTERFACE_MODE=hooks-draft`, the registry exposes crystallised helpers as `not-callable` and the agent crashes when it tries to call one. The mode is a one-env-var fix but easy to miss; new-harness scripts already set it, old-harness scripts don't by default.
- Next: E4 — port the missing `df.db.records` mount and seed-drop into `skillcraftFullDatafetch.ts` so Goal 1's substrate gains (94.4% pass, auto-invoke trailer, 300s timeout, multi-turn probe) compose with this loop. Then re-run on tvmaze and the full 21-family surface.
- Artefacts:
  - Run dir: `eval/skillcraft/results/datafetch/goal2-e3-old-harness-allfams-20260512-214103/`
  - Per-family crystallised helpers: `<run-dir>/libraries/{economic,blog,country,profile,university,weather}/sc<Name>.ts`
  - report.md: `<run-dir>/report.md`

### E1.5: Wire observer + extend persist (no behavioural fix to the gate)
- Date: 2026-05-12
- Goal: Goal 2 (learning loop fires)
- Hypothesis: with the observer wired into the full harness and `persistFamilyLibCache` extended to also pull from the observer's output dir, e1's clean trajectory will pass the crystallisation gate, an authored helper will land in the per-family lib-cache, and e2 will see `libFunctionsAvailable >= 1`.
- Lever: full-harness wiring (`src/eval/skillcraftFullDatafetch.ts` + `src/eval/runScript.ts`) + persist (`persistFamilyLibCache`)
- Change:
  1. `installObserver({ baseDir, tenantId, snippetRuntime })` called immediately after `installSnippetRuntime` in both files (uncommitted).
  2. `persistFamilyLibCache` now reads from both `<workspace>/lib/` and `<datafetch-home>/lib/<tenantId>/`, observer output copied first then workspace-authored helpers (workspace wins on filename collision).
- Probe (tvmaze-series-analyzer): **6/6 evaluator pass, score 100 across all six levels.** `libFunctionsAvailable`, `libFunctionsCreated`, and `reuseRate` STILL all zero on every level. lib-cache directory empty. `<datafetch-home>/lib/skillcraft-full/` empty across all six episodes. `<datafetch-home>/hooks/skillcraft-full/` does not exist (no manifests). Probe dir: `eval/skillcraft/results/datafetch/goal2-iter1p5-probe-tvmaze-20260512-210724/`.
- Validate: SKIPPED, see Lessons.
- Full-126: SKIPPED, see Lessons.
- Status: **INCONCLUSIVE → STRUCTURAL FINDING.** The observer is wired and active; trajectories are saved (3 trajectories per e1 episode, all `mode: novel`, all `errored: false`). The gate's heuristic #5 rejects every single one for the same reason: zero `db.*` calls in the trajectory. The substrate's observer is built to recognise `db.* → lib.*` compositions with data-flow; SkillCraft trajectories are pure-tool fan-out aggregations with no data-flow between primitives.
- Lessons:
  1. **The substrate's learning loop, as architected today, cannot fire on SkillCraft.** The observer's gate (`src/observer/gate.ts`) requires a `db.*` call as the first primitive and a downstream `lib.*` consumer with data-flow. SkillCraft tasks use only `df.tool.<bundle>` calls and structure their work as independent fan-out calls with a shared parameter literal. The gate's heuristics are designed for a different composition pattern than the one this benchmark uses.
  2. **The user-visible behaviour ("agents get cheaper with reuse") has never been demonstrated on this substrate on this benchmark.** All Goal 1 wins (94.4% pass) were achieved by a substrate path that bypasses the learning loop entirely. The substrate's headline value prop is unvalidated on SkillCraft and the architecture in `docs/architecture.md` over-claims what the loop is designed to handle.
  3. The fix is not single-iteration scope. Three paths exist and none is a one-line change. See `EXPERIMENT_NOTES.md` § "2026-05-12 21:20 [analyze, E1.5 null result, structural finding]" for the full taxonomy (Option A: extend the gate for fan-out aggregations; Option B: trim the gate to data-flow only; Option C: pivot to a learning-loop-friendly benchmark; Option D: lean on agent-authored helpers and strengthen the prompt).
  4. Halting the autonomous cadence here. Picking one of the four options is a goal-level decision; user input required.
- Artefacts:
  - Probe dir: `eval/skillcraft/results/datafetch/goal2-iter1p5-probe-tvmaze-20260512-210724/`
  - Wired files: `src/eval/skillcraftFullDatafetch.ts` (line ~9, ~588), `src/eval/runScript.ts` (line ~23, ~149)
  - Extended persist: `src/eval/skillcraftFullDatafetch.ts` `persistFamilyLibCache` ~ line 1078
  - Diagnostic: trajectory inspection at `<probe-dir>/episodes/tvmaze-series-analyzer/e1/datafetch-home/trajectories/` shows 0/3 trajectories have `db.*` calls, 100% are `tool.*` only

### iter9-12: Goal-3 substrate batch (commit-phase validator + sub-graph extractor + df.d.ts re-rank + smoke-replay gate)
- Date: 2026-05-13
- Goal: Goal 3 (generic, code-mode-native, cost-effective learning loop)
- Hypothesis: bundling four substrate levers and running one combined eval is cheaper than per-lever probes, AND the four levers compose so individual gains don't show until they all land.
- Change (all four landed before any eval):
  1. `src/snippet/runtime.ts` + `src/bash/snippetRuntime.ts`: `requireSubstrateRootedChain` flag on SessionCtx. When set and the trajectory has no db.* or lib.* call, rewrite answer to `unsupported` and exitCode=1.
  2. `src/observer/template.ts` + `src/observer/gate.ts` + `src/observer/worker.ts`: sub-graph extractor + relaxed gate for sub-graphs (`subGraph: true`). Observer iterates through whole + sub-graphs and crystallises each that passes its respective gate.
  3. `src/server/manifest.ts`: re-rank df.d.ts entries by (maturity, success count, recency).
  4. `src/hooks/registry.ts` + `src/observer/author.ts`: `smokeReplayAndPromote` does a static-shape match of authored body primitives vs trajectory primitives; promotes to validated-typescript on match, leaves candidate with callable-with-fallback on mismatch.
- Probe: not yet run, pending user approval of Claude API spend for the eval cycle.
- Validate: not yet run.
- Full-126: not yet run.
- Status: **IMPLEMENTATION LANDED, MEASUREMENT PENDING.** 254/254 unit tests pass; typecheck clean.
- Lessons:
  1. **Cadence deviation made consciously.** PLAN's per-iter probe cadence would burn ~$X × 4 levers in token cost before any composite signal is visible. The four levers compose, so a single batched eval is more informative than four sequential probes.
  2. **Sub-graph extractor is bet on whether Claude lifts tool calls to top-level.** With the iter9 validator forcing Claude to use df.lib / df.db, the question is: does Claude write `db.findExact -> lib.per_entity` (whole-trajectory only, iter 10 contributes nothing) or `db.findExact -> tool.A -> tool.B -> ... -> lib.per_entity` (sub-graphs emerge, iter 10 contributes a fan-out helper)?
  3. **Smoke-replay is static-shape, not runtime replay.** Full runtime replay would need the mount + tool bridge active at observer time. The static-shape match (regex-extract primitives from authored source, compare to trajectory primitives) catches all the failure modes we have seen in practice without the side-effect coupling.
- Artefacts:
  - Substrate changes: `src/snippet/runtime.ts`, `src/bash/snippetRuntime.ts`, `src/observer/template.ts`, `src/observer/gate.ts`, `src/observer/worker.ts`, `src/server/manifest.ts`, `src/hooks/registry.ts`, `src/observer/author.ts`, `src/eval/skillcraftFullDatafetch.ts` (prompt + flag).
  - Test additions: `tests/snippet-runtime-phase.test.ts` (+2), `tests/observer-template.test.ts` (+3), `tests/hooks/manifest-rendering.test.ts` (+2), `tests/hooks/hook-registry.test.ts` (+5).
  - Smoke moved: `src/observer/__smoke__.ts` → `src/observer/__smoke__/finqa.ts`.

### iter13: novel-tenant smoke
- Date: 2026-05-13
- Goal: Goal 3 (B, the generic-substrate proof)
- Hypothesis: the four iter9-12 substrate changes ship without any tenant-specific code, so a 5-record synthetic dataset under a new tenant id should let the observer crystallise a helper without any substrate edits.
- Change: new `src/observer/__smoke__/novel-tenant.ts`. Mounts a 5-record book catalogue under `novel-tenant-smoke`, drops a single substrate-level seed `summariseRecords` under `lib/__seed__/`, runs `db.records.findExact -> lib.summariseRecords`, asserts the observer crystallises a helper at `<baseDir>/lib/novel-tenant-smoke/`, then re-runs and asserts the crystallised helper is called.
- Result: **11/11 checks pass.** Observer crystallised `summariserecords` under `<baseDir>/lib/novel-tenant-smoke/`. Second snippet's trajectory call list includes `lib.summariserecords` with zero LLM calls.
- Status: **PASSED.** Goal 3 (B) clears on a 5-record dataset; the substrate's "works out of the box" claim is demonstrable end-to-end.
- Lessons:
  1. **Zero substrate edits required for a new tenant.** Only the test file is new; everything under `src/observer/`, `src/hooks/`, `src/snippet/`, `src/sdk/`, `src/adapter/` is untouched.
  2. **The crystallised helper's input shape mirrors the trajectory's external params, NOT the originating call's input.** First test attempt failed with `SchemaValidationError` because the second snippet passed `{rows}` (the internal binding) instead of `{filter, limit}` (the external params). Documenting because future tenant-onboarding will hit the same gotcha — the public signature is the substrate's contract, not the trajectory's call shape.
- Artefacts:
  - Smoke: `src/observer/__smoke__/novel-tenant.ts`
  - Crystallised file (run-specific): `/tmp/df-novel-tenant-smoke-*/lib/novel-tenant-smoke/summariserecords.ts`
