---
title: "Agent Workflow Memory: The Closest Academic Precedent for AtlasFS Procedure Crystallisation"
date: 2026-05-01
mode: deep
sources: 16
status: complete
---

# Agent Workflow Memory: The Closest Academic Precedent for AtlasFS Procedure Crystallisation

## Executive Summary

Agent Workflow Memory (AWM) is a 2024 paper by Wang, Mao, Fried, and Neubig (CMU and MIT), published as an ICML 2025 poster, that proposes a method for inducing reusable workflows from agent trajectories on web-navigation benchmarks. AWM operates in two modes: **offline** induces workflows from annotated training trajectories before test time, and **online** induces workflows on the fly from self-generated, LM-evaluator-judged trajectories. On WebArena, AWM lifts overall task success rate from 23.5 to 35.5 (a 51.1% relative improvement) using GPT-4, beating even the human-expert-workflow baseline (SteP, 33.0). On Mind2Web, online AWM widens its lead over baselines as the train-test distribution gap widens, scoring 8.9 to 14.0 absolute points higher in cross-website and cross-domain settings. The repo (`zorazrw/agent-workflow-memory`, Apache-2.0, 426 stars, 50 forks, last pushed 2025-12-22) is the canonical reference implementation.

The bottom line for AtlasFS: AWM is **the closest academic precedent for the trajectory-crystallisation idea in `kb/product-design.md`**, and that strengthens AtlasFS's framing rather than threatening it. AWM validates the "induce, integrate, utilize" loop empirically; AtlasFS extends the framework with three substantive innovations AWM does not have: a *typed-filesystem substrate* for the workflows (vs. AWM's prompt-context storage), a *schema fingerprint with mechanical drift detection* (vs. AWM's no-environment-pinning model where DOM changes silently break workflows), and a *compile-to-pipeline budget worker that takes the LM out of the hot path* (vs. AWM, where successful workflows still cost an LM call on every invocation). AtlasFS also adds the per-tenant Dimension-1 axis (library divergence across tenants), which AWM never considers. Cite AWM explicitly in Related Work, borrow its quality metrics (number of procedures per tenant, function overlap, coverage, utility rate) for the eval ledger as a rigour-multiplier, and pre-empt the obvious reviewer question. Total effort to extract: roughly one hour.

The bigger context: a wave of 2025 to 2026 follow-on work (ReasoningBank at ICLR 2026, LEGOMem, MemRL, ASI/Agent Skill Induction, the December 2025 "Remember Me, Refine Me" procedural-memory paper, plus a March 2026 survey on autonomous-LLM-agent memory) has converged on the thesis that agents need to crystallise procedural knowledge across tasks. AtlasFS sits squarely in this lineage but is the only system applying the principle to a database-backed typed filesystem with hybrid retrieval primitives. The space is hot enough that the framing reads as recognised rather than novel, which lowers the explanation budget; the substrate, the typing, the fingerprint, and the compilation tier are where pitch words should go.

## Overview

**What it is.** AWM is a memory-augmentation method for LM-based agents on long-horizon tasks. The agent has a base memory $M$ (documentation of primitive actions like CLICK and TYPE). Past trajectories are summarised by an *induction module* $I$ into reusable workflows $\mathcal{W}$, each consisting of a natural-language description $d$ and a sequence of (observation, action) steps with example-specific values abstracted into named variables. Workflows are appended to $M$ to form $M_w = M + \mathcal{W}$, and the LM is invoked over $M_w$ for subsequent tasks. The induction module is LM-based by default (an LM is prompted to extract common sub-routines from a batch of trajectories, replacing concrete values like "dry cat food" with `{product-name}`); a rule-based variant exists but performs slightly worse on Mind2Web.

**Why it matters now.** AWM's "induce, integrate, utilize" loop is the academic ancestor of AtlasFS's "trajectory, endorse, crystallise" pipeline (`kb/product-design.md` §"Bootstrap to Emergence" and §"Procedure crystallisation pipeline"). The paper has 426 stars on GitHub, was accepted as an ICML 2025 poster, and has spawned a citation lineage covering ASI (Agent Skill Induction), ReasoningBank, LEGOMem, and the broader procedural-memory survey at TechRxiv. A judge familiar with this literature will recognise AtlasFS's crystallisation step as a known-good approach being applied to a new substrate, which is a stronger pitch than presenting it as novel from whole cloth.

**Maturity and traction signals.**

| Signal | Value |
|---|---|
| First arxiv submission | 2024-09-11 (v1, the version at this URL) |
| Venue | ICML 2025 (poster, accepted May 2025) |
| GitHub stars / forks | 426 / 50 |
| License | Apache-2.0 |
| Last push | 2025-12-22 |
| Open issues | 4 |
| Authors | Zora Zhiruo Wang (CMU), Jiayuan Mao (MIT), Daniel Fried (CMU), Graham Neubig (CMU) |

**Competitive landscape, in the procedural-memory-for-agents space.**

| Project | Storage | Induction | Verifier | Drift handling | Domain |
|---|---|---|---|---|---|
| **AWM** | Prompt context (text or code) | LM or rule-based | LM evaluator (online mode only) | None | Web navigation |
| **ASI** (Agent Skill Induction, 2025) | Program-based skills | LM, with verification | Self-verification | Skill update on incompatibility | Web navigation |
| **ReasoningBank** (ICLR 2026) | Strategy memory, retrievable | LM, abstracts strategies; learns from failures too | Memory-aware test-time scaling | Implicit via re-induction | Multi-domain |
| **LEGOMem** (Oct 2025) | Modular procedural memory | Multi-agent decomposition | Workflow-level | Module-level updates | Workflow automation |
| **AtlasFS / MongoFS** (this project) | Typed TS file in `procedures/<tenant>/<name>.ts` | LM trajectory summarisation, gated by user endorsement and shadow-input replay | Verifier shadow-input replay (deterministic, fails closed) | Schema fingerprint (`sha256:...`) plus Atlas Change Streams plus ts-morph walk | Typed MongoDB retrieval |

The differentiators AtlasFS owns in this list: (a) durable file-system storage of procedures rather than prompt-context storage, which decouples library size from context-window cost; (b) mechanical drift detection via fingerprint pinning, which AWM lacks entirely; (c) compile-to-pipeline as a third tier that takes the LM out of the hot path, which no system in the table has; (d) per-tenant library scoping, which is the Dimension-1 axis of AtlasFS's eval and is structurally absent from AWM and its descendants.

## How It Works

### The pipeline

```
+--------------------+     +----------------+     +--------------------+
|  Test trajectory   | --> | LM evaluator   | --> | If correct:        |
|  (q, steps[])      |     | (online mode)  |     | induce workflow w  |
+--------------------+     +----------------+     +--------------------+
                                                            |
                                                            v
                          +-----------------------------------------------+
                          | Workflow w = (description d, steps[(o,a)])    |
                          | Example-specific values abstracted to vars    |
                          +-----------------------------------------------+
                                                            |
                                                            v
                          +-----------------------------------------------+
                          | Memory M_w = M + W ; pass to LM for next task |
                          +-----------------------------------------------+
```

AWM's online loop is: (1) the agent attempts task $q_t$ with current memory $M^t$, producing trajectory $e_t$; (2) the LM evaluator judges $e_t$ as success or failure (binary); (3) on success, $I(e_t) \rightarrow \{w^t\}$; (4) $M^{t+1} = M^t + \{w^t\}$. Repeat until tests are exhausted. Offline mode collapses steps 1 to 3 into a single prep phase using annotated training trajectories, then runs step 4 once before any test.

### Workflow representation

A workflow has two parts:

1. **Description** ($d$): a natural-language summary of the high-level goal, e.g., "Browse Products in a Specific Category" or "Calculate Travel Time and Distance".

2. **Trajectory steps** ($p_1, p_2, \ldots$), where each step is a triple of:
   - NL state description, e.g., "Order {id} is shown"
   - Reasoning text, e.g., "Order {id} is found, I will now terminate the task"
   - Executable action over the environment, e.g., `click('subcategory_id')` or `fill('158', 'FROM_LOCATION')`

The example-specific values become named variables (`{search-term}`, `{your-origin-city}`, `MODE_OF_TRANSPORTATION`), which is the core abstraction trick that lets the same workflow apply across tasks with different concrete inputs.

### The induction prompt, verbatim

The single LM prompt that drives workflow extraction (used identically on WebArena and Mind2Web):

```
Given a list of web navigation tasks, your task is to extract the common
workflows. Each given task contains a natural language instruction, and a
series of actions to solve the task. You need to find the repetitive subset
of actions across multiple tasks, and extract each of them out as a workflow.
Each workflow should be a commonly reused sub-routine of the tasks. Do not
generate similar or overlapping workflows. Each workflow should have at least
two steps. Represent the non-fixed elements (input text, button strings) with
descriptive variable names as shown in the example.
```

That is the entire induction logic. The simplicity is itself a finding: a single prompt over a batch of trajectories produces sub-routines with 0.94 utility rate (workflows are used by 94% of test examples on WebArena) and 0.08 functional overlap.

### Quality metrics (AWM Table 10)

AWM reports four metrics over induced workflows; these map almost one-to-one onto AtlasFS's eval needs:

| Metric | WebArena | Mind2Web | AtlasFS analogue |
|---|---|---|---|
| Number of workflows per website | 7.4 | 7.3 | Number of procedures per tenant per intent cluster |
| Coverage (steps covered by workflows) | not reported | 0.40 | Fraction of trajectory steps invoking a procedure rather than a raw primitive |
| Function overlap (workflow pair similarity) | 0.08 | 0.20 | Procedure-library hygiene metric AtlasFS does not currently have |
| Utility rate (test examples using workflows) | 0.94 | 0.91 | $R_n$, the reuse rate metric in `kb/product-design.md` |

7.4 workflows per WebArena website and 7.3 per Mind2Web domain set a useful expectation for AtlasFS procedure libraries: tens, not hundreds, per intent cluster.

### Two scenarios

**Offline.** Available training data is concatenated, fed to the LM in one shot, and produces $\mathcal{W}_{\textit{offline}}$. The same memory is used for every test task. Best when train-test distributions overlap.

**Online.** Test queries are processed in streaming fashion; workflows are induced from successful predictions and added to memory. Best when no annotated training data exists and when the test distribution drifts away from any prior data. Online wins clearly on cross-domain Mind2Web (35.5 vs 32.6 step success rate; 1.7 vs 0.7 task SR), where train-test gaps are widest.

### Three ablations worth flagging

1. **LM-induction vs rule-induction.** On WebArena the gap is 0.1 SR (35.5 vs 35.6, identical within noise) but LM-induction uses 0.4 fewer steps. On Mind2Web the gap widens to +1.7 step SR and +2.8 task SR for LM-induction. The difference is whether the workflow abstracts out specific values: LM-induction does, rule-induction does not. Conclusion: abstraction matters, mechanism less so.

2. **Code vs NL workflow trajectories.** Step success rate is essentially tied (45.1 code vs 45.4 text) but task success rate diverges (4.8 code vs 3.6 text). Code wins at the task-level; NL wins narrowly at the step-level. AtlasFS's TypeScript-procedure-as-code path is therefore validated, not contested.

3. **Workflows-as-actions (AWM_AS).** Wrapping each workflow into a callable function in the agent's action space gives only +1.3 step SR over the memory-only AWM, and the same task SR. The agent uses workflow actions in only 18.5% of tasks despite their availability. **This is a caution signal for AtlasFS's deterministic-mode matcher**: the agent should not be relied on to discover and invoke procedures; the deterministic matcher in `kb/product-design.md` §"Data Flow" step 3 must intercept and execute, not merely advertise. AtlasFS already has this right by construction.

## Strengths

- **Empirically validates the induce-integrate-utilize loop on long-horizon tasks.** WebArena 23.5 → 35.5 (+12.0 absolute, +51.1% relative) and Mind2Web 36.2 → 45.1 step SR (+8.9 absolute, +24.6% relative) on GPT-4. Both exceed the human-expert-workflow baseline (SteP, 33.0). Sample sizes are large: WebArena 812 tasks across 5 websites; Mind2Web has 1000+ tasks across 200+ domains in the original benchmark.

- **Online mode generalises better than offline mode as train-test gap widens.** Cross-domain Mind2Web online beats offline 35.5 vs 32.6 step SR; cross-website online beats offline 33.9 vs 33.7. This is direct evidence for the structural argument behind AtlasFS's Dimension-1 axis: per-tenant trajectory induction beats shared training data when intent priors diverge across users.

- **Step efficiency.** AWM uses 5.9 steps per WebArena task vs 7.9 for the baseline and 46.7 for AutoEval. Workflows reduce trajectory length, not just success rate. Maps cleanly to AtlasFS's $T_n$ metric.

- **Cross-template generalisation.** On the cross-template WebArena subset (where each example is from a different task template), AWM still scores 33.2, beating BrowserGym (20.5) and AutoEval (23.2). Workflows are not just template-memoising; they are genuinely abstracting.

- **The whole induction logic fits in a single prompt.** No special LM training, no fine-tuning, no embedding model, no retrieval index over workflows. The simplicity of the implementation is itself a strong signal that the abstraction is well-targeted.

- **Snowballing complexity.** The "find a place by its name" workflow becomes a sub-step of "get the zip code of a place", which can become a sub-step of further workflows. This is the AWM equivalent of AtlasFS's tier-2-to-tier-3 progression where simple procedures compose into more complex ones over time.

## Limitations & Risks

The list below is honest, drawn from the paper and the citing-work landscape. Each item is also a positive datapoint for the AtlasFS pitch.

1. **Workflows live in prompt context.** $M_w = M + \mathcal{W}$ means every test task's prompt grows with library size. AWM reports 7.3 to 7.4 workflows per website, which keeps tokens manageable, but the architecture has no story for libraries with 100+ entries or for shared cross-website memory at scale. AtlasFS's typed-filesystem storage decouples library size from context-window cost: only the type module and the matched procedure (or its compiled pipeline) enter context.

2. **No environment-state pinning, no drift detection.** When a website's DOM changes (button id `submit-id` becomes `btn-submit`), workflows silently fail. AWM reports no mechanism to detect or repair this. AtlasFS's `SCHEMA_VERSION` constant plus Atlas Change Streams plus ts-morph walk in `kb/product-design.md` §"Schema fingerprint + drift workflow" is exactly the missing piece. This is one of the design's clearest deltas.

3. **Verifier is LM-judged in online mode, not deterministic.** AWM uses Pan et al. 2024's LM evaluator to judge trajectory success before induction. This is acceptable but not gated-closed; an LM-judged success can still be wrong, propagating bad workflows into memory. AtlasFS's verifier is shadow-input replay against a recorded result (`kb/product-design.md` §"Procedure crystallisation pipeline"), which fails closed and is auditable. AWM's online numbers are likely underestimating the noise this verifier introduces.

4. **No notion of compilation.** Successful workflows still require an LM call on every invocation; the cost per task does not converge to zero, only to a smaller multiple. AtlasFS's compile-to-pipeline tier (`kb/product-design.md` §"Optimisation-budget worker") removes the LM after a procedure has earned budget. This is the third tier AWM lacks, and it is what makes AtlasFS's $D_n$ (determinism rate) and $T_n$ (trajectory length) tend toward 1.0 and 1, respectively.

5. **No tenant or user model.** AWM has a single agent memory; no per-user, per-intent-prior, or per-tenant scoping. The library divergence Dimension-1 axis in AtlasFS does not exist in AWM. A multi-tenant deployment of AWM would require either (a) one big shared library (which loses intent-specific workflows) or (b) one per-tenant library (which the system has no machinery for, and which would balloon prompt context per tenant).

6. **Workflow-as-action variant has 18.5% usage rate.** When workflows are exposed as new callable actions in the agent's action space rather than just inlined into memory, agents call them in only 18.5% of tasks. The paper attributes this to "resistance of current agents to use newly-added actions". For AtlasFS, this is a structural argument for the deterministic matcher: the system, not the LLM, decides when a procedure runs. AtlasFS already does this; the AWM result is the empirical case for not flipping the design.

7. **Domain coverage is web-navigation-only.** WebArena and Mind2Web. No evaluation on database retrieval, structured data, typed APIs, or anything closer to AtlasFS's MongoDB-Atlas substrate. Whether the induction-and-reuse principle ports to a richer typed surface is, strictly speaking, an open question; AWM provides the framing but not direct evidence. AtlasFS's eval will be the first piece of direct evidence on a typed-database surface, and that is itself a research-contribution claim worth making.

8. **No discussion of cross-task workflow conflict.** What happens when two tasks induce contradictory workflows for the same sub-routine? AWM's online mode just appends; there is no merge, dedup, or conflict-resolution policy beyond the LM's own re-prompting. For AtlasFS, this is mostly handled by per-tenant scoping (workflows do not collide across tenants) and by the verifier (a contradictory procedure that fails replay is rejected), but it is worth noting that the AtlasFS design solves an open problem in the AWM line, not just a missing feature.

9. **Apache-2.0 with a single first author and ~50 forks; ICML poster, not oral.** Maturity is moderate. The implementation is reference-quality, not production-quality; expect to read the algorithms but not vendor the code. Last push 2025-12-22; whether there will be a v2 is unclear.

10. **AWM_AS finding (action-space variant) does not extend to in-process function calls.** AWM tests workflow-as-action with a click/type-style action space. AtlasFS's "action space" is typed TypeScript imports against a synthetic FS, which has very different ergonomics: an LLM that imports `db.packages.findExact` is not adding a new action; it is using an existing typed surface. The AWM_AS underuse finding does not directly apply to AtlasFS's design, but the underlying reason (agents are anchored on familiar primitives) is the same and supports keeping the deterministic matcher in front of the LLM.

## Integration Analysis

> Project context: per `kb/product-design.md` §"Core Design Principles" and §"Procedure crystallisation pipeline", AtlasFS's whole machinery rests on the assumption that endorsed agent trajectories crystallise into reusable, deterministic procedures. AWM is the most rigorous existing piece of evidence that this idea works at the scale of 800+ tasks across 5+ domains. This section is for the question: how does the AtlasFS design need to change in light of AWM?

### Fit assessment

**Strong fit as conceptual precedent and metrics donor; partial fit as design constraint; non-fit as code to vendor.** The induction-and-reuse paradigm in AWM is exactly what AtlasFS's tier-2 (endorsed query trajectory) layer does, and AWM's empirical results justify the approach. The metric set in AWM's Table 10 is closer to what AtlasFS's eval should report than the placeholder metrics in `kb/product-design.md` §"Eval harness". But the implementation is in Python on a click-and-type web action space, with no notion of typed primitives, fingerprint pinning, or compile-to-pipeline; vendoring is not on the table.

### What to extract

Five concrete additions, each pre-hackathon-feasible.

1. **Cite AWM as the academic precedent in Related Work.** One paragraph, in the README's Related Work section and in the eval writeup. Frame: AtlasFS extends AWM's trajectory-induction model from prompt-context storage on a click-action space to typed-filesystem storage on a typed-method action space, with three additional tiers (typed primitives, fingerprint pinning, compile-to-pipeline) and a per-tenant scoping axis (Dimension 1). This pre-empts the "is this just AWM with extra steps?" reviewer question. Effort: 30 minutes.

2. **Adopt AWM's four quality metrics for the eval ledger.** Add to the metric harness in `kb/product-design.md` §"Eval harness":
   - **Number of procedures per tenant**, alongside the within-tenant convergence axes. Target: tens, not hundreds (AWM finds 7.3 to 7.4 per website).
   - **Function overlap**: count of overlapping action sub-sequences (length 2 or more) between procedure pairs within a tenant. Target: low (AWM reports 0.08 on WebArena, 0.20 on Mind2Web). High overlap indicates pipeline hygiene problems.
   - **Coverage**: fraction of trajectory steps that are procedure invocations (deterministic-mode rows in `tool_calls`) rather than raw primitives. Target: rising over rounds. This is essentially $1 - (\text{primitive-step rate})$, which AtlasFS already records implicitly in the `mode` column of `tool_calls`; just compute and chart it.
   - **Utility rate**: fraction of test tasks that invoke at least one procedure. Already mapped to AtlasFS's $R_n$. Target: rising over rounds and approaching AWM's 0.94 within-domain.
   
   Effort: 30 minutes (the data is already in `tool_calls`; this is a query plus a chart).

3. **Sanity-check abstraction in the crystallisation step.** AWM finds that abstracting example-specific values into named variables matters more than the induction mechanism (LM vs rule). When AtlasFS crystallises a trajectory like:
   ```typescript
   const advisories = await db.advisories.hybrid({
     query: "log4j RCE",
     weights: { vec: 0.7, lex: 0.3 },
     filter: { severity: { $gte: "high" } }
   });
   ```
   into `procedures/<tenant>/find_advisories_by_topic.ts`, the crystallisation must parameterise the query string, not freeze it. The TypeScript surface makes this natural (the procedure becomes a function with `topic: string` as an argument), but it is worth one explicit pass during procedure synthesis to make sure raw values are lifted into parameters. Effort: 1 hour, plus a property test.

4. **Add NL descriptions to procedure docstrings, AWM-style.** AWM's workflow description ($d$) is a goal-level NL summary. For AtlasFS procedures, the equivalent is the JSDoc on the exported procedure function: "Find advisories that mention a given topic, ranked by hybrid retrieval, filtered to high-severity-or-above." This is mostly cosmetic but matters at endorsement time: the user reviews the trajectory against the description, and the description carries forward as the documentation an agent reads when deciding whether to invoke the procedure. Adoption: have the crystallisation step prompt the LLM to produce both (a) the procedure body and (b) a one-paragraph JSDoc summary at endorsement time. Effort: 1 hour (it is a prompt change in the crystallisation pipeline).

5. **Use AWM's online generalisation result as evidence in the Dimension-1 writeup.** AWM's cross-domain Mind2Web result (online 35.5 step SR vs offline 32.6, with the gap widening as train-test distribution gaps widen) is the strongest existing public evidence that per-trajectory induction beats shared-library transfer when user intent priors diverge. The AtlasFS demo and pitch should cite this number directly when making the per-tenant-library-divergence argument; it converts a structural claim into an empirically-supported one. Effort: 0 (writeup only).

### Bootstrap path

The minimum integration with the AtlasFS hackathon, in priority order:

1. **30 min**, write the AWM-citing paragraph for the Related Work section of the AtlasFS README and submission writeup. Frame AtlasFS as extending AWM with a typed substrate, fingerprint pinning, compile tier, and per-tenant axis.
2. **30 min**, add a query in the eval harness that computes (#procedures per tenant, function overlap, coverage, utility rate) per round and renders four small charts.
3. **1 hr**, add a "lift constants to parameters" pass in the crystallisation pipeline (`Plan 005` per `kb/product-design.md`).
4. **1 hr**, modify the crystallisation prompt to also emit a JSDoc summary, and surface it in the procedure-library pane of the demo UI.
5. **(Roadmap)** Replicate AWM's Mind2Web online result with AtlasFS's MongoDB-retrieval task set as the substrate. This becomes a publishable extension: porting the AWM induction principle from web navigation to typed database retrieval. Effort: weeks.

### Effort estimate

- Cite plus four small additions: **Quick to Short (~3 hours total)**, spread across the eval harness and crystallisation pipeline workstreams.
- Vendor any AWM code: **Not recommended**; wrong language, wrong action space, wrong storage model.
- Replicate AWM-style Mind2Web ablation on AtlasFS substrate: **Large (>1 day)**, post-hackathon roadmap only.

## Key Takeaways

1. **AWM is the closest academic precedent for AtlasFS's trajectory-crystallisation idea, and citing it in Related Work strengthens the framing rather than threatening it.** The "induce, integrate, utilize" loop has 51.1% relative SR on WebArena, an ICML 2025 publication, and a citation lineage running through ASI, ReasoningBank, and LEGOMem. AtlasFS sits inside this lineage as the application of the induction principle to a typed-database substrate. Frame the pitch as extending an empirically-validated approach with three new tiers (typed primitives, fingerprint pinning, compile-to-pipeline) and a per-tenant axis (Dimension 1), all of which AWM lacks.

2. **AWM's quality metrics (number of workflows per website, function overlap, coverage, utility rate) port almost one-to-one onto AtlasFS's eval ledger.** Adding them is roughly half an hour of work and converts the eval from "we measured cost convergence" into "we measured cost convergence using the same metric vocabulary as the academic standard". Targets to beat: 7.4 workflows per intent cluster (parsimony), 0.08 function overlap (hygiene), 0.94 utility rate ($R_n$).

3. **Three AtlasFS design decisions are validated by AWM's gaps, not just consistent with them.** AWM has no environment-state pinning, no compilation tier, and no tenant model. AtlasFS's `SCHEMA_VERSION` plus drift workflow, compile-to-pipeline budget worker, and per-tenant CoW overlay each address a concrete missing capability in the closest published system. These are the three places where the pitch has the most leverage with a technical reviewer.

4. **AWM's online-generalisation finding (online beats offline as train-test distribution gap widens) is direct empirical support for AtlasFS's per-tenant Dimension-1 axis.** Cite the +14.0 absolute step SR cross-domain figure when defending the structural argument that per-tenant procedure libraries beat shared-training-data transfer when intent priors diverge across users. This is the largest existing piece of evidence for the Dimension-1 claim, and using it costs nothing.

## Sources

**Primary, paper itself:**
- [Agent Workflow Memory, arXiv:2409.07429v1, Wang/Mao/Fried/Neubig, 2024-09-11](https://arxiv.org/html/2409.07429v1), the source URL of this brief.
- [Agent Workflow Memory, arXiv abstract page](https://arxiv.org/abs/2409.07429), authoring metadata, version history, citation handles.
- [Agent Workflow Memory, OpenReview record](https://openreview.net/forum?id=NTAhi2JEEE).
- [Agent Workflow Memory, ICML 2025 poster page](https://icml.cc/virtual/2025/poster/45496), accepted-venue confirmation.
- [zorazrw/agent-workflow-memory on GitHub](https://github.com/zorazrw/agent-workflow-memory), 426 stars, 50 forks, Apache-2.0, last push 2025-12-22.

**Secondary, summaries and replications:**
- [Agent Workflow Memory: using workflows to guide LLM Agent generations, Sachin Kumar, Medium](https://medium.com/@techsachin/agent-workflow-memory-using-workflows-to-guide-llm-agent-generations-aad75fe2f78a), independent paper summary.
- [Research Paper Summary: Agent Workflow Memory, Mehnoor Aijaz, Athina AI](https://medium.com/athina-ai/research-paper-summary-agent-workflow-memory-35318865b65f), independent paper summary.
- [Enhancing Web Navigation with Agent Workflow Memory, Athina hub](https://hub.athina.ai/research-papers/agent-workflow-memory/).
- [Hugging Face papers: Agent Workflow Memory](https://huggingface.co/papers/2409.07429), discussion thread plus citing-papers list.

**Secondary, follow-on and lineage work:**
- [ReasoningBank, ICLR 2026, OpenReview pdf](https://openreview.net/pdf?id=jL7fwchScm), the +8.3/+7.2/+4.6 WebArena successor that abstracts strategies rather than concrete workflows and learns from failures as well as successes.
- [Agent Skills from the Perspective of Procedural Memory: A Survey, TechRxiv, Yaxiong Wu et al.](https://www.techrxiv.org/users/1016212/articles/1376445/master/file/data/Agent_Skills/Agent_Skills.pdf?inline=true), 2026 survey placing AWM in the procedural-memory landscape.
- [Memory in the Age of AI Agents: A Survey, Shichun-Liu/Agent-Memory-Paper-List on GitHub](https://github.com/Shichun-Liu/Agent-Memory-Paper-List), curated reading list including AWM and successors.
- [Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers, arXiv:2603.07670, March 2026](https://arxiv.org/html/2603.07670v1), survey citing AWM in the procedural-knowledge-memorisation taxonomy.
- [VoltAgent/awesome-ai-agent-papers on GitHub](https://github.com/VoltAgent/awesome-ai-agent-papers), 2026 curation of agent-research papers including AWM and successors.
- [Agentic Workflows in 2026: The ultimate guide, Vellum](https://www.vellum.ai/blog/agentic-workflows-emerging-architectures-and-design-patterns), industry perspective on the agentic-workflow design pattern.

**Project-internal:**
- `kb/product-design.md`, the AtlasFS / MongoFS design read 2026-05-01, especially §"Core Design Principles" (principle 1: induction tiers; principle 3: trajectory is the procedure), §"Bootstrap to Emergence" (the three-tier model AWM is the tier-2 precedent for), §"Procedure crystallisation pipeline" (the AtlasFS analogue of AWM's induction module), §"Eval harness" (the metrics this brief proposes augmenting).
- `kb/br/01-voyage-ai-code-mode-data-interface.md`, the broader code-mode-data-interface thesis AtlasFS sits inside.
- `kb/br/02-mongodb-fit-and-adjacent-projects.md`, the substrate-fit companion brief.
- `kb/br/03-documentdbfuse.md`, the closest existing implementation of MongoFS-as-FS, complementary axis to this brief's induction-pipeline axis.
- `kb/mission.md` and `kb/research.md`, project goals and prior-art-survey context.
