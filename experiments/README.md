# experiments/

Our session-level working notes for iterating against the SkillCraft
benchmark. Distinct from `docs/`, which is public-facing.

## Start here

- [`STATUS.md`](./STATUS.md) — what we've achieved across Goal 1 + Goal 2,
  what the seven-threshold gap looks like at the end of Goal 2, and the
  three-line summary of Goal 3's path forward. Read this first.
- [`PLAN.md`](./PLAN.md) — current goal, substrate changes needed, iteration
  schedule. Update when direction shifts.
- [`EXPERIMENTS.md`](./EXPERIMENTS.md) — curated chronological log of every
  iteration. Each entry has hypothesis → change → result → lessons. This
  is the most important file; read it before forming a new hypothesis.
- [`EXPERIMENT_NOTES.md`](./EXPERIMENT_NOTES.md) — raw scratchpad with
  real-time thoughts, dead-ends, open questions. Lower bar to entry than
  EXPERIMENTS.md; higher information density on what the agent was
  *thinking*.
- [`goal.md`](./goal.md) — canonical `/goal` condition strings, ready to
  paste into a new goal-mode session.

## How a goal cycle works

1. Read `EXPERIMENTS.md` before forming a hypothesis.
2. State the iteration's hypothesis in `EXPERIMENT_NOTES.md`.
3. Implement against substrate (`src/observer/`, `src/snippet/`,
   `src/hooks/`, `src/eval/`).
4. Probe on a single family, validate on a held-out pair, full-126.
5. Commit the headline row to `../docs/hook-registry-experiment.md`.
6. Append the complete entry to `EXPERIMENTS.md`.
7. `pnpm typecheck` clean, `pnpm test` ≥ 242 passing, working tree
   committed.

## What goes where

| this directory (`experiments/`) | public docs (`docs/`) | benchmark harness (`eval/`) |
|---|---|---|
| session notes | architecture, how-it-works | the SkillCraft scaffolding |
| running plan + log | client-facing release plan | runner scripts, scorers |
| `/goal` strings | proof-skillcraft (website copy) | results dirs (gitignored) |
| iteration scratchpad | committed headline rows | normalize/analyze scripts |

## Pre-existing structure preserved

The headline-rows-per-iteration table lives at
`../docs/hook-registry-experiment.md`. It's the public face of the
experiment cycle and stays in `docs/` for that reason. EXPERIMENTS.md
references it; each iteration appends one row to it and stores the
analysis + error-taxonomy JSONs under `eval/skillcraft/reports/`.
