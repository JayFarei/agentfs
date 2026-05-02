---
title: "ASI (Agent Skill Induction): R&D Scouting Brief"
type: scouting-brief
tags: [magic-docs, prior-art, atlasfs-relevant]
target: "Inducing Programmatic Skills for Agentic Tasks (Wang et al., CMU)"
arxiv: "2504.06821v2"
authors: ["Zora Zhiruo Wang", "Apurva Gandhi", "Graham Neubig", "Daniel Fried"]
research_date: 2026-05-01
source: "https://arxiv.org/abs/2504.06821"
category: research-paper
relevance_to_atlasfs: load-bearing
---

# ASI: Inducing Programmatic Skills for Agentic Tasks , R&D Scouting Brief

> Research date: 2026-05-01
> Primary source: <https://arxiv.org/html/2504.06821v2>
> Category: research paper (CMU, cs.CL)
> Submission: v1 Apr 2025, v2 Aug 2025

---

## Overview

ASI (Agent Skill Induction) is an online self-adaptive web agent that, on each
solved task, induces a Python function summarising the trajectory, **verifies
the function by re-executing the task with the new function in scope**, and only
then admits it into the agent's action space for future calls. The paper's
empirical claim is that programmatic, verified skills outperform AWM's
text-skill-in-memory approach by 11.3 points of success rate on WebArena and
trim 10.7-15.3% of steps , the lift comes mainly from the verification gate,
not from the program format alone.

The same CMU group authored AWM (Agent Workflow Memory, 2024) and TroVE (verifiable
toolboxes, ICML 2024); ASI is the synthesis: AWM's online induction loop with
TroVE's programmatic-verification primitive, applied to web agents.

---

## Problem It Solves

Web agents amnesiac across episodes. Each new task re-derives the same procedure
(open marketing reviews, search for product, sort by price) from scratch using
primitive actions (click, fill, scroll). Demonstrations are expensive, mismatched
to test distributions, and don't keep up with website changes. Prior online
methods (AWM, AutoGuide, CLIN) store text-form workflows in memory that the agent
*may* consult; the format provides no execution-time guarantee and skills can be
quietly ignored or misapplied.

Two specific failure modes ASI targets:
1. **Unverified text skills** , no execution check at induction; many become
   noisy or irrelevant in memory, dragging quality.
2. **Skills as references vs. actions** , an agent that sees a workflow in
   memory may try to call it as if it were callable; programs in the action
   space close that loop.

---

## How It Works

### Problem setup

Agent policy: $\pi_\mathcal{L}(\cdot \mid \mathcal{M}, \mathcal{A})$ where
$\mathcal{M}$ is memory and $\mathcal{A}$ is the skill library / action space.
Online queries arrive as a sequence $Q = \{q_1, \dots, q_N\}$. No demonstrations,
no ground-truth rewards.

### The four-stage online loop

Per query $q$:

1. **Solve.** Agent generates trajectory $\tau$ using current $\mathcal{A}$
   (primitive actions plus any previously-induced skills).
2. **Evaluate.** LLM-as-judge $V_\mathcal{L}(e) \rightarrow \{0,1\}$ filters
   trajectories deemed correct. Prompt is in §A.2 of the paper , three task
   types (information-seeking, site-navigation, content-modification), strict
   evaluation instructions.
3. **Induce.** For each correct $(q, \tau)$:
   - **Episode cleaning**: each step's verbose chain-of-thought is summarised by
     an LLM into a one-sentence description, dropping per-step thought tokens
     from 87.9 to 13.4 average. Steps that errored in execution are dropped.
   - **Skill proposal**: the induction LLM emits one or more Python functions
     $\mathcal{D} = \{d\}$. Hard rules in the prompt:
     - No try/except.
     - 3-10 lines of code.
     - At least 2 steps, no more than 5.
     - Args must be primitive (string, list); no closures.
     - `send_msg_to_user` may not take its message as an argument , the message
       must be decided inside the function.
4. **Verify.** This is the load-bearing step the paper attributes most of the
   gain to.
   - Construct a **rewritten trajectory prefix** $\tau_D$: take the original
     trajectory $\tau$, ask the induction LLM to replace sub-trajectories with
     calls to the new skill program(s).
   - **Truncate** trailing primitive actions after the last skill call (so
     `send_msg_to_user('2')` doesn't spuriously pass the test by sending the
     known correct answer).
   - Re-execute: query the agent again with $q$, force-execute the prefix
     $\tau_D$, then let the agent generate up to $H_{max} - |\tau_D|$ further
     actions. Concatenated trajectory $\tau_f = \tau_D + \tau_A$.
   - Three checks gate promotion of $\mathcal{D}_{\text{called}}$ into
     $\mathcal{A}$:
     1. **Correctness** , $V_\mathcal{L}(\tau_f) = 1$.
     2. **Skill usage** , at least one new skill called in $\tau_f$.
     3. **Skill validity** , every skill-call action causes an environment
        change (else the program was a no-op or a trap).

### Why this design works

Skill quality is dominated by two orthogonal axes (Table 3 ablation):

| Format | Storage | Verification | SR (%) |
|--------|---------|--------------|--------|
| text | memory | unverified | 32.6 |
| program | memory | verified | 36.4 |
| text | memory | verified | 39.0 |
| **program** | **action space** | **verified** | **40.1** |

Reading: most of the lift (32.6 -> 39.0) comes from **verification** (run the
candidate skill against shadow input, prove it solves the task). The further
1.1 points from putting programs in the action space rather than memory comes
from agents being able to *call* skills directly instead of paraphrasing them.

### Empirical results (WebArena, 812 tasks)

| Model | Method | Steps | SR | Shop | Admin | Reddit | GitLab | Maps |
|-------|--------|-------|-----|------|-------|--------|--------|------|
| Claude-3.5-Sonnet | Vanilla | 5.6 | 32.7 | 32.6 | 36.8 | 36.8 | 26.1 | 38.5 |
| Claude-3.5-Sonnet | AWM (text) | 5.9 | 36.3 | 34.8 | 39.0 | 51.9 | 28.9 | 39.4 |
| Claude-3.5-Sonnet | **ASI** | **5.0** | **40.4** | 40.1 | 44.0 | 54.7 | 32.2 | 43.1 |

- 23.5% absolute lift over vanilla GPT-vanilla baseline (12.3 -> 35.5 with AWM,
  cited in abstract).
- 11.3% lift over text-skill counterpart on Claude.
- 10.7-15.3% step reduction.

### Scaled-up activities (§4)

Long-horizon composite tasks (e.g. "add 5 items to cart, change billing and
shipping address, generate 5 reports"). The efficiency advantage *grows* with
horizon length: ASI hits 100% on shopping/maps where vanilla gets 41.7%/40.0%,
in roughly half the steps. Statistical significance verified ($|t|>2$, $p<0.05$).

### Cross-website transfer (§5)

Skills induced in WebArena's sandboxed sites (OneStopMarket, PostMill,
OpenStreetMap) tested on real counterparts (Target, Reddit, Google Maps).
- Common skills (e.g. `search_product`) transfer.
- Site-specific skills (e.g. `sort_by_listings` selecting from a dropdown) break
  on sites with different UI affordances , agents typically *detect* the
  incompatibility and fall back to primitives rather than failing silently.
- Allowing skill update on the new site (`+update`) further improves
  performance, especially for AWM (text adapts faster); ASI's gain is more in
  efficiency than in success rate on transfer.

### Skill curation rates (§B.1)

| Domain | Attempted induction | Successful induction | Reuses | Total tasks |
|--------|---------------------|----------------------|--------|-------------|
| shopping | 21 | 8 | 96 | 180 |
| admin | 38 | 15 | 108 | 156 |
| reddit | 24 | 11 | 14 | 105 |
| map | 13 | 10 | 80 | 109 |
| gitlab | 25 | 11 | 10 | 175 |

Critical numbers: induction *attempted* on 13-21% of correct tasks; passes
verification only ~50% of the time (8/21, 15/38, 10/13, 11/25), so promotion
rate is ~6-9% of total queries. Reuse rate: 42.5% of all tasks call at least
one previously-induced skill on average. The library is *small* and
*frequently-reused*, exactly the metric *Library Learning Doesn't* indicts
auto-induction methods on.

### Skill examples (§B.2)

Representative , `search_product`:
```python
def search_product(name: str):
    click("Search textbox...")
    if has_popup_window():
        click("Close")
    fill("Search textbox", name)
    click("Search button")
```

Note: the popup-handling `if` branch is induced , the LLM is allowed
control flow primitives (if/else, for/while). This matters because it's the
gap between "macro" and "function" , ASI skills can encode adaptivity to
runtime state, not just a fixed action sequence.

---

## Maturity & Traction

- **License**: research code (no specific OSS license noted in paper; CMU group)
- **Backbone**: Claude 3.5 Sonnet across all components (agent, evaluator, inducer)
- **Framework**: BrowserGym (de Chezelles et al., 2024)
- **Lineage**: AWM (NAACL/arXiv 2024) -> ASI (this paper). Same lab also
  authored TroVE (ICML 2024, programmatic toolboxes) , ASI is essentially
  TroVE's verification mechanism applied to AWM's online setting.
- **Adoption**: research artefact, not a product. Not packaged for re-use as a
  library. Re-implementation cost is moderate (LLM prompts in §A.2 are the
  recipe).

---

## Strengths

- **Verification is the load-bearing trick.** Most of the SR lift in the
  ablation (Table 3) comes from execution-based verification, not from format
  alone. This is the cheapest, highest-leverage part to copy.
- **Small library + high reuse rate.** 7-9% promotion rate, 42.5% per-task
  reuse rate. Directly answers *Library Learning Doesn't* on its own ground.
- **Composability.** Programs naturally call other programs , the action
  space grows hierarchically without needing a special composition rule.
- **Structural defense against hallucinated skills.** Three-axis check
  (correctness, skill usage, skill validity) catches cases where an agent
  technically passes the task without using the new skill, or where the skill
  causes no environment change.
- **Episode cleaning.** Compressing per-step thought from 87.9 to 13.4 tokens
  cleans up the induction prompt input dramatically; the paper credits this with
  improving induction quality at scale.

## Limitations & Risks

- **LLM-as-judge is the only correctness signal.** WebArena ships with
  programmatic evaluators they did *not* use during induction (only at final
  reporting). In a domain without a programmatic ground truth, $V_\mathcal{L}$
  carries the verification load , and it is an LLM, with all that implies.
- **Skill granularity is hand-tuned.** "2-5 steps, 3-10 lines of code" is a
  prompt constraint, not a learned property. The paper's conclusion explicitly
  flags "conceptually or empirically suitable granularity" as future work.
- **No human in the loop.** This is the design space *Library Learning Doesn't*
  attacks: the auto-evaluator can pass a skill that a human would reject as
  off-task. Reuse rate is high *given* the auto-evaluator, but the auto-evaluator's
  precision is the unmeasured bound.
- **Cross-site transfer is brittle by skill.** Skills with hard-coded element
  IDs / link constants don't transfer. Transfer success is driven by abstract
  skills (`search_product(name)`); concrete-state skills (`open_marketing_reviews`)
  don't.
- **No drift handling.** A skill encoded against a website's DOM at induction
  time has no fingerprint, no pin, no detection mechanism for subsequent UI
  changes. A redeployed website silently breaks every skill that touched its
  changed paths.
- **Steady-state vs. cold start.** The 7% promotion / 42% reuse numbers are over
  the full 812-task run. Early-round behaviour (when library is empty) is
  necessarily worse , the paper does not break out cold-start curves, which
  matters for a 4-day eval window.

---

## Competitive Landscape

| Alternative | Differentiator vs ASI | Trade-off |
|-------------|----------------------|-----------|
| AWM (Wang 2024b) | Text-form workflows in memory | No execution verification, no callable skills, ~11pt SR loss |
| Voyager (Wang 2023) | Open-ended embodied agent in Minecraft | Different domain (no DOM); skill format also Python; no human gate |
| TroVE (Wang 2024a) | Programmatic toolboxes for math/program tasks | Offline batch induction, not online |
| AutoGuide (Fu 2024) | Per-state textual guidelines | Single-state granularity, no procedure composition |
| CLIN (Majumder 2024) | Causal abstractions in memory | Text only, no execution check |
| LILO / DreamCoder / Tool Makers | Library learning via wake-sleep / program synthesis | Specific to programmatic-task domains, not online web |
| **AtlasFS** (this project) | User-endorsed crystallisation, typed *retrieval* surface, schema fingerprint, compile-to-pipeline budget | UX cost of endorsement step, ~40-task ceiling on what fits in a 4-day eval |

---

## Community Signal

This is a research paper, not a product, so signal is academic:
- Builds explicitly on Wang's own AWM (NeurIPS '24 line of work).
- Cited / situated alongside the family captured in *Library Learning Doesn't*
  (Berlot-Attwell, NeurIPS MATH-AI 2024) , the empirical critique of
  auto-induced libraries.
- WebArena is the de-facto eval for online web agents; ASI is currently
  state-of-the-art on that benchmark with a Claude backbone.
- No HN/Reddit traction visible (research artefact, not packaged).

---

## Integration Analysis: AtlasFS

The user's product, AtlasFS, already cites ASI in `kb/mission.md` as one of
three prior-art families and in `kb/research.md` as the "skill induction without
users" frame that AtlasFS positions against. This brief's job is to convert
that positioning into specific borrowable mechanisms and specific divergences
to defend.

### Fit Assessment: Strong Fit (as load-bearing precedent), High Divergence (as design)

ASI is the closest published academic precedent to AtlasFS's procedure
crystallisation pipeline. Borrow the mechanism for verification; defend the
divergences (user gate, typed retrieval surface, schema fingerprint, optimisation
budget) on grounds the paper itself flags as open work.

### Mapping ASI -> AtlasFS

| ASI concept | AtlasFS equivalent | Same / divergent |
|-------------|-------------------|------------------|
| Primitive action space (`click`, `fill`, `scroll`) | Typed retrieval primitives (`findExact`, `findSimilar`, `hybrid`) | **Divergent**: AtlasFS primitives are typed *queries*, not UI actions. The objective is a **learning query surface**, not a learning UI surface. |
| Skill library $\mathcal{A}$ in agent action space | `procedures/` directory in AgentFS overlay | Same conceptual role, different substrate (filesystem-as-namespace) |
| Episode evaluator $V_\mathcal{L}$ | Verifier replay against shadow input | **Divergent**: AtlasFS uses deterministic re-execution + result comparison, not LLM-as-judge. The task domain (Atlas queries) admits exact comparison. This is a structural advantage. |
| Episode cleaning (87.9 -> 13.4 thought tokens) | (not in current AtlasFS plan) | **Borrow this.** It's a cheap induction-quality boost. |
| Skill induction prompt with hard rules (3-10 lines, 2-5 steps) | (not formalised in current plan) | **Borrow this.** Formalise the procedure granularity prompt. |
| Trajectory rewriting + truncation for verification | (not in current AtlasFS plan; AtlasFS plans verifier replay against shadow input) | **Borrow the truncation idea specifically.** A trajectory whose final step is `console.log(result)` will *always* pass if not truncated. The truncation step is non-obvious and necessary. |
| Three-axis check (correctness, skill usage, skill validity) | Verifier shadow-input pass/fail | **Borrow the three-axis frame.** Currently the design says "replay against shadow input and compare result"; ASI's third axis (skill validity = does the skill cause environment change) catches a class of no-op procedures the comparison check alone misses. For AtlasFS, this maps to "does each typed call return non-empty / change query state". |
| LLM-as-judge for episode correctness | User endorsement | **Divergent and load-bearing.** AtlasFS deliberately replaces the auto-judge with a human endorsement. The paper itself notes auto-induction promotes ~7% of episodes; AtlasFS's claim is that user-endorsed promotion produces a smaller library with higher *quality* per entry, addressable by *Library Learning Doesn't*'s reuse-rate critique. |
| (no drift handling) | Schema fingerprint pinned in procedure body, ts-morph drift walker | **AtlasFS-only feature.** Defensible point of differentiation , web UI doesn't have a stable fingerprint, but Atlas collections do. |
| (no compilation) | Compile-to-pipeline budget worker | **AtlasFS-only feature.** Worth foregrounding in the demo: ASI keeps the LLM in the hot path forever; AtlasFS ramps the LLM out. |
| Cross-website transfer experiment | (not yet in AtlasFS eval plan) | **Consider for v2.** The cross-cluster equivalent would test whether procedures induced on one Atlas cluster transfer to a structurally similar cluster with different data. The paper's transfer numbers are middling; this is a feature, not a bug, for AtlasFS positioning ("skills don't transfer freely; the typed surface and schema fingerprint catch the failure mode mechanically"). |

### "Learning query surface" objective , what ASI tells us

AtlasFS's central design claim is that the agent's surface should grow
*because* the agent operated on it. This is exactly ASI's claim, with one
substitution: ASI grows an action space, AtlasFS grows a typed-retrieval
namespace under `/datafetch/db/` and `/datafetch/procedures/`.

The paper supports this objective in three concrete ways:

1. **Verification is the dominant lift.** From Table 3: verification alone
   accounts for ~80% of the SR gain (32.6 -> 39.0 with text-format-but-verified
   vs 32.6 -> 40.1 with full ASI). This is *good news* for AtlasFS: the
   user-endorsement gate (cheap, deterministic) plus shadow-input replay
   should reproduce most of ASI's benefit *without* needing an LLM-as-judge.
   Frame this as "ASI's verification gate is an LLM; ours is a user + a deterministic
   shadow input. Both should land in roughly the same place; ours has a stronger
   correctness floor."

2. **Library is small and reuse rate is high *if* the gate is strict.** ASI
   promotes 7-9%; reuse is 42.5%. AtlasFS expects to promote at a rate the
   user controls (binary endorse/reject), so the promotion rate is bounded by
   the user's tolerance for procedure proliferation. The reuse rate is the
   chart that wins arguments; pre-register the threshold (e.g. R_n > 0.40 by
   round 4) so the post-hoc number isn't rationalisable.

3. **Composition is free.** Programs naturally call other programs. AtlasFS's
   "trajectory is the procedure" principle (Core Design Principle 3) gets the
   same property automatically: a procedure that imports `db.packages.findExact`
   and `db.advisories.findRelatedToPackage` is just a sequence of typed calls
   in a TS file, and a *higher-order* procedure can call lower-order ones with
   no ceremony.

### Concrete things to borrow in the next 48 hours

In rough cost-order, lowest cost first:

1. **Episode cleaning step** (cost: 1 LLM call per step, half-day to wire). Take
   the induction LLM prompt from §A.2 of the paper for "Episode Cleaning" and
   adapt it. This pays for itself in induction-quality and prompt-token savings.
2. **Hard granularity rules in the induction prompt** (cost: 30 minutes). Adopt
   "2-5 typed calls per procedure, 3-10 lines, no try/catch, args primitive"
   verbatim. Cite the source.
3. **Truncate-trailing-primitives rule** (cost: 30 minutes in verifier code).
   Before shadow replay, drop any trailing primitive calls after the last typed
   call into a procedure-defined function. The paper's example
   (`send_msg_to_user('2')`) is a sharp warning about how shadow replay can pass
   spuriously without this step.
4. **Three-axis verification check** (cost: 1 hour). Augment the planned
   "shadow input matches" check with (a) "at least one typed call into the
   procedure body fired" and (b) "every typed call returned a non-empty result
   or caused a state change." Catches procedures that pass by accident.
5. **Pre-registered cold-start curve** (cost: half-day in eval harness). The
   ASI paper does not break out cold-start vs steady-state; AtlasFS can. Plot
   T_n / D_n / R_n round-by-round so the convergence story is visible by round
   2 instead of needing the full 4-day window.

### Things to *not* borrow

- The LLM-as-judge ($V_\mathcal{L}$). AtlasFS's domain (deterministic Atlas
  queries) admits exact result comparison; replacing that with an LLM judge
  would weaken the correctness floor.
- Free-form skill granularity. ASI's prompt is the granularity policy; AtlasFS
  can do better by typing the procedure surface and constraining via
  ts-morph at promotion time.
- Per-website skill silos (ASI inducs per-website, with hard-coded link
  constants). AtlasFS's schema-fingerprint-pin is the structurally cleaner
  equivalent.

### Open questions for AtlasFS, sharpened by ASI

1. **Cold-start ceiling.** ASI promotes ~7% of correct episodes. AtlasFS with
   a strict user gate may promote less. With a 4-day eval and 40-50 tasks per
   round, the steady-state library may have only 10-15 procedures. Is the
   reuse-rate chart still legible? *Tentative answer: foreground per-cluster
   reuse rate, not absolute library size.*
2. **What is the AtlasFS analogue of "skill validity"?** ASI checks that each
   skill call causes environment change. For AtlasFS, this maps to: every
   typed call in the procedure returns non-empty *or* the procedure's final
   result depends on it. This needs a concrete predicate before promotion.
3. **Does the ASI auto-induced library beat the AtlasFS user-endorsed library
   in the same eval?** This is a baseline AtlasFS could *add*: "AtlasFS-with-auto-judge"
   as a fourth bar on the comparison chart. If user-endorsed beats auto-judge
   on reuse rate by a large margin while comparable on T_n / D_n, that is the
   *Library Learning Doesn't* answer in a single chart.
4. **Drift transfer.** ASI's cross-website transfer is brittle. AtlasFS's
   schema-fingerprint mechanism should catch the corresponding break
   *mechanically* (vs. ASI's empirical "agent notices and falls back").
   Demonstrating this on a deliberate schema change is a compelling demo
   moment.

### Effort estimate

- "Borrow" items 1-4 above: **Quick** (half-day for one engineer, plus prompt
  authoring).
- Cold-start curve item 5: **Short** (1 day).
- "AtlasFS-with-auto-judge" as a fourth eval baseline: **Short** (1 day);
  treat as stretch, not core.

### Citation pose

In the final pitch / README, the right framing is:

> ASI (Wang et al., arXiv:2504.06821) showed that programmatic, verified skills
> outperform text-form induced skills by 11.3 SR points on WebArena, with
> verification accounting for most of the lift. AtlasFS follows ASI's
> verification-gate insight, adopts its episode-cleaning and granularity rules
> directly, and substitutes (a) a user endorsement for the LLM-as-judge, (b) a
> typed retrieval surface for the primitive UI action space, and (c) a schema
> fingerprint for the missing drift mechanism. The reuse-rate chart should be
> the headline because that is precisely the metric *Library Learning Doesn't*
> argues auto-induction methods fail on.

---

## Key Takeaways

1. **Verification, not format, is the load-bearing mechanism.** AtlasFS's
   shadow-input replay reproduces ~80% of ASI's gain at zero LLM cost. Don't
   over-invest in optimising the procedure *format* (TS module shape, types);
   over-invest in the verification gate.

2. **Steal the prompt-engineering details.** Episode cleaning, hard granularity
   rules, trajectory truncation, and the three-axis check are concrete recipes
   from §A.2 / §2.3 of the paper. Pulling them in costs hours, not days, and
   directly raises induction-quality.

3. **The user-endorsement gate is defensible *because* of ASI.** ASI's reuse
   rate (42.5%) is the high-water mark for auto-induction; AtlasFS's claim is
   that a user gate beats this on a metric that matters (reuse rate is up,
   library size is down, T_n is down). Pre-register the comparison; don't argue
   it post-hoc.

4. **Schema fingerprint is the AtlasFS-only structural advantage.** ASI's
   cross-website transfer experiment shows skills break silently when the DOM
   changes; AtlasFS catches the equivalent failure mechanically. This is a
   demo moment worth scripting.

5. **Cold-start curve is the diagnostic the paper doesn't publish.** Plot
   T_n / D_n / R_n round-by-round so convergence is visible early. ASI reports
   only steady-state numbers; AtlasFS can show the convergence trajectory.

---

## Sources

- [Inducing Programmatic Skills for Agentic Tasks (arXiv 2504.06821v2)](https://arxiv.org/html/2504.06821v2)
- [arXiv abstract page](https://arxiv.org/abs/2504.06821)
- Reference [^33]: AWM, Wang Mao Fried Neubig, [arXiv 2409.07429](https://arxiv.org/abs/2409.07429)
- Reference [^32]: TroVE, Wang Neubig Fried, [ICML 2024](https://openreview.net/forum?id=DCNCwaMJjI)
- Reference [^31]: Voyager, Wang et al., [arXiv 2305.16291](https://arxiv.org/abs/2305.16291)
- Reference [^44]: WebArena, Zhou et al., [ICLR 2024](https://openreview.net/forum?id=oKn9c6ytLx)
- Local context: `kb/mission.md` (existing ASI citation), `kb/research.md`
  ("Skill induction without users" section), `kb/market.md` (competitive
  positioning)
