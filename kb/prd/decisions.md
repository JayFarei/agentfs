---
title: "Datafetch — Locked Decisions"
type: prd
status: design-target
date: 2026-05-04
---

# Locked Decisions

One entry per architectural decision that's been settled. Each decision lists the rule, the *why*, and the implications. Reverse-chronological order; new decisions go at the top.

When iterating, prefer adding a new entry here over modifying the design doc directly — this is the audit log.

---

## D-020 — Trajectory leakage acknowledged; soft mitigation for v1

**Decision.** The data-gravity property only holds for the work the agent does inside our environment. If an agent extracts data via `df.db.<coll>.findExact` and processes it offsite (calling their own LLM, transforming locally) before coming back for the next bit, our trajectory has gaps. **For v1 we accept this risk.** Mitigation is via cultural nudges (`/AGENTS.md`, SDK skill bundle) telling the agent to compose the full task as a single in-environment snippet. We do not enforce hard barriers (no `df commit` mode, no sealed-vs-unsealed envelope distinction).

**Why.** Hard enforcement complicates the design and the experimentation loop. Soft enforcement ships sooner. If leakage turns out to be material in practice (the patterns we mine are systematically fragmented; the flywheel underperforms), we revisit with stronger options.

**How to apply.**
- `/AGENTS.md` includes the convention: "Compose your full task in one snippet. Don't extract data and process it outside the environment."
- The SDK skill bundle (`/usr/share/datafetch/skill/`) reinforces the same.
- The result envelope's `provenance.callsRecorded` and `provenance.pins` make thin trajectories visible to consumers.
- The observer is conservative — it only proposes crystallisation from trajectories that look complete (full call chains, plausible internal structure). Fragmented trajectories don't enter the flywheel.
- If we later need hard enforcement, the design has a clean upgrade path: add `df commit` for sealed end-to-end results; mark exploration output as unsealed in the envelope.

---

## D-019 — Per-mount README.md for orientation

**Decision.** Each mount auto-generates a `/db/<mount-id>/README.md` describing what this dataset is, typical query patterns, schema highlights, and gotchas. Sits alongside the workspace-level `/AGENTS.md` and the per-function `man <fn>`.

**Why.** Three documentation scopes match three real-codebase conventions: workspace, package, function. The agent's training prior on this layered shape (top README + per-package READMEs + generated API docs) is strong. `man` alone is the wrong granularity for "what is this dataset"; that's a per-mount concern.

**How to apply.** Auto-generated when the mount is published; updated when the meta-harness learns. Seeded with content from the bootstrap (collections, row counts, polymorphism notes); enriched over time with "typical query patterns" derived from convergent trajectories.

---

## D-018 — `/tmp/` instead of `/scratch/`

**Decision.** Ephemeral working area is at `/tmp/`, matching the universal Unix idiom.

**Why.** `/tmp/` is what every Linux/Mac developer knows. `/scratch/` is invented vocabulary; the LLM has seen `/tmp/` in millions more bash sessions and shell scripts. Don't fight the training data.

**How to apply.** Find/replace across docs and any future implementation references. The semantics are unchanged — ephemeral, cleared at session end. Just the name aligns with priors.

---

## D-017 — Flue as in-process library for LLM-backed function bodies

**Decision.** The runtime uses Flue as an in-process library (not subprocess) to dispatch LLM-backed function bodies (`llm({...})` and `agent({skill})`). Flue ships the skill markdown format, valibot result validation, the session model, and roles for system-prompt overlays. The agent surface (`bash` tool) and the user surface (`datafetch.connect`) never see Flue.

**Why.** Flue gives us several things we'd otherwise build (skill format, schema validation at the LLM-call boundary, session efficiency, roles). Subprocess shell-out (the prototype's pattern) is too slow and too coupled to a specific deployment target. In-process library use is the right level of integration.

**How to apply.**
- Flue is a library dependency on the data plane only.
- LLM-backed function bodies dispatch through Flue.
- The skill markdown format (`/lib/skills/<name>.md`) follows Flue's frontmatter+prompt convention so files are portable across systems.
- Agent runtime (Flue, Anthropic SDK direct, OpenAI, Bedrock, etc.) is pluggable behind the `agent({...})` body factory; v1 standardises on Flue.

---

## D-016 — TS files as universal authoring artefact; skills as opt-in sidecars

**Decision.** The agent always authors TypeScript files in `/lib/<name>.ts`. LLM-backed steps are expressed by `body: llm({prompt, output, model})` inline (default) or `body: agent({skill, model})` referencing an externalised `/lib/skills/<name>.md` markdown sidecar (when the prompt is long enough to externalise or reused across functions). There is no `df.lib.synthesize` verb; authoring is file-writing.

**Why.** Skills are an *optimisation*, not a required artefact. Most LLM-backed functions are simple enough that the prompt fits inline in the TS body. Forcing every LLM step into a separate markdown file adds friction. The agent picks based on size and reuse: short prompt → inline; long prompt or reuse → externalise.

**How to apply.**
- Three body shapes from `fn({...})`: pure TS, `llm({...})` inline, `agent({skill})` referencing a sidecar.
- Skills (when present) live at `/lib/skills/<name>.md` in Flue's frontmatter+prompt format.
- The agent uses `man <fn>` and `cat /lib/<fn>.ts` to find templates; writes new files via `cat > <<EOF` heredocs.
- The runtime registers new files automatically; no special "register" or "synthesise" step.

---

## D-015 — Client agent authors LLM-backed functions; datafetch hosts and executes

**Decision.** The client agent — not datafetch — authors LLM-backed functions. They have the user's intent context; they know what the function should do (e.g., what "beard" means in their classifier). Datafetch's role is hosting, executing, observing, and crystallising patterns. We do **not** ship `df.lib.synthesize` or any other LLM-driven function-creation primitive.

**Why.** Datafetch is the expert on the data; the agent is the expert on the intent. Synthesis-by-datafetch was sneaking authorship into the wrong responsibility — it made datafetch guess at intent it doesn't have. Letting the agent author directly via heredoc is honest about who knows what.

**How to apply.**
- Agent uses `man <fn>` + `cat /lib/<fn>.ts` to see existing functions as templates.
- Writes a new function file via `cat > /lib/<name>.ts <<EOF`.
- Optionally writes a skill markdown via `cat > /lib/skills/<name>.md <<EOF` for externalised prompts.
- Datafetch's role: register the file on next read, validate I/O on each invocation, record trajectories, mine for promotion across tenants.
- The observer can *propose* crystallisation of recurring patterns (compositions and convergent prompts) but doesn't author standalone LLM-backed functions on the agent's behalf.

---

## D-014 — just-bash as library, not fork

**Decision.** Use just-bash as a library dependency. Three public APIs cover everything we need: `Bash`, `MountableFs`, `defineCommand`. No fork.

**Why.** just-bash already provides real bash semantics (pipes, redirections, heredocs, conditionals, loops), GNU coreutils (`cat`, `ls`, `grep`, `awk`, `sed`, `jq`, `find`, `head`, `tail`, etc.), and a `MountableFs` for layered virtual filesystems. Their direction (AI agents as primary user) aligns with ours. Forking adds maintenance burden without clear capability gain.

**How to apply.** Pin a version. Light dependency. Watch their roadmap; have a fork-readiness plan if direction diverges.

**Quirk to mitigate.** Shell state (env, cwd) resets per `exec` call; filesystem persists. `/AGENTS.md` instructs agents to use absolute paths and avoid relying on shell variables across commands.

---

## D-013 — Real bash, not invented vocabulary

**Decision.** The agent's interaction surface is real bash plus exactly three custom commands: `npx tsx`, `man`, `apropos`. No invented verbs (`run`, `synthesize`, `discover`, `df.list`, `df.read` etc. are dropped).

**Why.** The LLM's training prior on Unix is the moat. Every invented verb is a thing the LLM has to learn from a tool description; every real bash idiom is something they've seen a million times. Don't fight the training data.

**How to apply.**
- File creation: `cat > path <<EOF` (heredoc), not a `synthesize` or `df.write` verb.
- TS execution: `npx tsx file.ts` or `npx tsx -e "..."` or `npx tsx -` (stdin), not a `run` verb.
- Listing: `ls`, not `df.list`.
- Reading: `cat`, `head`, `tail`, not `df.read`.
- Lexical search: `grep -rn`, not `df.search` for keyword-style queries.
- Semantic search: `apropos` (real Unix command, registered as custom in just-bash).
- Structured docs: `man <fn>` (real Unix convention, auto-generated from JSDoc).
- Editing: `cat > <<EOF` (overwrite), `cat >> <<EOF` (append), `sed -i`.

**Implication.** The custom-command surface is small (just three) and every name carries strong training-data priors.

---

## D-012 — Two-layer skill orientation

**Decision.** Two layers of agent-orienting skills: `/AGENTS.md` per-workspace (auto-generated, mutable) and a versioned skill bundle in `@datafetch/sdk/skill/` (per-version, immutable per release).

**Why.** Per-workspace state ("what's mounted, what's crystallised") is mutable and varies per tenant; per-version conventions ("how `fn({...})` works, error patterns") are stable and travel with the SDK. Mixing them muddies both. Two distinct artefacts at two distinct lifecycles.

**How to apply.**
- `/AGENTS.md` lives at the bash workspace root. Auto-generated when the workspace is materialised. Mentioned in the bash tool's description so the agent reads it on first contact.
- The SDK skill bundle ships with `@datafetch/sdk` at `node_modules/@datafetch/sdk/skill/`. Mountable as a Claude Code / Flue / Anthropic Skill. Also readable from `/usr/share/datafetch/skill/SKILL.md` inside the bash session.

---

## D-011 — Functions are the unit, not procedures/skills/primitives

**Decision.** Procedures, skills, primitives, agents collapse into one abstraction: typed TypeScript functions exported by `fn({...})`. Implementation kind (pure TS, LLM-backed, composition) is a property of the function's `body`, not a separate file location.

**Why.** Earlier iterations carried a four-way taxonomy (procedures/skills/primitives/learned-functions) with separate stores and separate runtime dispatch. The taxonomy was structure I invented; the user pushed back. Collapsing to one factory makes the agent's mental model simpler (everything in `/lib/` is callable), the runtime simpler (one dispatch path), and the file layout simpler (one `/lib/` namespace).

**How to apply.**
- One factory: `fn({ intent, examples, input, output, body })`.
- Three body shapes: pure TS function, `agent({ skill, model })` reference, or composition that calls other `df.*` functions.
- All files in `/lib/<name>.ts`. Skills sit at `/lib/skills/<name>.md` as separate markdown bundles, referenced by `agent({...})` bodies.
- Same call shape from outside: `df.lib.<name>(input) → output`.

---

## D-010 — Agent picks tier explicitly; no server-side router

**Decision.** Drop the server-side embedding-cosine router and the multi-tier escalation continuum as runtime mechanism. Tier selection is the agent's call: they pick by what they invoke (`df.lib.foo()` is tier 1–2; raw substrate calls are tier 0; LLM-backed functions are tier 3; full ReAct is tier 4). Escalation logic is in the agent's snippet (`try/catch`, fallback composition).

**Why.** Server-side routing is opaque magic. The agent's code should literally say which path it takes; the runtime should just execute. Cleaner cost contract, more transparent failure mode, simpler runtime.

**How to apply.**
- The runtime executes whatever the agent submits. No interpretation of intent.
- Procedures are exposed in `/lib/` as typed callables. The agent reads JSDoc / man pages / examples and chooses.
- For lazy delegation, expose `df.lib.routeIntent({intent, expect})` as one option among many — but it's a function the agent calls explicitly, not a hidden middleware.
- Stale pins surface as errors with `code: "stale_pin"`; the agent's snippet `try/catch` handles them or they fall through to composition.
- The five tiers (cache, compiled, interpreted, LLM-backed, full ReAct) survive as a *vocabulary* for what the agent is calling, not as a server-side dispatch table.

---

## D-009 — `expect` schema as fan-out contract

**Decision.** Required-by-default for `df.query` calls, optional for `df.run` snippets. `expect` is a standard-schema-compatible value (valibot/zod/etc.), not just a TypeScript type.

**Why.** The schema isn't type safety inside the SDK; it's the **interface contract for whatever consumes the result.** Plan/workflow composition, generative UI, generative terminal interfaces all need a typed envelope they can introspect, transform, and feed forward. Without `expect`, the result is opaque text.

**How to apply.**
- `df.query({ intent, expect })` — `expect` required. The runtime uses it to retry / narrow / escalate.
- `df.run(snippet)` — schema implicit in the snippet's return type; can be made explicit via TypeScript inference at the call site.
- The schema is persisted with the function when it crystallises. Future readers (humans, LLMs, generative UI tools) can introspect it.
- Three call shapes available:
  - `df.query({intent, expect})` — declarative
  - `df.run(snippet)` — code-mode
  - `df.lib.<name>(input)` — direct to a crystallised function
- Plus two ergonomic shortcuts:
  - `df.explore(question)` for freeform / chat-style with no schema
  - `df.search(query)` for raw retrieval over collection handles

---

## D-008 — Data gravity centre: execution lives where the data is

**Decision.** All execution (bash, snippets, sub-agents) runs at the data plane. The agent client is a thin wrapper that submits commands and receives output. Trajectories live next to the data.

**Why.** Three properties only attainable this way:
1. Trajectory mining stays at the data centre — cross-tenant learning is automatic, not opt-in.
2. The data plane controls credentials (substrate, model API). Bindings-not-network at the network boundary; even a fully compromised agent can't exfiltrate.
3. Improvement compounds for the *dataset surface*, not for any specific agent. Customers adopting datafetch get smarter datasets, not smarter agents.

**How to apply.**
- Bash session runs server-side, in just-bash, with the MountableFs configured for the relevant tenant + mounts.
- The single-tool LLM interface (`bash`) sends commands over HTTPS; the data plane runs `bash.exec(command)`.
- The substrate connection string and the LLM API key live on the data plane. The agent never holds them.
- Identity: agent authenticates with a tenant token (bearer-style); the data plane resolves what mounts that tenant has access to.

---

## D-007 — Two regions: `/db/` immutable, `/lib/` mutable

**Decision.** The VFS has two top-level regions. `/db/` is the substrate's typed surface (synthesised from sampling; read-only). `/lib/` is the agent's working area (typed functions and skills; tenant-overlaid over mount-shared over core).

**Why.** Earlier designs proliferated taxonomy paths (`/procedures/`, `/skills/`, `/meta/primitives/`, `/learned/`). The taxonomy was structure I invented. Two regions are sufficient: things you can't change vs things you can. Functions and skills coexist in `/lib/` (skills as markdown subfiles).

**How to apply.**
- `/db/<mount-id>/<coll>.ts` — typed module synthesised by the bootstrap.
- `/db/<mount-id>/<coll>/_descriptor.json`, `_samples.json`, `_stats.json` — introspection sub-files.
- `/lib/<name>.ts` — typed function (any body kind).
- `/lib/skills/<name>.md` — skill bundle referenced by LLM-backed function bodies.
- `/tmp/` — per-session ephemeral.
- Three layers under `/lib/` resolved at lookup time: tenant overlay → mount-shared → SDK core. Agent sees one merged view.

---

## D-006 — VFS holds metadata + interface, not bulk data

**Decision.** Datasets are not materialised as files. Only the *introspection surface* (schema, samples, descriptor, stats) and the *function pool* (typed callables, skills) live in the VFS. Bulk data stays in the substrate, queried via the four-method retrieval contract.

**Why.** Materialising a million rows as files is wrong on every axis (size, latency, freshness, cost). The Unix metaphor only works at the metadata layer. Schema-on-read at the agent layer.

**How to apply.**
- Things you'd `ls` / `cat` / `grep` / `diff` / `git log` are files: schema, primitives, hooks, procedures, trajectories, capabilities, samples.
- Things you'd `query` / `search` / `compose` are primitive calls that reach into the substrate: rows, embeddings, indexes, result sets.
- The `_samples.json` is a small materialised slice (5–10 docs) for inspection; full collection access is via `findExact` / `findSimilar` / `search` / `hybrid`.
- A reader looking at `/db/cases/_descriptor.json` sees field roles + presence; to get a specific row they call `df.db.cases.findExact({id: ...})`.

---

## D-005 — One bash tool; no tool-list scaling problem

**Decision.** The agent has exactly one tool in their tool list: `bash`. The router internalises tool choice — adding 200 procedures adds zero tokens to the agent's context.

**Why.** The standard LLM tool-use pattern (load every tool description, agent picks) breaks around 30–50 tools. Datafetch tenants can have hundreds of crystallised functions plus dozens of primitives plus collection handles. Loading all of them every call is impossible. Inverting the pattern (one tool, runtime routes) sidesteps the problem entirely.

**How to apply.**
- Tool list: `[{name: "bash", description: "..."}]`. Always one entry.
- Discovery happens via bash commands the agent runs (`ls`, `apropos`, `man`, `cat`).
- The agent's `npx tsx` snippets call `df.lib.<name>` by name; the runtime resolves.
- For tool-using harnesses that prefer multiple tools, optional add-ons: `apropos` and `man` *could* be exposed as separate tools in tool-list mode. Default is one.

---

## D-004 — Content-addressable artefacts; drift is import resolution

**Decision.** Every artefact in `/db/` and `/lib/` has a content hash. TS imports carry pins via inline `@sha256:` comments; JSON descriptors carry `@sha256` headers. Drift detection is import resolution: when a load resolves a pin and the current hash differs, the artefact is stale.

**Why.** Generalising the schema fingerprint into a content-addressable graph dissolves the need for a separate drift worker, ts-morph walker, or change-stream listener. The file system already has the answer.

**How to apply.**
- Every artefact's TS header has a pin block listing all upstream dependencies and their hashes.
- Every TS `import` statement carries an inline hash comment: `import { foo } from "./bar" /* @sha256:... */`.
- Three trust tiers: verified (hash matches), stale (refuses to use until verified or re-derived), reborn (re-derived against current upstream; new hash).
- Verifier replay: re-run the artefact against shadow inputs from its originating trajectory; on match, promote pin in place.

---

## D-003 — Token-budget legibility constraints

**Decision.** Per-artefact-type token ceilings, enforced. Reading the code is the discovery mechanism for both agents and humans, so every artefact must be readable in seconds.

**Why.** A 5000-token "primitive" is impossible to verify mechanically; a 300-token primitive is. A new tenant on a fresh mount must be able to read the surface for one collection in <5K tokens. Token economy is a first-class design constraint.

**How to apply.** Targets and ceilings (see `design.md` §7.3):

| Artefact | Target | Hard ceiling |
|---|---|---|
| `/db/<coll>.ts` (single shape) | 400 | 1000 |
| `/db/<coll>.ts` (3-variant polymorphic) | 800 | 2000 |
| Function (any body kind) | 500 | 1500 |
| Skill markdown | 600 | 1200 |
| Trajectory record per call | 200 | 500 |

CI enforces ceilings; artefacts that exceed split into smaller pieces.

---

## D-002 — Mount adapters per source; bootstrap layer source-agnostic

**Decision.** Substrate-specific code lives in `MountAdapter` implementations (`AtlasMountAdapter`, `HuggingFaceMountAdapter`, `PostgresMountAdapter`, `SqliteMountAdapter`, `JsonlMountAdapter`, etc.). The bootstrap layer (sample → infer → emit typed module) is generic; it ships with no opinion about specific datasets.

**Why.** Today's prototype hardcodes FinQA-on-Atlas. Every new dataset would mean another `loadFinqaToAtlas`-style integration. Decoupling adapter from bootstrap means a new dataset is a `mount(source)` call, not a code commit.

**How to apply.**
- `MountAdapter` interface: `id`, `capabilities()`, `probe()`, `sample()`, `collection<T>()`, `runCompiled()`, optional `watch()` and `ensureIndex()`.
- One adapter per substrate. Each ships independently, ~few hundred lines.
- `/db/<mount-id>/cases.ts` is generated by the bootstrap from samples returned by the adapter — never hand-authored.

---

## D-001 — Three personas with three different surfaces

**Decision.** Provider, user, and agent are three personas with three different SDK surfaces. The provider publishes mounts; the user connects with a tenant identity and makes typed calls; the agent uses a bash tool. All three reduce to the same data-plane runtime.

**Why.** Earlier framings collapsed user and agent into one "client" that called `df.query`. They have different ergonomics: a developer writing app code wants typed function calls and TypeScript autocomplete; an LLM in a tool-use loop wants a Unix shell with multi-turn exploration. Same runtime, different surfaces.

**How to apply.**
- Provider: `datafetch.publishMount(...)`.
- User: `datafetch.connect({tenant, mounts}).query(...)` / `.run(...)` / `.lib.<name>(...)`.
- Agent: one `bash` tool; navigates `/db/` and `/lib/`; runs TS via `npx tsx`.
- All three submit work to the same data-plane endpoint; the SDK shapes vary by who's calling.

---

## Parked (out of scope for v1)

These were explicitly raised and explicitly deferred:

- **Cross-mount queries.** A single function spanning two datasets. Not Day 1.
- **Privacy-bounded signal extraction.** Adversarial-fixture audits + k-anonymity-thresholded promotion gates. v1 assumes tenants on a shared mount implicitly share the meta-harness.
- **Mount marketplace.** Publishing warmed mounts as shareable artefacts. Out of scope for the core SDK.
- **Family-promotion threshold tuning.** Default N=3 / N=5; revisit based on observed cluster quality.
- **Synthesis review queue.** Subtle synthesis errors that pass the verifier but produce wrong outputs in production. May need a human-review path.
