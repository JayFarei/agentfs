---
title: "SkillCraft: Auto-Induced Skill Libraries for Tool-Using Agents, and the AtlasFS Differentiation Story"
date: 2026-05-01
mode: deep
sources: 8
status: complete
---

# SkillCraft: Auto-Induced Skill Libraries for Tool-Using Agents, and the AtlasFS Differentiation Story

## Executive Summary

SkillCraft (arXiv:2603.00718, Chen et al., submitted 2026-02-28, revised 2026-03-10) is a March 2026 benchmark and protocol from a 16-author group (Oxford, CityU Hong Kong, HKUST, Northwestern, NUS) that does almost exactly what AtlasFS's procedure crystallisation pipeline does: it equips an LLM agent with four MCP primitives (`save_skill`, `get_skill`, `list_skills`, `execute_skill`) over a "Skill Library", lets the agent auto-abstract successful tool-call sequences into parameterized code-based Skills, validates each candidate through a three-stage Coding Verifier, and reuses the cached Skills on later tasks. The headline numbers are exactly the convergence axes AtlasFS proposes to measure: GPT-5.2 lifts overall success from 109/126 (87%) to 114/126 (90%), cuts average tokens from 1.23M to 0.26M (-79%), drops cost from $1.77 to $0.43 (-75%), and Claude-4.5-Sonnet cuts tokens from 1.36M to 0.40M (-71%). On the same benchmark, success-rate-versus-skill-execution-rate correlates at r=0.65 and stronger models capture larger token savings (r=0.53), which Chen et al. frame as evidence that "tool composition ability is a core metric of intelligence."

For AtlasFS this is the strongest direct prior art identified to date and **must be cited in Related Work**, but it is not a kill shot. The fit is "highly relevant, frames the AtlasFS delta sharply, partially threatens the cost-convergence half of the pitch, leaves the per-tenant emergence half untouched." Five concrete AtlasFS axes are not in SkillCraft and constitute defensible novelty: (1) **user-endorsed crystallisation, not deterministic auto-induction**, which SkillCraft explicitly leaves to a Coding Verifier with no human gate; (2) **per-tenant library divergence (Dimension 1, L_n)**, the headline of the AtlasFS pitch, which SkillCraft does not address (single-agent libraries, no multi-tenancy notion); (3) **compile-to-pipeline (Tier 3)**, which collapses verified procedures into a single Atlas aggregation pipeline taking the LLM out of the hot path, where SkillCraft skills stay as code the agent invokes; (4) **typed filesystem discovery surface**, where SkillCraft uses MCP-style primitives over a fixed tool set; (5) **schema fingerprint and Change-Stream-driven drift handling**, which SkillCraft sidesteps by holding the tool surface static. The hierarchical-skill negative result in §5.1 of SkillCraft (deeper nesting amplifies error propagation, "shallow well-tested skill libraries are currently more reliable and cost-effective than deep automatically-generated hierarchies") is a free gift to AtlasFS: compile-to-pipeline is the alternative to deep nesting, collapsing a successful procedure to one Atlas call rather than stacking skills.

The actionable instruction set is in the Integration Analysis. The short version: cite SkillCraft as the canonical auto-induction baseline, port its three-stage Coding Verifier (syntax, runtime, post-execution quality) into AtlasFS's verifier near-verbatim, adopt its metric vocabulary (Exec Rate, Reusing Rate, plus the existing T_n / D_n / R_n / I_n) onto the eval ledger to make like-for-like comparison legible, and consider running SkillCraft's protocol as an additional fourth baseline in the pre-registered eval if Day 1 capacity allows. Use Dimension 1 and the compile-to-pipeline tier as the wedge in any judge conversation that opens with "isn't this just SkillCraft?".

## Overview

**What it is.** SkillCraft is two artefacts plus an ideology. The artefacts: (a) a 126-task benchmark across 6 application domains and 21 task families with explicit quantitative-and-complexity scaling axes; (b) a "Skill Mode" protocol exposed as four MCP primitives that retrofit any tool-using agent with a persistent skill library. The ideology: tool composition ability, not raw tool-call accuracy, is the unmeasured capability gap, and skill auto-abstraction plus reuse is the natural primitive that closes it. The paper benchmarks eight frontier models (Claude-4.5-Sonnet, GPT-5.2, Gemini-3-Pro, DeepSeek-V3.2-EXP, DeepSeek-R1, Kimi-K2-Thinking, MiniMax-M2.1, GLM-4.7) under base mode versus Skill mode and reports that Skill Mode strictly improves both success and efficiency on every model except a small regression for the model that already had high baseline efficiency.

**Adoption and traction signals.** The paper is fresh (preprint dated 2026-03-11), so direct citation count is low, but the citation graph is already forming: it is referenced in arXiv:2603.25723 ("Natural-Language Agent Harnesses") within weeks of v2. Code is at [github.com/shiqichen17/SkillCraft](https://github.com/shiqichen17/SkillCraft); a project page exists at [skillcraft-website.github.io/page](https://skillcraft-website.github.io/page). The author roster spans groups that have shipped tool-use research at scale (Junxian He, Yee Whye Teh, Manling Li), so this is a credentialed contribution rather than a speculative preprint.

**Why it matters now.** Three forces converge. First, the auto-induced skill library is the obvious next move after Voyager (Wang et al., 2023, arXiv:2305.16291), CREATOR (Qian et al., 2023), and ASI (arXiv:2504.06821), which AtlasFS already lists in its mental-model lineage; SkillCraft makes it benchmarkable. Second, the headline efficiency numbers (-71% to -79% tokens at parity-or-better success on frontier models) land in the same regime as AtlasFS's pitch, which means a judge with this paper in mind will read the AtlasFS efficiency claim as table stakes rather than as a moat. Third, the protocol is implemented as MCP primitives, which means anyone with an MCP server can clone it in days; the moat lives in the things SkillCraft does not do, which happen to be the four AtlasFS deltas listed above. The window in which "skill library plus verifier" is a fresh framing is closing; AtlasFS's wedge needs to be the per-tenant emergence axis, not the within-tenant convergence axis.

## How It Works

### Architecture, in one diagram

```
+-----------------------------+        +-------------------------+
|  Test-Time Tool-Chain       |        |   Skill Library         |
|  Evolution                  |  save  |   (verified Skills +    |
|  - atomic tool exploration  +------->+    metadata)            |
|  - records successful       |        |                         |
|    sequences                |        |   region_earthquakes... |
+--------------+--------------+        |   gitlab_project_a...   |
               |                       |   tvmaze_show_data_e... |
               | abstract              |   country_economic_a... |
               v                       +-----------+-------------+
+-----------------------------+                    |
|  Iterative Skill            |                    |
|  Composition                |    list_skills,    |
|  - parameterize successful  |<-------get_skill,--+
|    sequence as code         |        execute_skill
|  - Coding Verifier (3-stage)|                    |
|  - if pass: save_skill      |                    |
|  - if fail: re-explore      |                    v
+-----------------------------+        +-------------------------+
                                       |  Agent on next task     |
                                       |  - reuse first,         |
                                       |  - explore on miss      |
                                       +-------------------------+
```

The pipeline has three stages and four primitives. The three stages are Test-Time Tool-Chain Evolution (atomic tool exploration that records successful sequences), Iterative Skill Composition (parameterizing those sequences into code-based candidate Skills, then validating them in a coding environment), and Skill Library and Reuse (a growing repository the agent queries first on every new task). The four primitives are the only interface to the library: `save_skill` to persist a verified workflow, `get_skill` to retrieve code and metadata, `list_skills` to enumerate, and `execute_skill` to invoke a saved Skill as a higher-level tool.

### The protocol pipeline

For every new task the agent runs four steps in order. Step 1, **Reuse Attempt**: query `list_skills`, attempt `execute_skill` with task-specific parameters if any signature plausibly matches. Step 2, **Exploration**: if no Skill matches or execution fails, fall back to atomic tools and record the successful sequence. Step 3, **Composition**: abstract the successful sequence into a parameterized candidate Skill, consolidating recurring subroutines and passing intermediate results through code variables rather than natural language. Step 4, **Verification and Saving**: execute the candidate Skill in a controlled Coding Env via a unified `call_tool()` interface, run the three-stage Coding Verifier, and on pass call `save_skill`. The protocol is intentionally minimal: no preference learning, no human-in-the-loop, no router model.

### The Coding Verifier (three stages)

This is the part of SkillCraft that maps most directly onto AtlasFS's existing "verifier-checked promotion" principle (Decision 6 in `kb/product-design.md`). The three stages, quoting and condensing §3.2:

1. **Syntax validation** before accepting `save_skill`, parses the candidate Skill code, rejects syntactically invalid submissions with error line numbers and context snippets to block fundamentally broken code.
2. **Runtime error reporting** when `execute_skill` fails, returns structured debugging information (exception messages, tracebacks, input parameters) so the model can distinguish syntax issues from tool invocation problems and parameter mismatches.
3. **Post-execution quality detection** to filter out useless Skills, detects silent failures by checking output quality. The published heuristic: "if over 50% of output fields contain `Unknown`, `None`, or `0`, we flag the Skill as low-quality and reject it."

The third stage is the part AtlasFS does not currently match. AtlasFS's verifier compares the procedure's replayed result against the trajectory's recorded result on a shadow input, which catches mismatches but does not catch a procedure that "succeeds" while returning mostly-null payloads. Porting the 50%-null heuristic into the AtlasFS verifier is roughly an hour's work and closes a real gap.

### Tasks and difficulty scaling

126 tasks across 21 task families across 6 domains: Entertainment & Gaming (28.6%), Reference & Knowledge (19.0%), Education & Society (19.0%), Science & Environment (14.2%), Food & Lifestyle (9.5%), Developer & Web (9.5%). Sources are existing benchmarks (Toolathlon, AgentCompany, WebArena, M3ToolEval), public APIs wrapped as standardized tools (GitLab, OpenMeteo, TVMaze), and handcrafted local file and data-processing tasks. Two scaling axes:

- **Quantitative scaling** increases entity count per task (e.g., "fetch one repo" becomes "fetch five repos and analyze contributor correlations"). Range 3 to 5.
- **Complexity scaling** increases tool calls per subtask (e.g., from atomic fetch-and-extract to multi-step fetch-extract-correlate). Range 3 to 5.

Combined difficulty buckets: Easy 63 tasks (50.0%), Medium 42 (33.3%), Hard 21 (16.7%). The full task pool is generated from 21 hand-designed seed tasks via systematic combination of the two axes.

### Metrics

Three Skill-specific metrics on top of standard task metrics. **Success Rate** counts a task successful at score >= 90 against a human-expert handcrafted matching rule (this is the Toolathlon convention). **Exec Rate** is the fraction of Skill execution attempts that succeed. **Reusing Rate** is the average number of times each saved Skill is invoked. Efficiency metrics include input/output tokens, LLM turn count, tool-call count, and dollar cost. Diff metrics are computed only over tasks where both base and Skill mode succeed, to avoid the trivial case where a failure path uses fewer tokens because it gave up faster.

### Headline empirical results (Table 2, paper §4)

Quoted directly from Table 2, ordered by overall success rate gain on closed-source models:

| Model | Base success | Skill success | Tokens base -> skill | Cost base -> skill | Reuse |
|-------|---|---|---|---|---|
| GPT-5.2 | 87% | 90% | 1.23M -> 0.26M (-79%) | $1.77 -> $0.43 (-75%) | 3.8x |
| Claude-4.5-Sonnet | 94% | 96% | 1.36M -> 0.40M (-71%) | $1.08 -> $0.28 (-74%) | 3.4x |
| Gemini-3-Pro | 86% | 92% | 0.66M -> 0.30M (-54%) | $0.59 -> $0.30 (-49%) | 3.9x |
| DeepSeek-V3.2-EXP | 60% | 71% | 0.51M -> 0.26M (-49%) | $0.21 -> $0.10 (-51%) | 4.8x |
| DeepSeek-R1 | 71% | 80% | 0.58M -> 0.41M (-30%) | $0.24 -> $0.18 (-24%) | 6.2x |
| GLM-4.7 | 72% | 57% | 0.78M -> 0.48M (-39%) | $0.20 -> $0.12 (-41%) | 3.7x |
| Kimi-K2-Thinking | 44% | 44% | 0.51M -> 0.30M (-42%) | $0.21 -> $0.13 (-39%) | 3.4x |
| MiniMax-M2.1 | 93% | 94% | 0.42M -> 0.38M (-11%) | $0.04 -> $0.04 (-8%) | 3.2x |

Two patterns are stable. First, the strongest models capture the largest token savings (Claude and GPT-5.2 hit -71% and -79%); the paper's own framing is "Skill Mode acts as a capability amplifier." Second, weaker open-weight models (Kimi, GLM, DeepSeek) sometimes regress on success rate (e.g., GLM-4.7 drops from 72% to 57%) because they over-apply Skills when they shouldn't. The paper attributes the regressions to over-rigid composition behaviour.

### The hierarchical-skill negative result (§5.1)

SkillCraft tested an Iteration Mode where Skills can invoke other Skills (`call_tool` resolves to `execute_skill` recursively, max nesting depth 10). The result is unambiguous: **Hierarchical Mode performs worse than flat Skill Mode**. GPT-5.2 drops from 90% (flat) to 79% (hierarchical), Claude-4.5-Sonnet stays at 96% but increases token cost (0.40M to 0.63M). Three failure modes: (1) compounding failures where a Skill at depth d depends on its full dependency subtree; (2) latent bugs where early-created Skills harbor edge-case errors that propagate to all higher-level Skills built on them; (3) debugging overhead from tracing failures through dependencies. The paper's conclusion: "shallow, well-tested skill libraries are currently more reliable and cost-effective than deep, automatically generated hierarchies; realizing the latter likely requires much stronger systematic error handling and compositional verification."

### Cross-task generalization (§5.2, Table 4)

Skills learned on Easy tasks transfer to Hard tasks within the same family. Claude-4.5-Sonnet on Easy->Hard transfer raises success from 95% to 100% and cuts tokens from 1.92M to 1.56M (-19%); Hard->Easy raises success and cuts tokens by 45%; Hard->Hard keeps success at 95% while dropping tokens from 1.96M to 0.47M (-76%). This is a strong reusability signal: the Skills are not over-fit to source-difficulty.

## Strengths

- **Protocol is minimal and reproducible.** Four MCP primitives plus a three-stage verifier. Any team with an MCP-capable agent can implement this in a sprint. Code is open. This is exactly the protocol AtlasFS's procedure crystallisation pipeline implements, which means the implementation contract is now established public art and AtlasFS gets to inherit the "this is well-trodden" affordance.
- **Coding Verifier is concrete enough to port.** Three stages, each with a clear pass/fail rule. The 50%-null post-execution quality check is a small, high-leverage addition to AtlasFS's existing replay-against-shadow-input verifier. Direct port, low effort.
- **Dataset construction is principled.** Two orthogonal scaling axes, three stages of curation, six application domains. AtlasFS's pre-registered intent-clustered eval can borrow the construction pattern even though the domain is supply-chain rather than the SkillCraft mix.
- **Efficiency-versus-capability framing matches AtlasFS's pitch.** "Stronger models benefit more from skill reuse" is exactly the curve the AtlasFS hot-path overlay is designed to show, and SkillCraft's r=0.53 correlation between baseline success rate and turns-saved is a precedent the AtlasFS eval can cite when reporting its own correlation numbers.
- **Hierarchical negative result is a useful gift.** Compile-to-pipeline (AtlasFS Tier 3) is the alternative to nesting Skills, and SkillCraft's empirical case for "shallow libraries beat deep hierarchies" is the strongest-possible argument for why AtlasFS should compile rather than nest. AtlasFS gets to cite SkillCraft's negative result as motivation for its positive solution.

## Limitations & Risks

- **Skill auto-induction without human endorsement is the critical design choice SkillCraft does not interrogate.** The Coding Verifier filters broken code and obviously-null outputs but cannot detect a Skill that is correct on the source task and slightly-wrong on adjacent tasks (semantic drift). AtlasFS's Decision 6 (user-endorsed crystallisation) is the structural answer to this, but the cost is a UI surface and a human-in-the-loop step. The risk is that a judge says "your endorsement step is just slowing down what SkillCraft already automates"; the rebuttal is the GLM-4.7 regression in Table 2 (over-applying Skills costs success) and the Reuse-Rate column showing some models save Skills they reuse only 3.2 to 3.4 times.
- **Single-agent / single-tenant scope.** SkillCraft does not test cross-tenant divergence. The library is one library per agent. There is no L_n metric, no per-tenant overlay, no notion that the same data plane should produce different libraries for different intent priors. This is the largest gap relative to AtlasFS's pitch and is where the AtlasFS Dimension 1 wedge has to live.
- **No compile-to-deterministic-execution tier.** SkillCraft Skills remain code that the agent invokes via `execute_skill`. The LLM is still in the hot path on every Skill invocation, even if the Skill executes deterministically once invoked. AtlasFS's compile-to-pipeline removes the LLM from the hot path entirely on a successful crystallisation. This is the second-largest gap.
- **No schema-drift handling.** SkillCraft assumes the tool surface is static. AtlasFS's whole fingerprint-and-Change-Stream story is unaddressed. In a real document-store deployment where collections evolve, a SkillCraft skill library would silently rot.
- **Hierarchical composition is broken at depth.** The §5.1 result is a hard ceiling on the SkillCraft protocol. AtlasFS does not need to defend hierarchical composition since compile-to-pipeline replaces it, but any team trying to extend SkillCraft directly hits this ceiling.
- **Open-source model regressions are real.** GLM-4.7 drops 15 percentage points. Kimi-K2-Thinking gains zero. The protocol amplifies frontier-model strength but punishes weaker models that over-apply Skills. AtlasFS's user-endorsement gate is the natural mitigation (no rate of bad Skills makes it through if a human signs off), but the cost is the UI step.
- **Benchmark domain mix does not include data-store retrieval.** SkillCraft's tasks are web APIs, file processing, and game-flavoured exploration. There is no MongoDB, no aggregation pipeline, no hybrid retrieval. AtlasFS evaluates on a supply-chain corpus with hybrid retrieval primitives; the SkillCraft protocol numbers are not directly comparable, only directionally suggestive.

## Integration Analysis: AtlasFS

### Fit assessment: **Strong Fit, with sharper differentiation needed**

SkillCraft is the closest contemporary public expression of AtlasFS's procedure crystallisation pipeline. The four MCP primitives map onto AtlasFS's `procedures/` directory plus the trajectory log. The Coding Verifier maps onto the AtlasFS verifier. The auto-abstraction step maps onto crystallisation. The library-of-reusable-code-skills maps onto `procedures/`. None of this changes the AtlasFS plan; it confirms the design space and tightens the differentiation story.

### What to extract (and the effort to extract it)

1. **Three-stage Coding Verifier**, near-verbatim port. Add to AtlasFS's existing replay-against-shadow-input verifier: (a) syntax validation pre-promotion using the TypeScript compiler API rather than a parser (free, AtlasFS already runs `tsc` for typed-call interception), (b) structured runtime error capture on verifier replay (already present, just standardize the schema), (c) post-execution quality detection with the 50%-null heuristic. Effort: **Quick (< 1h)**, mostly wiring.
2. **Metric vocabulary alignment**, specifically Exec Rate (fraction of procedure executions that succeed) and Reusing Rate (average invocations per saved procedure). AtlasFS already has T_n / D_n / R_n / I_n; adding these two as columns on the metric ledger makes side-by-side comparison with SkillCraft trivial. Effort: **Quick (< 1h)**.
3. **Two-axis difficulty scaling pattern** (quantitative and complexity, range 3 to 5). The pre-registered intent-clustered eval already has clusters; layering quantitative-and-complexity scaling within each cluster gives the eval the same legibility SkillCraft's reviewers liked. Effort: **Short (< 4h)** to retrofit, optional.
4. **The hierarchical negative result as motivation for compile-to-pipeline**. Cite §5.1 directly in the AtlasFS pitch and in the eval discussion: "SkillCraft (2026) showed that auto-generated hierarchical skill libraries amplify error propagation; we sidestep this by compiling each verified procedure to a single Atlas aggregation pipeline rather than nesting." Effort: **Quick**, copy-paste citation.
5. **Optional: SkillCraft as a fourth baseline**. The eval currently has three baselines (vanilla / static-typed / ours). Adding SkillCraft's auto-induced-skill-library protocol as a fourth would directly address the "isn't this just SkillCraft?" question. The implementation is not free (porting four MCP primitives plus a Coding Verifier into the eval harness) but the harness is being built anyway. Effort: **Medium (~1 day)** if Day 1 capacity allows; **defer to post-hackathon** if not.

### Bootstrap path

If this brief shapes any code change in week one, the order is:

1. **30 min**, port the 50%-null post-execution quality check into the AtlasFS verifier in `procedure-crystallisation/verifier.ts`.
2. **30 min**, add Exec Rate and Reusing Rate columns to the metric ledger schema and the cluster heatmap renderer.
3. **15 min**, add a SkillCraft citation block to `kb/product-design.md` Related Work (does not exist yet, create it) and to `kb/mission.md` if the mission doc has a positioning section.
4. **Optional, 1 day**, scaffold a SkillCraft-protocol baseline in the eval harness as a fourth column. Only if Day 1 finishes the existing three-baseline harness on schedule.

### Open questions raised by this brief

- **Should AtlasFS run an unattended-induction mode for the eval as a fourth condition?** The auto-induction-without-endorsement experiment is exactly the SkillCraft protocol applied to AtlasFS's substrate. Running it against the same eval gives a clean ablation: with-endorsement versus without-endorsement, all else equal. This is the cleanest possible answer to "does endorsement matter?", but the cost is doubling the eval matrix.
- **Does AtlasFS's per-tenant L_n metric have a precedent in the agent-skill literature, or is it genuinely novel as of 2026-05?** The brief checks SkillCraft, Voyager, ASI, and CREATOR; none address tenant-level library divergence. If true, this is a paper-shaped result and worth keeping out of the demo until publication is decided.
- **Is the 50%-null heuristic the right quality gate for AtlasFS's domain (hybrid retrieval over Atlas)?** Retrieval results are typed payloads with rich metadata; the null-rate may be miscalibrated for `hybrid` calls that legitimately return zero hits. Calibrate on the supply-chain corpus before promoting the heuristic.

### Effort estimate

Quick (< 1h) for the verifier port and metric vocabulary. Short (< 4h) for the difficulty-scaling retrofit. Medium (~1 day) for the optional fourth baseline. The high-leverage moves are the verifier port and the citation. Everything else is optional.

## Key Takeaways

1. **SkillCraft is the strongest contemporary prior art for AtlasFS's procedure crystallisation pipeline and must be cited in Related Work.** Four MCP primitives plus a three-stage Coding Verifier plus an auto-abstraction step is the protocol AtlasFS implements. The differentiation surface is endorsement-versus-auto-induction, per-tenant divergence (L_n, Dimension 1), compile-to-pipeline (Tier 3), typed-FS substrate, and schema-drift handling. Lead with Dimension 1 in any judge conversation that opens with "isn't this just SkillCraft?".
2. **Port the 50%-null post-execution quality check into the AtlasFS verifier in the first hour of week one.** The check costs nothing, fixes a real gap (silent-success procedures that return mostly-null payloads), and aligns AtlasFS's verifier with the strongest published reference. Add Exec Rate and Reusing Rate as columns on the metric ledger at the same time for free side-by-side comparability.
3. **The §5.1 hierarchical negative result is free positioning for compile-to-pipeline.** SkillCraft empirically shows that auto-generated nested skill hierarchies are worse than flat libraries because of error propagation; AtlasFS's Tier 3 (compile a verified procedure to a single Atlas aggregation pipeline) is precisely the alternative to nesting. Cite this in `kb/product-design.md` Decision 7 (compile-to-pipeline as v1 budget pay-out) as the empirical motivation.
4. **The user-endorsement step is now the load-bearing AtlasFS differentiation against an auto-induction baseline that already exists publicly.** GLM-4.7's 15-percentage-point regression on SkillCraft is the strongest single argument for endorsement: auto-induced libraries can degrade success when models over-apply Skills. Frame the AtlasFS endorsement UI as the high-precision-low-recall complement to SkillCraft's high-recall-medium-precision auto-verifier, not as a slowdown.

## Sources

**Primary, this paper:**
- [SkillCraft: Can LLM Agents Learn to Use Tools Skillfully? (arXiv:2603.00718v2)](https://arxiv.org/abs/2603.00718), Chen et al., 2026-03-10. Abstract, methods, results, hierarchical analysis, cross-task transfer.
- [SkillCraft full PDF](https://arxiv.org/pdf/2603.00718), pages 1 to 8. Verbatim source for §3.2 Coding Verifier, §3.3 Protocol Pipeline, §4 Evaluation, §5.1 Hierarchical Mode, §5.2 Cross-Task Generalization.
- [SkillCraft code repository](https://github.com/shiqichen17/SkillCraft), reference implementation of the four MCP primitives.
- [SkillCraft project page](https://skillcraft-website.github.io/page), supplementary materials and results browser.

**Secondary, citation context:**
- [Natural-Language Agent Harnesses (arXiv:2603.25723)](https://arxiv.org/html/2603.25723v1), early downstream citation of SkillCraft, frames it within the agent-harness landscape.

**Adjacent prior art referenced for differentiation:**
- [Voyager: An Open-Ended Embodied Agent with LLMs (arXiv:2305.16291)](https://arxiv.org/abs/2305.16291), Wang et al. 2023, the foundational skill-library-via-trajectory paper SkillCraft builds on.
- [CREATOR: Tool Creation for Disentangling Abstract and Concrete Reasoning of LLMs (Qian et al., 2023)](https://aclanthology.org/2023.findings-emnlp.462/), tool-creation framework cited as a SkillCraft baseline.
- [ASI: Agentic Skill Induction (arXiv:2504.06821)](https://arxiv.org/abs/2504.06821), prior agent-skill-induction work AtlasFS already lists in its mental model.

**AtlasFS internal cross-references:**
- `kb/product-design.md`, AtlasFS three-tier schema induction (bootstrap, emergent, compiled), procedure crystallisation pipeline, Decisions 6 (user-endorsed) and 7 (compile-to-pipeline) anchor the differentiation story.
- `kb/br/02-mongodb-fit-and-adjacent-projects.md`, broader landscape including ASI, Voyager, MongoDB MCP server, official adjacencies.
- `kb/br/03-documentdbfuse.md`, the closest substrate-side public expression of MongoFS, complements this brief on the FS axis.
