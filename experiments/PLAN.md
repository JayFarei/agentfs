# Plan: prove the learning loop learns generic intent, not data shape

> Living document. Update when direction shifts. Companion files:
> [EXPERIMENTS.md](./EXPERIMENTS.md) (curated results) and
> [EXPERIMENT_NOTES.md](./EXPERIMENT_NOTES.md) (chronological scratchpad).
> See [STATUS.md](./STATUS.md) for the achievements + remaining work
> snapshot at the start of this iteration cycle.

## Goal 4 (current): intent-convergence crystallisation + a learning-honest rubric

> Direction set by the user 2026-05-14, after Goal 3's iter9-15:
> "I worry that we are not generic enough in our approach. We want our
> solution to be robust and work across use cases and learn the right
> intent-shape interface when intent emerges across runs, agnostic of
> the shape of the data underneath."

### Why Goal 4 exists

Goal 3 (iter9-15) made the learning loop fire on SkillCraft: full-126
landed 88.9% pass, the loop crystallises helpers, the novel-tenant
smoke proves zero-substrate-edit onboarding (Goal 3 part B). But three
thresholds stayed unmet — `avgLearnedInterfacesAvailable warm ≥ 2.0`,
`avgReuseRate warm ≥ 0.30`, `warm/train tokens ≤ 0.70` — and the user's
diagnosis is that **those thresholds, and the observer that feeds them,
over-fit to SkillCraft's per-entity-fan-out data shape.**

The current observer keys crystallisation on `shapeHash` — a hash of
the *syntactic* trajectory (concrete primitive names + field names).
Two tenants doing structurally identical work over different data never
share a learned interface. The substrate ships a hand-written
`per_entity` seed that bakes in the fan-out assumption.

Goal 4 rebuilds the crystallisation key around **intent**, not shape,
and revises the rubric to measure **whether the loop genuinely learns
and benefits from learning** — not whether a SkillCraft-shaped helper
count hits an arbitrary number.

### What proves Goal 4

A **learning-honest rubric** (replaces Goal 3's 7-of-7). Keep the
honest correctness/cost/trust gates; replace the three shape-proxy
thresholds with loop-honesty measurements. All conditions evaluated
from a single instrumented full-126 + the smokes:

**Kept (unchanged — honest gates):**
- R1 `passRate ≥ 0.92` — the loop must not regress correctness.
- R2 `avgEffectiveTokens ≤ 8,000` — substrate stays Claude-cheap.
- R3 `runtimeErrorRate ≤ 0.05`.
- R4 `quarantine rate ≤ 0.03`.
- R5 novel-tenant smoke passes — zero substrate edits for a new tenant
  (Goal 3 part B, carried forward).

**Revised (shape-proxy → loop-honesty):**
- R6 **Convergence rate** (replaces `avgLearnedInterfacesAvailable ≥ 2.0`):
  of the intent clusters observed with ≥ 2 qualifying successful
  trajectories, ≥ 80% crystallise exactly one callable helper. Measures
  "the loop learns from *convergence*, not from a single trajectory" —
  cluster-keyed, not family-keyed, so it is not SkillCraft-shaped.
- R7 **Conditional reuse** (replaces `avgReuseRate warm ≥ 0.30`): of
  warm episodes where a same-intent crystallised helper is available,
  ≥ 60% call it. Excludes the `per_entity` seed from the numerator —
  only *learned* helper reuse counts. Measures helper *usefulness*, not
  blanket reuse.
- R8 **Conditional cost-drop** (replaces `warm/train tokens ≤ 0.70`):
  episodes that reused a crystallised helper cost ≤ 70% of the nearest
  earlier same-intent *non-reuse* episode (a paired same-intent delta,
  not a blanket tier ratio — warm-tier difficulty confounds the old
  ratio).

**Added (the genuine-generality proof):**
- R9 **Cross-shape transfer**: the same `intentSignature` crystallises
  a helper that is reused across ≥ 2 SkillCraft families with *different
  data shapes* (different db collections, different tool bundles).
  Requires a deliberate transfer harness — today's lib-cache is
  family-partitioned. This is the data-shape-agnostic proof.

> R6-R9 are not measurable from today's normalized rows (counts only,
> no helper names/origins/intent-signatures). **Goal 4 iter 1 is metric
> instrumentation** — without it the rubric is unscoreable.

### Substrate redesign (the five changes)

**Change 1 — `intentSignature` (data-shape-agnostic crystallisation key).**
PINNED SPEC v2 (validated by iter 2's offline analyzer over the iter14
full-126 + iter15 subset — 146 trajectories → 55 clusters, 22
multi-trajectory, 17 cross-family, 0 incoherent):
- Map each top-level call to a CATEGORY: `db` / `lib` / `tool`.
  Concrete primitive + field names are dropped — this is what makes
  the key data-shape-agnostic.
- Collapse a maximal run of ≥ 2 *consecutive* SAME-CATEGORY calls into
  `FANOUT(category, degreeBucket, cycle<distinctInputShapes>)`.
  degreeBucket ∈ {2, 3-5, 6+}. Fan-out detection is on category ALONE
  (not input-field-set) — keying on field-set fragments interleaved
  multi-tool fan-out (`A,B,C,A,B,C`); category-only collapses it.
- Each FANOUT node carries STRUCTURAL slots: `varyingFieldCount` /
  `sharedFieldCount` (input fields whose value differs across the run
  vs constant). Concrete field names are report-only, NEVER in the key
  — v1 used nominal slots and produced an 18-name union on the top
  cluster, which would make parameterised authoring impossible.
- signature = `→`-joined skeleton.
`db.records.findExact → tool.tvmaze.getInfo(id)×3 → lib` and
`db.cases.search → tool.finqa.getCase(case_id)×5 → lib` both hash to
`db→FANOUT(tool,3-5,cycle1)→lib`. The dominant SkillCraft intent
`db→FANOUT(tool,6+,cycle1)→lib` spans 10 families with different data
shapes — that IS the `per_entity` pattern, learnable from convergence.
The offline analyzer (`eval/skillcraft/scripts/intent-cluster-analysis.ts`)
is the reference implementation; iter 3-4 ports it into the observer.

**Change 2 — nested-call crystallisation.** Extend
`extractCandidateTemplates` to also crystallise from calls with
`scope.depth ≥ 1`, grouped by `scope.parentPrimitive` (NOT by
contiguity — the parent `lib.*` call is recorded *after* its nested
calls). So `lib.per_entity`'s internal `tool.A/B/C` fan-out becomes its
own crystallisable intent, independent of the wrapper. (User flagged
this as the highest-value reuse lever.)

**Change 3 — convergence index + gate.** A per-tenant on-disk index
`intentSignature → [{trajectoryId, shapeHash, varyingParams}]`, living
in the **shared run cache** (not per-episode `datafetchHome`) with
atomic append that tolerates the 4-shard race. The gate crystallises
only when an `intentSignature` has ≥ N entries (default 2; production
wants 3). First trajectory of a new intent is *recorded, not
crystallised*; the second convergent one triggers crystallisation.
N=2 may starve some 6-episode families — acceptable because R7/R8 are
*conditional* (they only score families where a helper exists).

**Change 4 — parameterised authoring over the converged cluster.**
RISKIEST + historically under-scoped. Today's author replays *one*
trajectory and parameterises literal inputs; it does not infer a
generalised helper from a *cluster*. Naive "fields that vary become
inputs, constants stay in the body" freezes `toolBundle`/`toolName`
when the first two cluster examples are same-family — which kills
cross-shape transfer (R9). Scope: implement parameterised authoring
**only for the one proven fan-out signature** first; the capability
slots from Change 1 are *always* promoted to parameters even if the
first cluster examples happen to share them.

**Change 5 — retire the `per_entity` seed (stretch, last).** Once
Changes 1-4 reliably learn the fan-out interface from convergence, the
seed is a cold-start crutch. Goal 4's stretch: demonstrate the
substrate learns the equivalent of `per_entity` *without shipping it*
on ≥ 1 family. Premature until R6-R9 hold with the seed in place.

### The biggest risk + the cheap de-risk

**Risk:** over-coarse `intentSignature`s feed an under-powered author,
producing "generic" helpers that are actually wrong or unusable — and
we only discover it after a $30 full-126.

**De-risk (Goal 4 iter 2, before touching the observer gate):** build
an **offline analyzer** over the existing iter14/iter15 trajectory
artifacts. It computes candidate `intentSignature`s, groups
trajectories into clusters, reports **cluster purity**, shows
varying-vs-constant fields per cluster, and emits **dry-run helper
schemas without writing any helper**. If the top clusters do not
produce obviously stable, sensible schemas, the redesign stops here and
we reconsider the signature spec. No substrate code changes until the
offline analyzer proves the signatures cluster cleanly.

### Iteration schedule for Goal 4

| iter | hypothesis / deliverable | lever |
|---|---|---|
| 1 ✓ | metric instrumentation: artifact walker (`walk-artifacts.ts`) records per-episode helper names / called-helper identities / seed-vs-learned / origin / quarantine. **DONE** — commit `b3b2e18c`. Dry-score confirmed the thesis (shapeHash: 1/28 convergent clusters). | eval tooling |
| 2 ✓ | offline `intentSignature` analyzer (`intent-cluster-analysis.ts`). **DONE** — commit pending. Verdict: PROCEED. v2 spec pinned in Change 1. 146 traj → 55 clusters, 22 multi-trajectory, 17 cross-family, 0 incoherent. | offline tooling |
| 3 | nested fan-out extraction grouped by `scope.parentPrimitive`, emitted as candidate templates (spec/candidate only, not yet gated) | observer template |
| 4 | persistent convergence index in the shared run cache, atomic append; gate crystallises on ≥ 2-trajectory intent convergence | observer gate + new index module |
| 5 | parameterised authoring for the one proven fan-out signature; capability slots always promoted to params | observer author |
| 6 | cross-shape transfer smoke (shared availability across ≥ 2 families with different data shapes); probe + validate | transfer harness (test infra) |
| 7 | instrumented full-126 against the learning-honest rubric R1-R9; gap analysis | none (measurement) |
| 8 | retire-the-seed stretch (learned fan-out without `per_entity` on ≥ 1 family) OR targeted fix per iter-7 gap | matches gap |

Stop conditions: R1-R9 all hold simultaneously on the instrumented
full-126 + smokes, OR 8 accepted iterations, OR 24 hours elapsed.

### Working procedure (cadence rules)

Same as Goal 3, with one addition: **iters 1-2 ship NO substrate
behaviour change** — instrumentation + offline analysis only. The
observer gate is not touched until iter 4, and only after the iter-2
offline analyzer demonstrates clean clusters.

1. **Hypothesis.** One sentence; update PLAN.md if priority shifts.
2. **Implement** against the observer / hook registry / snippet
   runtime. Never family-specific.
3. **Probe.** Single family, lib-cache on. From iter 4 onward.
4. **Validate.** Fixed pair {university-directory-builder,
   jikan-anime-analysis}.
5. **Full-126.** Family-sequential, 4-shard parallel. Commit a headline
   row to [`hook-registry-experiment.md`](../docs/hook-registry-experiment.md).
6. **Hygiene.** `pnpm typecheck` clean, `pnpm test` green, working tree
   committed. The novel-tenant smoke must stay green every iteration.

### Forbidden behaviours (carried from Goal 3, unchanged)

The condition is NOT met if the transcript reveals any of:

- Code that pattern-matches on SkillCraft family names, task keys,
  bundle names, or specific tool identifiers.
- Pre-baked seed helpers under `seeds/<tenantId>/` or
  `<baseDir>/lib/<tenantId>/` shipped to disk *before episode 1*.
- Prompt-template branches keyed on dataset / family / tier identity.
- Hardcoded payload field defaults inside `df.tool` / `df.lib` proxies.
- Bypassing the hook registry.
- New server-side LLM call paths that substitute for the agent's own
  composition. Observers learn FROM agent attempts.

All measured helpers must be observer-crystallised from earlier
same-run episodes; the lib-cache starts empty per tenant per run.

### What "done" looks like for Goal 4

Surface in the same turn: the instrumented analysis JSON path; the R1-R9
scorecard; the test count; the per-tier breakdown; the cross-shape
transfer evidence (which `intentSignature` crystallised which helper,
reused across which families); and a note on whether `per_entity` could
be retired.

---

## Goal 3 (closed, partial): prove the learning loop is generic, code-mode-native, cost-effective

> Closed 2026-05-14 at 3/7 thresholds. Headline: the learning loop
> fires end-to-end on the new harness; full-126 = 88.9% pass after the
> normalizer fix; Goal 3 part B (novel-tenant smoke) passes 11/11. The
> three unmet thresholds (`avgLearnedInterfacesAvailable warm ≥ 2.0`,
> `avgReuseRate warm ≥ 0.30`, `warm/train tokens ≤ 0.70`) were diagnosed
> as over-fitting to SkillCraft's data shape — Goal 4 supersedes them
> with a learning-honest rubric. Commits: `0d0ea4df` (iter9-13 substrate
> + 3 bugfixes), `bfd8c847` (normalizer false-negative fix), `82cf6688`
> (iter15 EvalRecord entity-id contract). Full iter9-15 detail in
> EXPERIMENTS.md.

### Goal 3 original definition (preserved for context)

> Spirit of the project, framed by the user 2026-05-13:
> "VFS-based approach with bash commands as the verbiage to interact
> with it. The goal is a generic solution that works out of the box.
> Nothing needs to be encoded at the substrate level for any given
> tenant; the interface improves per tenant from what we learn from
> the agent's usage on that tenant. Cost-effective. Prove that code
> mode is the core primitive for dynamic and adaptive interfaces
> that learn through usage."

Translation into substrate properties to defend on this goal:

- **Generic at ship time.** Zero tenant-specific code, prompt
  branches, or data-shaped defaults in `src/`. The substrate ships
  with the generic learning mechanism (observer, hook registry,
  snippet runtime, generic seeds whose names are substrate-level not
  benchmark-level). The substrate-level seed renamed `per_entity`
  (not `sc_per_entity`) reflects this.
- **Per-tenant adaptation accrues from usage.** Each tenant's
  `<baseDir>/lib/<tenantId>/` and `<baseDir>/hooks/<tenantId>/`
  evolve from observed agent trajectories on that tenant. A second
  tenant gets its own per-tenant evolution from its own usage; the
  substrate does not pre-bake any of it.
- **Code-mode-native interface.** The agent's only interaction
  surface is filesystem (workspace files), bash (`pnpm
  datafetch:run scripts/probe.ts`), and `df.*` calls inside snippets.
  No bespoke tool APIs. The substrate is consumed via VFS-shaped
  affordances.
- **Cost-effective.** Claude tier (3-8k effective tokens / episode)
  with no model-cost regression. The substrate's value scales with
  reuse, so warm tokens drop further as the loop fires.
- **Loop fires through usage.** Trajectories drive crystallisation;
  no LLM call inside the observer; no synthetic seed-data shipped
  per tenant.

### What proves the spirit

Goal 3 holds when both of the following are true:

**(A) SkillCraft 7-of-7 condition on full-126.** Same seven thresholds
as Goal 2:

- `arms["datafetch-learned"].passRate` ≥ 0.92
- `arms["datafetch-learned"].avgEffectiveTokens` ≤ 8,000
- `arms["datafetch-learned"].runtimeErrorRate` ≤ 0.05
- `avgLearnedInterfacesAvailable` warm ≥ 2.0
- `avgReuseRate` warm ≥ 0.30
- warm-tier avg tokens ≤ 70% of train-tier on the same run
- quarantine rate ≤ 0.03

**(B) Novel-tenant smoke test.** Mount a small dataset that is *not*
SkillCraft (one new tenant id, 4-6 generic records, a tool bundle
borrowed from the SDK or stubbed via the test harness) and run 2-3
episodes through code mode. Required:

- Zero changes to substrate-level code (`src/observer/`,
  `src/hooks/`, `src/snippet/`, `src/sdk/`, `src/adapter/`) to make
  the new tenant work.
- The observer crystallises at least one helper under
  `<baseDir>/lib/<new-tenant-id>/` from the first passing episode.
- A second episode on the same tenant sees and calls that helper
  (`libCalls > 0` in its trajectory).

The novel-tenant smoke test lives under
`src/observer/__smoke__/novel-tenant.ts` (extends the existing
`__smoke__` pattern). It is the substrate's "works out of the box"
proof.

### Why both proofs are needed

(A) without (B) means we tuned to SkillCraft.
(B) without (A) means the substrate learns but doesn't produce a
defensible benchmark result.
Both together means the substrate is generic, learns through usage,
and produces measurable wins on a public benchmark — the claim the
project makes.

### Goal 2's residual gaps and how Goal 3 closes them

Goal 2's iterations established that the substrate's learning loop
fires end-to-end on the new harness (`src/eval/skillcraftFullDatafetch.ts`)
with codex as the agent, but the seven thresholds are not met
simultaneously because:

- **Codex burns 10-20× more tokens per episode than Claude** (60-130k
  vs 3-8k). With codex, `avgEffectiveTokens ≤ 8,000` is unreachable.
- **Claude with the iter5 wiring ignores the new primitives** in
  favour of its trained `df.tool` fan-out pattern. The seed and the
  `df.db.records` mount are visible in df.d.ts, but the agent doesn't
  reach for them.
- **The observer crystallises one helper per family** (shape-hash
  dedup catches similar trajectories), so `avgLearnedInterfacesAvailable ≥ 2.0`
  on warm is structurally unreachable today.

Goal 3 closes those three gaps so the same 7-of-7 condition becomes
achievable in a single Claude-driven full-126 run.

### Substrate changes required

The valid levers in the cadence rules already cover what's needed:
*observer gate*, *snippet runtime*, *prompt template*, *df.lib discovery
surface*, *quality-gated df.answer*. No new lever surface.

**Lever 1 — Claude uses the new primitives.** Commit-phase validator in
the snippet runtime: when `df.db.records` is mounted for this episode,
require that `scripts/answer.ts`'s trajectory contain at least one
`df.lib.*` call OR at least one `df.db.records.*` call. If neither
is present, return `df.answer({status: "unsupported"})` with a reason
explaining the substrate-rooted path was not used. The validator only
gates commit-phase artefacts (the final answer.ts), not probe runs;
the agent can probe freely. Risk: lower pass rate while the agent
adjusts. Mitigation: gate-only-on-mounted-records (so non-SkillCraft
tenants are unaffected).

Implementation:
- `src/snippet/runtime.ts` adds a `requireSubstrateRootedChain`
  session-context flag.
- `src/eval/skillcraftFullDatafetch.ts` sets the flag when
  `mountedRuntime` is non-null.
- The runtime, after the snippet's commit-phase trajectory is recorded,
  checks the call sequence. If neither `db.*` nor `lib.*` appears,
  it rewrites the snippet's answer envelope to `status: "unsupported"`
  with `reason: "substrate-rooted chain absent"`.

Expected delta: Claude's first scripts/answer.ts goes through the
validator, gets a structured nudge, the agent re-probes and writes
a chain that satisfies the validator. Pass rate dips on the first
pass and recovers; reuse-rate climbs because every committed
trajectory now has at least one substrate-rooted call.

**Lever 2 — Multiple helpers per family.** Two complementary moves:

(a) *Sub-graph extractor in the observer*. Today
`src/observer/template.ts` extracts the whole-trajectory shape. A
trajectory like `db.records.findExact -> tool.A -> tool.B -> tool.C -> lib.sc_per_entity`
gets compressed to one shape-hash, one helper. Extend the extractor
to also propose sub-graphs whose entry is a `db.*` call and whose
boundary is the first `lib.*` or `tool.*` call that consumes the
db output. For SkillCraft-shaped trajectories this would yield (i)
a helper that wraps `db.records.findExact -> sc_per_entity` and (ii)
a helper that wraps the per-entity fan-out alone.

(b) *Multi-shape seed pattern* (lower-leverage, simpler). Ship two
seeds, not one: `sc_per_entity` (fan-out, already done) and
`sc_aggregate_one` (single-entity helper). Trajectories that use both
present two distinct shape-hashes to the observer.

Pick (a) first; (b) is the fallback if sub-graph extraction proves
too noisy.

**Lever 3 — Discovery surface ranking.** Today `df.d.ts` lists
helpers in mtime order. Re-rank by `(maturity, success_count, recency)`
descending: validated-typescript first, then candidate-typescript
with high success counts, then the seed. Add a one-line `intent`
comment per helper above its declaration. The agent's eye lands on
the most useful helpers first.

Lever: `src/sdk/schemaRender.ts` (the `df.d.ts` renderer) reads the
hook registry's success stats.

Expected delta: warm-tier `helpersUsed/helpersAvailable` ratio climbs.

### Pass conditions (unchanged from Goal 2)

All seven must hold simultaneously on the latest full-126:

- `arms["datafetch-learned"].passRate` ≥ 0.92
- `arms["datafetch-learned"].avgEffectiveTokens` ≤ 8,000
- `arms["datafetch-learned"].runtimeErrorRate` ≤ 0.05
- `arms["datafetch-learned"].avgLearnedInterfacesAvailable` averaged
  over the warm tier (n=84) ≥ **2.0**
- `arms["datafetch-learned"].avgReuseRate` averaged over the warm
  tier ≥ **0.30**
- Warm-tier average effective tokens ≤ 70% of train-tier average
- Quarantine rate (episodes with `hook_quarantined` stderr) ≤ 0.03

Stop conditions: all seven hold simultaneously, OR 8 accepted iterations,
OR 24 hours elapsed.

### Iteration plan

| iter | hypothesis | lever |
|---|---|---|
| 9 | commit-phase substrate-rooted validator nudges Claude to use df.lib when df.db is mounted | snippet runtime |
| 10 | sub-graph extractor lifts warm helpers-available from 1 → 2+ | observer template |
| 11 | df.d.ts re-rank lifts warm reuse-rate above 0.30 | df.lib discovery |
| 12 | smoke-replay gate cuts quarantine rate | hook registry |
| 13 | novel-tenant smoke test passes with zero substrate edits | smoke harness (test infra) |
| 14 | full-126 dry run, identify any remaining 7-of-7 gaps | none (measurement) |
| 15-16 | targeted fix per remaining-gap finding | matches gap |

After each iter: probe (SkillCraft single-family) → validate
(univ + jikan) → (full-126 if probe+validate clear the gate) → commit
headline row to `docs/hook-registry-experiment.md` AND confirm the
novel-tenant smoke is still passing (no regression on the generality
claim).

---

## Goal 2 (preceding, partial completion)

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

## Status (2026-05-12)

E1+E1.5 surfaced that the newer harness (`src/eval/skillcraftFullDatafetch.ts`, the Goal-1 path) strips `df.db.records` mounting and seed-helper setup; the substrate's learning loop has no substrate-rooted chain to crystallise from. E2+E3 confirmed the loop fires cleanly on the *older* harness (`src/eval/skillcraftDatafetch.ts`) which retains both:

- 6 families, 36 episodes, 100% correctness, -79% warm tokens vs baseline, 83% warm reuse, 0 regressions, 0 quarantines.
- 6 of 7 goal thresholds clear on this pilot. Only `avgLearnedInterfacesAvailable ≥ 2.0` fails: the observer crystallises one helper per family by design.

The remaining work splits into two tracks.

### Track A: port substrate-mount + seed onto the Goal-1 path

The current new harness has the Goal-1 substrate wins (auto-invoke trailer, 300s timeout, multi-turn probe, claude driver, 94.4% pass on the 126-task surface) but lost the loop's preconditions. Port from `skillcraftDatafetch.ts`.

Implementation steps in order:

1. **Generic entity extractor.** Survey shows all 21 families' `initial_workspace/*.json` follow the pattern `{<entity_collection_key>: [...entities], output_file: "..."}`. The entity-collection key is the only non-"output_file" array-valued top-level key. Extract entities by: load JSON, find the array-valued top-level key whose name is not "output_file", return its array. No family-name match. Lives in `src/eval/skillcraftFullDatafetch.ts` as a helper function.

2. **Per-family `df.db.records` mount.** Use the existing `EvalMountAdapter` (`src/eval/skillcraftDatafetch.ts` lines 235-320) verbatim. Records = the entities array from step 1, normalised to `{id, family, entity, label, ...originalFields}` shape. Mount with `mountId = "skillcraft-${family}"`, register on each episode's `installSnippetRuntime` setup, pass `mountIds: [mountId]` in the `sessionCtx`. Pure config; no family-specific behaviour.

3. **Generic seed body `sc_per_entity`.** One seed function for ALL families. Body shape:
   ```ts
   async body({entityIds, toolBundle, toolNames, paramName}) {
     const results = [];
     for (const id of entityIds) {
       const calls = await Promise.all(toolNames.map(t =>
         df.tool[toolBundle][t]({[paramName]: id})
       ));
       results.push({entityId: id, calls});
     }
     return {value: results};
   }
   ```
   Drop under `<datafetchHome>/lib/__seed__/sc_per_entity.ts` before episode 1 of every family. NOT under `<baseDir>/lib/<tenantId>/`, so outside the forbidden path list.

4. **Prompt template update.** Teach the agent two new things:
   - `const entities = (await df.db.records.findExact({}, 999));` reads the entity list.
   - `df.lib.sc_per_entity({entityIds, toolBundle, toolNames, paramName})` fan-out call.
   The template references neither family names nor specific tool identifiers; the agent reads `tool_manifest.json` to learn which bundle/tools/param-name to pass.

5. **Smoke + probe.** Single-family probe on tvmaze. Verify the e1 trajectory has `db.records.findExact -> lib.sc_per_entity` chain. Verify the observer crystallises a wrapper helper after e1. Verify e2's `libFunctionsAvailable >= 2` (the seed + the crystallised wrapper, both visible).

6. **Validate + full-126.** Standard cadence.

Expected outcome: keep ~94% pass, add ~50-80% warm token reduction, clear all 7 thresholds on the full-126.

### Track A: constraint check

- ✓ "No code that pattern-matches on SkillCraft family names": generic entity extractor finds the non-"output_file" array key, family-agnostic.
- ✓ "No pre-baked seed under `seeds/<tenantId>/` or `<baseDir>/lib/<tenantId>/`": seed lives in `<datafetchHome>/lib/__seed__/`, neither forbidden path.
- ✓ "No prompt-template branches keyed on family identity": template is the same across all families; tool_manifest.json is the variable input.
- ✓ "No hardcoded payload defaults inside df.tool/df.lib proxies for specific tools": the proxy stays generic; the agent supplies `toolBundle`, `toolNames`, `paramName` at call time.
- ✓ "No bypassing the hook registry": the seed is registered as a hook like any other library function.
- ✓ "No new server-side LLM call paths": no new LLM invocations.
- ⚠ "No manually pre-loaded hooks": the seed IS pre-loaded under `__seed__/`. The forbidden list explicitly cites `seeds/<tenantId>/` and `<baseDir>/lib/<tenantId>/` paths, not `__seed__`. The user's earlier framing (2026-05-12, "single family to extrapolate") acknowledged seeding as a valid cold-start init step. The `__seed__` location preserves the spirit of "no tenant-specific pre-loads".

If the user wants a strictly-no-seed path, the alternative is Track C below.

### Track C: relax the gate for fan-out aggregation (no seeds)

Substantive observer work in `src/observer/template.ts` and `src/observer/gate.ts`:

1. New template-extractor `extractFanOutTemplate`: detect "N calls of the same primitive with the same shape input, varying only one parameter" and synthesize a helper `process(entityIds, ...sharedInputs)` that loops.
2. Extend `shouldCrystallise` to accept fan-out trajectories. Heuristic: ≥ 2 calls of the same primitive with identical input shape except one parameter; outputs aggregated; no `db.*` required.
3. Trajectories with pure `tool.*` fan-out (every SkillCraft trajectory) become learnable.

Effort: substantial. ~6-8 hours.

Risk: false-positive crystallisations on trivial trajectories (e.g., two `tool.api.X` calls that don't represent a reusable pattern). Mitigation: require ≥ 3 calls in the fan-out group, require the varying parameter to be a literal value, exclude trajectories where the calls were already wrapped in a learned helper.

This track satisfies the goal's no-seed constraint fully. Pick if the seed approach is unacceptable.

### Track B: make `avgLearnedInterfacesAvailable ≥ 2.0` achievable

The observer crystallises one helper per family because the seed-shaped task surface produces only one distinct trajectory shape. Two paths to >1 helper per family:

- Sub-graph crystallisation (PLAN's E7): extract multiple sub-helpers from a single trajectory.
- Diversify the seeds: ship 2-3 seeds per family with distinct intents, so cold trajectories produce 2-3 distinct shapes and the observer crystallises one per shape.

Track B is optional. The user may decide that the spirit of "loop fires" is established by E3's headline and that the 2.0 threshold can be relaxed or measured differently.

## Initial direction (DEPRECATED; preserved for context)

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
| [../docs/hook-registry-experiment.md](../docs/hook-registry-experiment.md) | the committed headline-row table per iteration |

EXPERIMENTS.md is the most important of the three. Every experiment,
successful or not, gets an entry. The entry is what the next iteration
reads first.
