# Datafetch progressive-improvement goal

This document holds the canonical `/goal` condition for driving
iterative improvement of datafetch's adaptive-retrieval substrate
against the SkillCraft evaluator, **without** over-fitting to that
dataset.

It is not a runtime artifact. It exists so that whoever opens
`/goal` in a future session can paste a tested, reviewed condition
rather than re-inventing one.

## Framing

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
