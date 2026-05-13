# Datafetch progressive-improvement goal

This document holds the canonical `/goal` condition strings for
driving iterative improvement of datafetch's adaptive-retrieval
substrate against the SkillCraft evaluator, **without** over-fitting
to that dataset.

It is not a runtime artifact. It exists so that whoever opens
`/goal` in a future session can paste a tested, reviewed condition
rather than re-inventing one. Goal 3 (current) at the top; Goal 2 and
Goal 1 preserved below for historical reference.

## Goal 3 (current): close the 7-of-7 gap

See [`PLAN.md`](./PLAN.md) for the full plan and per-iteration
hypothesis schedule. Paste-ready condition (≤ 4000 chars):

```
/goal Close the 7-of-7 SkillCraft full-126 condition on a single sequentially-ordered lib-cache-enabled run measured by pnpm eval:skillcraft:analyze. All seven must hold simultaneously: arms["datafetch-learned"].passRate >= 0.92; avgEffectiveTokens <= 8000; runtimeErrorRate <= 0.05; avgLearnedInterfacesAvailable averaged over warm tier (n=84) >= 2.0; avgReuseRate averaged over warm tier >= 0.30; warm-tier avgEffectiveTokens <= 70% of train-tier avg on the same run; quarantine rate <= 0.03. Stop after 8 accepted iterations or 24 hours otherwise.

Working files: experiments/PLAN.md (current goal + iteration schedule), experiments/EXPERIMENTS.md (curated log, read before each new hypothesis; Goals 1+2 entries E0.5..E8 shape priors), experiments/EXPERIMENT_NOTES.md (chronological scratchpad), experiments/STATUS.md (snapshot of achievements + remaining work), experiments/goal.md (this file). docs/architecture.md, docs/proof-skillcraft.md, docs/release-plan.md, docs/hook-registry-experiment.md are background reading; the last appends one headline row per iteration.

Per-iteration cadence:
1. Read EXPERIMENTS.md first. State one hypothesis with expected delta on a learning-loop metric and its design lever. Valid levers: observer gate, hook registry promotion, snippet runtime, prompt template, df.lib discovery surface, smoke-replay gate, quality-gated df.answer. Never SkillCraft-specific. Add [hypothesis] note to EXPERIMENT_NOTES.md; update PLAN.md if priority shifts.
2. Implement against hook-registry / observer / snippet-runtime substrate.
3. Single-family probe with lib-cache enabled and DATAFETCH_AGENT=claude DATAFETCH_INTERFACE_MODE=hooks-draft. Required: >=+5pp pass vs iter4 baseline AND >=1 helper authored in e1 AND >=1 helper reused in e2-m2. Add [probe] note.
4. Validate on {university-directory-builder, jikan-anime-analysis}. Required: >=+3pp combined pass AND >=30% reuseRate on warm tier of at least one family. Add [validate] note.
5. Full-126, 4-shard parallel, family-sequential (e1->e2->e3->m1->m2->h1 with persistent per-tenant lib-cache). Commit headline row to docs/hook-registry-experiment.md with analysis + error-taxonomy JSONs. Append final [full-126] note AND a complete EXPERIMENTS.md entry.
6. pnpm typecheck clean, pnpm test >= 242 passing, working tree committed.

Lib-cache starts empty per tenant. All measured helpers must be observer-crystallised same-run. Seed helpers under <datafetchHome>/lib/__seed__/ are permitted as cold-start init (per user's framing 2026-05-12); pre-baked seeds under seeds/<tenantId>/ or <baseDir>/lib/<tenantId>/ before episode 1 remain forbidden.

NOT met if the transcript reveals: code pattern-matching on SkillCraft family/task/bundle/tool identifiers; pre-baked seed helpers under seeds/<tenantId>/ or <baseDir>/lib/<tenantId>/; prompt-template branches keyed on dataset/family/tier identity; hardcoded payload defaults in df.tool/df.lib proxies for specific tools; bypassing the hook registry; new server-side LLM call paths substituting for the agent's composition; manually pre-loaded hooks. New affordances reach the agent via bash + filesystem + pnpm script aliases. Persisted artefacts under <baseDir>/{lib,hooks,trajectories}/<tenantId>/.

Before declaring met, surface in the same turn: analysis JSON path; headline row diff in docs/hook-registry-experiment.md; pnpm test count; per-tier breakdown (train/warm/hard with helpers-available, helpers-used, reuse-rate, avg-tokens); note on which experiments contributed; confirmation EXPERIMENTS.md has the final iteration's complete entry. Condition holds when all seven thresholds AND constraints AND family-sequential lib-cache-enabled execution are simultaneously true on the most recent full-126.
```

## Goal 2 (preceding): prove the learning loop fires

Achieved on the pilot but not on the strict full-126; see
[`STATUS.md`](./STATUS.md) § "Goal 2" for the achieved metrics, and
[`EXPERIMENTS.md`](./EXPERIMENTS.md) for full entries E0.5..E8.

## Goal 1 (preceding): pass-rate hill climb

Achieved: 94.4% pass on full-126 at 3,027 effective tokens / task,
0.8% runtime errors. Details in [`STATUS.md`](./STATUS.md) § "Goal 1"
and [`../docs/hook-registry-experiment.md`](../docs/hook-registry-experiment.md)
§ "Iter4 full-126 (the headline)". Original framing preserved below.

### Framing

The hook registry, VFS layout, and per-tenant lib overlay are
**substrate**. SkillCraft is the **evaluator**. The substrate must
stay useful for any tenant whose primitives the agent doesn't know
in advance; SkillCraft is one such tenant. The goal therefore needs
to push numbers on the evaluator while explicitly disqualifying
wins that come from baking SkillCraft-specific knowledge into the
substrate.

Current baseline (from `docs/hook-registry-experiment.md` →
iter2 full-126 section, committed at HEAD):

- pass ≥70: 85.7%
- strict ≥90: 78.6%
- runtime error rate: 5.6%
- avg effective tokens: 3,340 / task
- skillcraft-base ceiling: 96.0% / 94.4% / 0% / ~520,450 tokens
- remaining gap: concentrated in warm phase (helpers crystallised
  in train that don't generalise to warm variants)

## Targets

- **Primary**: pass ≥70 ≥ 92% on full-126 (closing ~6.3pp of the
  10.3pp ceiling gap) without inflating tokens above ~2× current
  baseline.
- **Secondary**: runtime error rate ≤ 5%; no regression in test
  count (≥ 227 passing).

## The `/goal` command

Open the session and paste:

```
/goal Reach pass ≥70 of ≥ 92% on the full SkillCraft 126-task surface (measured from the arms["datafetch-learned"].passRate field of a fresh pnpm eval:skillcraft:analyze output) with avg_effective_tokens ≤ 8,000 and runtime_error_rate ≤ 0.05 — OR stop after 8 accepted iterations or 24 hours.

Cadence per iteration, each surfaced in the transcript:
1. State one hypothesis with expected delta and the design lever it pulls (hook registry, observer gate, prompt template, snippet runtime — never a SkillCraft-specific shortcut).
2. Implement against the hook-registry / VFS substrate.
3. Run a single-family probe; surface per-task pass + tokens + runtime-error counts. Require ≥+5pp pass vs the latest committed baseline on that family.
4. If probe passes, run a 2-family held-out validate on the fixed rotation pair {university-directory-builder, jikan-anime-analysis}. Require ≥+3pp combined pass.
5. If validate passes, run full-126 (4-shard parallel) and commit the new headline row to docs/hook-registry-experiment.md with the analysis + error-taxonomy JSONs.
6. After every iteration: pnpm typecheck clean, pnpm test shows ≥ 227 tests passing, and the working tree is committed.

Condition is NOT met if the transcript reveals any of:
- Code that pattern-matches on SkillCraft family names, task keys, bundle names, or specific tool identifiers (no "if family === ..." or "if toolName.startsWith('local-cocktail_')")
- Pre-baked seed helpers under seeds/ that solve specific SkillCraft tasks
- Prompt-template branches keyed on dataset / family identity
- Hardcoded payload field defaults inside df.tool / df.lib proxies for specific tools
- Bypassing the hook registry: <baseDir>/hooks/<tenantId>/ stays the trust gate; df.lib.<name> is a stable public contract; implementations are replaceable behind it; quarantine stays active; per-tenant layout is preserved
- New server-side LLM call paths that substitute for the agent's own composition (observers learn FROM agent attempts; they don't make attempts of their own)

New affordances reach the agent via bash + filesystem + pnpm script aliases (the existing pnpm datafetch:run pattern), not new bespoke tool APIs. Persisted artefacts live under <baseDir>/{lib,hooks,trajectories}/<tenantId>/ — generic shape, not skillcraft-specific paths.

Before declaring the condition met, surface in the same turn: the analysis JSON path, the headline row diff, and the test count. The condition only holds when the numbers AND the constraints both pass simultaneously on the most recent full-126 run.
```

## Why this shape

**Measurable end state.** Three numeric thresholds tied to a
specific JSON path the analysis script produces. The evaluator can
read whether Claude reported those numbers from a fresh run.

**Stated check.** Every iteration has to walk through smoke →
probe → validate → headline and surface the analysis JSON path.
Claude can't claim victory without showing the artefact.

**Bounded.** 8 iterations or 24h. The evaluator can count
iteration markers in the transcript.

**Constraints that matter.** Eight explicit disqualifiers covering
the over-fitting shapes we've discussed in this session. Every one
of them is detectable from the diff Claude surfaces — Claude has
to show its commits, and the evaluator can read the diffs.

**No more aggressive than the current trajectory needs.** 92% pass
with ≤8k tokens is roughly: iter2 (85.7% / 3.3k) → close half the
remaining ceiling gap → token budget doubles to leave room for any
smoke-replay verification overhead. If iter2-style cheap wins keep
landing, this terminates well under 8 iterations.

## Anti-patterns the constraints catch

The "Condition is NOT met if …" section is the most important part.
It's there because the numbers alone can be gamed:

- **Family-keyed prompt branches** would lift SkillCraft numbers
  without generalising. Forbidden.
- **Hardcoded payload defaults** in df.tool proxies would mask
  agent-code bugs by silently returning empties for specific tool
  names. Forbidden — defenses go in the agent's code or the
  prompt, not the runtime.
- **Server-side skill bodies** would let us match SkillCraft by
  effectively re-running SkillCraft's agent loop on our substrate.
  Forbidden — datafetch's claim is the substrate, not a new
  LLM-call orchestrator.
- **Pre-baked seed helpers for SkillCraft** would inflate
  warm-phase reuse rate without proving the crystallisation
  pipeline works on novel tenants. Forbidden.

## Iteration candidates that pass the constraints

The current open question (warm-phase helper generalisation) admits
several substrate-level improvements that don't violate the
constraints:

1. **Smoke-replay promotion gate** — `candidate-typescript` →
   `validated-typescript` only when the helper replays cleanly on
   the same inputs that produced it. Generic across tenants.
2. **Iteration-count warning** (Phase 4, deferred) — when the
   agent overwrites a learned helper ≥ 3 times within a family,
   surface a hint to write the task directly instead. Generic.
3. **Per-tenant test sieve** — after the agent authors a helper,
   automatically run it against the example inputs in the
   trajectory's recorded calls. Quarantine on output drift.
4. **Trajectory-aware probe hints** — when the agent's previous
   call returned `undefined` for a field its next call assumes,
   surface that in the prompt. Detects from the trajectory log,
   not from family/tool identity.

Each of these targets warm-phase quality (the actual remaining
gap) at the substrate level. None of them require knowing
anything about SkillCraft specifically.

## Running it

Interactive:

```
/goal <paste the condition from above>
```

Non-interactive (e.g. an overnight run on Claude's subscription):

```
claude -p "/goal <paste the condition>"
```

Status check:

```
/goal
```

Clear early:

```
/goal clear
```

The goal auto-clears when met. Each accepted iteration commits its
own evidence, so even a stopped run leaves a clean audit trail in
git.
