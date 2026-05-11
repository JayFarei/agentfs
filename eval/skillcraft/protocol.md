# Protocol

## Hypothesis

Datafetch learned interfaces are useful if, on held-out repeated SkillCraft
tasks, they match native SkillCraft skill-mode correctness while reducing
effective tokens, latency, cost, and low-level tool calls.

## Unit Of Comparison

The paired unit is a SkillCraft task directory:

```text
tasks/scaled_tasks/<family>/<level>
```

Every included task is run through each benchmark arm. Pairing avoids treating
different families or difficulty levels as interchangeable.

## Learning Schedule

For each family:

- `e1`: cold creation episode. Datafetch may create a learned interface. Only
  passed `e1` episodes are promoted into the family `lib-cache/` for primary
  held-out analysis.
- `e2`, `e3`, `m1`, `m2`: held-out warm reuse episodes.
- `h1`: hard generalization episode.

Warm and hard claims must not be reported from the same task that created the
interface. If a warm/hard episode creates and uses a fresh helper, report that
as within-episode composition rather than cross-episode learned-interface reuse.

## Primary Endpoint

Primary correctness is the official SkillCraft evaluator result for the task:

- pass/fail at SkillCraft's `passed` threshold (`score >= 70`)
- strict pass status (`status == "pass"`, typically `score >= 90`)
- score percent
- evaluator status

Datafetch `df.answer(...)` validation is secondary and cannot replace the
official evaluator for full-benchmark claims.

## Secondary Endpoints

- total tokens
- effective or uncached tokens
- cost
- wall-clock latency
- total tool calls
- SkillCraft skill save/use calls
- Datafetch learned-interface calls
- Datafetch replay regression rate

## Statistical Analysis

Use paired analysis:

- Binary pass rate: McNemar-style discordant counts and paired bootstrap
  confidence intervals.
- Score and efficiency metrics: paired bootstrap confidence intervals on mean
  deltas and ratios.
- Three-arm comparisons: predeclare Datafetch warm vs SkillCraft base and
  Datafetch warm vs SkillCraft skill; use Holm correction when testing both.
- Block summaries by family and level.

Do not count repeated stochastic reruns as independent tasks. If reruns are
used, report them as robustness checks.

## Fairness Controls

All arms should use the same model, provider, temperature, top-p, context limit,
timeout, retry policy, concurrency, and network/API access unless a difference
is explicitly part of the tested intervention.

Provider-side prompt caching must be reported separately. Primary cost claims
should use uncached/effective tokens when available.
