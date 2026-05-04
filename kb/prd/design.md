---
title: "Datafetch — Design"
type: prd
status: design-target
date: 2026-05-04
---

# Datafetch — Design

Single source of truth for the architecture. Read it linearly or jump to a section. Sections 1–3 are the 5-minute version; 4–11 are the working design; 12–13 are implementation and open questions.

---

## 1. The product in one paragraph

Datafetch turns a mounted dataset into a Unix-shaped workspace. A provider publishes a mount (Atlas, HuggingFace, Postgres, JSONL — pluggable); a tenant connects with a tenant identity; an agent in that tenant writes TypeScript that composes typed functions against the data. The agent sees a real bash shell over a virtual filesystem; the data plane (alongside the data) executes typed calls, records trajectories, and async-crystallises convergent patterns into new typed functions that appear in the next session. Cross-tenant patterns get promoted into the dataset's shared surface. The result: agents experience a typed API that gets faster and more idiomatic the more anyone uses it, while the call shape stays the same.

---

## 2. Three personas

```
Provider                Tenant / User                   Agent
─────────               ──────────────                  ─────
publishes a mount       connects with tenant id;        writes bash + TS
                        types the contract              against /db/, /lib/

datafetch.publishMount  datafetch.connect               one tool: bash
  ↓                       ↓                               ↓
       data plane (alongside the data)
                          ↓
       sandboxed execution + trajectory mining
                          ↓
       async observer / optimiser / cross-tenant promotion
```

Provider sets the dataset boundary; user sets the tenant boundary; agent operates within both. Concrete mocks for each in [`personas.md`](./personas.md).

---

## 3. The principles

Five short ones; everything else follows from these.

1. **Real bash, no invented vocabulary.** The agent uses `ls`, `cat`, `grep`, `find`, `jq`, `head`, `npx tsx`, `man`, `apropos`. The LLM's training prior on Unix is the moat. We add nothing the LLM hasn't seen ten million times.

2. **Functions are the unit.** Procedures, skills, primitives, agents — all collapse into "a typed TypeScript function exported by `fn({...})`." Implementation kind (pure TS, LLM-backed, composition) is internal to `body`; from the caller's view, every callable in `/lib/` looks identical.

3. **Data gravity centre.** Execution lives where the data is, not where the agent is. Trajectories are recorded server-side; the observer/optimiser run on the data plane; the agent is a thin client that submits commands and receives output.

4. **Read the code; don't enumerate tools.** Discovery is `ls` / `man` / `apropos` / `cat`. The agent's tool surface stays at exactly one tool (`bash`) regardless of how many functions exist. Adding 200 procedures adds zero tokens to context.

5. **Simplicity over completeness.** When in doubt, strip a layer. The prior iterations of this design accreted routers, escalation continuums, tier dispatchers; the locked version replaces them with "the agent picks a tier by what they call; the runtime executes; the observer learns async."

---

## 4. The agent's environment

### 4.1 The shell

The agent's tool list contains exactly one entry: `bash`. Each tool call runs one bash command in a persistent session. Output is plain text on stdout/stderr with an exit code. No terminal emulation, no PTY — same shape as Claude Code's bash tool, OpenAI's code interpreter, Cursor's terminal tool.

```jsonc
{
  "name": "bash",
  "description": "Run a bash command in this datafetch workspace. Standard Unix tools available (cat, ls, grep, find, head, jq, awk, sed, tree, ...). Run TypeScript with `npx tsx file.ts`. The mounted dataset is at /db/, your function pool at /lib/. See /AGENTS.md for conventions.",
  "input_schema": {
    "type": "object",
    "properties": { "command": { "type": "string" } },
    "required": ["command"]
  }
}
```

The shell is implemented via [just-bash](https://github.com/vercel-labs/just-bash) used as a library — no fork, no patches. just-bash provides real bash semantics (pipes, redirections, heredocs, conditionals, loops, globs) plus the GNU coreutils subset (`cat`, `ls`, `grep`, `awk`, `sed`, `jq`, `find`, `head`, `tail`, `wc`, `sort`, `uniq`, `xargs`, `tree`, `tar`, `cp`, `mv`, `rm`, `mkdir`, `touch`, etc.). The `Bash` instance is constructed once per LLM conversation, persistent for its lifetime.

```ts
import { Bash, MountableFs, InMemoryFs, defineCommand } from "just-bash";

const fs = new MountableFs({ base: new InMemoryFs() });
fs.mount("/db",      mkSubstrateFs(mount));
fs.mount("/lib",     mkOverlayFs(tenant, mount));
fs.mount("/tmp",     new InMemoryFs());

const bash = new Bash({
  fs,
  cwd: "/",
  customCommands: [npx, man, apropos],
  files: { "/AGENTS.md": orientation, "/package.json": fakePackageJson },
});
```

**Quirk to mitigate**: just-bash persists filesystem state across `exec` calls but resets shell state (env vars, cwd, functions). The agent works around with absolute paths; `/AGENTS.md` instructs them not to rely on `cd` or env vars between commands.

### 4.2 The mounted filesystem

Three mount points:

```
/db/                              IMMUTABLE   substrate's typed surface
/lib/                             MUTABLE     typed function pool
/tmp/                             EPHEMERAL   per-session working area
```

Plus orientation files at three scopes:

```
/AGENTS.md                        per-workspace orientation (auto-generated)
/README.md                        short project description
/package.json                     plausible Node project metadata
/db/<mount-id>/README.md          per-mount orientation (what this dataset is, typical patterns, gotchas)
/usr/share/datafetch/skill/       SDK skill bundle (versioned)
```

Three documentation scopes match three real-codebase conventions: `AGENTS.md` is the workspace; `/db/<mount-id>/README.md` is the per-package README; `man <fn>` is the per-function API doc. The agent's training prior on this layered shape is strong.

### 4.3 Three custom commands

Real bash covers ~95% of what the agent needs. Three things genuinely require custom integration, all mapped onto names the LLM has seen in millions of training examples:

| Command | What it does | Real-world prior |
|---|---|---|
| `npx tsx <file\|->` | Execute a TypeScript snippet against the data-plane sandbox; `df.*` is a global. | Standard Node CLI for running TS. |
| `man <fn>` | Auto-generated structured docs for a typed function in `/lib/`. | Standard Unix man-page convention. |
| `apropos <query>` | Semantic search across `/lib/` intents and JSDoc; returns top matches with relevance scores. | Standard Unix command for searching command descriptions. |

That's it. No `synthesize`, no `discover`, no `run` — those map onto bash idioms (`cat > file <<EOF`, `apropos`, `npx tsx`) the LLM already knows.

### 4.4 What writing files looks like

Real bash. Heredocs are how the agent creates new function files:

```bash
$ cat > /lib/scoreNarrativeTone.ts <<'EOF'
import { fn, agent } from "@datafetch/sdk";
import * as v from "valibot";

export const scoreNarrativeTone = fn({
  intent: "score a paragraph for narrative tone",
  examples: [/* ... */],
  input:  v.object({ text: v.string() }),
  output: v.object({ tone: v.picklist(["optimistic","neutral","cautious","defensive"]), confidence: v.number() }),
  body: agent({ skill: "score_narrative_tone", model: "anthropic/claude-haiku-4-5" }),
});
EOF
```

No special verb. Standard heredoc. The LLM has seen this exact pattern in countless tutorials.

---

## 5. Two regions: `/db/` and `/lib/`

The whole VFS reduces to two top-level paths and one ephemeral working area.

### 5.1 `/db/` — immutable substrate surface

Synthesised from the mount adapter. Read-only. Contents per collection:

```
/db/<mount-id>/<coll>.ts                      typed module
/db/<mount-id>/<coll>/_descriptor.json        field roles, presence, indexable_as
/db/<mount-id>/<coll>/_samples.json           5–10 representative documents
/db/<mount-id>/<coll>/_stats.json             counts, presence frequencies, cardinality
```

The `<coll>.ts` file is a real TypeScript module: an `interface` derived from inferred schema (with discriminated unions for polymorphism), a `SCHEMA_VERSION` content-hash constant, and the typed handle exposing the four-method retrieval contract (`findExact`, `search`, `findSimilar`, `hybrid`).

```ts
// /db/finqa-2024/cases.ts
// generated 2026-05-04 from 8281 sampled documents
// fingerprint: sha256:c3f1a8…   substrate: atlas

export interface Case { /* inferred shape, with JSDoc presence frequencies */ }
export const SCHEMA_VERSION = "sha256:c3f1a8…" as const;
export const cases: CollectionHandle<Case>;
```

The agent never modifies `/db/`. Inferred shape, sample documents, indexes — these are properties of the dataset, not of the tenant.

### 5.2 `/lib/` — mutable typed function pool

The agent's working surface. Every file is a typed function (or a skill markdown bundle referenced by one). Three layers, merged at lookup time:

```
/lib/                             merged view (what the agent sees)
  (tenant-private functions)
  (mount-shared functions, promoted from cross-tenant patterns)
  (core functions shipped with the SDK)
```

The runtime resolves `/lib/<name>.ts` by checking tenant overlay first, then mount-shared, then core. The agent doesn't see the layering; they see one `/lib/`.

### 5.3 `/tmp/` — ephemeral

Per-session working area. Cleared at conversation end. Used for one-off composition snippets the agent doesn't intend to commit.

---

## 6. The function model

Everything in `/lib/` is built with one factory.

### 6.1 The `fn({...})` factory

```ts
import { fn, agent } from "@datafetch/sdk";

export const totalRevenue = fn({
  intent: "total revenue for a named company in a given filing year",
  examples: [
    { input: { company: "AAPL", year: 2017 }, output: { amount: 229_234_000_000, evidence: [/*...*/] } },
  ],
  input:  v.object({ company: v.string(), year: v.number() }),
  output: v.object({ amount: v.number(), evidence: v.array(v.unknown()) }),
  body: /* one of the three body shapes */,
});
```

`intent`, `examples`, `input`, `output` are the contract — the agent reads them via `man` or via the JSDoc-extracted form.

### 6.2 Three body shapes

| Body kind | What it is | When |
|---|---|---|
| Pure TS | Plain function `(input) => output` | Deterministic primitives (`arithmeticDivide`, parsing, normalisation). |
| LLM-backed | `llm({ prompt, output, model })` inline, or `agent({ skill, model })` referencing an externalised skill markdown | Capabilities that need an LLM (scoring, summarisation, classification). |
| Composition | Async function that calls `df.db.*`, `df.lib.*`, or both | Multi-step workflows over typed primitives. |

```ts
body: ({ n, d }) => n / d                                                       // pure

body: llm({                                                                      // LLM, inline prompt
  model: "anthropic/claude-haiku-4-5",
  prompt: `You score a paragraph for narrative tone. Definitions: ...`,
})

body: agent({ skill: "score_narrative_tone", model: "claude-haiku-4-5" })        // LLM, externalised skill

body: async ({ company, year }) => {                                             // composition
  const cands  = await df.db.cases.findSimilar(`${company} ${year} revenue`, 5);
  const filing = await df.lib.pickFiling({ question: `${company} ${year}`, candidates: cands });
  const figure = await df.lib.locateFigure({ question: "total revenue", filing });
  return { amount: figure.value, evidence: [figure] };
}
```

The implementation kind is internal. Every callable in `/lib/` looks identical from the outside: `df.lib.<name>(input) → output`. The agent picks `llm({...})` inline when the prompt is short enough to read alongside the function (most cases); they extract to a skill markdown when the prompt is long, reused, or worth editing without touching TS.

### 6.3 Skills as optional markdown sidecars

When an LLM-backed body's prompt is long enough or reused enough to externalise, it lives at `/lib/skills/<name>.md` and the function body becomes `agent({ skill: "<name>", model: "..." })`. Skills are an *optimisation*, not a required artefact. Most LLM-backed functions are written with the prompt inline via `llm({prompt, ...})` and never need a sidecar.

```markdown
---
name: score_narrative_tone
input:  { text: string }
output: { tone: "optimistic" | "neutral" | "cautious" | "defensive", confidence: number, rationale: string }
---

You score a paragraph for narrative tone.

Look for hedging language, forward-looking statements, defensive posturing, declarative confidence.

# Examples
- Input: "We remain confident our platform will drive growth."
  Output: { tone: "optimistic", confidence: 0.85, rationale: "Forward-looking growth language." }
```

One file. Versionable. Inspectable. Editable. Same shape as Flue's skill files (the Flue triage example was the inspiration here).

The client agent doesn't call skills directly; they call typed functions. Skills surface only when the agent reads source for transparency:

```bash
$ cat /lib/scoreNarrativeTone.ts        # see the function
$ cat /lib/skills/score_narrative_tone.md   # see the skill it references
```

### 6.4 Authoring a new function

When the agent needs a capability that doesn't exist, they write a TS file. Real bash, real heredocs:

```bash
$ man scoreCompetitiveOutlook            # see how an existing LLM-backed function is structured
$ cat /lib/scoreCompetitiveOutlook.ts    # peek at the body shape

$ cat > /lib/scoreNarrativeTone.ts <<'EOF'
import { fn, llm } from "@datafetch/sdk";
import * as v from "valibot";

export const scoreNarrativeTone = fn({
  intent: "score a paragraph for narrative tone",
  examples: [
    { input: { text: "We remain confident our platform will drive growth." },
      output: { tone: "optimistic", confidence: 0.85, rationale: "Forward-looking growth." } },
  ],
  input:  v.object({ text: v.string() }),
  output: v.object({
    tone: v.picklist(["optimistic","neutral","cautious","defensive"]),
    confidence: v.number(),
    rationale: v.string(),
  }),
  body: llm({
    model: "anthropic/claude-haiku-4-5",
    prompt: `You score a paragraph for narrative tone.

Definitions:
- "optimistic": forward-looking confidence, declarative growth language
- "cautious": hedging, defensive posturing, conditional commitments
- "neutral": neither side
- "defensive": acknowledging pressure or threat

Return: { tone, confidence (0-1), rationale (one short sentence) }.`,
  }),
});
EOF
```

One file. The intent (what "narrative tone" means here) lives in the prompt; the contract lives in the schemas; the body wires them together. Datafetch's runtime registers the file on next read; `df.lib.scoreNarrativeTone(...)` is callable immediately.

There is no synthesise verb. Authoring is file-writing, with bash idioms the LLM has seen everywhere. The client agent has the *intent* (what "tone" means in the user's context); datafetch only has the data. Authorship belongs with intent.

If the prompt is long enough that the inline string is awkward, the agent extracts it to `/lib/skills/<name>.md` and changes the body to `agent({ skill: "<name>", model: "..." })`. Both forms work; this is just a refactor.

---

## 7. The artefact contract

### 7.1 Content-addressable + dependency-pinned

Every file in `/db/`, `/lib/`, and `/lib/skills/` has a content hash. TS imports carry pins via inline `@sha256:` comments; JSON descriptors carry an `@sha256` field at the top.

```ts
// /lib/totalRevenue.ts
// pins:
//   /db/finqa-2024/cases @sha256:c3f1a8…
//   /lib/pickFiling     @sha256:b2e8…
//   /lib/locateFigure   @sha256:c3d1…

import { db } from "/db/finqa-2024" /* @sha256:c3f1a8… */;
import { pickFiling } from "/lib/pickFiling" /* @sha256:b2e8… */;
import { locateFigure } from "/lib/locateFigure" /* @sha256:c3d1… */;
```

**Drift detection is import resolution.** When a load resolves a pin and the current hash differs, the artefact is `stale`; runtime escalates (see §8). No separate ts-morph walker, no Change Stream listener. The file system already has the answer.

### 7.2 Trust tiers

Three states for any pinned artefact:

| Tier | Condition | Behaviour |
|---|---|---|
| Verified | Current hash matches the pin | Use directly. |
| Stale | Current hash differs from pin | Refuse to use until verified or re-derived. Trigger escalation. |
| Reborn | Re-derived against current upstream | New hash, new artefact, prior trajectory preserved as audit. |

Verification = replay against shadow inputs from the originating trajectory's evidence; on match, promote pin in place.

### 7.3 Legibility budgets

Reading the code is the discovery mechanism for both agents and humans, so every artefact has a token ceiling. Files that exceed the ceiling indicate the abstraction is wrong and should be split.

| Artefact | Target | Hard ceiling |
|---|---|---|
| `/db/<coll>.ts` (single shape) | 400 | 1000 |
| `/db/<coll>.ts` (3-variant polymorphic) | 800 | 2000 |
| `/db/<coll>/_descriptor.json` | 300 | 800 |
| `/db/<coll>/_samples.json` | 1500 | 3000 |
| Function (any body kind) | 500 | 1500 |
| Skill markdown | 600 | 1200 |
| Trajectory record (per call) | 200 | 500 |

A new tenant reads the surface for one collection in <5K tokens. A composing agent reading 3 functions + the schema spends <3K tokens. Token economy is the constraint that keeps the surface navigable.

### 7.4 Shape-uniform descriptor across data shapes

The `_descriptor.json` format is uniform across data kinds. The `kind` field tells the SDK how to render the typed module; samples/stats stay shape-specific.

```jsonc
{
  "@sha256": "c3f1a8…",
  "kind": "documents" | "table" | "graph" | "timeseries" | "vectors" | "files",
  "cardinality": { "rows": 8281, "unique_keys": { "filename": 8281 } },
  "fields": {
    "<field>": {
      "role": "id" | "text" | "number" | "timestamp" | "embedding" | "fk" | "label" | "blob",
      "presence": 0.97,
      "cardinality_estimate"?: 142,
      "embeddable"?: true,
      "indexable_as"?: ["lex", "vec", "exact"]
    }
  },
  "affordances": ["findExact", "search", "findSimilar", "hybrid"],
  "polymorphic_variants": null,
  "shape_specific"?: { /* graph: adjacency stats; timeseries: tick interval; ... */ }
}
```

Every adapter produces this format. The SDK renders an appropriate `Handle<T>` from it. The four-method contract is the lowest common denominator; shape-specific affordances build on top.

---

## 8. Escalation as fail-safe

The runtime ossifies expensive trajectories into cheap typed functions, but the agent loop is always available as the failsafe. This is the resilience property borrowed from browser agents (WebArena, OSWorld): expensive observation → action trajectory → ossified code → fall back to agent when the world changes → recovery trajectory ossifies.

### 8.1 The five tiers

The runtime has five execution tiers, ranked by cost. The agent picks tier implicitly by what they call:

| Tier | What runs | Cost | LLM in path? |
|---|---|---|---|
| 0. Cache hit | Same intent + same input within drift window | sub-ms | No |
| 1. Compiled function | `compiled_plan` runs natively in substrate (Atlas pipeline, SQL, etc.) | one substrate round-trip | No |
| 2. Interpreted function | TS body executes against substrate via the runtime | several substrate calls | No |
| 3. LLM-backed function | `agent({ skill, model })` body runs an LLM call | few LLM calls | Yes |
| 4. Full ReAct + planner | Agent's snippet composes primitives directly, possibly minting new functions inline | many LLM calls | Yes |

Calling `df.lib.totalRevenue(...)` is tier 1–2. Calling `df.db.cases.findSimilar(...)` directly is tier 0–substrate. Calling an LLM-backed function (`df.lib.<fn>` whose body is `llm({...})` or `agent({skill})`) is tier 3. Composing primitives in a snippet is tier 4. **The agent never sees a router; their call shape is the tier.**

### 8.2 Three classes of escalation triggers

A call escalates from tier N to tier N+1 in three cases:

- **Static** — pin mismatch detected at load. Before execution.
- **Dynamic** — primitive returns null / type-mismatched at runtime. Procedure can't proceed.
- **Verifier** — result satisfies schema but a sanity check (replay against shadow inputs) flags it as inconsistent. Opt-in via the call's `verify: true`.

The agent's snippet expresses escalation logic in plain TypeScript:

```ts
async () => {
  if (df.lib.totalRevenue) {
    try { return await df.lib.totalRevenue({ company, year }); }
    catch (e) { if (e.code !== "stale_pin") throw e; }
  }
  // composition fallback
  const cands = await df.db.cases.findSimilar(...);
  // ...
};
```

The runtime executes; the agent owns the failure mode. No invisible server-side router rerouting calls.

### 8.3 Autonomous intent clustering

Convergent novel trajectories cluster into procedure families:

1. Each novel trajectory recorded with primitive sequence + parameter shapes + result schema.
2. Background observer runs cluster analysis over recent trajectories.
3. When N ≥ 3 trajectories share the same template (varying only in parameters), the observer proposes a procedure family.
4. The family is crystallised as a parameterised function in `/lib/`. The N originating trajectories become its first instantiations.
5. Future near-matches hit the family directly. Cold path widens.

No per-instance endorsement needed; clustering is unsupervised. The user endorses the *pattern* implicitly through repeated successful invocations.

### 8.4 Why this is the selling point

For tenants evaluating against vanilla agentic RAG:
- **Vanilla**: every query is full ReAct. Cost constant. Brittleness constant.
- **Static-typed**: cheaper but brittle to anything outside the typed surface.
- **Datafetch**: cheap on the hot path, expensive on the cold path, **with the guarantee that the cold path always exists as fallback.** Never refuses; just slows down for hard questions and learns from them.

The asymptote isn't "we get cheap and brittle." It's "we get cheap on what we've seen; the agent is always there for what we haven't."

---

## 9. Mount lifecycle and meta-harness

### 9.1 Mount adapters

A `MountAdapter` per data source wraps the substrate. Same interface across all sources:

```ts
export type MountAdapter = {
  readonly id: string;                    // "atlas", "huggingface", "postgres", ...
  capabilities(): SourceCapabilities;
  probe(): Promise<MountInventory>;
  sample(collection: string, opts: SampleOpts): Promise<unknown[]>;
  collection<T>(name: string): CollectionHandle<T>;
  runCompiled(plan: CompiledPlan, params: Record<string, unknown>): Promise<unknown>;
  watch?(collection: string): AsyncIterable<SchemaChangeEvent>;
  ensureIndex?(collection: string, hint: IndexHint): Promise<void>;
};
```

Concrete adapters: `AtlasMountAdapter`, `HuggingFaceMountAdapter`, `PostgresMountAdapter`, `SqliteMountAdapter`, `JsonlMountAdapter`, `S3ParquetMountAdapter`. Each ~few hundred lines, isolated, swappable.

The adapter knows the source; the bootstrap layer (sample → infer → emit typed module) knows the data. **Adapters ship with no opinion about specific datasets.** A FinQA-on-Atlas mount runs through `AtlasMountAdapter` plus the generic bootstrap; the bootstrap discovers the FinQA shape from sampling, not from hand-coded knowledge.

### 9.2 Warm-up stages

When a mount is created, five staged steps:

| Stage | Action | Cost |
|---|---|---|
| 1. Probe | List collections, count rows, detect existing indexes | seconds |
| 2. Sample | Pull adaptive-size sample per collection (default 100, scales to 1000 on high field-presence variance) | seconds–minute |
| 3. Infer | Run schema inference, detect polymorphism, classify fields by role | minute |
| 4. Apply meta-harness | Pull in any prior cross-tenant signals available for this dataset shape | minute |
| 5. Build indexes (opt-in) | Substrate-native vector + lexical indexes the inference suggests | minutes–hours |

Lazy warm-up: stage 1 runs at mount time; 2–4 run async; 5 only on opt-in. Eager: all five block. Stage 5 is opt-in because the four-method contract still works without it (`hybrid` falls back to client-side fusion when the substrate can't do it natively).

### 9.3 Cross-tenant meta-harness

Three layers per mount:

| Layer | Scope | What it learns | Who sees it |
|---|---|---|---|
| Bootstrap | Per-mount, deterministic | Field types, polymorphism, fingerprint, presence | All tenants on this mount |
| Meta-harness | Per-mount, aggregated | Index hints, retrieval-mode preferences, dataset-generic functions | All tenants on this mount |
| Tenant overlay | Per-tenant, private | Intent-shaped functions, intent-specific compositions | Just this tenant |

Three loops, three retention scopes. Tenant intents stay private; the *path to expressing intents on this dataset* is shared.

### 9.4 Promotion criteria

A tenant-private function becomes a candidate for meta-harness promotion when:

1. **Capability is intent-generic** (`disambiguateCompanyName`, `locateNumericCellByLabel`) — not intent-shaped (`compute_aapl_yoy_revenue`).
2. **Has emerged in N ≥ 3 tenants independently.** Convergent evolution is the signal.
3. **Inputs/outputs reference no tenant-specific identifiers.** Strict schema check.
4. **Passes a verifier suite** assembled from each contributing tenant's shadow inputs.

When all four hit, the function moves from `tenant-overlay/<tenant>/lib/` to `mount/<mount-id>/lib/`. Future tenants see it in their bootstrap surface for free.

Demotion is symmetric: a meta-harness function that consistently fails verification on new tenants gets pulled back.

---

## 10. Data gravity centre

The agent runs anywhere — customer's cloud, device, browser, terminal. Execution always lives at the data plane.

```
+---------------------------- AGENT (thin client) -------------------------+
| - sends bash commands over HTTPS                                         |
| - holds nothing valuable: no data, no schemas (except .d.ts for typing)  |
| - tool count: 1 (bash)                                                   |
+--------------------------------------------------------------------------+
                                   ↓ HTTPS
+----------------------------- DATA PLANE (server) ------------------------+
| Bash session     — just-bash instance, MountableFs, custom commands      |
| Sandbox          — runs npx tsx snippets with bound df.* runtime         |
| Recorder         — every typed call becomes a trajectory row             |
| Observer         — async worker, mines trajectories, crystallises        |
| Optimiser        — async worker, compiles to native plans                |
| Substrate        — Atlas / Postgres / etc.                               |
| Mount cache      — schemas, samples, descriptors, functions, skills      |
+--------------------------------------------------------------------------+
```

Three properties:

1. **Trajectories live next to the data.** Every call is recorded host-side. The observer/optimiser pipeline runs against persisted trajectories, not against client-streamed data.
2. **Cross-tenant learning is automatic.** Every agent that hits a mount adds to the trajectory pool. The observer mines all of them per the promotion rules.
3. **Bindings, not network, at the network boundary.** The agent can't reach the substrate or the model API directly — only through the typed `df.*` surface, which is exposed inside the bash session, which runs server-side. The customer's environment never holds a substrate connection string or an LLM API key.

Identity: agents authenticate with a tenant token (bearer-style); the data plane holds substrate credentials and model API keys.

### 10.1 Trajectory leakage — known risk, soft mitigation for v1

The data-gravity property holds **only for the work the agent does inside our environment.** If the agent extracts data via `df.db.<coll>.findExact(...)` and processes it in their own runtime (calls their own LLM offsite, transforms data outside, then comes back asking for the next bit), our trajectory has gaps. We see disjoint calls; the work in between is invisible. The flywheel suffers because the patterns we mine are fragmented.

For v1 we acknowledge this risk and **don't enforce hard barriers.** Instead:

- **`/AGENTS.md` and the SDK skill bundle nudge** the agent toward composing their full task as a single snippet that runs through `npx tsx`. The cultural convention is "do the whole task in one snippet; don't piece it together from extracted fragments."
- **The result envelope's `provenance` field** records what *was* captured. Downstream consumers can spot suspiciously thin provenance (a "result" with two raw substrate calls and a literal answer is a red flag) and apply their own scrutiny.
- **The observer is honest** about partial trajectories — it doesn't propose crystallisation from fragmented patterns; it waits for trajectories that look complete.

This is a known weak point. If leakage turns out to be material in practice, we revisit with hard-enforcement options (e.g., a `df commit` mode that produces sealed result envelopes only for end-to-end snippets). For v1 we accept the risk to keep the design simple and the experimentation loop short.

---

## 11. SDK surfaces

Three callers, three different shapes — all mediated by the same data-plane runtime.

### 11.1 Provider — `datafetch.publishMount`

```ts
import { datafetch } from "@datafetch/sdk";
import { atlasMount } from "@datafetch/adapter-atlas";

const finqa = await datafetch.publishMount({
  id: "finqa-2024",
  source: atlasMount({ uri: process.env.ATLAS_URI, db: "finqa" }),
  warmup: "lazy",
  policy: { access: "open", write: false },
});

for await (const event of finqa.status()) {
  console.log(event);                    // {stage:"sampling", collection:"cases", progress:0.4}
}

finqa.on("drift", (e) => console.log("drift:", e.collection, e.fingerprint));
finqa.on("family-promoted", (e) => console.log("promoted:", e.name));
```

### 11.2 User — `datafetch.connect` plus typed call surface

For non-agent code (a developer writing app logic, not an LLM), the SDK exposes typed convenience wrappers:

```ts
const df = await datafetch.connect({
  tenant: "acme-finance",
  mounts: ["finqa-2024"],
});

// Style A — declarative intent + expect schema
const r1 = await df.query({
  intent: "what is total revenue for AAPL in 2017",
  expect: v.object({ amount: v.number(), evidence: v.array(...) }),
});

// Style B — direct snippet (codemode-style)
const r2 = await df.run(async () => {
  const cands = await df.db.cases.findSimilar("AAPL 2017 revenue", 5);
  const filing = await df.lib.pickFiling({ question: "AAPL 2017", candidates: cands });
  return df.lib.locateFigure({ question: "total revenue", filing });
});

// Style C — auto-generated namespace methods (after crystallisation)
const r3 = await df.lib.totalRevenue({ company: "AAPL", year: 2017 });
```

All three reduce to the same data-plane endpoint. Per-tenant `.d.ts` regenerates as new functions crystallise; the user's IDE autocompletes whatever this tenant has.

The result envelope is the same across styles:

```ts
type Result<T> = {
  value: T;                              // typed by `expect` or by the function's output schema
  mode: "cache" | "compiled" | "interpreted" | "llm-backed" | "novel";
  cost: { tier: 0|1|2|3|4; tokens: { hot: number; cold: number }; ms: { hot: number; cold: number }; llmCalls: number };
  provenance: { tenant: string; mount: string; functionName?: string; trajectoryId: string; pins: Record<string, string> };
  escalations: number;
  warnings?: Array<{ code: string; message: string }>;
};
```

### 11.3 Agent — `bash` tool

The LLM agent's surface is just the `bash` tool described in §4.1. They explore with bash commands, run TS with `npx tsx`, write new files with heredocs. The typed `df.*` surface is available as a global inside `npx tsx` snippets.

Two layers of skill orient the agent:

- **`/AGENTS.md`** in the workspace — auto-generated. Tells the agent what's mounted, what's already in `/lib/`, and the workspace conventions. ~600 tokens.
- **SDK skill bundle** at `/usr/share/datafetch/skill/SKILL.md` (and shipped with `@datafetch/sdk` for harnesses that support skill loading). Conventions that don't change per workspace: how `fn({...})` works, error recovery patterns, how to write a new function.

---

## 12. Implementation

### 12.1 What survives from the prototype

| Current code | Disposition |
|---|---|
| `src/trajectory/recorder.ts` (`TrajectoryRecorder`) | Format extends to include pin block; otherwise unchanged. |
| `src/procedures/store.ts:LocalProcedureStore` | Storage layer fine; renderer changes to load-bearing TS form. |
| `src/datafetch/db/finqa_*.ts` | Move into `AtlasMountAdapter`'s `CollectionHandle<T>` impl; the FinQA-specific shape becomes a *runtime inference output*, not hand-authored. |
| `src/datafetch/db/finqa_search.ts` | Atlas Search DSL moves into `AtlasMountAdapter.collection().search/findSimilar/hybrid`. |
| `src/loader/loadFinqaToAtlas.ts`, `setupAtlasSearch.ts` | Become `AtlasMountAdapter.bootstrap()` + `ensureIndex()`. |
| `src/planner/{types,runner,executor}.ts` | The `ExecutionPlan` becomes the fallback "interpreted" `CompiledPlan` variant for substrates without native compilation. |
| `src/workspace/runtime.ts` | Becomes `JsonlMountAdapter`. |
| `src/agents/store.ts:LocalAgentStore` | Fine as is; agent specs gain pin blocks. |
| `src/datafetch/primitives/learned_functions.ts:LocalFunctionStore` | Same — TS becomes load-bearing; JSON shadow goes. |

### 12.2 What gets newly built

- **just-bash integration** — `MountableFs` setup with three mount points; `defineCommand` for `npx`, `man`, `apropos`; orientation files (`/AGENTS.md`, `/package.json`, `/db/<mount>/README.md`, `/usr/share/datafetch/skill/`).
- **MountAdapter interface + adapters** — `Substrate` / `MountAdapter` types; concrete impls for Atlas (extracted from current code), HuggingFace, Postgres, SQLite, JSONL.
- **Bootstrap pipeline** — `sample`, `infer`, `classifyFields`, `synthesizeModule`. Generic schema inference from sampled documents.
- **The `fn({...})` factory** — single export from `@datafetch/sdk`, supports all three body shapes (pure TS, inline `llm({...})`, skill-referencing `agent({skill})`).
- **Flue as in-process library** — used by the runtime to dispatch `llm({...})` and `agent({skill})` bodies. Not a subprocess. Provides session model, valibot result validation, skill markdown format.
- **Per-tenant `.d.ts` regenerator** — extracts intent + input + output from `/lib/*.ts` and writes a tenant-scoped declaration file.
- **Async observer + optimiser workers** — read trajectories, propose families, compile to native plans, run verifiers.
- **Meta-harness store + signal extractor** — per-mount shared `/lib/` layer; promotion worker.
- **Three agent-orientation channels** — `bash` tool description, `/AGENTS.md` generator, per-mount `README.md` generator, SDK skill bundle.

### 12.3 Just-bash quirks to handle

- **Shell state resets per `exec` call.** Mitigation: `/AGENTS.md` instructs agent to use absolute paths and not rely on env vars between calls.
- **No real `vim` / interactive editors.** Mitigation: agents write files via `cat > <<EOF` / `sed -i`. The LLM training prior covers both.
- **Not VM-isolated.** Resists prototype pollution but isn't a security boundary. Acceptable because the bash session runs on the data plane — we control what's mounted, what custom commands exist, what the runtime can reach. For defence in depth, run each session in a Vercel Sandbox or equivalent.
- **`npx <package>` doesn't actually install npm packages.** The custom `npx` command dispatches on subcommand: `npx tsx` and a few aliases (`npx ts-node`, `pnpm exec tsx`, `yarn tsx`) route to the data-plane TS runtime; everything else returns a clear "not available in this sandbox" message.

---

## 13. Open questions

1. **Family promotion threshold.** Default N=3 for low-stakes intents; N=5 for higher-stakes. Tenants tunable. May need adjustment based on observed cluster quality.
2. **Cost-of-learning vs cost-of-serving.** The observer that codifies a trajectory spends ~5–10× the tokens of a single answer. If most intents are one-shot, the system gets *more* expensive. Mitigation: only crystallise after N successful trajectories of the same shape. Worth measuring on real workloads.
3. **Verifier shadow-input strategy.** Shadow inputs from the originating trajectory's evidence work for compositions; for pure-LLM functions, what counts as "shadow input" is less clear. May need per-body-kind verifier strategies.
4. **`.d.ts` cache invalidation across long-running sessions.** The auto-generated typed surface evolves as `/lib/` grows. IDEs and CI runners need a refresh signal — `df.refresh()` works for explicit cases; long-running daemons need a watcher.
5. **Skill bundle packaging across harnesses.** Anthropic Skills, Flue, Claude Code each have a bundle format. The `@datafetch/sdk` skill bundle should be readable by all three; pick a base format and ship adapters as needed.
6. **Cross-mount queries.** A tenant joining two mounts in one query — what does crystallisation look like? Probably the function pins both mount fingerprints and lives in a "joint" namespace. **Parked for v1.**
7. **Privacy-bounded signal extraction.** Cross-tenant promotion needs adversarial-fixture audit + k-anonymity-thresholded gates. **Parked for v1; v1 assumes tenants on a shared mount implicitly share the meta-harness.**
8. **What model defaults look like.** Skills declare a preferred model (`anthropic/claude-haiku-4-5`); the runtime resolves it against available providers. Default policy and per-tenant override mechanism unspecified.
9. **Multi-version mount evolution.** Datasets evolve. A mount fingerprint bump produces auto-fork or reject? Default: auto-fork; tenants migrate explicitly. Concrete migration tooling unspecified.
10. **Trajectory leakage.** The agent could extract data through `df.db.*` and process it offsite (calling their own LLM, transforming locally) before coming back for the next bit. We see disjoint substrate calls; the work in between is invisible; the flywheel suffers. **v1 mitigation is soft** — `/AGENTS.md` + SDK skill bundle nudge the agent to compose the full task in one snippet; the result envelope's provenance shows what *was* captured so consumers can spot thin trajectories. If leakage becomes material, revisit with hard enforcement (`df commit` for sealed end-to-end results, exploration mode for everything else). See §10.1.

11. **LLM-backed function quality without a synthesiser.** With authoring being "agent writes a TS file with `body: llm({...})` inline," subtle prompt or schema bugs land in `/lib/` directly. The verifier replay catches gross output-shape errors; subtle semantic errors surface only on real use. Consider a "review queue" or auto-verification stage that runs a new function against its declared examples before promoting it from `/tmp/` to `/lib/`.

---

This is the working design. See [`personas.md`](./personas.md) for concrete code per persona, [`decisions.md`](./decisions.md) for the locked architectural choices, and [`snapshot/`](./snapshot/) for what the prototype delivers today.
