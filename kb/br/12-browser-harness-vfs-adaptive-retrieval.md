---
title: "browser-use/browser-harness Through the VFS Lens: Agent-Editable Action Space for Learning Adaptive Retrieval"
date: 2026-05-06
mode: deep
sources: 12
status: complete
---

# browser-use/browser-harness Through the VFS Lens: Agent-Editable Action Space for Learning Adaptive Retrieval

## Executive Summary

The earlier brief at `09-browser-use-browser-harness.md` covered browser-harness's architecture, traction, and PRD-007 fit in full. This file reframes that same artifact through the specific lens of "VFS as the environment for a learning adaptive retrieval interface", which is the AtlasFS angle captured in `kb/elevator.md`, `kb/mission.md`, and `kb/plans/006-vfs-native-discovery-and-reuse.md`. The bottom line is that browser-harness is the cleanest production reference for the architectural pattern AtlasFS has already committed to: a small read-only protected core, a writable seam where the agent extends its own action space at runtime, and a two-tier skill library where substrate-generic primitives live in one directory and per-substrate playbooks live in another. AtlasFS's `src/bash/fs/` mount layout, with `/db/<mountId>/` enforced as `EROFS` via `src/bash/fs/readOnly.ts:127-134` and `/lib/<tenantId>/` as the writable overlay, is structurally the same shape as browser-harness's `src/browser_harness/` plus `agent-workspace/agent_helpers.py` plus `agent-workspace/domain-skills/`; the empirical evidence at 10K+ stars and 94 host directories is that the pattern survives at production scale.

The transferable primitives, looking at what AtlasFS's codebase already has versus what browser-harness still does, are NOT browser-harness's discovery mechanism. AtlasFS's `src/discovery/librarySearch.ts` BM25-flavoured five-bucket scorer is strictly more sophisticated than browser-harness's "first hostname token, return up to 10 filenames" walk in `helpers.py:159-164`, and AtlasFS's `sha256(canonical_json(schema))` schema fingerprint in the elevator pitch is strictly stronger than hostname-keyed lookup. The transferable primitives are three patterns this re-survey isolated: first, the agent-edits-its-own-helpers seam, where the April 2026 Bitter Lesson of Agent Harnesses essay argues "your helpers are abstractions too. Delete them. Let the agent write what it needs", which lines up exactly with the pure-composition path in `src/observer/author.ts:64-139` and validates that path as the load-bearing one. Second, the stub-as-slot pre-allocation pattern visible in browser-harness's `interaction-skills/`, where 12 of 17 files are one-line directives describing what the file should eventually contain, which is the natural surface for plan-006-phase-5's intent-shaped function names and plan-006-phase-7's missed-reuse warnings. Third, the typed-API-versus-prose-skill gap, where browser-harness's skills are unstructured markdown without parameter or return contracts, and AtlasFS's `fn({...})` files with YAML frontmatter plus a proposed `intent_hash` (per `kb/br/11-pysyft-force-intent-declaration.md`) are strictly better; the takeaway is to not regress.

Since `09-browser-use-browser-harness.md` was written on 2026-05-04, the broader filesystem-shaped-agent ecosystem has produced three artifacts that change the picture for AtlasFS specifically. Turso's AgentFS (Nov 2025, with a January 2026 disaggregated follow-up by Pekka Enberg) argues for one SQLite file mounted via FUSE as the unifying abstraction, claiming queryability, versioning, portability, and durability fall out automatically. AutoSkill (ECNU-ICALK, with AutoSkill4Doc 1.0 released 2026-03-13 and SkillEvo 1.0 released 2026-03-23) formalises a versioned `SKILL.md` SkillBank with a replay-evaluation-mutation-promotion cycle and an explicit "durable constraints" gate that refuses to crystallise on noisy generic intents. Skill Library Evolution (Nikola Balic, 2026-01-13) introduces the MCP-bound-skill pattern with selective `includeTools` filtering, with a worked example showing 91% context reduction (26 tools and 17K tokens to 4 tools and 1.5K tokens). Browser-use's own series added two posts in this window: "The Bitter Lesson of Agent Harnesses" (2026-04-19) and "BUX: Your 24/7 Remote Agent with Browser Harness" (2026-04-25), the second of which productises the harness story as a persistent `/home/bux` mount on a $5/month VPS and demonstrates that the pattern carries from short-lived sessions to long-lived agents. The combined message for AtlasFS is that "agent state as filesystem-shaped" is the field's converging answer for both auditability and learning, and the typed-TS-module-over-Atlas approach AtlasFS is building is the most structured point on the spectrum so far. The right move is to lift the agent-editable-action-space pattern wholesale and pair it with the typed-surface contract AtlasFS already has, rather than copy any specific browser-harness primitive.

---

## Overview

This section is intentionally short. The full architecture and traction picture is in `09-browser-use-browser-harness.md`; the points repeated here are the ones load-bearing for the VFS-as-environment angle.

**What changed in browser-harness since 09-... was written.** The repo grew from 1709 lines across 6 files in `src/browser_harness/` to 1978 lines on 2026-05-06; the growth is concentrated in `admin.py` (782 lines, was 649) and `daemon.py` (408 lines, was 332). The `helpers.py` agent-facing surface barely moved (493 lines, was 485). The skill library grew from 89 host directories to 94, with 102 `.md` files total; the new hosts continue the prose-plus-Python convention with no schema and no frontmatter on the substantial majority. The discovery mechanism in `helpers.py:159-164` did not change: it remains `(urlparse(url).hostname or "").removeprefix("www.").split(".")[0]` keyed against `agent-workspace/domain-skills/`, returning `sorted(p.name for p in d.rglob("*.md"))[:10]`. There is still no embedding index, no manifest file, no semantic ranking, no rerank step.

**Two new posts in the philosophy series.** "The Bitter Lesson of Agent Harnesses" (2026-04-19, Gregor Zunic) is the thesis-level companion to the existing "Web Agents That Actually Learn" post; the load-bearing quotes are "your helpers are abstractions too. Delete them. Let the agent write what it needs", "the agent isn't writing new code from first principles. It's writing the one function that was missing", and "the 'complexities of CDP' we were trying to hide weren't something to hide. They were something to let the model see." "BUX: Your 24/7 Remote Agent with Browser Harness" (2026-04-25, Johannes Dittrich) productises the harness story as a $5/month VPS plus Telegram plus Claude Code deployable, with the architecturally relevant detail that agent state lives in `/home/bux` so "reboots keep your cookies, skills, and chat history."

**The opt-in gate.** Domain-skills surfacing is gated by `BH_DOMAIN_SKILLS=1`. By default the harness returns plain CDP results from `goto_url` and the skill library is dormant. This is a deliberate deployment choice: the substrate is shippable without an opinion on skills, and skills only become active in environments that opt in. Browser-harness uses an env var; AtlasFS's analogous control point is the `mountIds` and tenant binding in `BashSessionInit`, plus the existence of `/lib/<tenantId>/` files at session start.

**Why this matters now for AtlasFS.** AtlasFS just landed three things that put the VFS-angle question front and centre: `src/bash/fs/readOnly.ts` enforcing EROFS at the adapter (plan 006 phase 3, done), `src/discovery/librarySearch.ts` as the shared scorer for in-VFS `apropos` and CLI `datafetch apropos` (plan 006 phase 1, done), and the in-progress `kb/br/11-pysyft-force-intent-declaration.md` proposal that closes the symmetric gap on reads. The brief at hand asks how browser-harness can help shape the next moves; the answer is that the architectural shape is already validated, the missing primitives are stub-allocation, durable-constraints gating, and the framing language that keeps the agent-edits-its-own-action-space path load-bearing.

---

## How It Works (the VFS angle, not a re-do of 09-...)

For the four-file core, the daemon, the helpers surface, and the trajectory loop, see `09-browser-use-browser-harness.md`. This section concentrates on the four mechanisms that matter for the VFS-as-environment framing.

### The two-zone separation, mirrored

Browser-harness ships two structurally distinct zones: a write-protected `src/browser_harness/*.py` core that the agent cannot mutate, and an `agent-workspace/` tree that the agent extends at runtime. The runtime resolution is via the `BH_AGENT_WORKSPACE` environment variable; if set, helpers load from the path it points at, otherwise they fall back to the repo's default. The core's job is daemon lifecycle, CDP plumbing, and the small set of pre-imported helpers; the workspace's job is everything the agent learns about how to navigate specific sites.

```
+-------------------------------------------------------------+
|  browser-harness                                             |
|    src/browser_harness/                  protected core      |
|      __init__.py     2     daemon.py    408                  |
|      _ipc.py       183     helpers.py   493                  |
|      admin.py      782     run.py       110                  |
|                                                              |
|    agent-workspace/                      writable seam       |
|      agent_helpers.py    7    (stub: pure docstring)         |
|      domain-skills/                                          |
|        <host>/<task>.md       94 hosts, 102 files            |
|                                                              |
|    interaction-skills/                   shared playbook     |
|      *.md                     17 files, 12 stubs             |
+-------------------------------------------------------------+

+-------------------------------------------------------------+
|  AtlasFS                                                     |
|    src/                                  protected core      |
|      bash/                  session, snippetRuntime,         |
|                             fs/{mountable,readOnly,...}      |
|      discovery/             librarySearch.ts                 |
|      observer/              gate.ts, author.ts, worker.ts    |
|      snippet/               runtime.ts, dfBinding.ts         |
|      trajectory/            recorder.ts                      |
|                                                              |
|    /db/<mountId>/                        EROFS, synthesised  |
|      <coll>.ts              typed TS modules, lazy           |
|      <coll>/_descriptor.json,_samples.json,_stats.json       |
|                                                              |
|    /lib/<tenantId>/                      writable seam       |
|      <name>.ts              fn({...}) files, frontmatter     |
|      skills/                                                 |
+-------------------------------------------------------------+
```

The shapes line up almost one-to-one. Browser-harness's `src/browser_harness/` is AtlasFS's `src/`. Browser-harness's `agent-workspace/agent_helpers.py` (a 7-line docstring stub today) is the conceptual seed of AtlasFS's `/lib/<tenantId>/<name>.ts` directory. Browser-harness's `agent-workspace/domain-skills/<host>/<task>.md` and AtlasFS's `/lib/<tenantId>/<name>.ts` are the same kind of thing at different fidelities: per-substrate playbooks accumulated over runs, typed in AtlasFS, prose-plus-code in browser-harness. The empirical case for the two-zone separation is in browser-harness's traction; the empirical case for typing it is in AtlasFS's existing `LibraryResolver.resolve(name)` validation step (`src/observer/author.ts:124-136`) which deletes any authored file that fails to load.

### The "agent edits its own helpers" seam

The Bitter Lesson of Agent Harnesses is the single sharpest external argument for the pattern AtlasFS already implements in `src/observer/author.ts`. The essay's pithy moves are worth quoting directly because they collapse a long PRD argument into one paragraph:

> Your helpers are abstractions too. Delete them. Let the agent write what it needs. We gave it Claude Code's normal Read/Edit/Write plus CDP access. The agent isn't writing new code from first principles. It's writing the one function that was missing.

In browser-harness, the mechanism is `_load_agent_helpers()` at `helpers.py:470-485`: every invocation re-imports `agent-workspace/agent_helpers.py`, so any function the agent writes there is picked up on the next call without restarting the daemon. The agent's tools are its own Read/Edit/Write tools (Claude Code, Codex, Cursor); the harness side of "self-extension" is fifteen lines.

In AtlasFS, the mechanism is the pure-composition path in `authorFunction()` at `src/observer/author.ts:64-139`. The Observer's worker (`src/observer/worker.ts:91-172`) reads the trajectory after a snippet runs; if the gate predicates in `src/observer/gate.ts:54-177` all pass, `authorFunction()` first tries to generate a `fn({...})` file directly from the template's call steps, harvesting external parameters and example values from the originating trajectory. Only if pure composition fails does it fall back to dispatching the `finqa_codify_table_function` codifier skill via Flue. The authored file is written to `<baseDir>/lib/<tenantId>/<name>.ts` with YAML frontmatter inside a `/* --- ... --- */` comment block, then validated by `LibraryResolver.resolve(name)`; on validation failure the file is deleted and the result is `kind: "skipped"`.

The key load-bearing claim, restated for AtlasFS: pure composition from a trajectory's existing typed primitives is structurally equivalent to browser-harness's "agent writes the one function that was missing." The trajectory has already proved the call sequence works; the authoring step is mechanical projection from "ordered list of typed calls" to "named function over harvested parameters." Falling back to a skill-dispatched codifier is the analogue of browser-harness's "if the function doesn't exist, agent uses its file-edit tools to write it"; both are last-resort paths for the cases the cheap mechanism cannot reach.

The framing in the Bitter Lesson essay matters because PRD prose for AtlasFS currently underplays this. The Observer is described in `kb/learnings.md` C4 as "trace-shaped naming is the load-bearing weakness", but the full message is: do not retreat from pure composition into a hand-curated typed-primitive library. The reason browser-harness's helpers stayed thin (492 lines pre-imported, 7 lines in the agent-workspace stub) is exactly that the team committed to "let the agent write what it needs" rather than expanding the helper API. AtlasFS's analog is to keep `src/snippet/dfBinding.ts` and the typed-module surface deliberately narrow, and to push novelty into `/lib/<tenantId>/` via authoring, not into the protected core via PRs.

### The stub-as-slot pre-allocation pattern (the new finding)

Browser-harness's `interaction-skills/` directory contains 17 markdown files; 12 of them are one-line directives. Examples from the re-survey:

- `shadow-dom.md`: "Focus on recursive `shadowRoot` traversal, and note when coordinate clicking is simpler than piercing deeply nested component trees."
- `dropdowns.md`: "Split dropdowns into native selects, custom overlays, searchable comboboxes, and virtualized menus, and always re-measure after opening because option geometry often appears late."
- `network-requests.md`: "Document how to watch or infer network activity when page state is ambiguous."

These are not skills. They are slot specifications: declarations of what the file should eventually contain, pre-allocated under named paths, ready to be filled by an agent the first time it encounters the relevant mechanic. The pattern is structurally significant because it inverts the usual "agent learns, then we add the file" workflow into "the file exists, with a contract describing what populates it, and the agent fills it on first encounter."

For AtlasFS this maps onto plan-006-phase-5 (intent-shaped function names) and plan-006-phase-7 (missed-reuse warnings) but adds a new primitive that the plan does not currently articulate: pre-allocate empty typed module stubs at known intent-shape paths, with the parameter and return type declared but the body empty. The crystallisation system fills the body without changing the signature. The result is a `/lib/<tenantId>/<intentName>.ts` directory whose `ls` already advertises "what the agent should learn", not just "what the agent has learned."

A worked example. The `finqa-revenue-growth` intent cluster (per `kb/mental-model.md`) currently has no stub; the first novel trajectory for "year-on-year revenue growth" runs full ReAct, then the Observer's pure-composition path writes `crystallise_executeTableMath_<8-char-hash>.ts`. With stub-as-slot, the cluster ships a stub `/lib/<tenantId>/yearOverYearGrowth.ts`:

```typescript
/* ---
name: yearOverYearGrowth
description: Year-over-year change for a named line item in a financial table.
status: stub
intent_hash: ""
shape-hash: ""
--- */
export async function yearOverYearGrowth(args: {
  table: TableHandle;
  metric: string;
  year: number;
}): Promise<{ change: number; baseline: number; current: number }> {
  throw new Error("not yet crystallised");
}
```

The agent's `apropos "year-over-year revenue growth"` returns this stub above the score threshold because the description and name match. The agent reads it, sees the contract, and either calls it directly (failing with "not yet crystallised", which is the missed-reuse warning by another name) or composes the missing body using `df.db.*` primitives. The Observer's authoring step then fills the body, preserving the signature; the stub becomes a real procedure. This is the natural surface for plan-006 phases 5 and 7 combined: intent-shaped names are pre-declared, missed-reuse warnings fall out of "stub matched but body was empty."

### The discovery mechanism gap (do not regress here)

Browser-harness's discovery is the weakest part of its architecture and the one place AtlasFS is already strictly ahead. The full mechanism is `helpers.py:159-164`:

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

It is exactly two operations: derive a directory name from the first hostname token, and list up to 10 markdown filenames in that directory. There is no semantic ranking, no embedding match, no intent feature, no schema awareness. Multi-tenant SaaS hosts (`*.salesforce.com`, `*.atlassian.net`) all collapse to a single directory; subdomains are stripped; alternate TLDs break.

AtlasFS's `src/discovery/librarySearch.ts` does five things browser-harness does not: tokenises the query, scores against five fields with declared weights (name 0.9, intent 1.0, frontmatter description 1.0, examples 0.95, source head 0.55), takes `max(coverage, jaccard)` with a tool-kind tie-breaker, applies a 0.25 threshold, and returns a typed `RankedFunction[]` with both an `invocation` string and a `why` map showing which buckets matched. The `man <fn>` command on top of this scorer renders a Unix man-page block with NAME, KIND, DESCRIPTION, SYNOPSIS, INPUT SCHEMA, OUTPUT, EXAMPLES, INVOCATION, SOURCE. The combined surface is closer to a typed library than to a filename roster.

The takeaway is structural: browser-harness's hostname-prefix matcher is what an agent-extensible filesystem-shaped action space looks like before retrieval is taken seriously, and AtlasFS has already crossed that line. Resist the temptation, when chasing browser-harness compatibility, to re-introduce a hostname-prefix-shaped lookup as a "fast path." The right path is the existing scorer plus a future intent-shape-hash redirect (per `kb/br/11-pysyft-force-intent-declaration.md`).

### The skill file format (typed surface vs prose, do not regress)

Five representative `.md` files were examined in the re-survey: `arxiv/scraping.md` (311 lines, no frontmatter, runnable Python with confirmed-output comments), `atlas/overview.md` (70 lines, has YAML frontmatter with name and description, no input/output shape), `shopify-admin/knowledge-base.md` (109 lines, no frontmatter, references functions defined in a sibling file), `medium/article-hydration.md` (120 lines, no frontmatter, decision logic plus DOM doc plus extractor), `github/repo-actions.md` (65 lines, no frontmatter, contains explicit precondition guard).

Across 102 files, only 2 have frontmatter. The implicit structure is H1 = domain name, H2 sections = workflow categories, prose = approach, code block = procedure. Typed function signatures appear inside Python code blocks but are not at the file's interface boundary; cross-file references (sibling files calling sibling functions) are conventional, not enforced. Drift is impossible to detect because there is no schema to invalidate.

AtlasFS's authored `fn({...})` files have frontmatter with `name`, `description`, `trajectory`, `shape-hash`, plus a TypeScript type-checked signature, plus the validation step at `src/observer/author.ts:124-136` that deletes any file that fails to load. Adding `intent_hash` per the PySyft proposal closes the last gap. The takeaway is the same as for discovery: AtlasFS is already past the prose-and-code stage, and the pull from browser-harness's volume of skills (102 files looks impressive) should not pull back from the typed surface.

### Levels of evolution, restated for the data-substrate case

The April 2026 "Web Agents That Actually Learn" essay introduces a concept worth restating in AtlasFS terms: the harness for a job evolves toward a progressively cheaper substrate. UI clicks become DOM selectors, become private API hits, become direct HTTP. Each tier replaces the previous; convergence is migration, not just acceleration.

For AtlasFS's data substrate, the analogous tier ladder is:

```
+---------------------------------------------------+
|  Tier 0  full ReAct                               |
|          LLM-driven control flow                  |
|          reads from /db/, writes scratch          |
|          most expensive                           |
+---------------------------------------------------+
|  Tier 1  pure-composition crystallised fn         |
|          /lib/<tenant>/<name>.ts                  |
|          deterministic typed call sequence        |
|          LLM out of hot path                      |
+---------------------------------------------------+
|  Tier 2  compiled aggregation pipeline            |
|          single Atlas $aggregate, named pipe      |
|          substrate runs it natively               |
|          cheapest                                 |
+---------------------------------------------------+
```

Each tier corresponds to a different file at the same `/lib/<tenantId>/<name>.ts` path: same filename, different body, same signature. The Observer's tier is post-hoc-classified from the trajectory mode (`novel`, `interpreted`, `llm-backed` in `src/snippet/runtime.ts`); the budget worker's job is to walk a tier-1 file and replace bodies with tier-2 equivalents whenever user-alignment makes the substitution safe. This is exactly the elevator pitch's "Generalisation pass (cost falls one link at a time)" but framed as a tier ladder rather than a chain of substitutions, which lines up with browser-harness's framing and with PRD-007's `tier` field proposal in 09's takeaways.

### Bonus: what the broader ecosystem published since 09

Three artifacts that change the picture:

**Turso AgentFS, Nov 2025 plus disaggregated AgentFS, Jan 2026.** The argument is that agent state should be one SQLite file mounted via FUSE, giving queryability via SQL, versioning via WAL, portability via single-file copy, and durability via replication. Pekka Enberg's January 2026 follow-up disaggregates the database itself onto object storage and adds pull/push checkpoints. For AtlasFS this is orthogonal: AtlasFS's substrate IS Atlas, not a new database; AtlasFS's "filesystem" is a typed virtualisation over an existing data plane, not a SQLite-as-mountable-state. The relevance is that the field is converging on "agent state as filesystem-shaped" as the right abstraction, and AtlasFS is on the right side of that convergence.

**AutoSkill (ECNU-ICALK), AutoSkill4Doc 1.0 on 2026-03-13 and SkillEvo 1.0 on 2026-03-23.** The closest published analogue to AtlasFS's crystallisation pipeline. Skills are stored as versioned `SKILL.md` artifacts in a SkillBank, then merged or upgraded (`v0.1.0` to `v0.1.1`) as feedback arrives. SkillEvo adds an explicit replay-evaluation-mutation-promotion cycle. The most actionable detail for AtlasFS's Observer gate is the "durable constraints" gate: AutoSkill explicitly avoids creating skills for noisy generic tasks (a bare "write a report" with no stable preferences) and only crystallises when durable constraints appear across multiple runs. This is a 7th predicate the Observer at `src/observer/gate.ts:54-177` does not currently check; the existing 6 predicates ensure trajectory shape is good, but none ensure intent durability across runs.

**Skill Library Evolution (Nikola Balic, 2026-01-13).** Formalises a four-stage lift from ad-hoc code through saved working solution through reusable function through documented skill to agent capability. The architecturally significant part for AtlasFS is the MCP-bound-skill pattern with selective `includeTools` filtering. The worked example shows trimming chrome-devtools from 26 tools and 17K tokens to 4 tools and 1.5K tokens, a 91% context reduction. For AtlasFS, the analogous mechanism is per-procedure declaration of which `df.db.*` paths the procedure may read; this is exactly what `kb/br/11-pysyft-force-intent-declaration.md` proposes for AtlasFS's `paths: string[]` field, except framed in MCP language. The pattern is the same: a typed surface is a slice of a larger underlying capability; the slice is explicit, the slice is auditable, the slice is the unit of context cost.

**BUX (browser-use, 2026-04-25).** A productised harness deliverable as a $5/month VPS plus Telegram plus Claude Code. The architecturally relevant detail for AtlasFS is that agent state lives in `/home/bux` so reboots preserve cookies, skills, and chat history; the persistent mount carries from short-lived sessions to long-lived agents. This validates that the filesystem-as-environment pattern survives outside the original short-task framing.

---

## Strengths

- **Empirical proof at production scale that the two-zone separation works.** 10K+ stars, 94 host directories, daily skill PRs from real agents, two-week-old repo. The pattern of "small protected core plus writable agent-workspace" is not a thought experiment; it is shipping. AtlasFS's mirrored layout (`src/` plus `/db/<mountId>/` EROFS plus `/lib/<tenantId>/` writable) inherits the validation.

- **The Bitter Lesson framing is short and load-bearing.** "Your helpers are abstractions too. Delete them. Let the agent write what it needs." This single sentence collapses several PRD-paragraphs of argument about why AtlasFS's pure-composition author path matters more than expanding the typed-primitive surface. It belongs in `kb/mission.md` or `kb/elevator.md`, attributed to Zunic, as the canonical defence of `src/observer/author.ts`.

- **The agent-edits-its-own-helpers seam is genuinely cheap.** `_load_agent_helpers()` is fifteen lines. It re-imports a single file on every invocation. The latency of "agent writes a new helper, agent uses it" is one file write plus one re-exec. AtlasFS's analogue is the equally cheap re-resolution of `LibraryResolver` after `regenerateManifest()` fires (`src/observer/author.ts:124-136`); the pattern carries.

- **The opt-in gate semantics are deployable.** `BH_DOMAIN_SKILLS=1` is the difference between a harness that ships with no opinion on skills and one that activates the skill library only in environments that opt in. AtlasFS's analogous gate is per-tenant binding plus the existence of authored files in `/lib/<tenantId>/`, with tier promotion gated by Observer predicates.

- **The stub-as-slot pattern in `interaction-skills/` is a discoverable pre-allocation primitive.** 12 of 17 files describe what the file should contain, before content exists. This is a usable pattern AtlasFS should add: pre-create empty typed module stubs at known intent-shape paths, with parameter and return type declared. The Observer fills the body without changing the signature.

- **Two new posts added in this window strengthen the picture.** Bitter Lesson of Agent Harnesses sharpens the helper-deletion argument; BUX shows the persistent-mount pattern carries from short-lived sessions to long-lived agents. Both are short, both are quotable, both are usable in AtlasFS PRD prose.

- **Browser-use's framing is consistent across nine first-party essays.** The philosophy series (Frameworks, Harnesses, Closer to the Metal, Web Agents That Actually Learn, plus the new posts) is unusually coherent for a young product. The arguments stack and the tone is clear. AtlasFS's docs should aspire to a similar level of consistency and pithiness.

---

## Limitations & Risks

- **Discovery primitive is structurally weaker than what AtlasFS already has.** Hostname-prefix matching with no semantic ranking, no embedding, no rerank, no schema awareness. Returning up to 10 alphabetically sorted filenames is the bare minimum that qualifies as "discovery." Any pull from browser-harness compatibility toward "fast hostname-keyed lookup" should be resisted; AtlasFS's `src/discovery/librarySearch.ts` is the right surface, and the right next step is intent-shape-hash redirect, not a regression to filename listing.

- **Skill files are unstructured prose plus code.** Only 2 of 102 files have YAML frontmatter; cross-file references are conventional, not enforced; drift is undetectable. AtlasFS's typed `fn({...})` files with frontmatter, schema-fingerprint pinning, and `LibraryResolver.resolve` validation are strictly better. Do not regress.

- **The "skill PR review" workflow is manual and does not fit AtlasFS.** Browser-harness's domain-skills are agent-drafted, human-reviewed, manually merged via PR. AtlasFS's crystallisation pipeline is autonomous: `src/observer/worker.ts` fires after every snippet run and `authorFunction` writes immediately. The right comparison is AtlasFS's Observer plus gate plus author versus browser-harness's cloud product (closed source); the OSS PR workflow is a slower, more manual version of the same pattern and not the integration target.

- **No drift detection in browser-harness OSS.** Sites change; selectors break; skill files persist. Browser-harness has no expiry, no fingerprint pin, no flag. AtlasFS's schema fingerprint at `kb/mental-model.md` plus the `drifted` and `broken` procedure states gives this; do not lose it.

- **No PII gate, no scoring, no retirement in the OSS.** Those primitives live behind the cloud API, which is closed source. The takeaway is: read the architecture from the April 2026 essay, do not expect to find the implementation. AtlasFS will need to build all of these from scratch (or borrow from PySyft's `InputPolicy` and AutoSkill's promotion cycle).

- **The stub-as-slot pattern is fragile if the agent ignores filenames.** Pre-allocated stubs only help if `apropos` surfaces them above threshold. If the agent always composes from scratch (the failure mode plan-006 was written to address), stubs become noise. The mitigation is the same as for plan-006-phase-7: missed-reuse warnings in the result envelope when a novel trajectory matches an existing stub above confidence threshold.

- **The Bitter Lesson framing can be overgeneralised.** "Delete the helpers" is right for a CDP harness where the protocol is already a complete substrate. AtlasFS's typed module surface is partially that role; the typed `df.db.*` proxy and the `views/` directory carry semantic content the agent should not have to re-derive. The "delete" verb is rhetorical; the actual move is "keep the thin layer thin, push novelty into the writable seam."

- **The hostname-prefix matcher's failure modes do not all carry to AtlasFS.** Multi-tenant SaaS hostnames break browser-harness's discovery; AtlasFS's mount-id keying does not have this failure mode. The risk is importing a mental model of "discovery is hard" from browser-harness when AtlasFS's keying is structurally cleaner.

- **The browser-use cloud product's promotion calculus is the load-bearing reference, not the OSS repo.** This was the conclusion in 09 and re-survey confirms it. The OSS at 1978 lines is a thin substrate; the PII gate, the scoring, the auto-edit-on-feedback, the planned HTTP-tier are all in the closed cloud. Anyone reading only the OSS will under-appreciate the architecture.

- **The 2026-05-06 commit history is one big initial drop.** The shallow clone shows `bc186db` as the only commit, a complete repo init. The "since 2026-05-04" delta in the OSS is therefore not literal commits-since-then; it is "the codebase as of 2026-05-06 versus the version captured in 09." Anything attributed to "recent changes" in this brief is "the current state at re-survey", not "what was added in the past two days."

---

## Integration Analysis

### What to extract for AtlasFS

**1. The two-zone separation is already implemented; reinforce it in PRD prose.** AtlasFS's `src/bash/fs/readOnly.ts:127-134` makes `/db/<mountId>/` EROFS at the adapter; `/lib/<tenantId>/` is the writable seam; orientation files live in the base overlay. The browser-harness mirror provides external validation. Add a one-paragraph reference to browser-harness's same shape in `kb/mission.md` or PRD docs as evidence the architecture is field-tested at production scale.

**2. The Bitter Lesson framing belongs in the elevator and PRD.** The single sentence "your helpers are abstractions too. Delete them. Let the agent write what it needs" is the canonical defence of AtlasFS's `src/observer/author.ts:64-139` pure-composition path. Cite it. The framing protects against future PR-review pressure to expand `src/snippet/dfBinding.ts` or grow the typed-primitive surface; the response is "the typed surface is deliberately narrow; novelty lives in `/lib/<tenantId>/`."

**3. Add stub-as-slot pre-allocation to plan 006.** Pre-create empty typed module stubs at known intent-shape paths, with parameter and return type declared but body throwing `not yet crystallised`. The Observer's pure-composition path fills the body without changing the signature. Stubs are surfaced by `apropos` above threshold because their `name`, `description`, and `intent` match. The pattern unifies plan-006-phase-5 (intent-shaped names) and plan-006-phase-7 (missed-reuse warnings) into one mechanism: pre-allocation plus body-fill plus warning-on-empty.

**4. Add a "durable constraints" predicate (7) to the Observer gate.** Borrowed from AutoSkill: do not crystallise on noisy generic intents. The current gate at `src/observer/gate.ts:54-177` has 6 predicates ensuring the trajectory shape is good (no errors, no nested crystallisation, schema-fingerprint not duplicated, etc.) but none ensuring the intent itself is durable across runs. Add: "this trajectory's intent_hash has been observed in at least N completed trajectories (default N=2) before crystallisation is allowed." Pairs naturally with the PySyft `intent_hash` proposal.

**5. Adopt the "1 to 3 calls" budget framing in the Observer's authoring step.** Already in 09's takeaways for PRD-007; re-applies here. The Observer's authoring step at `src/observer/author.ts` should be prompted with "what would you need to know to solve this in 1 to 3 calls", which is a budget on the *future* run, not a vague summary of the past one. Lift wholesale.

**6. Adopt the MCP-bound-skill `includeTools` pattern for `/db/` slicing.** From Skill Library Evolution: each procedure declares which underlying tools (collection paths in AtlasFS's case) it actually needs. A 91% context reduction on the worked chrome-devtools example. AtlasFS's analogue is per-procedure declaration of `paths: string[]` against `df.db.*`; enforce at the proxy chokepoint in `src/snippet/dfBinding.ts:59`. This is exactly the PySyft `InputPolicy` proposal in `kb/br/11-pysyft-force-intent-declaration.md`, framed in MCP language.

**7. Adopt the levels-of-evolution tier ladder explicitly.** Tier 0 full ReAct, Tier 1 pure-composition crystallised fn, Tier 2 compiled aggregation pipeline. Each tier is a different body at the same `/lib/<tenantId>/<name>.ts` path. The budget worker's job is tier promotion; verifier-pass is the gate. Already present implicitly in `kb/elevator.md` "Generalisation pass" but not framed as a tier ladder.

**8. Adopt the opt-in gate semantics for tier-1 procedures.** Browser-harness's `BH_DOMAIN_SKILLS=1` activates the skill library; AtlasFS's analogue is per-tenant gating of `/lib/<tenantId>/<name>.ts` matching. A tenant can run "vanilla" (Tier 0 only) versus "endorsed" (Tier 1 active) versus "compiled" (Tier 2 active). The gate is per-tier, not per-skill, which keeps the surface area auditable.

### What NOT to extract

**1. Hostname-prefix discovery (a regression).** AtlasFS's BM25 scorer is strictly better. Do not add a "fast path" that bypasses it; the right next step is intent-shape-hash redirect plus stub-matching, not filename listing.

**2. Unstructured prose-plus-code skill format (a regression).** AtlasFS's typed `fn({...})` with frontmatter is strictly better. The volume of browser-harness's 102 files is misleading; the cost of each file's drift is paid by every future agent.

**3. The PR-review skill workflow (does not fit autonomous crystallisation).** AtlasFS's Observer fires automatically; browser-harness's OSS skills are merged manually. The right comparison is to browser-use's closed cloud product, not the OSS PR workflow.

**4. The BH_DOMAIN_SKILLS env-var-as-gate pattern, exactly.** Use per-tenant tier gating instead. The env-var pattern is fine for a single-tenant browser harness; AtlasFS's multi-tenant overlay layout makes env-var-keyed activation under-expressive.

### Bootstrap path

**Quick (under 1h):**
- Add the Bitter Lesson framing as a one-sentence quote in `kb/mission.md` or `kb/elevator.md`, attributed to Zunic 2026-04-19. Cite the new post in the references section of PRD docs.
- Add a one-paragraph reference to browser-harness's two-zone separation in PRD prose as external validation of `src/bash/fs/`.

**Short (under 4h):**
- Sketch the stub-as-slot pattern in `kb/plans/006-vfs-native-discovery-and-reuse.md` as a new phase between phase 5 (intent-shaped names) and phase 7 (missed-reuse warnings). Pre-create one or two stubs in `lib/<tenant>/` for the FinQA cluster's most common intents (e.g., `yearOverYearGrowth.ts`, `operatingMarginChange.ts`); have the Observer fill them on first relevant trajectory.
- Add a 7th predicate to `src/observer/gate.ts` enforcing intent-hash durability (>= 2 completed trajectories before crystallisation). Requires the PySyft `intent_hash` field per `kb/br/11-...md`.

**Medium (under 1d):**
- Implement intent-shaped function names per plan-006-phase-5, replacing `crystallise_${topic}_${shapeHash.slice(0,8)}` with the stub-derived name when a stub matches. Wire `LibraryResolver` to detect stub-vs-full state via the frontmatter `status: stub` field.
- Implement plan-006-phase-7 missed-reuse warnings by emitting a warning in the result envelope when a novel trajectory matches an existing stub or function above the discovery threshold.
- Implement the tier-ladder body at the procedure level: `tier: 0 | 1 | 2` in the frontmatter, set on authoring, advanced by the budget worker.

**Large (over 1d):**
- Implement the MCP-bound `paths: string[]` declaration on `fn` envelopes per `kb/br/11-...md`, enforced at the proxy chokepoint in `src/snippet/dfBinding.ts:59`.
- Implement the budget worker's tier promotion path: walk a tier-1 file, identify substitutable links, propose a tier-2 compiled pipeline, run verifier suite, promote on pass.

### Effort estimate

Adopting the conceptual primitives (Bitter Lesson framing, stub-as-slot pattern, durable-constraints predicate, tier ladder, MCP-bound paths): **Quick to Medium**. Most of these are PRD prose plus 50 to 200 lines of code in `src/observer/`, `src/discovery/`, and `src/snippet/dfBinding.ts`.

Reusing browser-harness as a runtime: **not applicable**. Their CDP-Chrome harness has no overlap with AtlasFS's data-substrate harness. Different substrate entirely.

Mining their cloud product for code: **not possible**. Closed source.

Lifting the broader-ecosystem primitives (AutoSkill's durable-constraints gate, Skill Library Evolution's MCP includeTools, AgentFS's WAL-as-history): **Short to Medium**, all framing-plus-small-code-changes; the mechanisms are simple, the work is in alignment.

### Open questions

- **Does the stub-as-slot pattern need a manual-curation step, or is it pure agent-driven?** Browser-harness's analogous pattern (interaction-skills stubs) is hand-authored. AtlasFS could ship a small set of pre-allocated stubs with the FinQA and BIRD intent clusters, then let the Observer create new stubs as trajectories converge. Hybrid is probably right; need to decide who owns the stub catalog.

- **Should `intent_hash` be content-derived (hash over input fields) or prompt-derived (hash over the user's natural-language request)?** PySyft's framing is closer to content-derived. AutoSkill's "durable constraints" is closer to prompt-derived. Different tradeoffs: content-derived is robust to phrasing variation but loses intent specificity; prompt-derived captures specificity but explodes the hash space. Probably both, layered.

- **How does the tier ladder interact with the schema fingerprint pin?** Tier 1's body imports typed modules; tier 2's body is a compiled aggregation pipeline; both pin the same schema fingerprint. If schema drifts, both tiers are flagged as `drifted`; the verifier suite is the arbiter of which tier survives the drift. Need to decide: does drift demote tier 2 to tier 1, or invalidate both?

- **Does AtlasFS want a `BUX`-shaped persistent-mount product framing?** The April 2026 BUX post shows the harness pattern carries from short-lived sessions to long-lived agents with persistent state at `/home/bux`. AtlasFS's analogous deliverable is a tenant whose `/lib/<tenantId>/` accumulates over weeks. The product framing is interesting but probably out-of-scope for the hackathon demo.

---

## Key Takeaways

1. **AtlasFS's architecture is already a more-structured version of browser-harness's; the integration question is "what to extract," not "what to copy."** The two-zone separation, the agent-editable seam, and the per-substrate playbook directory are all already implemented in `src/bash/fs/`, `src/observer/author.ts`, and `/lib/<tenantId>/`. Browser-harness validates the shape at production scale; AtlasFS adds typed module signatures, schema-fingerprint pinning, the BM25 discovery scorer, and an autonomous Observer-gate-author crystallisation pipeline. The transferable primitives are the framing language (Bitter Lesson essay), the stub-as-slot pre-allocation pattern, and the durable-constraints gate from AutoSkill. The non-transferable primitives are the hostname-prefix matcher, the unstructured prose skill format, and the manual PR-review workflow.

2. **Add the Bitter Lesson framing to `kb/mission.md` as the canonical defence of `src/observer/author.ts`.** The single sentence "your helpers are abstractions too. Delete them. Let the agent write what it needs" (Zunic 2026-04-19) protects against future pressure to expand `src/snippet/dfBinding.ts` or grow the typed-primitive surface. AtlasFS's pure-composition path is the load-bearing one; the framing makes the case in one sentence rather than several PRD paragraphs. Effort: Quick.

3. **Add stub-as-slot pre-allocation as a new phase in plan 006, between phases 5 and 7.** Pre-create empty typed module stubs at known intent-shape paths with parameter and return type declared but body throwing `not yet crystallised`. The Observer's pure-composition path fills the body without changing the signature. Stubs are surfaced by `apropos` above threshold because their name, description, and intent match. The pattern unifies plan-006-phase-5 (intent-shaped names) and plan-006-phase-7 (missed-reuse warnings) into one mechanism: pre-allocation plus body-fill plus warning-on-empty. Effort: Short.

4. **Add a 7th predicate to `src/observer/gate.ts` enforcing intent-hash durability across runs (>= 2 completed trajectories with the same intent_hash before crystallisation).** Borrowed from AutoSkill's "durable constraints" gate. Pairs naturally with the PySyft `intent_hash` proposal in `kb/br/11-...md`. Prevents crystallisation on noisy generic intents and keeps the `/lib/<tenantId>/` library focused on intents the tenant actually re-runs. Effort: Short, contingent on the PySyft `intent_hash` landing first.

---

## Sources

### Internal references
- [09-browser-use-browser-harness.md](09-browser-use-browser-harness.md), the canonical technology brief; this file extends rather than replaces it.
- [10-mintlify-chromafs-virtual-filesystem.md](10-mintlify-chromafs-virtual-filesystem.md), the closest external analogue to AtlasFS's VFS shape; provides the substrate-side manifest pattern.
- [11-pysyft-force-intent-declaration.md](11-pysyft-force-intent-declaration.md), the symmetric completion of EROFS-on-writes via declared-paths-on-reads; the source of the `intent_hash` proposal.
- [kb/elevator.md](../elevator.md), the AtlasFS framing as "code-mode adaptive retrieval system that crystallises query shape from agent usage."
- [kb/mission.md](../mission.md), the AtlasFS mission as "a code agent that performs adaptive retrieval inside a virtual filesystem."
- [kb/mental-model.md](../mental-model.md), the primitives, entities, states, and metrics; in particular `T_n`, `D_n`, `R_n`, `L_n`.
- [kb/learnings.md](../learnings.md), the 15-pattern transposable reference; in particular C2 (shape hash over canonical step list), C4 (trace-shaped names are the load-bearing weakness), M4 (enforce invariants at the lowest layer that can express them).
- [kb/plans/006-vfs-native-discovery-and-reuse.md](../plans/006-vfs-native-discovery-and-reuse.md), the seven-phase plan; phases 5 and 7 are the natural surface for the stub-as-slot pattern.

### Browser-use first-party essays (new since 09)
- [The Bitter Lesson of Agent Harnesses](https://browser-use.com/posts/bitter-lesson-agent-harnesses), Gregor Zunic, 2026-04-19. The thesis-level companion to "Web Agents That Actually Learn"; load-bearing for AtlasFS's Observer authoring step framing.
- [BUX: Your 24/7 Remote Agent with Browser Harness](https://browser-use.com/posts/bux-launch-blog), Johannes Dittrich, 2026-04-25. Productises the harness story with persistent state at `/home/bux`; demonstrates the pattern carries from short sessions to long-lived agents.

### External ecosystem (relevant since 09)
- [The Missing Abstraction for AI Agents: The Agent Filesystem](https://turso.tech/blog/agentfs), Turso, 2025-11-13. The agent-state-as-SQLite-FUSE-mount thesis.
- [Towards a Disaggregated Agent Filesystem on Object Storage](https://penberg.org/blog/disaggregated-agentfs.html), Pekka Enberg, 2026-01-11. WAL-as-history; pull/push checkpoints; the database itself as the unit of disaggregation.
- [Skill Library Evolution](https://www.agentic-patterns.com/patterns/skill-library-evolution/), Nikola Balic, 2026-01-13. Four-stage crystallisation; MCP-bound skills with `includeTools` (worked example: 26 tools to 4 tools, 91% context reduction).
- [AutoSkill: Experience-Driven Lifelong Learning via Skill Self-Evolution](https://github.com/ECNU-ICALK/AutoSkill), ECNU-ICALK, AutoSkill4Doc 1.0 on 2026-03-13 and SkillEvo 1.0 on 2026-03-23. Versioned `SKILL.md` SkillBank; replay-evaluation-mutation-promotion cycle; "durable constraints" gate.

### Specific browser-harness file paths cited above
- `src/browser_harness/helpers.py:159-164`, the BH_DOMAIN_SKILLS hostname-keyed lookup (unchanged from 09).
- `src/browser_harness/helpers.py:470-485`, the `_load_agent_helpers` re-exec pattern.
- `agent-workspace/agent_helpers.py`, the 7-line docstring stub; the "writable seam" in its purest form.
- `interaction-skills/`, 17 files, 12 of which are one-line stubs; the source of the stub-as-slot pre-allocation pattern.
- `agent-workspace/domain-skills/`, 94 host directories, 102 files; 2 with frontmatter, the rest unstructured prose plus Python.

### Specific AtlasFS file paths cited above
- `src/bash/fs/readOnly.ts:127-134`, the EROFS enforcement at the FS adapter.
- `src/bash/session.ts:350-434`, the four-zone mount layout (`/db/<mountId>/` read-only, `/lib/<tenantId>/` writable, `/tmp/` ephemeral, base overlay of orientation files).
- `src/discovery/librarySearch.ts`, the BM25-flavoured five-bucket scorer; shared by in-VFS `apropos` and CLI `datafetch apropos`.
- `src/observer/author.ts:64-139`, the pure-composition authoring path; the AtlasFS analogue of browser-harness's "agent writes the missing function."
- `src/observer/author.ts:124-136`, the `LibraryResolver.resolve` validation step that deletes any authored file failing to load.
- `src/observer/gate.ts:54-177`, the 6-predicate gate; candidate site for the AutoSkill-derived 7th predicate.
- `src/snippet/dfBinding.ts:59`, the `df` proxy chokepoint; candidate site for path-policy enforcement per the PySyft proposal.
- `src/snippet/runtime.ts:86-219`, the trajectory recorder + post-hoc mode classification.
- `src/trajectory/recorder.ts:67-158`, the session-scoped wrapper that captures every typed call.
