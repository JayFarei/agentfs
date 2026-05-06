---
title: "browser-use/browser-harness: Self-Healing Harness, Two-Tier Skill Library, and Trajectory-Mined Convergence"
date: 2026-05-04
mode: deep
sources: 18
status: complete
---

# browser-use/browser-harness: Self-Healing Harness, Two-Tier Skill Library, and Trajectory-Mined Convergence

## Executive Summary

`browser-use/browser-harness` is the open-source artifact behind the "Bitter Lesson of Agent Harnesses" thesis: a four-file (~1.7K-line) Python wrapper that hands a coding agent direct CDP access to a real Chrome instance, lets it write the helpers it needs at runtime, and surfaces per-site `.md` playbooks via an opt-in hostname-keyed lookup. It pairs with a closed cloud product (`cloud.browser-use.com`) where a separate "skill agent" reviews completed trajectories and mines reusable recipes, scored and edited by a feedback loop across all users. The OSS repo and the cloud product describe the same philosophy at two different fidelity levels: a hand-curated PR-driven library on the OSS side, and a fully autonomous trajectory-extraction-plus-social-scoring system on the cloud side.

Mapped onto PRD-007's three-layer cake, browser-harness validates the architecture wholesale. Their `interaction-skills/` directory is our `BootstrapHarness` layer (substrate-generic mechanics like dialogs, iframes, shadow DOM). Their `agent-workspace/domain-skills/<host>/` is our `MetaHarness` layer (per-substrate playbooks aggregated across runs). Their cloud "skill" pipeline is our `MetaHarnessWorker` plus `PromotionWorker` plus drift-handling, with three concrete primitives we don't currently have: a PII gate as the trust boundary, score-based retirement, and a clean "levels of evolution" UI→DOM→HTTP progression where the harness itself converges toward the cheapest viable mechanism per task.

The most actionable lesson is not in the OSS repo's code, it's in the cloud product's *promotion calculus* described in their April 2026 essay "Web Agents That Actually Learn": skills are extracted from trajectories by a dedicated reviewer agent, gated by privacy, scored with written feedback that can edit the skill in place, retired below threshold, merged when near-duplicates appear, and the next planned tier replaces UI playbooks with raw HTTP requests reverse-engineered from observed traffic. That last point is the key insight for our meta-harness: convergence over time isn't just "the dataset gets a better index", it's "the agent picks a progressively cheaper substrate to express the same intent on." Our four-method retrieval contract should leave room for the meta-harness to graduate from `findSimilar` into `runCompiled` with a private compiled plan when a tenant's trajectory shows the same plan recurring.

---

## Overview

**What it is.** Open-source Python package (`pip install -e .`) that exposes a single CLI, `browser-harness -c '<python>'`, where the Python snippet runs with a set of pre-imported helpers (`new_tab`, `goto_url`, `click_at_xy`, `js`, `cdp`, `http_get`, `capture_screenshot`, etc.) and a long-lived Python daemon proxies Chrome DevTools Protocol calls over a Unix socket. The agent that drives it (Claude Code, Codex, Cursor, etc.) is expected to read `SKILL.md` from the repo as its system prompt and to use its own Read/Edit/Write tools to extend `agent-workspace/agent_helpers.py` and `agent-workspace/domain-skills/` whenever it discovers a missing capability.

**Traction.** 10,210 GitHub stars, 937 forks, 65 open issues, MIT license, created 2026-04-17 (≈18 days old at research date). Active development: most recent push 2026-05-03. Backed by Browser Use (`browser-use.com`), the same team that built the original `browser-use` Python agent (40K+ stars). Companion blog posts have driven significant adoption discussion on Hacker News and Twitter. Companion cloud product at `cloud.browser-use.com` runs hundreds of thousands of tasks per day per the team's own claim (unverified externally). Nine first-party essays in their blog series build out the philosophy ("Bitter Lesson of Agent Frameworks", "Bitter Lesson of Agent Harnesses", "Web Agents That Actually Learn", "Closer to the Metal", and others).

**Why it matters.** It's the cleanest concrete instance of the "agent edits its own action space at runtime" pattern in production. The OSS repo is small enough to read in an hour; the philosophy essays are short and high-signal; the cloud product is the only currently-deployed system I'm aware of that mines reusable skills from agent trajectories with an explicit privacy gate, version control, and score-based retirement. For PRD-007 specifically, it's the closest external analog to the meta-harness layer we're designing, and the only one with public documentation of how promotion and demotion rules actually work.

---

## How It Works

### The four-file core (with caveats)

The Bitter Lesson essay claims the harness is "~600 lines across 4 core files." The actual repo at clone time is 1,709 lines across 6 files in `src/browser_harness/`:

```
src/browser_harness/
  __init__.py        2 lines
  _ipc.py          142 lines   socket / TCP / token plumbing
  admin.py         649 lines   daemon lifecycle, cloud API, profile sync, doctor, update
  daemon.py        332 lines   long-lived CDP proxy
  helpers.py       485 lines   24 pre-imported helper functions
  run.py            99 lines   CLI entrypoint, exec(-c, globals())
```

The discrepancy matters: the essay's "minimalism" claim has slipped about 3x in the few weeks since launch, mostly into `admin.py` (cloud browser provisioning, profile sync, doctor, update banner). The agent-facing primitives (`helpers.py`) and the actual CDP proxy (`daemon.py`) are still small enough to read in one sitting.

### Three layers of "self-healing"

The repo's tagline is "Self-healing harness that enables LLMs to complete any task." In code, "self-heal" is precisely three mechanisms, none of them learned:

1. **Stale CDP session re-attach** (`daemon.py:264-267`). When a CDP call returns "Session with given id not found", the daemon transparently calls `attach_first_page()` and retries once. Recovers from tab close, target detach, renderer crash.

2. **Stale daemon detection** (`admin.py:135-168`, `ensure_daemon`). On every `browser-harness -c` invocation, the daemon is health-pinged with both an IPC handshake and a real CDP probe (`Target.getTargets`). Alive socket but dead CDP triggers a full daemon restart. First-attempt failure on Chrome's "Allow remote debugging" popup auto-opens `chrome://inspect` and retries. Idempotent.

3. **Agent-level helper synthesis at runtime**. This is the load-bearing one. When the agent calls a helper that doesn't exist (the canonical example: `upload_file` was missing from `helpers.py` at one point), it greps the file with its own tools, sees nothing, writes the helper using raw CDP (`DOM.setFileInputFiles`), and reruns. The harness side of this is `_load_agent_helpers()` (`helpers.py:470-485`) which reads `agent-workspace/agent_helpers.py` on every invocation, so any function the agent writes there is picked up immediately on the next call without restarting the daemon.

The first two are routine infrastructure recovery. The third is the actual novelty: the harness is genuinely rewriteable by the agent that drives it, and the rewrite persists across runs as ordinary Python in a known file. There is zero retry framework, no manager layer, no session supervisor. The design constraint is explicit in `SKILL.md`: "Don't add a manager layer."

### Two-tier skill library

The "library" of accumulated knowledge has two directories, with very different shapes:

```
+-------------------------------------------------------------+
|  interaction-skills/    substrate-generic UI mechanics      |
|                         dialogs, iframes, shadow DOM,       |
|                         tabs, uploads, scrolling, etc.      |
|                         17 files, 5 substantive, 12 stubs   |
|                         status: incomplete, hand-authored   |
+-------------------------------------------------------------+
|  agent-workspace/       per-host playbooks                  |
|  domain-skills/<host>/  selectors, private APIs, gotchas    |
|                         89 host directories, 98 files       |
|                         200 to 1000 lines each, validated   |
|                         status: agent-drafted, PR-merged    |
+-------------------------------------------------------------+
```

The split maps cleanly onto PRD-007: `interaction-skills/` is the bootstrap-layer's "what *can* the agent do on any web page" surface; `domain-skills/` is the meta-harness's "what *generally works* on this specific dataset shape (= this specific website)" surface.

**interaction-skills/ shape.** No frontmatter, no schema, just markdown with prose explanation followed by copy-paste Python. Five files have real content (`dialogs.md`, `tabs.md`, `connection.md`, `screenshots.md`, `profile-sync.md`); twelve are one-line placeholders. The LLM is instructed to read these on demand: "If you start struggling with a specific mechanic while navigating, look in `interaction-skills/` for helpers" (`SKILL.md`).

**domain-skills/ shape.** Per-host directories under `agent-workspace/domain-skills/`. The README claims these are agent-written ("Skills are written by the harness, not by you"); the actual mechanism is "agent drafts → human opens PR → merge." Files are substantial: 200 to 500 lines is typical, the largest is 1021 lines. They contain field-tested CSS selectors with empirical breakage notes, private API endpoints discovered from network observation (Algolia for HN, `window.mosaic.providerData` for Amazon, Overpass QL for OpenStreetMap), timing requirements, bot-detection patterns, and rate-limit handlers. Almost all are single `.md` files; a handful of sites have multi-file directories with a README.md index. One site (`claude-ai/`) ships a Python file alongside the markdown, demonstrating that "skill" can be runnable code, not just prose.

**Discovery mechanism (the load-bearing claim).** When `BH_DOMAIN_SKILLS=1`, every call to `goto_url(url)` triggers a hostname-keyed directory lookup (`helpers.py:159-164`):

```python
def goto_url(url):
    r = cdp("Page.navigate", url=url)
    if os.environ.get("BH_DOMAIN_SKILLS") != "1":
        return r
    d = (AGENT_WORKSPACE / "domain-skills"
         / (urlparse(url).hostname or "").removeprefix("www.").split(".")[0])
    return ({**r, "domain_skills": sorted(p.name for p in d.rglob("*.md"))[:10]}
            if d.is_dir() else r)
```

What it returns is **filenames only, not file content**. Up to 10 names. The agent then decides whether to read those files. There is no semantic matching, no embedding search, no intent-aware ranking. Discovery is purely "first label of hostname matches a directory name." `news.ycombinator.com` keys to `news`, not `hackernews`, so the actual hackernews directory is unreachable from that URL unless the agent renames it or the lookup is upgraded.

This is the OSS version. The cloud version is much richer; see the next section.

### The cloud product's trajectory-mining loop

Their April 5, 2026 essay "Web Agents That Actually Learn" describes the closed-source Browser Use Cloud system, which is what their tagline "improves over time" actually means in practice. The system is fully autonomous, no PR step:

1. **Trajectory collection.** Every cloud agent run produces a structured trajectory: messages, tool calls, page states.

2. **Skill extraction.** After a task completes, a *separate* "skill agent" reads the full trajectory and asks one question: *"What would you need to know to solve this in 1 to 3 calls?"* It outputs a structured skill: a URL pattern, a recipe (the steps), and the number of steps a future agent can skip.

3. **PII gate.** Every extracted skill passes through a dedicated LLM that rejects anything containing emails, tokens, or user-specific data. Hard rejection; not "scrub then save."

4. **Storage and indexing.** Skills are keyed by URL pattern (more precise than hostname-only) and surfaced to future agents working in the same domain.

5. **Social scoring.** Every agent that uses a skill leaves feedback: a +1 or -1 *with a written reason*. The reason is the load-bearing part. A bare ±1 carries no information.

6. **Auto-edit on negative feedback.** A -1-with-reason doesn't just lower the score; the skill agent uses the reason to *edit the skill in place*. The post cites a Duo 2FA skill that went through 3 versions as agents discovered edge cases.

7. **Retirement.** Score below -3 retires the skill.

8. **Deduplication.** Near-duplicate skills are merged automatically.

9. **Levels of evolution (the planned next tier).** "Current skills teach agents how to interact with the UI, selectors, forms, dropdowns. But the UI is an abstraction over HTTP requests. We're building HTTP-level skills next. The skill agent observes HTTP traffic during a task, reverse engineers the underlying API, and saves the raw request. Next agent skips the UI entirely and fires the API call directly."

That last point is the most important architectural claim in either essay. Convergence over time is not just "the existing harness gets faster," it's "the harness for the *job* gets cheaper": UI clicks become DOM selectors become private API hits become direct HTTP. Each tier is a more efficient mechanism than the last and the system migrates upward as evidence accumulates.

### Data flow (single invocation)

```
$ BH_DOMAIN_SKILLS=1 browser-harness -c '
    new_tab("https://www.amazon.com/s?k=keyboard")
    wait_for_load()
    print(page_info())'

  (1) run.py main()
  (2) ensure_daemon()                  health ping + CDP probe
        |- alive: no-op
        |- stale: kill, respawn, poll-until-alive
  (3) _load_agent_helpers()            re-import agent_helpers.py
  (4) exec(snippet, globals())
        |- new_tab(url)        +-> Target.createTarget("about:blank")
        |                      +-> Target.attachToTarget
        |                      +-> goto_url(url) [BH_DOMAIN_SKILLS keyed]
        |                              returns {frameId, domain_skills:[...]}
        |- wait_for_load()     +-> poll Runtime.evaluate("document.readyState")
        |- page_info()         +-> Runtime.evaluate(`{url, title, w, h, ...}`)
  (5) snippet exits, daemon stays alive (Unix socket persists)
```

Subsequent invocations skip (1)-(2)'s work in the alive case. The daemon caches the CDP WebSocket, so each `-c` round trip is just a JSON line in, JSON line out, plus the actual CDP roundtrip Chrome-side.

### What's missing from the OSS that exists in the cloud

The OSS repo deliberately ships none of: trajectory recorder, skill extractor, PII gate, score system, near-duplicate merger, auto-edit-on-feedback, HTTP-level skill mining. Those live behind the cloud API. The OSS provides the runtime substrate (CDP harness + agent-editable skill directories + hostname lookup) and leaves all the learning to either the agent's own foreman behavior or to whoever PRs in skill files.

This is significant for our PRD: the cloud-side system is the actual reference implementation of "convergence through usage" and it's not open. We can read the architecture from the essay but not the code.

---

## Strengths

- **Action-space maximalism.** The agent has direct CDP access plus the ability to write Python with arbitrary imports and shell-out via `subprocess`. There is no constrained API surface to fight. Cross-origin iframes, shadow DOM, anti-bot pages, and renderer-crash recovery all work because Chrome handles them and the agent reads the Chrome error and decides what to do. Validated by the README's "find a task it fails on (not captcha or 2FA) and win a Mac Mini" challenge.

- **Runtime self-extension is genuinely cheap.** `_load_agent_helpers()` re-exec'd on every invocation means the latency of "agent writes a new helper, agent uses it" is one file write plus one re-exec, not a daemon restart. The mechanism is 15 lines (`helpers.py:470-485`).

- **The two-tier skill split is the right one.** Substrate-generic UI mechanics in one directory, per-substrate playbooks in another, hand-curated and agent-curated respectively. Even with the OSS repo's primitive matcher (hostname prefix only), this organization is a strong scaffold and maps directly onto our bootstrap/meta layer split.

- **The cloud product's promotion calculus is well-thought-out.** Skill extraction by a separate reviewer agent, PII gate as a hard boundary, written feedback that can edit the skill in place, score-based retirement, near-duplicate merging, and a planned tier where UI playbooks graduate into HTTP recipes. Each of those is a primitive we'd want in our meta-harness.

- **"Levels of agent evolution" reframes convergence.** Convergence isn't "this one harness gets faster", it's "the system migrates between progressively cheaper harnesses for the same job." UI to DOM to private API to direct HTTP. This is the framing we should adopt.

- **Single-trajectory extraction question is sharp.** "What would you need to know to solve this in 1 to 3 calls?" is a beautifully concrete prompt for the skill-extraction agent. It's a budget on the *future* run, not the past, which sidesteps the whole "summarize the trajectory" failure mode.

- **PII gate as a single audit point.** One LLM, one job: reject any skill that contains user-specific data. That's the same architectural hygiene PRD-007 calls for in the signal extractor (single bottleneck file, easy to audit).

- **Skill versioning via written feedback is interesting.** Edits driven by `-1 with reason` rather than re-extraction from scratch is more sample-efficient than re-running the extractor on every new failure. Skills evolve like Wikipedia articles, not like training-data re-runs.

---

## Limitations & Risks

- **OSS discovery is hostname-prefix only.** `news.ycombinator.com` keys to `news/`, not `hackernews/`. Subdomains, country-specific TLDs, and multi-tenant SaaS hostnames (any `*.salesforce.com`, any `*.atlassian.net`) all break this scheme. The cloud product's URL-pattern matching is more precise but is closed.

- **OSS surfaces filenames only, not content.** When `BH_DOMAIN_SKILLS=1`, `goto_url` returns up to 10 filenames. The agent has to decide which to read and read them with its own file tools. There is no semantic ranking, no intent-conditioned selection, no embedding search. With 89 host directories and growing, the matcher will plateau.

- **`interaction-skills/` is mostly stubs.** 12 of 17 files are one-line placeholders ("describe scrolling here"). The directory is a roadmap, not a library. New users hitting iframes, shadow DOM, drag-and-drop, dropdowns, downloads, network observation, or PDF print find no actual help.

- **The "improves itself every run" tagline is misleading without context.** In the OSS repo, "improvement" is: agent edits `agent_helpers.py` or writes a new domain-skill markdown, then a human opens a PR and merges. There is no autonomous skill-extraction, no scoring, no retirement. The autonomous loop lives entirely in the cloud product.

- **No skill quality bar in the OSS.** A bad domain-skill .md persists until someone opens a corrective PR. The cloud product has score-based retirement, the OSS has nothing equivalent.

- **No drift detection.** Sites change. A skill committed 2026-04-18 says Amazon's selector is `.zg-item-immersion`; the same skill notes Amazon already migrated away from it. There is no automatic flag, expiry, or regression test. Even the cloud product's blog post doesn't describe a drift-handling story beyond "scores eventually drop."

- **No primitive type system.** Domain skills are unstructured prose plus code. There's no schema for "a skill that returns search results" vs "a skill that submits a form" vs "a skill that authenticates." Compare to PRD-007's typed `CollectionHandle<T>` four-method contract: browser-harness has none of that on the skill side.

- **Codebase has grown ~3x since the "minimalism" essay.** 600 lines became 1709 lines in a few weeks. Most growth in `admin.py` (cloud browser provisioning, profile sync, doctor, update). This is not a bug, but the marketing claim of "thinness" and the actual code are diverging.

- **Cloud product is closed-source.** The most interesting parts of this whole story (the skill extractor agent, the PII gate, the scoring system, the near-duplicate merger, the planned HTTP-level tier) are not in the repo. We can read the essay but not the implementation.

- **No public benchmarks.** The blog cites "254 agents skipped Duo 2FA exploration" and "249 Netflix pages in 2.8s" but there is no published evaluation of skill quality, skill hit rate, retirement rate, or skill-versus-no-skill task completion deltas. The "Mac Mini if you find a failing task" prize is more marketing than measurement.

---

## Integration Analysis

### What to extract for PRD-007

**1. The two-tier skill directory layout, exactly.** Our `BootstrapHarness` produces a typed surface (substrate-generic mechanics, four-method contract) and our `MetaHarness` accumulates per-mount primitives. browser-harness does the same split with `interaction-skills/` and `domain-skills/<host>/`. We should keep ours typed (their format is unstructured markdown), but the two-tier organization is the right shape and theirs validates the design.

**2. The skill-extractor-as-separate-agent pattern.** Their reviewer agent reads a completed trajectory and answers one focused question: "What would you need to know to solve this in 1 to 3 calls?" Our `MetaHarnessWorker` could do the same. Today PRD-007 says "extract only propagatable signals" but doesn't specify how. The "1 to 3 call budget on the future run" framing is much sharper than "extract a signal from the trajectory" and worth lifting wholesale.

**3. PII gate as a single auditable bottleneck.** PRD-007 already says "the signal extractor is the most security-sensitive component, single point of audit." Their PII gate is the same idea, implemented as a dedicated LLM call. We should add the same: a single function that takes a candidate primitive and either passes it or rejects it, with an adversarial test fixture suite. Keep it bottlenecked.

**4. Score-based retirement, not just promotion.** PRD-007 mentions demotion ("a meta-harness primitive that consistently fails verification on new tenants gets pulled back") but doesn't specify a mechanism. browser-harness's "score below -3 → retired" is concrete and worth copying. Combine with our verifier suite: a primitive that fails verification on the verifier suite OR scores below threshold on tenant feedback gets demoted.

**5. The "edit on -1 with reason" mechanism.** Rather than re-extracting a primitive from scratch on every failure, an agent reads the failure reason and edits the primitive in place. This is much more sample-efficient than re-extraction. Our promotion worker should support partial edits, not just full re-derivation.

**6. Levels of evolution as an explicit promotion path.** UI-level → DOM-selector-level → private-API-level → direct-HTTP-level. Each is a cheaper mechanism for the same intent. PRD-007's four-method retrieval contract is one tier of this; we should leave room for a primitive to graduate from `findSimilar` (slow, model-driven retrieval) to `runCompiled` (a saved compiled plan that takes parameters and runs in one call). The meta-harness should track which tier each primitive is at and promote when evidence accumulates.

**7. URL-pattern (not hostname-prefix) keying.** Their cloud product uses URL patterns; their OSS uses hostname prefix. PRD-007 already uses schema fingerprints (sha256 of inferred schema), which is stronger than either; this is one place we're already ahead. Worth flagging that hostname matching is a known weakness on their side, so we shouldn't over-rotate to copy their OSS.

**8. The "right harness for the right job" framing.** This is the user's actual question. Their answer: skills aren't just "do this faster", they're "use a different mechanism altogether." A skill that says "skip the UI, hit the API" is qualitatively different from a skill that says "click the button at coordinates (340, 220)." Our four-method retrieval contract should support a similar graduation: a primitive starts as `agent.search(query)` (intent-driven retrieval) and over time graduates into `agent.runCompiled(planId, params)` (a compiled plan with named parameters). The meta-harness should propose this graduation when it sees the same execution plan recur across N tenants.

### Bootstrap path

**Minimal integration (Quick, < 1h):**
- Adopt the two-tier directory naming convention in our codebase: `kb/skills/interaction/` and `kb/skills/datasets/<mountId>/`.
- Adopt the "1 to 3 call budget" prompt for our `MetaHarnessWorker`'s skill-extraction step (currently underspecified in PRD-007).

**Short integration (< 4h):**
- Add a PII-gate-equivalent function as a dedicated step in our promotion worker. Single function, schema-checked, with an adversarial fixture suite. Hard reject, not scrub.
- Add a per-primitive score field to `mount/<mountId>/meta/primitive_registry.json`. Score updates on tenant verifier results.

**Medium integration (< 1d):**
- Implement the "edit on negative feedback with reason" pattern in `PromotionWorker.ts`. Failure reason from a verifier becomes input to a primitive-edit step rather than a primitive-retire step.
- Implement "levels of evolution" tracking on each primitive: `tier: "search" | "compiled" | "native"`. Promotion paths: search → compiled (after N≥3 same-shape executions) → native (after substrate adapter publishes a `runCompiled` for that plan).

**Large integration (> 1d):**
- Build the trajectory-extraction agent as a separate process that runs offline against trajectory logs, with the "1 to 3 call budget" prompt. This is essentially PRD-007's `MetaHarnessWorker` made fully autonomous. Wire it into the existing trajectory recorder.

### Effort estimate

**Adopting the architectural lessons from their essays (the conceptual primitives): Quick to Short.** The primitives we need (PII gate, score-based retirement, edit-on-feedback, tier-based evolution) are each a small mechanism; the work is mostly in PRD-007 prose and a few hundred lines of new code in `src/meta/`.

**Reusing browser-harness as a runtime: not applicable.** Their CDP-Chrome harness has no overlap with our data-substrate harness (Atlas, HF, Postgres, JSONL). Different problem entirely.

**Mining their cloud product for code: not possible.** It's closed.

### Open questions

- **Do we want score-based retirement of meta-harness primitives, or strict verifier-based?** browser-harness uses scores from feedback; we currently propose verifier-suite-based. Scores are weaker but faster signals. Hybrid: any primitive that fails its verifier OR drops below score threshold gets demoted. Need to decide.

- **Where does the "1 to 3 call budget" framing fit on a data substrate?** On the browser, it's "skip exploration, hit the API." On Atlas, the analog is "skip ReAct, run a compiled plan." Need to translate the prompt for our domain.

- **What's the equivalent of HTTP-level skills for our substrate?** UI → DOM → API on the browser. On Atlas: ReAct → compiled MQL → native aggregation pipeline. The "levels of evolution" should be defined explicitly in PRD-007 as a tier ladder per substrate.

- **Do we want runtime helper synthesis (their `agent_helpers.py` re-exec pattern)?** Today PRD-007 generates the typed surface deterministically at bootstrap time. Their model is "agent writes new primitives at runtime." Mostly orthogonal but worth deciding: can a tenant agent write a new primitive that gets picked up on the next call without a redeploy?

---

## Key Takeaways

1. **Adopt the "1 to 3 call budget" prompt for our `MetaHarnessWorker` skill-extraction step.** PRD-007 currently underspecifies how the worker decides what to extract from a trajectory. Their prompt, "what would you need to know to solve this in 1 to 3 calls," is a sharp budget on the future run, not a vague summary of the past one. Lift it directly. Effort: Quick.

2. **Add an explicit "tiers of evolution" ladder to PRD-007 ($4d, primitive registry).** Today every primitive is a flat entry. Add a `tier` field: `search` (intent-driven retrieval, costly) → `compiled` (saved plan with named parameters, fast) → `native` (substrate-runs-it-natively, fastest). Define promotion paths between tiers as part of `PromotionWorker.ts`. This is the architectural shape behind their "UI → DOM → HTTP" levels of evolution and it's the answer to the user's question about "the right harness for the right job."

3. **Implement a PII-gate-equivalent as a single audit-point function in `SignalExtractor.ts`.** PRD-007 already calls for a single bottleneck file; their PII gate is one concrete instance and is the most security-relevant primitive in the whole pattern. Single LLM, single job, hard reject, adversarial fixture suite. Don't try to be clever. Effort: Short.

4. **Don't copy their hostname-prefix matcher; we already have schema fingerprints which are stronger.** Their OSS surfaces filenames keyed by `urlparse(url).hostname.split(".")[0]`. We use `sha256(inferred_schema)` for mount fingerprinting. Keep ours. The takeaway is: schema-shape keying is more robust than substrate-name keying, and we should not regress to their primitive matcher just because it's simpler.

---

## Sources

### Primary repository
- [browser-use/browser-harness on GitHub](https://github.com/browser-use/browser-harness), 10,210 stars, MIT, the OSS harness itself
- Repo source explored at clone: `src/browser_harness/{run,helpers,daemon,admin,_ipc}.py`, `interaction-skills/*.md` (17 files), `agent-workspace/domain-skills/<host>/*.md` (98 files across 89 hosts), `SKILL.md`, `AGENTS.md`, `install.md`, `README.md`, `pyproject.toml`

### Philosophy essays (the load-bearing primary sources)
- [The Bitter Lesson of Agent Harnesses](https://browser-use.com/posts/bitter-lesson-agent-harnesses), Gregor Zunic, 2026-04-19. The four-file thesis, "self-heal" defined, agent-edits-its-own-helpers pattern.
- [Web Agents That Actually Learn](https://browser-use.com/posts/web-agents-that-actually-learn), Gregor Zunic, 2026-04-05. The cloud product's trajectory-extraction loop, PII gate, scoring, retirement, "levels of evolution" with HTTP-level skills as the next tier. The most directly relevant essay for PRD-007.
- [The Bitter Lesson of Agent Frameworks](https://browser-use.com/posts/bitter-lesson-agent-frameworks), Gregor Zunic, 2026-01-16. The original "give the model maximal action space, then restrict" thesis. Predates the harness.

### Specific repo files cited above
- `src/browser_harness/helpers.py:159-164` (BH_DOMAIN_SKILLS hostname-keyed lookup)
- `src/browser_harness/helpers.py:470-485` (`_load_agent_helpers` re-exec pattern)
- `src/browser_harness/daemon.py:264-267` (stale CDP session re-attach)
- `src/browser_harness/admin.py:135-168` (`ensure_daemon`, "self-heals stale daemon, cold Chrome, missing Allow on chrome://inspect")
- `SKILL.md:99` (design constraint: "Don't add a manager layer")
- `README.md:61` (skill-authoring philosophy: "skills are written by the harness")
- `agent-workspace/domain-skills/claude-ai/extract-share-transcript.py` (only Python file in the skill library, demonstrates skills can be code)

### Related project context
- [PRD 007, Mount-Shaped Datasets and Cross-Tenant Meta-Harness](../prd/007-mount-and-meta-harness.md) (this project)
- [moltbook](https://www.moltbook.com/), cited in "Web Agents That Actually Learn" as the inspiration for the social-network skill model

### Connection details
- `cdp-use==1.4.5` (PyPI, the Python CDP client they wrap)
- `fetch-use==0.4.0` (PyPI, their proxy/anti-bot HTTP client used by `http_get`)
- Browser Use Cloud API at `cloud.browser-use.com` (closed source, not inspected in this brief)
