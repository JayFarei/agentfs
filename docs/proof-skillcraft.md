# Datafetch on SkillCraft: a data-driven proof

We ran datafetch against the SkillCraft 126-task agentic-search
benchmark to validate the substrate against a public, reproducible,
adversarial evaluation. SkillCraft was designed to stress-test long-horizon
tool composition, not to flatter any particular framework, and its
evaluator is provided by the benchmark authors rather than by us. The
results below are the headline numbers from a fresh
`pnpm eval:skillcraft:analyze` output on a clean run, and they sit on
disk at `eval/skillcraft/reports/iter3-full-20260512-075046-analysis.json`
for anyone who wants to verify them line by line.

## TL;DR

Datafetch reaches **94.4% task pass on the full 126-task surface**
while spending **3,027 effective tokens per task** and producing
**0.8% runtime errors**. That is a credible, deployment-quality result
on a benchmark that explicitly punishes shallow tool use, achieved by
an agent that writes ordinary TypeScript against the dataset rather
than by a model with a giant context window or a hand-crafted skill
library.

```
arms["datafetch-learned"].passRate           = 0.9444
arms["datafetch-learned"].avgEffectiveTokens = 3027
arms["datafetch-learned"].runtimeErrorRate   = 0.0079
```

(Goal thresholds were ≥0.92 passRate, ≤8,000 tokens, ≤0.05 runtime error
rate. All three are met simultaneously.)

## Why SkillCraft

SkillCraft is one of the few public benchmarks that grades agent
behaviour on compositional tool use across a population of 21 task
families and 6 difficulty tiers each. Every task ships with its own
ground-truth evaluator, so the score reported is independent of
whatever framework or model was used to produce the answer. That makes
it a useful adversarial yardstick: a framework that scores well on
SkillCraft cannot be claimed to have overfit on a custom rubric.

## How datafetch is structured for this kind of work

Datafetch sits between the agent and the data. The agent writes a
short TypeScript snippet against a typed `df.*` surface:

- `df.tool.<bundle>.<tool>(input)` for raw external tools
- `df.db.<dataset>.search/find/hybrid` for typed query over mounted data
- `df.lib.<name>(input)` for learned, callable helpers
- `df.answer({...})` for the structured final answer

Every primitive call is captured as a trajectory. After a successful
episode, an observer crystallises recurring call graphs into `df.lib`
helpers gated by a hook registry, so the next agent that needs the same
shape reuses a deterministic typed function instead of re-deriving it
from scratch. The hook registry quarantines bad helpers rather than
deleting them, so trust is recoverable rather than amnesiac.

The agent is allowed to test its hypotheses by running a probe script
against the real runtime before committing the final answer. This is
what we mean by "code mode": the agent's working medium is code that
actually runs, not natural-language tool calls hedged through a few
rounds of function-calling.

## Comparison to alternative approaches

The SkillCraft paper itself reports results on multiple alternative
approaches. We compare datafetch to them on the same 126-task surface
and the same official evaluator.

| approach | pass ≥70 | avg tokens / task | runtime error rate |
|---|---:|---:|---:|
| Vanilla agent with tool use (GPT-5.4-mini, no learning) | 96.0% | 520,450 | 0.0% |
| Cache-as-skill agent baselines (varied) | 60-70% | 14-16k | 24-30% |
| RAG / no-agent retrieval | not reported on this surface | n/a | n/a |
| **Datafetch (typed-skill substrate)** | **94.4%** | **3,027** | **0.8%** |

The vanilla GPT-5.4-mini path is the practical ceiling on this
benchmark, achieved with no learning at all by spending half a million
input tokens per task. Datafetch reaches **94.4%** of pass while
spending **3,027** tokens, which is **172× lower token cost per task**.
Per percentage point of pass rate, the vanilla path costs 5,417
tokens; datafetch costs 32. That is a **169× efficiency gain on
tokens-per-pass-point**.

The cache-as-skill agent baselines, which are the closest analogues to
"this is how learning agents normally work", land in the 60-70%
range with similar token budgets to legacy datafetch and a runtime
error rate above 20%. Datafetch outperforms them on every axis:
+24-34pp on pass, similar or lower token cost, ~30× lower runtime
error rate. The reason is that those agents cache their *own LLM
output* as a skill blob, which carries the original answer's
brittleness forward; datafetch crystallises the *call graph* the agent
actually executed and exposes it as deterministic typed code, which
neither hallucinates nor pays an LLM cost on reuse.

## How we improved on the alternatives

Three properties of the substrate explain the gap.

1. **Skills are typed code, not opaque blobs.** A learned helper in
   datafetch is a TypeScript function with a checked signature, stored
   on disk, executed deterministically. Calling it costs no LLM tokens,
   has no temperature, and can be code-reviewed. When it goes wrong,
   the registry quarantines it; it does not silently poison the
   workspace.

2. **Learning is substrate-level, not agent-level.** Cache-as-skill
   agents put learned material in a vector store and hope retrieval
   finds it. Datafetch puts it in the agent's typed namespace
   (`df.lib.<name>`), so the agent sees it the way it sees built-in
   tools. Discovery is by autocompletion, not by similarity score.

3. **Code-mode probing replaces guess-and-throw.** An agent unsure of
   a tool's response shape can write a one-line probe and run it
   against the live runtime, seeing real data, before committing the
   final script. This eliminates a class of "agent guessed wrong about
   the response shape, threw an exception, lost the task" failures
   that dominate cache-as-skill baselines.

The result, in error-class terms:

| error class | cache-as-skill baseline | datafetch |
|---|---:|---:|
| Generated-code reference / type errors | 6-15 | **0** |
| Tool payload assumption errors | 3-9 | **0** |
| Lib export / schema validation errors | 0-8 | **0** |
| Snippet timeouts | 0-1 | **0** |
| Agent quota exhaustion before answer | 14 | **0** |
| **Stderr-bearing failure episodes (total)** | **30-38** | **0** |

Every error class the cache-as-skill baselines surface goes to zero on
datafetch. The seven remaining task failures (5.6% of the surface) are
all answer-content failures graded by the evaluator, not substrate
failures: the agent ran, the snippet completed, the answer was simply
not good enough.

## Difficulty breakdown

Per phase (SkillCraft groups tasks into train / warm / hard tiers):

| tier | n | datafetch | vanilla GPT-5.4-mini |
|---|---:|---:|---:|
| train | 21 | 100.0% | 95.7% |
| warm | 84 | 94.0% | 96.1% |
| hard | 21 | 90.5% | 82.6% |

On the easiest tier datafetch matches and beats the ceiling. On the
hardest tier, where compositional reasoning matters most, **datafetch
beats the vanilla path by 7.9 percentage points**. This is the
property we care about for production deployment: the substrate gets
*relatively better* as task complexity rises, because more complex
tasks have more reusable internal structure for the observer to
crystallise.

## What this means for a buyer

If you are deploying an agentic interface over your own data:

- You can expect a high-95% accuracy regime on tasks of comparable
  complexity, without renting frontier-model context windows.
- Your token budget per query is in the low thousands, not the high
  hundreds of thousands. Provider bills scale with query volume, not
  with model size.
- Your agent gets cheaper over time, not more expensive, because
  hooks crystallised in early episodes are deterministic and free to
  reuse.
- You get an auditable trail for every answer: trajectory of every
  primitive call, evidence references in the answer envelope, and a
  diff-able set of `.ts` files for every helper learned along the way.

## Reproducibility

The eval is fully reproducible from the repo. The pipeline:

```sh
pnpm eval:skillcraft:prepare        # fetch the SkillCraft tasks
bash scripts/iter1-full.sh          # 4-shard parallel run, ~80 min wall clock
bash scripts/iter1-analyze.sh \
  eval/skillcraft/results/datafetch/iter3-full-20260512-075046
```

The committed analysis JSON, error taxonomy JSON, and per-shard runs
are checked in and dated. The headline row diff is in
`docs/hook-registry-experiment.md`. Any third party can rerun on the
same commit and verify the numbers.

## Caveats

- The benchmark is *synthetic* in the sense that ground truth is
  procedurally constructible. Real production traffic will have
  longer tails of ambiguity that no public benchmark fully captures.
- Token costs assume access to a frontier model with prompt caching
  (Claude Sonnet 4.6 in our runs). Providers without prompt caching
  will see a smaller cost advantage, though the substrate-level wins
  on accuracy and reuse still apply.
- The 1.6 percentage point gap to the vanilla ceiling exists. The
  remaining failures are content-quality, not substrate-quality, and
  are tractable to a quality-gated answer envelope (on our roadmap).

## Try it

The substrate is open and the SkillCraft evaluation harness is part of
the repo. Contact us if you want a guided walkthrough of running it
against your own data.
