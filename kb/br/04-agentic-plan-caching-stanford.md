---
title: "Agentic Plan Caching (Stanford 2025): Test-Time Memory for Plan-Act Agents"
date: 2026-05-01
mode: scan
sources: 1
status: complete
---

# Agentic Plan Caching (Stanford 2025): Test-Time Memory for Plan-Act Agents

## Executive Summary

Stanford's APC paper (Zhang, Wornow, Wan, Olukotun, arXiv 2506.14852v2) is the cleanest concurrent academic validation of AtlasFS's central thesis: ReAct-style Plan-Act agents are expensive at the planning stage, that cost is repeatable across semantically similar tasks, and the right caching unit is the *plan template* not the *query response*. APC reports a 50.31% cost reduction and 27.28% latency reduction at 96.61% of accuracy-optimal performance across FinanceBench, QASPER, AIME, TabMWP, and GAIA. The cache overhead itself is 1.04% of total cost on average, 1.31% in the worst case where hit rate is zero. The paper builds on the Minions architecture (large planner LM in cloud + small actor LM at edge) and also integrates into Hugging Face's Open Deep Research smolagents harness; the GAIA result on Open Deep Research is 76.42% cost reduction with a 0.61% accuracy delta.

For AtlasFS the relevance is direct, and largely *confirmatory rather than competitive*. Two of APC's biggest empirical results are decisions AtlasFS already made independently and goes further on: (a) keyword-exact-match beats semantic-similarity for cache lookup (false-positive rate, scalability at 10^6 entries: 56 microseconds exact vs 148ms fuzzy); AtlasFS's procedure-signature match is the same idea with no LLM in the lookup path. (b) Plan templates beat full execution histories because small LMs choke on long unfiltered logs; AtlasFS's "trajectory is the procedure" design (kb/product-design.md key decision 6) skips both the rule-based and the LLM-based filtering steps APC needs because the trajectory is already valid TypeScript, no extraction phase required.

The places APC genuinely teaches us something for the hackathon are operational: cold-start behaviour with empirical curves, an "auto-disable caching when hit rate is persistently low" guardrail, cache-size diminishing returns at roughly the unique-keyword count of the workload, and a clean three-tier baseline framing (accuracy-optimal, cost-optimal, semantic, full-history) that we should mirror in the eval harness. The paper also exposes one structural blind spot APC has and AtlasFS plugs: APC has no schema-drift story, so if the underlying data changes a cached plan silently becomes stale; AtlasFS's `SCHEMA_VERSION` fingerprint plus Change-Stream walker (kb/product-design.md core principle 2 and key component "Schema fingerprint + drift workflow") is exactly that defence and is worth highlighting in the pitch as differentiation, not just plumbing.

## Overview

**What it is.** A NeurIPS-line research artefact (Stanford SystemX-flavoured, Olukotun group) proposing test-time plan caching for Plan-Act LLM agents. The paper has both a system contribution (the APC framework, with a Python prototype) and a measurement contribution (five-workload eval against four baselines plus two agent harnesses, Minion and Open Deep Research). Core insight: the Plan stage of a ReAct loop is where most LLM cost concentrates, planning is repetitive across semantically similar tasks, and the unit of reuse should be a *structured plan template* parameterised away from data-specific details. Templates are extracted at test time from completed runs, keyed by a keyword extracted from the original query, and adapted by a small LM at retrieval time.

**Authors and provenance.** Qizheng Zhang (NSF CNS-2211384), Michael Wornow (NSF Fellowship + Stanford HAI), Gerry Wan, Kunle Olukotun. Acknowledges Avanika Narayan (the Minions paper's first author) and the LMCache team. v2 submitted to arXiv on 2025-06-17; not yet open-sourced as of writing ("data and code will be open-sourced upon publication of the paper").

**Why it matters now.** The paper is the cleanest published statement of an idea that is currently being rediscovered in several forms simultaneously: Cloudflare's Code Mode (collapse N tools into one typed namespace and let the agent write code), Anthropic's Tool Search Tool (search for a tool when you need one), the pctx / CMCP open-source projects, and now Stanford's APC (extract a plan template, parameterise away the task-specific bits, reuse on a hit). All of these are responses to the same problem: ReAct loops are expensive, and the expense is repetitive across tasks. AtlasFS sits in the same conceptual neighbourhood and is, by my read, the most ambitious instantiation of the family because it pushes the cached object all the way down to a typed-filesystem artefact rather than a string template.

## How It Works

### APC pipeline at a glance

```
+---------------------------------------------------------------+
|   Query q  +  Context ctx                                     |
+----------------------+----------------------------------------+
                       |
                       v
            +---------------------------+
            |   Keyword extraction      |   small LM (gpt-4o-mini)
            |   (~42s / 100 queries)    |
            +-------------+-------------+
                          |
                          v
            +---------------------------+
            |   Cache lookup            |   exact-match dict, O(1)
            |   (Python dict, 56 us at  |   no semantic search
            |    10^6 entries)          |
            +------+-------------+------+
                   |             |
            HIT    |             |   MISS
                   v             v
        +-------------------+   +-----------------------+
        | Small planner LM  |   | Large planner LM      |
        | adapts template   |   | generates new plan    |
        | with ctx          |   | (LLaMa-3.1-8B as      |   (gpt-4o, claude-3-5-sonnet)
        |                   |   |  small adapter; gpt-4o|
        |                   |   |  as large planner)    |
        +---------+---------+   +-----------+-----------+
                  |                         |
                  +------------+------------+
                               |
                               v
                  +-------------------------+
                  |   Actor LM executes     |   LLaMa-3.1-8B locally
                  |   plan against ctx      |
                  +-----------+-------------+
                              |
                              v
                  +-------------------------+
                  |   Done?                 |
                  +-----------+-------------+
                              |
              not done        | done (cache miss only)
                  v                         |
        loop back to planner                v
                            +---------------------------+
                            |   Two-step template       |   rule-based filter
                            |   extraction:             |   strips reasoning
                            |   1. rule-based filter    |   verbosity; LLM
                            |   2. LLM-based filter     |   filter strips
                            |                           |   entity names,
                            |   ~3.99s per template     |   numeric values
                            +---------------------------+
                                          |
                                          v
                            +---------------------------+
                            |   Insert (keyword, tmpl)  |
                            |   into cache              |
                            +---------------------------+
```

### Six load-bearing design choices

1. **Keyword extraction over query similarity.** The paper's Figure 3 shows keyword-based lookup has lower false-positive *and* lower false-negative rates than semantic-similarity lookup across all thresholds. Reason: query embeddings overweight context-specific tokens (entity names, numbers) and underweight intent. The keyword "mean calculation" is a more stable lookup token than the embedding of "compute the average of all numbers listed in this 10-K filing".

2. **Exact match over fuzzy match.** Fuzzy match (SentenceTransformer all-MiniLM-L6-v2, threshold 0.8) is 2 to 3 orders of magnitude slower at scale: 56 microseconds (exact) vs 148ms (fuzzy) at 10^6 entries. Lower fuzzy thresholds (0.6, 0.8) trade accuracy for hit rate (85.5% accuracy at threshold 1.0, 77% at 0.6 on FinanceBench).

3. **Plan templates over full execution history.** Caching the full agent log as in-context demonstration (the "full-history" baseline) underperforms templates by 13.5 accuracy points on FinanceBench (72% vs 85.5%) and costs more ($1.99 vs $1.86). Reason: small planner LMs (LLaMa-3.1-8B) can't process long unfiltered logs even when the relevant pattern is in there.

4. **Two-step template extraction (rule + LLM filter).** Rule-based filter strips verbose reasoning steps; LLM-based filter (gpt-4o-mini) genericises the residue by removing entity names and numeric values. Output is a keyword plus a parameterised template. Cost: roughly 1% of total per cache entry.

5. **Small LM adapts on hit, large LM only on miss.** Adaptation is a structurally smaller task than de novo planning, so a cheaper model suffices. Cost asymmetry is the source of most of the savings.

6. **Test-time, not offline.** Cache is built from successful runs in production rather than pre-populated from a training set. The paper acknowledges cold start is real (hit rate 14% at the 20th percentile of queries, climbing to 48% by the 100th in the FinanceBench warm-up trace) and recommends pre-warming where the workload is predictable.

### Empirical headlines

| Result | Magnitude |
|--------|-----------|
| Cost reduction across five workloads (Minion harness, FinanceBench / QASPER / AIME 24+25 / TabMWP plus Open Deep Research / GAIA) | 50.31% on average |
| Latency reduction (FinanceBench microbench, 100 queries, 46% hit rate) | 27.28% |
| Accuracy retention vs accuracy-optimal baseline | 96.61% on average |
| Cache overhead, main results | 1.04% of total cost |
| Cache overhead, worst case (zero hit rate) | 1.31% of total cost |
| GAIA on Open Deep Research smolagents harness, cost | $69.02 → $16.27 (76.42% reduction), accuracy 37.58% → 36.97% (0.61% drop) |
| Cache lookup latency at 10^6 entries, exact match | 56 microseconds |
| Cache lookup latency at 10^6 entries, fuzzy match (SentenceTransformer 0.8 threshold) | 148ms (~2600x slower) |
| Cache size knee, FinanceBench | ~50 entries gets hit rate 45%, going to 100 yields 46% (diminishing returns at unique-keyword count) |

### Where the paper sits in the landscape

The paper is explicit about its lineage and competition. It cites Case-Based Planning (Bergmann 1996, Spalzzi 2001, Borrajo 2015) as the symbolic precedent, and frames the contribution as the neural-LLM extension: templates are extracted from "unconstrained LLM generations" rather than hand-authored. It cites GPTCache (semantic caching) and CacheBlend / KVLink / RAGCache (KV-cache reuse) as the chatbot-era caching baselines that fail on agent workloads because outputs are data-dependent. It cites MemGPT, Mem0, A-Mem, AgentCache as agent-memory work that targets *capability* (fewer hallucinations, longer horizons) rather than *cost*. The cleanest one-line positioning the paper offers itself: "we shift the focus from query-level caching, suitable for chatbots, to task-level caching, targeting LLM-based agents."

## Strengths

1. **Empirically credible.** Five workloads, two agent harnesses (Minion plus Open Deep Research smolagents), four baselines (accuracy-optimal, cost-optimal, semantic, full-history), reasonable model coverage in the appendix sensitivity analysis (gpt-4o, Claude 3.5 Sonnet, LLaMa-3.1-8B, LLaMa-3.2-3B, Qwen-2.5-7B). Cost numbers are computed from public API pricing as of 2025-Q2, latency numbers come from a dual-Xeon Runpod box. The eval is reproducible in shape if not yet in code.

2. **Clean fail-fast envelope.** Worst-case overhead bounded at 1.31% means the technique is safe to ship even in low-hit-rate workloads. The "auto-disable caching when hit rate stays low" recommendation is a real engineering hedge, not just a footnote.

3. **Architecture-agnostic.** The Open Deep Research integration (smolagents, gpt-4o planner + gpt-4o-mini adapter) shows the framework is not locked to Minion. The keyword-cache-adapt loop is a generic shim around any Plan-Act agent.

4. **Honest about cold start.** The paper does not hide that test-time caching has a warm-up cost; it provides empirical curves (Table 7) and recommends pre-warming. Many caching papers gloss this; APC measures it.

5. **Right call on lookup mechanism.** The exact-match-vs-fuzzy-match section is the most operationally useful part of the paper for anyone building a similar system. The 2600x scaling penalty for fuzzy at 10^6 entries is the kind of number that decides architecture.

## Limitations & Risks

1. **No schema-drift defence.** APC caches keyword and template, nothing more. If the underlying data changes shape between Round 0 and Round N (a column renames, a polymorphic variant emerges, a field's value space shifts), a cached plan silently breaks. The paper acknowledges "highly dynamic workloads with frequent task variations" as a limitation but does not engineer around it. AtlasFS's `SCHEMA_VERSION` plus Change-Stream walker plus ts-morph drift flagging (kb/product-design.md core principle 2) is the missing piece.

2. **Two LLM calls per request even on the cheap path.** Keyword extraction (gpt-4o-mini) is itself an LLM call; the small planner LM runs to adapt the template; the actor LM runs to execute. A hit saves the *large* planner call but does not get the LLM out of the hot path. AtlasFS's tier 3 (compiled aggregation pipeline, kb/product-design.md core principle 1c and "Optimisation-budget worker") is structurally cheaper because the LLM exits the loop entirely once a procedure compiles.

3. **Validation is post-hoc LLM-as-judge, not pre-hoc shadow replay.** APC's correctness gate is a gpt-4o judge comparing the agent's final answer to the ground truth. There is no in-line check that the adapted template *should* execute correctly before it runs. AtlasFS's verifier-checked shadow replay before promotion (kb/product-design.md key decision 6 and "Procedure crystallisation pipeline") is a stronger gate.

4. **Per-tenant emergence is not in frame.** APC has one global cache. The interesting research question of "does the same data substrate produce different reusable templates under different agent populations with different intent priors" is not asked. AtlasFS Dimension 1 (library divergence L_n, kb/product-design.md "Two Dimensions of Adaptation") is the contribution APC implicitly leaves on the table.

5. **GAIA result is honest but flagged.** The GAIA workload (Hugging Face, heterogeneous task space) saw lower hit rates because task descriptions rarely repeat. APC still saved 76% of cost, but mostly through *re-planning reuse* during a single trajectory rather than across-task reuse. This is a useful lesson for AtlasFS: the eval task set must be cluster-shaped, not a uniformly distributed grab-bag, or the convergence axis won't show.

6. **Code unreleased as of arXiv v2.** "Will be open-sourced upon publication" is a soft commitment; nothing to clone today. Useful for citation but not for code reuse.

7. **Two-stage Plan-Act only.** The paper explicitly scopes to two-stage Plan-Act; multi-agent or longer ReAct trees are flagged as future work. Pi's tree-structured trajectory history (kb/product-design.md "Pi (agent harness)") is in the harder regime APC has not yet validated.

## Integration Analysis

### What to extract for AtlasFS

1. **The cold-start curve framing.** APC's Table 7 (hit rate by query percentile, FinanceBench warm-up) is exactly the chart shape the AtlasFS demo needs for "Round 0 to Round N within a tenant" (Dimension 2, kb/product-design.md). Steal the framing: x-axis is task percentile or round number, y-axis is hit rate / cost / latency. We already have this in the eval ledger spec; APC validates the choice of axes.

2. **The auto-disable-on-low-hit-rate guardrail.** Add to the optimisation-budget worker (kb/product-design.md "Optimisation-budget worker"): if a procedure's reuse rate drops below a threshold, demote it from compiled-pipeline back to typed-procedure form. This costs a budget allocation but recovers correctness on drifted data. Effort: small, single config knob plus a counter on the procedure.

3. **The exact-match-over-fuzzy-match argument.** Cite APC's Table 5 directly in the procedure-signature-matching design defence. We already match on signatures (Step 3 of Data Flow, kb/product-design.md), so this is post-hoc justification rather than design change. The 2600x scaling penalty number is a useful slide.

4. **The three-baseline-plus-two-internal-baselines eval shape.** APC compares accuracy-optimal, cost-optimal, semantic, full-history. AtlasFS's three-baseline eval (vanilla agentic RAG, static-typed, ours, kb/product-design.md key decisions 11) is tighter but could borrow APC's *cost-optimal* baseline (small LM only, no caching) as a fourth point. This sets the floor of "how cheap could it be if we just gave up on accuracy" and makes the cost-axis chart more legible. Effort: half a day if we already have the small-LM agent harness wired up.

5. **The cache-size diminishing-returns chart.** APC Table 4 (hit rate plateaus around the unique-keyword count of the workload) is the empirical shape AtlasFS's L_n curve should mirror within-tenant. If our procedure library size stops growing at the unique-intent count of the tenant's workload, that *is* the convergence claim. Worth replicating in the eval harness explicitly.

6. **The GAIA caveat.** APC's result on heterogeneous workloads is lower hit rate but still useful via re-planning reuse. AtlasFS's eval task set (kb/product-design.md "Eval harness") must be intent-clustered for the convergence claim to land; if it ends up uniformly distributed across micro-clusters the curve will look like APC's GAIA, not their FinanceBench. This is a checkpoint on the day-1 eval-design plan.

### Bootstrap path for AtlasFS

Direct lift: cite APC in the architecture writeup as concurrent academic validation of the test-time plan-caching premise. One sentence in the README plus one sentence in the pitch deck. The numbers (50.31% cost, 27.28% latency, 96.61% accuracy) are quotable.

Selective lift: borrow the four operational guardrails (cold-start curve, auto-disable, cache-size knee, post-hoc judge as a sanity check on top of shadow replay) into the eval harness and budget worker.

No lift: do not borrow APC's keyword-extraction LLM call. AtlasFS's procedure-signature match is structurally cheaper (no LLM, type-system check) and we should defend that choice in the writeup, not converge to APC's design.

### Effort estimate

- Citation plus paragraph in the architecture doc: Quick (under 1 hour).
- Adding cost-optimal as a fourth baseline in the eval harness: Short to Medium (4 hours to a day, depending on small-LM wiring).
- Adding auto-disable-on-low-reuse to the budget worker: Quick (under 1 hour, a counter and a threshold).
- Replicating cache-size knee chart in the eval ledger: Short (a few hours, reuses existing telemetry).

Total integration effort if we adopt all five lifts: roughly one engineer-day, mostly eval harness plumbing.

### Open questions for AtlasFS

1. Should the demo include an explicit "APC-style" baseline (keyword-cache + small-LM-adapt over typed primitives without crystallisation) as a fifth comparison point? Pro: it makes the "code-mode crystallisation beats string-template caching" claim crisp. Con: another engineering surface in a 48-hour build.

2. Does AtlasFS's per-tenant procedure library naturally avoid APC's GAIA-style heterogeneity problem? Hypothesis: yes, because per-tenant scoping clusters intents by construction. Worth stating explicitly in the writeup as a structural advantage.

3. APC's two-step extraction (rule + LLM) is dead weight in our design because trajectories are already typed code. Worth a sidebar in the architecture doc making this explicit, since the question "why no template-extraction LLM?" will come from any reviewer who has read APC.

## Key Takeaways

1. **APC is the strongest published validation of the AtlasFS thesis.** The 50.31% / 27.28% / 96.61% triple across five workloads is the cleanest existing evidence that test-time plan caching for Plan-Act agents pays for itself. Cite this in the pitch and in the architecture writeup; it removes the burden of proving the premise from scratch in 48 hours.

2. **AtlasFS goes structurally further on three axes.** Keyword-LLM-call vs typed-signature match (no LLM in lookup), small-LM-adapt vs compiled-pipeline (no LLM in hot path on tier 3), no-schema-drift vs `SCHEMA_VERSION` plus Change-Stream walker. State these three deltas explicitly in the README architecture section; they are the differentiation that makes AtlasFS more than "APC on a filesystem."

3. **Borrow APC's operational guardrails, drop its lookup mechanism.** Auto-disable on low reuse, cold-start prewarm, cache-size knee tracking, and the cost-optimal fourth baseline are all cheap lifts. The keyword-extraction LLM call is not, do not adopt it.

4. **Per-tenant interface emergence (Dimension 1) is the contribution APC implicitly leaves on the table.** APC has one global cache; AtlasFS has per-tenant procedure libraries. The "library divergence L_n" claim is genuinely novel against the strongest concurrent baseline. This should be the leading slide of the pitch, not a footnote.

## Sources

- [Agentic Plan Caching: Test-Time Memory for Fast and Cost-Efficient LLM Agents](https://arxiv.org/html/2506.14852v2) , Zhang, Wornow, Wan, Olukotun, Stanford, arXiv 2506.14852v2, submitted 2025-06-17. The full paper, 11,372 words, NeurIPS-style with five-section main body plus five appendices (algorithms, experiment setup, extended results, example workflows, limitations).
- Cited within for context: Narayan et al. "Minions" (cloud-edge LLM systems), Yao et al. "ReAct", Bang et al. "GPTCache" (semantic caching baseline), Roucher et al. "Open Deep Research" smolagents, Mialon et al. "GAIA". Not separately fetched; quoted as the paper presents them.
