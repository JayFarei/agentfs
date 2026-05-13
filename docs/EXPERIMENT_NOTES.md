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

---

## 2026-05-12, Goal 2 iteration 1

### 2026-05-12 10:05 [meta, harness check]

Verified `src/eval/skillcraftFullDatafetch.ts`:
- `compareTasks` sorts by family, then by `LEVEL_ORDER = [e1, e2, e3, m1, m2, h1]`. Inside a shard, episodes run family-by-family in level order. That is exactly the canonical learning order Goal 2 requires.
- `hydrateFamilyLibCache` / `persistFamilyLibCache` key the cache directory by family: `<libCacheDir>/<family>/`. So a shard's helpers do not bleed across families, but e1's helpers reach e2 of the same family.
- `LEARN_FROM_LEVELS` is `{e1}` only: helpers are promoted to the lib-cache after a passing e1 episode, not after e2..h1. That biases the substrate towards "learn in train, apply in warm/hard", which is what we want.
- Each episode gets its own `datafetchHome` under the artifact dir. `tenantId` is hardcoded to `skillcraft-full`. So cross-episode state lives in lib-cache, not in `<baseDir>/{lib,hooks}/<tenantId>/`, which is reset to a fresh directory each episode and seeded from the lib-cache.
- Shards run in parallel but are family-disjoint (round-robin split of the 21 families across 4 shards), so the per-family lib-cache directory inside each shard's `<out-dir>/lib-cache` is the only learning substrate that matters.

Conclusion: `scripts/iter1-full.sh` with `--no-lib-cache` removed *is already* a Goal-2-compatible runner. I wrote `scripts/goal2-full.sh` instead of editing iter1-full.sh so Goal 1's exact iter4-reproducer stays runnable for fallback.

### 2026-05-12 10:08 [hypothesis]

E1 hypothesis: with lib-cache enabled, the substrate as-is (Goal 1 iter4 state) will produce non-zero `avgLearnedInterfacesAvailable` on warm, non-zero `avgReuseRate` on warm, and a measurable warm-vs-train token gap. The headline pass rate may regress slightly because warm episodes will spend an extra LLM call deciding whether to use a helper or fall back to raw `df.tool`, but should land within 2pp of iter4's 94.4%.

Quantitative prediction (this is what we are betting):
- pass rate: 92-95% (band around iter4)
- warm `avgLearnedInterfacesAvailable`: 1.0-2.5 (helpers will be authored but not all will be discovered)
- warm `avgReuseRate`: 0.10-0.30 (some reuse, but not at the goal threshold; this is the gap E2-E6 close)
- warm/train effective tokens ratio: 0.75-0.95 (helpers reduce warm tokens but not by 30% from one shot)
- quarantine rate: 1-4% (some authored helpers will fail at runtime; the registry will quarantine them)

If the warm token ratio is already <0.70 in E1, the goal is essentially met and the remaining work is making the helper-creation rate more reliable.

If `avgLearnedInterfacesAvailable` is near zero on warm, the gap is *crystallisation rate* (the observer is not authoring helpers, not just that the agent is not finding them). That changes the next hypothesis.

### 2026-05-12 10:10 [implement, instrumentation prelude]

Patched `eval/skillcraft/scripts/analyze-results.ts` to add per-tier learning-loop rollups in `phaseBreakdown` and an arm-level `learningLoop` summary including `warmVsTrainEffectiveTokenRatio`, `warmAvgLearnedInterfacesAvailable`, `warmAvgReuseRate`. Goal exit criteria are now computable directly from the analyze output.

Did not add a quarantine-rate metric to analyze yet. The per-episode row does not carry a quarantine flag; today's only way to count quarantines is to grep `<artifact>/episodes/*/datafetch-home/hooks/<tenant>/*.json` for `"callability":"quarantined"` after the run. Will do that as a one-off bash pipeline after the full-126 lands and decide whether to wire it into the harness based on what we see.

### 2026-05-12 10:12 [probe]

Kicking off the single-family probe on tvmaze-series-analyzer with lib-cache enabled. tvmaze was Goal 1's probe family for E1; using the same family makes the lib-cache-on vs lib-cache-off comparison clean.

Probe command, single-family, no substrate change beyond removing `--no-lib-cache`. Expect: helpers authored in e1 (train), some reused in e2/e3/m1/m2 (warm), and h1 either consumes or ignores them.

### 2026-05-12 21:05 [analyze, E1 null result]

Probe finished cleanly. **All six levels passed evaluator at 100%.** That is the headline. Now the *finding*:

```
e1: tok=7147 eff llmCalls=37 libAvail=0 libCreated=0 reuse=0
e2: tok=8082 eff llmCalls=29 libAvail=0 libCreated=0 reuse=0
e3: tok=13302 eff llmCalls=45 libAvail=0 libCreated=0 reuse=0
m1: tok=5484 eff llmCalls=13 libAvail=0 libCreated=0 reuse=0
m2: tok=4300 eff llmCalls=8 libAvail=0 libCreated=0 reuse=0
h1: tok=3054 eff llmCalls=7 libAvail=0 libCreated=0 reuse=0
```

Warm-tier avg eff tokens: 7792. Train: 7147. Ratio: 1.09. Warm is *more expensive* than train, not less. The learning loop did not fire at all. Zero helpers authored, zero crystallised, zero reused, zero in the persistent `<probe-dir>/lib-cache/`. Forensic walk:

- `<e1>/workspace/lib/` contains only `README.md`. Agent wrote no helpers there.
- `<e1>/datafetch-home/lib/skillcraft-full/` is empty. Observer wrote nothing there.
- `<e1>/datafetch-home/hooks/skillcraft-full/` does not exist. Observer did not register a single hook.
- `<e1>/datafetch-home/trajectories/skillcraft-full/` contains 6 trajectory JSONs. So trajectories ARE being recorded (snippet runtime is doing its job); they are just never read by an observer.

The smoking gun is in `src/eval/skillcraftFullDatafetch.ts`. The harness calls `installSnippetRuntime` (line 583) but never calls `installObserver`. Same for `src/eval/runScript.ts` (the multi-turn probe path). Grep confirmed: `installObserver` is wired in `src/cli.ts`, `src/server/server.ts`, `src/demo/runDemo.ts`, and the legacy `src/eval/skillcraftDatafetch.ts`, but NOT in the path the SkillCraft full-126 actually runs through.

So the substrate's headline learning loop has never had a chance to fire in any iter1..iter4 measurement. Goal 1's `--no-lib-cache` was a redundant kill switch on a path that was already dead. Goal 2's E1 is the first time anyone actually measured this, and what it measured is: the path is dead because nobody plugged it in.

This is a substrate bug, not a measurement workaround. The fix is one `installObserver({ baseDir: datafetchHome, tenantId, snippetRuntime })` call in `skillcraftFullDatafetch.ts` right after the snippet runtime install, and a matching call in `runScript.ts`. Wave 4's `installObserver` API expects exactly that and is idempotent.

The second gap is independent of the observer wiring: the *agent itself* didn't author any helpers in `workspace/lib/` during e1, even though the prompt template instructs it to. The harness's lib-cache promotion reads from `workspace/lib/`, not from the observer's `datafetch-home/lib/<tenant>/`. So even if the observer fires, its output does not feed the lib-cache today, because the persist step looks in the wrong place.

Two paths forward, both substrate-touching:

- **E1.5 (path A):** Install the observer in the full harness, AND change `persistFamilyLibCache` to also pull from `<datafetch-home>/lib/<tenantId>/`. Now observer-crystallised helpers reach the cross-episode cache.
- **E1.5 (path B):** Beef up the agent prompt so it actually writes `lib/<helper>.ts` in e1. Keep the current lib-cache plumbing. Observer remains decorative.

Path A is the architecture-as-documented. Path B is the lighter touch but trades on prompt engineering, which is fragile and the spec discourages dataset-specific branching. Going with path A. The substrate change is minimal: one wiring call + one extra source dir in persist.

Skipping E1's formal validate + full-126 sweep. The null result is what it is: identical to iter4 (94.4%) on the learning-loop metrics (all zero). Burning 4 shards × 60 minutes to confirm zero is bad ROI. Recording E1 in EXPERIMENTS.md as INCONCLUSIVE with the wiring finding, then advancing straight to E1.5.

### 2026-05-12 21:08 [hypothesis, E1.5]

E1.5: install the observer and make crystallised helpers reach the lib-cache. Two-line code change to wire, plus a slightly bigger change to extend persist. Single-family probe re-run on tvmaze should produce:
- At least one helper crystallised after e1 (the observer's gate passes if there are >=2 distinct primitives + at least one data-flow edge; the e1 trajectory had 9 tool calls with data flow from one call's output into the next, so this should pass the gate)
- That helper visible in e2 as `libFunctionsAvailable >= 1`
- Some reuse rate non-zero on e2..h1 if the agent prompt nudges it to use df.lib when one matches

If the observer's gate rejects all 6 trajectories even after wiring, the next move is to look at the gate code. If the observer crystallises but the agent ignores the new df.lib helper, that lands us in E6 (discovery surface ranking) territory.

Either way, E1.5's probe will produce something non-zero, or it will explain exactly which gate is too strict. Both outcomes are useful.

### 2026-05-12 21:20 [analyze, E1.5 null result, structural finding]

Probe finished cleanly. Six episodes, all passing. **Still zero on every learning-loop metric.** lib-cache directory empty, `<datafetch-home>/lib/skillcraft-full/` empty across all six episodes. No hooks/skillcraft-full/ directory created. Same shape as E1 except the wiring is now in place.

Diagnosis: the observer's gate rejects every trajectory. Read of `src/observer/gate.ts` heuristic #5:

```
if (firstDbIdx === -1) {
  return { ok: false, reason: "no db.* call present; observer requires a substrate-rooted chain" };
}
```

Then it requires a downstream `lib.*` call AFTER the first `db.*` call, with `consumesEarlierOutput` data-flow.

Now the SkillCraft trajectory reality, confirmed by inspecting the three e1 trajectories on disk:

```
traj A: 3 calls, prefixes={tool}
traj B: 3 calls, prefixes={tool}
traj C: 9 calls, prefixes={tool}
```

Every call is `tool.<bundle>.<name>`. Zero `db.*`. Zero `lib.*`. SkillCraft tasks are pure-external-API queries; the substrate's `df.db.*` namespace is not used at all. The observer's gate is structurally incompatible with SkillCraft's trajectory shape.

This is not a one-line fix. Three architectural facts compound:

1. **Heuristic #5 requires `db.*` as first call.** SkillCraft has none. Relaxing this to `tool.* OR db.*` is one line, but not enough on its own.

2. **Heuristic #5 also requires a downstream `lib.*` consumer.** SkillCraft trajectories use no `lib.*` because the lib-cache starts empty and no helper has ever been authored. This is the chicken-and-egg: helpers can't be observed until helpers exist, and they exist only if the agent authors them, which it doesn't.

3. **The data-flow check (`consumesEarlierOutput`) wants one call's input to reference an earlier call's output.** SkillCraft trajectories are fan-out aggregations: `tool.tvmaze_api.get_show_info({show_id: 169})`, `tool.tvmaze_api.get_show_episodes({show_id: 169})`, etc. The shared `show_id` is a LITERAL in the agent's JS, not a value piped from a previous call's output. The data-flow check fails by design.

In other words: the substrate's observer recognises one specific composition pattern, `db.query → lib.transform → ...`, and was never designed to learn fan-out aggregation across pure-tool calls. That pattern is what every SkillCraft task uses.

This finding is the most important thing E1+E1.5 produced. Three options I can see:

**Option A: Relax the gate to learn from fan-out aggregations.** Substantive substrate work. Need a new template extractor that recognises "same parameter shape across N independent tool calls, results assembled into a record". Also need to ensure the conservative gate still rejects garbage (n=1 single tool calls, error-path trajectories, etc.). This is days of work, not hours.

**Option B: Strip the gate's "must be `db.*`" and "must have downstream `lib.*`" requirements, keep only the data-flow check.** Then it learns from `tool → tool` chains with real data-flow. Doesn't help with fan-out aggregations (no data-flow there), but would surface a real learning surface on a different benchmark where the agent does use tool outputs as inputs to subsequent tool calls. Not a SkillCraft-friendly fix.

**Option C: Accept that SkillCraft is the wrong benchmark for the learning loop and pivot Goal 2.** The substrate's headline value prop, "agents get cheaper with reuse", needs a benchmark whose trajectories are composable in the pattern the substrate actually learns. Candidate: a synthetic benchmark where the agent first queries a mounted `df.db.docs` dataset, then composes results via helpers. Build it small (10-20 tasks) and demonstrate the loop fires there.

**Option D: Lean on the agent-authored path.** Workspace `lib/<helper>.ts` files persist via `persistFamilyLibCache` already, without going through the observer's gate. If the agent writes helpers in e1, they survive into e2..h1. The substrate ships an unused prompt hint about this; if we strengthen it, we can demonstrate cross-episode reuse without touching the observer. Risk: violates the spirit of "observer-crystallised from agent attempts" — the agent is doing both attempts AND crystallisation, and the substrate is just a file shuttle.

I've been working autonomously through Goal 2's first two iterations and produced a fundamental finding: **the learning loop, as architected, cannot fire on SkillCraft.** Stopping the autonomous cadence here. Surfacing this to the user with a clear summary and the three options. The right call is theirs.

### 2026-05-12 21:25 [meta, what we know now]

Concrete evidence for the finding (in case future-me reviews this):

- `src/observer/gate.ts` heuristic #5: `if (firstDbIdx === -1) return {ok:false, reason: "no db.* call present"}`
- Trajectory inspection: 0/3 e1 trajectories on `tvmaze-series-analyzer` have any `db.*` call; 100% are `tool.*` only
- Observer wired correctly: `installObserver` is now in `src/eval/skillcraftFullDatafetch.ts` and `src/eval/runScript.ts` after `installSnippetRuntime`
- Persist extended: `persistFamilyLibCache` now reads from both `<workspace>/lib/` and `<datafetch-home>/lib/<tenant>/`
- Even so, both are empty after e1 because the gate rejects all trajectories.

Things tried and ruled out:
- Wiring observer (E1.5): necessary, not sufficient
- Extending persist (E1.5): necessary if observer ever produces output, but observer produces nothing

Things not tried:
- Relaxing the gate (would need careful work to avoid false-positive crystallisations)
- Strengthening the agent prompt to author helpers (path D, simple but spec-questionable)
- Switching to a learning-loop-friendly benchmark (path C, biggest pivot)

### 2026-05-12 21:35 [analyze, correction to E1.5 finding]

User flagged that the loop has fired on SkillCraft before in prior runs. They are right. The prior `eval/skillcraft/reports/full-126-datafetch-report.md` (2026-05-10) and the `hooks-exp-20260511-123500-hooks-draft-analysis.json` both show non-zero learning-loop metrics:

```
full-126-datafetch-report (2026-05-10):
  pass 71%, avgEffectiveTokens 18,076, avgReuse 0.171, runtime errors 14%
  per-phase: train n=21 reuse 0.184, warm n=84 reuse 0.185, hard n=21 reuse 0.103

hooks-exp hooks-draft (2026-05-11, same DATAFETCH_INTERFACE_MODE we use now):
  pass 71%, avgEffectiveTokens 14,864, avgReuse 0.171, avgLearnedInterfacesAvailable 0.278,
  avgLearnedInterfacesCreated 0.484, runtime errors 24%
```

So my "structurally incompatible" framing was wrong. The loop fires on SkillCraft trajectories under *the right harness setup*. The setup I was running through (`src/eval/skillcraftFullDatafetch.ts`) is a NEWER harness that was introduced for the Goal-1 hill climb and strips three things the loop relies on:

1. **`df.db.records` mount.** The older harness `setupSnippetHarness` (line 871 of `src/eval/skillcraftDatafetch.ts`) constructs an `EvalMountAdapter` per family from the SkillCraft records and registers it as `df.db.records`. Implements `search`, `findExact`, `findSimilar`, `hybrid`. Trajectories therefore have `db.records.search(...)` calls as their first primitive. The new harness has no `df.db` mount; the agent only sees `df.tool.<external_api>`.

2. **Pre-seeded `df.lib.<seedFunction>` per family.** Older harness calls `writeSeedFunctions(baseDir, [spec.seedFunction])` (line 874) BEFORE the first episode. Drops one generic aggregation helper at `<baseDir>/lib/__seed__/<name>.ts` with input shape `{query, family, entities, analysis, rows}`. Every trajectory contains `df.lib.<seed>({...})` as a substrate-rooted downstream call.

3. **Prepared answer.ts template that wires both together.** Lines 1140-1147 and 1813 of the older harness emit `const summaryResult = await df.lib.<seed>({query, family, entities, analysis, rows: <db output> });`. The agent fills in the query/entities/analysis fields. Trajectory shape is therefore by construction `db.records.search -> lib.<seed>(consumesEarlierOutput)`, which is exactly what `gate.ts` heuristic #5 is built to match.

So the loop fires on SkillCraft *under the older harness because the older harness pre-shapes the trajectory*. The newer harness was a clean-slate rewrite that traded the substrate-rooting (and therefore the loop) for higher pass rate (94.4% vs 71%) and lower tokens (~3k vs 18k effective). Goal 1 measured pass rate only; nobody noticed the loop went silent.

Goal 2 needs the loop to fire. Two clean ways to get there from here:

**Restore the older harness's substrate-mount + seed setup INSIDE the newer harness.** Mount `df.db.records` of each family's fixtures, drop one seed helper per family before episode 1, give the agent both a `df.db.records.search` example and the `df.lib.<seed>` invocation in the prompt template. Should reproduce the 0.17 reuse rate of the prior run, on top of the Goal-1 substrate's improvements (auto-invoke trailer, 300s timeout, multi-turn probe).

**Use the older harness directly.** `pnpm` likely has a script or we can wire one. It will run slower per episode and at the lower pass rate, but the loop will fire and the goal's seven metrics will be measurable.

The first path keeps Goal 1's headline win and adds the loop on top. The second path is the established pre-existing setup with known numbers. I lean strongly toward the first because Goal 1's iter4 wins (94.4% pass with auto-invoke trailer + 300s timeout) shouldn't be discarded; the learning loop should be additive to them.

**Important constraint to re-check with the user.** Goal 2's forbidden-behaviours list says: "Pre-baked seed helpers under `seeds/<tenantId>/` or `<baseDir>/lib/<tenantId>/` shipped to disk before episode 1 of the run". The older harness ships seeds under `<baseDir>/lib/__seed__/<name>.ts`, NOT under `<baseDir>/lib/<tenantId>/`. So technically not in violation if we replicate the older path: seeds go to `<baseDir>/lib/__seed__/`, which is a *separate* directory the resolver searches but is not the tenant's own lib. Worth a verbatim user check before proceeding because the spirit of the prohibition (no helpers shipped to disk before episode 1) IS in tension with what the older harness does.

### 2026-05-12 21:42 [meta, where I went wrong]

I jumped to "structurally incompatible" without first reading the prior reports the codebase has on disk. Two reports of the loop firing were sitting in `eval/skillcraft/reports/` and I never looked at them. PLAN.md's seeded hypotheses (E1..E7) all assumed the gate could fire on the current harness; that assumption was wrong, and an hour of prior-report-reading would have caught it before the first probe. Lesson: when the substrate has documented prior runs of the thing you're trying to do, read those reports first, even when the harness path looks plausibly correct from the code alone.

### 2026-05-12 21:38 [analyze, E2 result, loop fires cleanly on country]

Old-harness single-family run on `country` with `DATAFETCH_INTERFACE_MODE=hooks-draft`. Three minutes wall-clock. Results, baseline arm (no seed, no observer) vs datafetch arm (seed + observer):

```
                  Baseline    Datafetch-Cold    Datafetch-Warm    Warm delta vs baseline
Correctness       100%         100%              100%              +0%
Evidence recall   100%         100%              100%              +0%
Avg eff tokens    15,827       6,870             2,319             -85%
Avg latency       36,052ms     36,097ms          12,468ms          -65%
Avg agent cmds    7             9                 1                 -86%
Reuse rate        N/A           0%                100%              -
Regressions       N/A          N/A                0%                -
```

`avgEffectiveTokens` on warm dropped -85% relative to baseline. Reuse rate on warm AND hard 100%. The observer crystallised one helper after cold (`scCountryRegionDigest`, the typed wrapper around `db.records.search -> lib.sc_country_region_digest`), and the warm-round agent called it directly.

The warm trajectory's `callPrimitives` shows what happened:
```
#0 db.records.search
#1 lib.sc_country_region_digest    <- the seed
#2 lib.scCountryRegionDigest        <- the observer-crystallised helper
```

The seed is called *inside* the crystallised helper's body, plus the agent calls the crystallised helper at the top. So both the seed and the observer's crystallised output are exercising in the same warm episode.

### 2026-05-12 21:40 [analyze, comparison to prior null E2 run]

The first E2 run (without `DATAFETCH_INTERFACE_MODE=hooks-draft`) defaulted to `hooks-candidate-only`, which exposes the crystallised helper as `not-callable`. The agent picked it from `apropos` and tried to call it, but the registry threw:

```
Error: df.lib.scCountryRegionDigest: hook is observed only (no callable implementation).
Interface mode is "hooks-candidate-only"; the registry will not expose this learned
interface as callable.
```

The helper was crystallised on disk (`libraries/country/scCountryRegionDigest.ts`) just like in the successful run; the difference was purely a registry exposure decision keyed off the mode env var. Setting the mode to `hooks-draft` (which is what every prior successful run used, including Goal 1 iter1-4 in the new harness) immediately fixed it.

This is a *configuration* issue, not a substrate issue. The substrate has been working all along. The cleanup we need:

- The Goal-2 work today added `installObserver` to the new harness path; that wiring is still correct and stays.
- The new harness still lacks the `df.db.records` mount and the seed-helper drop step. Both are required to give the observer a substrate-rooted chain to learn from. Port from old harness to new.
- The mode env var (`DATAFETCH_INTERFACE_MODE=hooks-draft`) must remain set; Goal-1 scripts have it, my goal2-iter1 runs had it too (so the absence of the loop in iter1 was the missing `df.db` + seed, not the mode).

So the actual remaining work for Goal 2 is:
1. Port `df.db.records` mount + seed-function setup from `skillcraftDatafetch.ts` into `skillcraftFullDatafetch.ts`. Roughly: family records loaded from `task_config.json`, registered as `df.db.records` per-tenant via the existing `EvalMountAdapter`; seed function rendered + dropped under `<datafetchHome>/lib/__seed__/<name>.ts` before episode 1.
2. Update the agent prompt template to teach the new primitives: `df.db.records.search(...)` is the first call; if `df.lib.<seed>` exists call it; if a learned helper is available prefer it over the seed.
3. Re-run goal2 single-family probe (tvmaze-series-analyzer) on the new harness. Expect the loop to fire there too. The pass-rate gains from auto-invoke + 300s timeout should compose with the loop's token-efficiency gains.

The seed-vs-learning question the user asked is now cleanly answered for `country`:

- **Seed value:** ~half the token cost in cold (6,870 vs baseline 15,827; -57% on the very first warm-style task). The seed gives the agent a substrate-rooted way to answer immediately and the cold-round trajectory becomes a clean learning input.
- **Learning value:** another -66% in warm and hard (2,319 vs cold 6,870), correctness held at 100%, reuse rate 100%. The observer's crystallised helper is *strictly cheaper* than the seed alone because it bypasses the cold-round agent reasoning.

These compose. Without the seed, cold is ~baseline cost; without the learning loop, warm/hard are ~cold cost. With both, warm is -85% of baseline.

### 2026-05-12 21:42 [hypothesis, E3 plan]

Run the same experiment across the old harness's other 5 families (economic, blog, profile, university, weather) to confirm the country result generalises. Approx 15 minutes for all six.

If five out of six families show the same pattern (loop fires, ~100% reuse, warm/hard tokens 30-50% of baseline), the substrate-level proof is solid. Then port the substrate-mount + seed-drop to the new harness and run goal2-full there.

If the pattern breaks on certain families (e.g., very small `df.db.records` corpora, or seed function returning poorly-typed payloads), that's a separate fix point and the EXPERIMENT_NOTES log captures the family-specific reason.
