# Plan: prove the learning loop fires on SkillCraft

> Living document. Update when direction shifts. Companion files:
> [EXPERIMENTS.md](./EXPERIMENTS.md) (curated results) and
> [EXPERIMENT_NOTES.md](./EXPERIMENT_NOTES.md) (chronological scratchpad).

## Goal

Reach the iter4 pass rate (≥ 92% pass ≥ 70 on the full SkillCraft
126-task surface) on a single, sequentially-ordered, lib-cache-enabled
run, AND demonstrate that the substrate's learning loop is doing
measurable work, measured from a fresh `pnpm eval:skillcraft:analyze`
output.

Pass conditions (all must hold simultaneously on the latest full-126):

- `arms["datafetch-learned"].passRate` ≥ 0.92
- `arms["datafetch-learned"].avgEffectiveTokens` ≤ 8,000
- `arms["datafetch-learned"].runtimeErrorRate` ≤ 0.05
- `arms["datafetch-learned"].avgLearnedInterfacesAvailable` averaged
  over the warm tier (n=84) ≥ **2.0**
- `arms["datafetch-learned"].avgReuseRate` averaged over the warm
  tier ≥ **0.30**
- **Warm-tier average effective tokens ≤ 70% of train-tier average**
  effective tokens on the same run (the "gets cheaper with reuse"
  claim, as a number)
- Quarantine rate (episodes with `hook_quarantined` stderr) ≤ 0.03
  across the full 126

Stop conditions: any of the above holds, OR 8 accepted iterations,
OR 24 hours elapsed.

## Why this goal

Every iter1-4 full-126 run was launched with `--no-lib-cache`. We
reached 94.4% pass with the learning loop deliberately disabled. The
substrate's headline value proposition, "agents get cheaper and
smarter with reuse", has never been validated end to end on a public
benchmark. Pass rate alone is not the right metric anymore. The right
metric is the *differential* between train-tier cost and warm-tier
cost on a single run where the observer was allowed to crystallise
helpers in train and the agent was allowed to call them in warm.

If we hit this goal, the website's claim becomes a number anyone can
reproduce. If we cannot hit it, that is itself an important finding
about what is broken in the substrate's learning path and exactly the
kind of thing the substrate roadmap needs to fix before client
release.

## Initial direction (seeded ideas, priority ordered)

The first experiment is "turn the flag on and measure". Do not change
the substrate. Run the existing iter4 stack with `lib-cache` enabled
and family-sequential execution, and see what falls out. Treat that
output as the new baseline. Everything after that aims to close the
gap between that baseline and the goal thresholds.

### E1, baseline with lib-cache on (no substrate change)

The hill-climb scripts use `--no-lib-cache`. Remove that flag from
`scripts/iter1-full.sh`. The harness already supports per-tenant
`libCacheDir` and the observer already runs on `onTrajectorySaved`.
Make the four shards execute their families sequentially (e1 → e2 →
e3 → m1 → m2 → h1) sharing the same lib-cache directory per family.
Expected: pass rate similar to iter4 (≈ 94%), but with non-zero
`avgLearnedInterfacesAvailable` and `avgReuseRate` on the warm tier.

If E1 already passes the goal, we are done. If E1 shows hooks being
crystallised but never reused, the gap is *discovery*. If E1 shows
crystallisation but bad hooks getting reused and crashing, the gap is
*trust*. Everything below targets one of those gaps.

### E2, smoke-replay promotion gate (substrate, hook registry)

When the observer authors a `candidate-typescript` body for a hook,
immediately replay it against the trajectory inputs that birthed it
and require deep-equal of the recorded output. If matched, promote
to `validated-typescript` (callable). If not matched, demote to
`candidate-typescript` with callable-with-fallback and emit a
structured warning. This closes the "first bad helper poisons the
second episode" failure class.

Lever: hook registry (`src/hooks/registry.ts`,
`validateImplementation`). The trajectory record carries inputs and
outputs already; the work is in the replay step plus the promotion
decision.

Expected: quarantine rate drops, callable-rate climbs, warm-tier
reuse climbs because the agent sees more "callable" helpers and fewer
"callable-with-fallback".

### E3, observed-only hooks (observer)

When the agent calls `df.lib.<name>` and the name does not exist,
capture it as `implementation.kind: "none"` with the input shape. This
is the demand signal for the next set of helpers to author. Even if
the agent's first call fails (because the helper doesn't exist), the
shape is recorded; the next episode that *does* succeed at the same
shape can crystallise a callable body for the now-known intent.

Lever: observer gate + `df.lib` proxy (`src/snippet/dfBinding.ts`,
`src/observer/worker.ts`). Today a call to a missing `df.lib.<name>`
just returns a structured `unsupported` envelope; we are not yet
recording the demand signal it carries.

Expected: `avgLearnedInterfacesAvailable` climbs because the system
now learns *what the agent wished existed*, not just what worked.

### E4, quality-gated `df.answer` in commit phase

`df.answer` already runs a quality heuristic and attaches advisory
warnings. In commit phase, refuse to commit `status: answered` when
the heuristic trips. The agent must either iterate (re-probe, fix)
or commit `status: partial` / `status: unsupported`. Honest unsupported
is preferable to confidently wrong.

Lever: `src/snippet/answer.ts` + commit-phase gate in the snippet
runtime. The pieces are there; the gate is not wired.

Expected: pass rate may *drop slightly* on the eval (some answered-but-
wrong now become unsupported) but the trajectories that *do* commit are
cleaner training input. Warm-tier reuse-rate climbs because the
observer learns from less polluted commits.

### E5, observer iteration-warning

Detect when the same shape-hash is being rewritten across episodes
without converging (more than N rewrites in M episodes). This is a
sign the helper is not generalising; emit a structured warning and
refuse to overwrite the existing body until the agent commits a
different shape.

Lever: observer (`src/observer/gate.ts`).

Expected: defensive, prevents thrash. Should not move pass rate on its
own; included for the trust-rate cap (≤ 3% quarantine).

### E6, discovery surface ranking

`df.d.ts` lists every callable hook. Today the order is mtime. The
agent reads it top to bottom. Re-rank by reuse stats (success count,
recency, validated-typescript first). Add a one-line description per
hook from the manifest's `intent`. This is a cheap intervention: the
agent already has the hooks; we are just helping it find the right
one.

Lever: `src/sdk/schemaRender.ts` (the `df.d.ts` renderer).

Expected: warm-tier `helpersUsed` / `helpersAvailable` ratio climbs
without changing what is in `lib/`.

### E7, sub-graph crystallisation (observer template extractor)

Today the observer extracts whole-trajectory templates. If a
trajectory contains two reusable sub-graphs (one for "fetch and
normalise an entity", one for "compose a summary from N entities"),
only the whole pipe is learned. Extract sub-graphs as separate
candidate hooks. This is the highest-effort substrate change and
should come last; only attempt if E1-E6 fail to clear the warm-tier
reuse-rate threshold.

Lever: `src/observer/template.ts`.

Expected: `avgLearnedInterfacesAvailable` rises sharply on the warm
tier as sub-graphs from train compose into warm-tier solutions.

## Working procedure (cadence rules)

Same shape as the prior goal:

1. **Hypothesis.** One sentence claim about which lever moves which
   learning-loop metric and by how much. Update PLAN.md if the
   priority order needs to shift.
2. **Implement** against the hook registry, observer, or snippet
   runtime. Never family-specific.
3. **Probe.** Single family with lib-cache enabled. Required:
   - ≥ +5pp pass vs the iter4 baseline on that family
   - At least one helper authored during the train phase (e1)
   - At least one helper reused during warm (e2-m2)
4. **Validate.** Fixed rotation pair {university-directory-builder,
   jikan-anime-analysis}. Required:
   - ≥ +3pp combined pass vs iter4 baseline
   - ≥ 30% reuseRate on the warm tier of either family
5. **Full-126.** Family-sequential, lib-cache shared per family.
   4-shard parallel. Commit the new headline row to
   [`hook-registry-experiment.md`](./hook-registry-experiment.md)
   with analysis + error-taxonomy JSONs.
6. **Hygiene.** `pnpm typecheck` clean, `pnpm test` ≥ 242 tests
   passing, working tree committed.

After each iteration, append an entry to EXPERIMENTS.md and a
chronological note to EXPERIMENT_NOTES.md.

## Forbidden behaviours

Verbatim from the goal definition. Condition is NOT met if the
transcript reveals any of:

- Code that pattern-matches on SkillCraft family names, task keys,
  bundle names, or specific tool identifiers
- Pre-baked seed helpers under `seeds/<tenantId>/` or
  `<baseDir>/lib/<tenantId>/` shipped to disk *before episode 1* of
  the run
- Prompt-template branches keyed on dataset / family / tier identity
- Hardcoded payload field defaults inside `df.tool` / `df.lib`
  proxies for specific tools
- Bypassing the hook registry: `<baseDir>/hooks/<tenantId>/` stays
  the trust gate, `df.lib.<name>` stays the public contract, learned
  bodies remain replaceable, quarantine stays active, per-tenant
  layout preserved
- New server-side LLM call paths that substitute for the agent's own
  composition (observers learn FROM agent attempts, they don't make
  attempts of their own)

All measured helpers must be observer-crystallised from earlier
same-run episodes. The lib-cache directory must start empty per
tenant for each fresh run.

## What "done" looks like

Before declaring the goal met, surface in the same turn:

- The analysis JSON path
- The headline row diff (added to `hook-registry-experiment.md`)
- The test count (`pnpm test`)
- A per-tier breakdown table:

  | tier | n | pass ≥70 | avg tokens | helpers available (avg) | helpers used (avg) | reuse rate |
  |---|---|---|---|---|---|---|
  | train | 21 | ... | ... | ... | ... | ... |
  | warm | 84 | ... | ... | ... | ... | ... |
  | hard | 21 | ... | ... | ... | ... | ... |

- A note on which experiments (E1..En) ended up contributing the
  decisive movement.

## Working files

| file | purpose |
|---|---|
| [PLAN.md](./PLAN.md) | living plan, updated when direction shifts |
| [EXPERIMENTS.md](./EXPERIMENTS.md) | curated experiments with hypothesis, change, result, lessons |
| [EXPERIMENT_NOTES.md](./EXPERIMENT_NOTES.md) | chronological scratchpad, real-time thoughts |
| [hook-registry-experiment.md](./hook-registry-experiment.md) | the committed headline-row table per iteration |

EXPERIMENTS.md is the most important of the three. Every experiment,
successful or not, gets an entry. The entry is what the next iteration
reads first.
