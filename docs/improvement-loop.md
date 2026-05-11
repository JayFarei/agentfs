# How datafetch Improves Over Time

datafetch is trying to prove that a dataset interface can adapt to how agents
actually use it.

The hypothesis:

```text
Repeated agent sessions over the same dataset should produce reusable,
intent-shaped TypeScript interfaces that make future sessions cheaper, faster,
more reliable, and easier to audit than fresh agentic search.
```

## Episode First, Interface Later

Every query creates an episode.

An episode includes:

- the mounted intent;
- exploratory `datafetch run` attempts;
- committed `scripts/answer.ts`;
- answer envelope;
- evidence handles;
- lineage of `df.db.*` and `df.lib.*` calls;
- validation output;
- replay test;
- telemetry and cost signals.

Not every episode should become a learned interface. One-off tasks should stay
as archived episodes. Only repeated, validated, reusable data-molding logic
should be promoted.

## Learning Loop

The intended loop is:

```text
user intent
-> mounted dataset workspace
-> exploration through db/ and scratch.ts
-> committed visible TypeScript in scripts/answer.ts
-> df.answer(...) with evidence and derivation
-> validation and replay test
-> observer/distiller
-> reusable lib function
-> future workspaces discover and reuse that function
```

In code-mode terms, the dataset starts with primitive handles and gradually
gains a tenant-local interface shaped around observed intents.

## Cold Path

The cold path is what happens before the system has a useful learned
interface.

The agent must:

1. inspect `AGENTS.md`, `df.d.ts`, and `db/`;
2. sample or search the dataset;
3. identify which data can support the intent;
4. write a visible trajectory in `scripts/answer.ts`;
5. commit the answer through `datafetch commit`.

This may be slower than a direct search API call. That is acceptable. The cold
path is where the system captures reusable work.

## Warm Path

The warm path is what should happen after prior episodes created reusable
interfaces.

The agent should:

1. inspect `df.d.ts`, `lib/`, `datafetch apropos`, and `datafetch man`;
2. find a matching learned function;
3. call it from `scripts/answer.ts`;
4. get an answer, partial answer, or safe unsupported result;
5. avoid recomposing the primitive chain unless the learned function does not
   fit.

The desired warm path is smaller:

```ts
return await df.lib.someLearnedIntentInterface({
  entity,
  metric,
  period,
});
```

## What Gets Promoted

A good learned interface should capture durable data-molding logic:

- dataset-specific retrieval strategy;
- evidence selection;
- normalization;
- validation;
- derivation;
- abstention policy;
- known counterexamples;
- answer formatting.

It should not simply preserve the exact call graph of one query. The durable
object is the intent-shaped program, not the diary of one session.

## Current Prototype Behavior

The current prototype already captures and validates committed trajectories.
It also has an observer path that can author learned `/lib/<tenant>/...`
interfaces from validated trajectories and surface them through `apropos`,
`man`, and `df.d.ts`.

The current implementation is intentionally still prototype-grade:

- promotion is closer to immediate/provisional crystallisation than a mature
  multi-episode distillation process;
- domain packs exist for demos, but generic mounts should not see them unless
  explicitly enabled;
- replay tests are generated from committed answers, but full benchmark-scale
  regression suites still need to be built;
- we still need evals proving that future agents actually discover and reuse
  learned interfaces under realistic conditions.

## Quality Gates

A trajectory is learnable only if the committed answer is visible and
validated.

Minimum gates:

- `scripts/answer.ts` returns `df.answer(...)`;
- answer status is `answered`, `partial`, or `unsupported`;
- evidence is present when needed;
- derivation is visible;
- lineage records the relevant `df.*` calls;
- validation accepts the answer;
- replay test captures the expected behavior.

Private manipulation, fabricated evidence, stdout-only answers, and hidden LLM
reasoning should not become learned interfaces.

## What We Want To Improve

The next product question is not simply whether datafetch can answer a single
query.

It is whether the harness gets better after use:

- Does the second or third related intent reuse prior work?
- Does reuse reduce latency, tool calls, and LLM calls?
- Does answer quality stay stable or improve?
- Does evidence selection become more reliable?
- Does the system abstain safely when evidence is missing?
- Do replay tests catch regressions when an interface is generalized?

That is the learning claim the benchmark must test.
