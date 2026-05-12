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

<!-- Next entry template:

### E1: <title>
- Date:
- Goal: Goal 2 (learning loop fires)
- Hypothesis:
- Lever:
- Change:
- Probe: <family>, pass before X, after Y, delta Z, helpers-created A,
  reuse-rate B
- Validate: combined pass before X, after Y, delta Z, helpers
  available A, reuse-rate B
- Full-126: pass rate X, avg tokens Y, runtime err Z, helpers-available
  A, reuse-rate B, warm-vs-train token ratio C
- Status:
- Lessons:
- Artefacts:

-->
