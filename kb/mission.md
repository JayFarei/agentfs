---
title: "datafetch, Mission"
type: evergreen
tags: [magic-docs]
updated: 2026-05-07
hackathon_theme: "Adaptive Retrieval"
---

# Mission

The "why we exist" doc. Read this when asking "should we build this?" — for vocabulary, see `mental-model.md`; for shipped surface area, see `product-design.md`.

---

## The core product claim

> **Datafetch does not virtualize the whole dataset. It virtualizes the dataset interface, then improves that interface from accepted, evidence-backed work.**

Everything else in this document is a justification of, or a constraint on, that one sentence.

---

## The problem we are solving

Every agent that touches a real dataset relearns the same shape on every novel run. The retrieval pattern, the synthesis recipe, the join between substrate calls and table math — all of it gets recomposed from primitives every time, even when the same question shape was answered correctly yesterday.

Two failure modes follow:

1. **The interface the agent reaches for either does not exist or is too generic.** A typed namespace reflected at deploy time (Code Mode, MCP catalogs) gives the agent vocabulary, but the vocabulary does not narrow with use. The agent gets `findSimilar` and `executeTableMath`; it does not get `rangeTableMetric`, even after composing one a hundred times.
2. **Prior successful work does not compound.** Auto-induced skill libraries (Voyager, ASI) crystallise indiscriminately; *Library Learning Doesn't* (Berlot-Attwell, NeurIPS MATH-AI 2024) showed the consequence — they are rarely actually reused. There is no signal for "this composition was the right one for this kind of question."

The pain felt by the human running the agent: it looks intelligent and is amnesiac. The pain felt by the agent: every novel intent is tier 4 forever, the same retrieval cost paid in perpetuity.

---

## Our thesis

**Virtualize the dataset interface, not the dataset.** The substrate stays where it lives (today, MongoDB Atlas). What we virtualize is the typed surface the agent reaches for. The surface starts generic — `db.<coll>.findExact|search|findSimilar|hybrid` plus a small seed library — and grows tenant-by-tenant as the agent ships accepted answers.

**Improve the interface from committed, executable TypeScript.** The unit of learning is not a prompt or a transcript. It is the source of an `npx tsx` snippet that ran, called typed primitives, returned a `df.answer({...})` envelope, passed validation, and was committed by the agent as the final auditable answer for an intent. The observer reads that source's recorded trajectory and writes a new typed callable in the tenant's `/lib/<tenant>/<name>.ts` overlay.

This makes the learned surface auditable by construction. A learned interface is a TypeScript file you can `cat`. Its frontmatter declares its intent. Its body re-walks the steps that worked. The agent finds it via `apropos`, reads it via `man`, and calls it via `df.lib.<name>(...)`.

The conjunction we are claiming as novel: **typed primitives that are visible to the agent + cross-session interface evolution gated by accepted, evidence-backed answers + per-tenant overlay so different agents on the same data plane grow different surfaces.**

---

## Who is the user

Two coupled users, both on the same machine for the demo.

**The agent.** Today, Claude Code driving `datafetch <verb>` through bash. The shipped harness is `claude --bare --allowedTools "Bash(datafetch *) Bash(cat *) Bash(ls *) Bash(jq *)"`. The agent has bash and four allowed verb families; everything else is denied. This is deliberate — see `kb/principles.md` on "give the agent bash, not a tool catalog."

**The human running the agent.** Owns the tenant id. Sees the workspace folder, the answer markdown, the lineage. Decides whether the answer is good. Today there is no review UI; acceptance is the agent's `df.answer(...)` envelope passing automated validation. The human review loop is roadmap, not shipped (see "What we are not yet").

Tenants share the substrate (`/db/<mount>/`), and each tenant has a private `/lib/<tenantId>/` overlay. The same dataset crystallises into different learned interfaces for different tenants. That divergence is structurally available; we have not yet wired the multi-tenant divergence story into the demo.

---

## What success looks like

### The cold-to-warm flip

Success is a single observable event: an intent that ran `mode:"novel" tier:4` becomes `mode:"interpreted" tier:2` the second time a similar intent is asked, with a measurable cost drop and the same gold answer.

Concretely, the demo (`pnpm demo`):

- **Q1** — "what is the range of chemicals revenue between 2014 and 2018" — composes `findSimilar → pickFiling → inferTableMathPlan → executeTableMath`. Four top-level calls. `mode=novel`, `tier=4`. Returns 700.
- The observer reads the committed trajectory and writes `lib/demo-tenant/rangeTableMetric.ts`.
- **Q2** — "what is the range of coal revenue between 2014 and 2018" — finds `rangeTableMetric` via `apropos`, calls it. One top-level call. `mode=interpreted`, `tier=2`. Returns 1000.

The cost panel renders that flip in two columns, with `✓ expected=X actual=X` markers on each. The call-graph collapse panel renders 4 → 1. If either gold answer is wrong, the demo throws.

### The broader claim

More generally: the second time a question shape is asked, the agent's program shrinks. The diagnostic is the trajectory's call list. If `rangeTableMetric` is in it, the system worked; if the agent recomposed `findSimilar/pickFiling/inferTableMathPlan/executeTableMath` again, the system did not.

The shape hash is the deduplication key. Two trajectories with the same canonical step sequence share a hash; the second one does not produce a second copy.

---

## The mechanism, in seven steps

The brief gives file:line citations; the steps below are the conceptual arc.

```
intent
  → mounted intent workspace
  → visible TypeScript snippet
  → committed df.answer(...)
  → validated lineage
  → learned lib function
  → future mount discovers and reuses it
```

1. **Intent in.** The user (or the agent on their behalf) creates an intent workspace bound to one tenant, one dataset, and one question. The workspace is a folder on disk with `scripts/`, `db/` (a view of the mount), `lib/` (a view of the tenant overlay), `df.d.ts` (the typed surface), and an oriented `AGENTS.md`.
2. **Compose in TypeScript.** The agent edits `scripts/scratch.ts` or `scripts/answer.ts`, calls `df.db.*` and `df.lib.*`, and returns a `df.answer({...})` envelope. The runtime is `npx tsx`-shaped; the agent reasons in code, not in tool calls.
3. **Run, then commit.** `datafetch run` is a tier-4 sandbox: results bounded, artefacts go under `tmp/runs/`, never crystallisable. `datafetch commit` is the irreversible step: the snippet must return a valid `df.answer(...)`, and the commit becomes the workspace HEAD.
4. **Trajectory recorded.** Every `df.db.*` and `df.lib.*` call is logged with input, output, depth, parent, and root. The trajectory is the audit log of the snippet, persisted at `<baseDir>/trajectories/<id>.json`.
5. **Gate.** The observer reads the saved trajectory, checks the gate (≥2 distinct primitive calls, no errors, novel/interpreted mode, validated answer for commit phase, shape hash not already present, first call is `db.*` and downstream `lib.*` consumes its output, this trajectory is the current workspace HEAD).
6. **Crystallise.** A pure-composition author re-emits the trajectory's call sequence as parameterised TypeScript with a YAML frontmatter and an `@shape-hash:` tag, written to `<baseDir>/lib/<tenantId>/<name>.ts`. Names are semantic (`rangeTableMetric`, `compareTableMetric`), not opaque hashes. The codifier-skill fallback exists for shapes the pure path cannot render. The manifest (`df.d.ts`) and workspace memory (`AGENTS.md`) are regenerated.
7. **Reuse.** The next intent workspace symlinks `<baseDir>/lib/<tenantId>/` as `lib/`. `apropos <kw>` ranks the new function. `man <name>` renders its synopsis. `df.lib.<name>(...)` calls it directly, server-side internals collapsed under one client-visible call.

The diagnostic story the demo tells:

```
Client-visible call:    lib.rangeTableMetric
Nested server-side:     db.finqaCases.findSimilar
                        lib.pickFiling
                        lib.inferTableMathPlan
                        lib.executeTableMath
```

First run: the agent composes the workflow. Second run: the agent calls the learned intent interface. The server still records the nested evidence path; the client sees a simpler typed API.

---

## What we are explicitly not

These are properties prior versions of this doc claimed but the implementation does not have. We are stripping them so the kb reflects what ships.

- **Not a database.** We do not write to the substrate. Every `findExact|search|findSimilar|hybrid` is a read against MongoDB Atlas. The data plane is stateless about the dataset; it is stateful about trajectories and learned interfaces.
- **Not a FUSE filesystem.** There is no NFS mount, no kernel filesystem, no real "mount the dataset as `/datafetch/`". The "intent workspace" is a directory on disk plus an in-process `MountableFs` from `just-bash` for the bash REPL path. The "mount" verb refers to the conceptual binding of a tenant to a dataset and an intent, not to a kernel mount.
- **Not a virtualized dataset.** We virtualize the *interface*, not the documents. Document polymorphism stays where it lives. The typed surface (`db.<coll>: CollectionHandle<T>`) is a view, not a wrapper.
- **Not a multi-tenant promotion engine — yet.** Per-tenant overlays work and are isolated. The "promote a learned interface from one tenant to a shared family function" path exists as a hook (`MountHandle.on("family-promoted")`) but never fires. The "library divergence across tenants" metric exists as a concept and is not computed anywhere.
- **Not a compiled-tier replay engine — yet.** `CostTier=1` and `mode:"compiled"` are reserved on the type. No code emits them. The Atlas-aggregation-pipeline compiler in earlier docs is roadmap.
- **Not a human-review loop — yet.** Validation is automated (`validateAnswerEnvelope`). There is no UI, no endorsement API, no review verdict. The agent's `df.answer(...)` envelope passing automated checks is what counts as "accepted."
- **Not a pre-registered eval harness — yet.** The demo runs two hard-coded synthetic FinQA filings (or the live collection if `ATLAS_URI` is set). The cost panel is anecdotal. Variance bands, multi-seed runs, and the FinQA full corpus are not in the build.
- **Not vector-native — yet.** `findSimilar` and `hybrid` delegate to `search` (Atlas `$search` with regex fallback). The capabilities flag `vector:false` is the truth.

The roadmap items above are real and tracked, but they belong in `kb/prd/` and `kb/plans/`, not in the mission doc.

---

## Decision framework

When principles collide, the order of precedence is:

1. **The cold-to-warm flip is the falsifier.** If a choice strengthens demo polish at the cost of a measurable Q1→Q2 cost drop, take the cost drop. Without that flip, nothing else matters.
2. **Visible TypeScript over hidden state.** Learned interfaces must be `cat`-able files. Trajectories must be JSON on disk. Anything that hides itself from `ls` is not allowed in the data plane.
3. **Adopt over invent.** `just-bash` for the in-process bash, `@flue/sdk` for the agent harness, `mongodb` for the substrate, `valibot` for schemas, `hono` for the HTTP plane. Our novel infrastructure is the snippet runtime, the observer, the gate, and the manifest, not the components below them.
4. **Per-tenant overlays are non-negotiable.** Two tenants on the same data plane must produce two non-interfering libraries. The shipped multi-tenant test (`tests/observer-multi-tenant.test.ts`) is load-bearing.
5. **Automated validation, not assertion of correctness.** `df.answer(...)` validation is structural (status allowed, value present, evidence present, derivation visible, lineage present, no default-zero fallback). It does not claim the answer is right. The gold-answer assertion lives in the demo runner, separate from the validation gate.
6. **Hackathon scope is honest.** Deferred features are listed in the README and the brief, not buried in marketing. "Not shipped" sections in the kb are the structural compliance with that honesty.

Escalation path: if a hard call comes up during the build, write the question into the relevant plan file and consult an Architect or Plan Reviewer expert. Default to the simpler choice if no clear signal emerges within 15 minutes.
