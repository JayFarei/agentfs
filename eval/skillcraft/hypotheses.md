# Hypotheses

## Primary Hypothesis

On held-out SkillCraft sibling and hard tasks, datafetch learned interfaces are
non-inferior to native SkillCraft skill mode on official evaluator score while
reducing effective token usage.

## Secondary Hypotheses

- Datafetch warm tasks reduce wall-clock latency compared with native
  SkillCraft skill mode.
- Datafetch warm tasks reduce low-level tool calls compared with SkillCraft
  base mode.
- Datafetch hard tasks preserve most of the warm-path efficiency gain.
- Datafetch replay checks catch learned-interface regressions before they
  affect later tasks.

## Non-Claims

- A synthetic `df.db.records` subset is not evidence of full SkillCraft
  performance.
- A deterministic source generator is not evidence of live agent performance.
- A warm scaffold that hard-codes task constants is not enough to claim learned
  interface discovery.

