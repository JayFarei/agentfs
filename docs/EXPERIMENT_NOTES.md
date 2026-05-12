# Experiment notes (scratchpad)

> Chronological scratchpad. Real-time thoughts during goal mode. Lower
> bar to entry than EXPERIMENTS.md, much higher information density on
> what the agent was *thinking*, not just what the agent did. Use this
> file to audit reasoning and nudge direction if it drifts.

## Format

```
## YYYY-MM-DD HH:MM [stage]
<free-form note. include surprise, dead-ends, open questions, hypotheses
that didn't make it into PLAN.md, things that nagged at us. Keep it raw.>
```

Stages roughly map to:
- `hypothesis` (forming the iteration's hypothesis)
- `implement` (writing code)
- `probe` (running the single-family probe)
- `validate` (running the held-out pair)
- `full-126` (running the full surface)
- `analyze` (looking at results)
- `commit` (writing up + committing)
- `meta` (anything cross-cutting: process, tooling, plumbing)

---

## 2026-05-12, Goal 2 setup

### 2026-05-12 09:30 [meta]

Goal 1 cleared at 94.4% with `--no-lib-cache`. The headline number is
good but the substrate's learning loop has never been measured on
this benchmark. Every full-126 run we shipped had reuse disabled.
That is what Goal 2 attacks.

Single most important pre-Goal-2 finding from the iter4 analyze JSON:

```
avgLearnedInterfacesAvailable: 0
avgLearnedInterfacesCreated:   0
avgReuseRate:                  0
```

These are zero because `--no-lib-cache` short-circuits the observer's
write path and clears the `df.lib` registry between episodes. The
substrate is technically correct (those numbers are honestly zero on
that run), but the product thesis is unvalidated.

### 2026-05-12 09:35 [hypothesis]

E1 in PLAN.md is "turn the flag on, run sequentially, see what falls
out." That is the right first move. No substrate change. Pure
measurement. The first new EXPERIMENTS.md row we write should be that
baseline.

Open question: how do we make the four shards run families
sequentially while still parallelising across shards? Today each
shard is given a comma-separated `--families` list and the harness
iterates within. We need the lib-cache directory to be *per family*,
not per shard, so e1's helpers are visible to e2 / e3 / m1 / m2 / h1
of the same family. Either:
- Shard the families, then within each shard run families serially
  with their own `libCacheDir`. Slow.
- Spin up one process per family (21 processes) sharing a smaller
  thread pool. More machinery but families isolate naturally and
  reuse is clean within a family.

Need to look at how `libCacheDir` is currently scoped in
`src/eval/skillcraftFullDatafetch.ts`. From the earlier scan it
looked like one dir per `--out-dir`, which means *all* families in
the shard would share one cache. That probably contaminates families
across each other in a way the eval was not designed to test. Worth
verifying before E1 runs.

### 2026-05-12 09:40 [meta, dead-end watch]

Pitfall to avoid: defining "reuse rate" loosely. The eval's
`avgReuseRate` is computed from `libCalls / (libCalls + toolCalls)`
in `lib-status.json`. That is fine but it counts every `df.lib.<name>`
call equally, regardless of whether the helper is a substrate-
crystallised helper or a hand-curated seed. For Goal 2 to mean
anything, the run must start with `<baseDir>/lib/<tenantId>/` empty
per the constraint list. Reuse must be of helpers the observer
crystallised during the same run, full stop.

If we discover the harness preloads helpers in a way we did not
intend, that is a substrate bug, not a measurement workaround.

### 2026-05-12 09:45 [meta, tooling needed]

For the per-tier breakdown table the goal requires, we need:
- helpers-available per task (already on `lib-status.json`)
- helpers-used per task (already on `lib-status.json`)
- reuse-rate per task (already)

These are not currently rolled up by tier in `analyze-results.ts`.
That script only emits an overall `avgLearnedInterfacesAvailable` etc.
across the whole arm. Adding tier-grouped rollups is a one-function
change to analyze; doing it before E1 is the right move so the goal's
exit criteria are computable directly from the analyze output.

This is essentially a "land a small instrumentation patch before the
first real experiment" move. Worth a separate, clearly-marked entry
in EXPERIMENTS.md as E0.5 or "instrumentation prelude". Keep it
mechanically obvious; nothing about the learning loop should depend
on this patch, only the *visibility* into the learning loop.

### 2026-05-12 09:50 [meta, scope discipline]

Watch out for the temptation to add a new metric every iteration.
The goal pins seven metrics; do not let the iteration drift into
"and we should also measure X" unless X is genuinely missing from
the seven. Every new metric is a new place for a future iteration to
get lost.

Things that look like metrics but aren't goal-meaningful:
- "Helpers' average lifespan" (interesting but not goal-blocking)
- "Diversity of learned helpers across families" (interesting,
  out of scope)
- "Token cost per helper invocation vs per LLM call" (compelling
  for the website, not for the eval)

Park those for a post-goal write-up.

### 2026-05-12 09:55 [hypothesis, E2 preview]

If E1 shows hooks crystallising but quarantine rate above 5%, jump
straight to E2 (smoke-replay gate). If E1 shows hooks crystallising
but `avgLearnedInterfacesAvailable < 2.0` on warm, the gap is
discovery, not trust, so jump to E6 (discovery surface ranking) and
maybe E3 (observed-only hooks) before touching the registry.

The E1 result is what decides which branch we are on.

### 2026-05-12 09:57 [meta]

This file is the audit trail. Skim it before each new iteration.
Reasoning that turned out to be wrong is just as useful as reasoning
that turned out to be right.
