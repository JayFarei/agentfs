---
title: "MongoDB Atlas + Voyage Fit, Adjacent Projects, and the Schema-Emergent Thesis"
date: 2026-05-01
mode: ultradeep
sources: 65
status: complete
---

# MongoDB Atlas + Voyage Fit, Adjacent Projects, and the Schema-Emergent Thesis

## Executive Summary

Three findings, in priority order. First, the AtlasFS conjunction (NFS-mounted typed
TypeScript view of any MongoDB Atlas cluster, code-mode agent emitting TypeScript
that resolves to Atlas operations, user-endorsed trajectory crystallisation into
deterministic procedures compiled to single aggregation pipelines, Voyage AI for
embedding and reranking) is, at roughly 80% confidence, genuinely unclaimed at the
system level as of May 2026. Each axis individually has prior art, including
documentdbfuse for Mongo-as-FS, Turso AgentFS for typed-FS-for-agents, Cloudflare
Code Mode for typed TypeScript surfaces from MCP schemas, ASI (arXiv:2504.06821) and
Voyager (arXiv:2305.16291) for trajectory-induced programmatic skills, and the
official MongoDB MCP server with auto-Voyage-embedding on insert. None unifies all
four. The most threatening adjacency is the official MongoDB MCP server itself, plus
the LangChain `MongoDBDatabaseToolkit`, both of which are tool-call shaped rather
than code-mode shaped, and could plausibly extend toward AtlasFS's design within a
six-to-twelve-month window.

Second, MongoDB's substrate is more ready for AtlasFS than the team's docs imply.
The Atlas Embedding and Reranking API at `https://ai.mongodb.com/v1` entered Public
Preview at MongoDB.local San Francisco on 2026-01-15, is database-agnostic, hosts
the full Voyage 4 family plus `voyage-context-3` and `voyage-multimodal-3.5`, and
is funded by a 200M-token free tier per model. `$rankFusion` is GA on 8.0+ for
reciprocal-rank-fusion hybrid search; `$scoreFusion` adds a normalized-and-weighted
companion in Public Preview on 8.2+. Native auto-embedding through `query.text` is
Preview on Community 8.2+ with Atlas access "coming soon." Flat Indexes ship for
multi-tenant vector workloads with up to one million tenants. Change Streams give
field-level `updatedFields` plus pre-and-post images, which is exactly the right
signal for invalidating procedure schema fingerprints. The single dependency that
is too unstable for the demo path is database-native auto-embedding inside Atlas,
the rest is at least Public Preview.

Third, the team's doubt about MongoDB-as-document-store-suits-unstructured-data
versus AtlasFS's-typed-filesystem-suits-structured-data is partly valid but largely
answerable. The right framing is not "structured versus unstructured" but
"schema-stable across documents" versus "schema-stable across queries." MongoDB
collections often live in the second regime: documents are polymorphic, but query
patterns repeat once the application matures. AtlasFS's job is to crystallise the
*query shape*, not the *document shape*, and that is exactly the structure that
emerges from agent usage. The risk is that a naive codegen step on a polymorphic
collection produces either an unwieldy union type or a sample-biased lie; the
mitigation is JSON Schema `oneOf` discriminated unions (which MongoDB has supported
since 3.2) plus presence-frequency annotations in the typed surface plus per-tenant
trajectory libraries. The supply-chain risk corpus is a moderately-polymorphic
demo that fits the pitch, with at least three distinct document families (registry
metadata, advisories, dependents) and a reasonable mix of similarity, traversal,
and lookup queries.

The actionable instruction set is at the bottom of the file under Key Takeaways.

---

## Overview

This research file addresses three questions the user posed about AtlasFS, the
hackathon project codenamed in `kb/product-design.md`:

1. Are there adjacent projects in the MongoDB Atlas or Voyage AI ecosystem already
   doing what AtlasFS proposes, such that the project would unwittingly duplicate
   prior work?

2. What does MongoDB's offering look like at the level of detail needed to ground
   AtlasFS's wrapping decisions, including which primitives are GA, which are
   Preview, and what the API surface area is?

3. Is the schema-emergent + filesystem-typed pitch a fit or a misfit for MongoDB's
   document-store strengths in unstructured-data environments?

The file is structured as one extended technical brief covering all three. It draws
on three parallel deep-research passes plus targeted primary-source searches, with
65 sources cited inline. It supersedes nothing in `br/01`; rather, it fills out the
ecosystem context against which `br/01`'s code-mode-over-Voyage thesis stands.

The hackathon (MongoDB Agentic Evolution Hackathon, London, 2026-05-02, theme
*Adaptive Retrieval*) is a 24-hour build window. The file's recommendations
prioritise what the team can credibly demonstrate in three minutes plus Q&A on
demo day, against the standing baseline of vanilla agentic RAG and static-typed
code-mode environments.

---

## How It Works

The brief is organized in three parts that map to the user's three questions:
*adjacent projects* (what already exists), *MongoDB substrate* (what the project
sits on top of), and *the schema-emergent thesis* (whether the project's framing
holds against the document-store-thrives-on-unstructured-data critique).

### Part A. Adjacent Projects in the Ecosystem

The survey covered ten target areas (Mongo-as-virtual-filesystem, schema-on-read
typed codegen for MongoDB, Voyage AI integration partners, agent-FS systems
generally, trajectory-learned procedure libraries, Anthropic's 2024 to 2026 work,
MongoDB-published agent frameworks, per-tenant search applications with
trajectory learning, the MongoDB MCP server, and past MongoDB hackathon prior art)
and produced 40 distinct projects/papers/posts. The conjunction was sliced
into four axes for threat assessment:

- **Axis 1**: typed TypeScript filesystem view of a live MongoDB Atlas cluster,
  with lazy on-read codegen.
- **Axis 2**: code-mode agent that writes TypeScript snippets executed in a
  sandbox, reaching the data only through typed bindings.
- **Axis 3**: trajectory crystallisation, where successful runs are user-endorsed
  and promoted into deterministic typed procedures, with verifier-checked
  promotion and schema-fingerprint pinning.
- **Axis 4**: compile-to-aggregation-pipeline as the optimisation target, removing
  the LLM from the hot path on subsequent invocations of the same intent.

No surveyed project hits three or four axes. The closest contenders, in order of
overlap:

#### Mongo-as-filesystem precedents (Axis 1, partial)

`documentdbfuse` ([github.com/xgerman/documentdbfuse](https://github.com/xgerman/documentdbfuse))
is the highest-conceptual-overlap project: a FUSE filesystem that mounts any
MongoDB-compatible cluster, exposing collections as directories and documents as
JSON files, with magic paths like `.match/` and `.sort/` that compile to aggregation
stages. It is FUSE-only, Linux-only, the agent reads JSON not typed code, has no
type synthesis, no trajectory learning, no Atlas-specific features, no Voyage, and
no procedure crystallisation. It is an early prototype with two stars and eleven
commits at survey time, effectively dormant. *Threat: MEDIUM in concept, LOW in
execution.* AtlasFS should cite it as confirmation that the "Mongo as FS" idea has
been independently considered.

`mongofs` ([github.com/gilles-degols/mongofs](https://github.com/gilles-degols/mongofs))
and `mgfs` ([github.com/amsa/mgfs](https://github.com/amsa/mgfs)) are older
prototypes with similar shape, focused on storage scaling and personal
experimentation respectively, both dormant. *Threat: LOW.*

The Hugging Face `hf-mount` ([github.com/huggingface/hf-mount](https://github.com/huggingface/hf-mount))
mounts Hub repos and Buckets via FUSE or NFS with lazy on-read fetch via xet-core
content-addressed storage. It is the closest architectural ancestor for AtlasFS's
NFS transport: localhost NFS server on macOS to avoid kernel extension issues,
adaptive prefetch, two-tier auth model with metadata token plus short-lived JWTs,
CSI driver for Kubernetes. But it mounts repos, not databases; there is no typed
code synthesis, no agent runtime, no MongoDB. *Threat: LOW.* Pure inspiration for
the mount layer.

Turso AgentFS ([github.com/tursodatabase/agentfs](https://github.com/tursodatabase/agentfs),
[docs.turso.tech/agentfs](https://docs.turso.tech/agentfs/introduction))
is a SQLite-backed POSIX-like filesystem for *agent state*, mountable via FUSE on
Linux or NFS on macOS, with a typed schema, CoW overlay, snapshotting via `cp
agent.db snapshot.db`, and a SQL-queryable audit trail. The architectural primitive
is the same as AtlasFS's mount layer (it is in fact what AtlasFS is built on per
`kb/research.md`). The content is different: AgentFS stores the agent's own files
and state and tool-call history, not a virtualised view of a remote DB. AgentFS
ships in TypeScript, Python, and Rust SDKs; the v1 macOS path uses localhost NFS
exactly as AtlasFS plans to. *Threat: MEDIUM as an architectural cousin; LOW as a
direct competitor.* AtlasFS adopts AgentFS as the FileSystem interface and authors
only `MongoFS`, the ~10-method class plugged into AgentFS's `FileSystem` interface,
per the existing design decision in `product-design.md`.

#### Code-mode precedents (Axis 2, partial)

Cloudflare Code Mode ([blog.cloudflare.com/code-mode](https://blog.cloudflare.com/code-mode/),
[blog.cloudflare.com/code-mode-mcp](https://blog.cloudflare.com/code-mode-mcp/),
[npm @cloudflare/codemode](https://www.npmjs.com/package/@cloudflare/codemode))
is the canonical reference for the typed-TypeScript-from-schema pattern. It
converts an MCP server's tool catalog into a TypeScript namespace at deploy time,
exposes a single `execute()` tool to the LLM, and runs the generated TypeScript in
a V8 isolate inside a Cloudflare Worker with `globalOutbound: null`. The numbers,
1.17M tokens of MCP descriptions reduced to ~1,000 tokens via a typed namespace,
and the single-collection tool replacing dozens, are the published baseline that
AtlasFS quotes in the pitch. The Cloudflare API MCP server uses two primitives,
`search()` and `execute()`, to expose 2,500+ endpoints in a fixed token footprint.
Cloudflare Code Mode is generic; it generates types per MCP server, not per Atlas
collection; it does not produce a navigable filesystem (the typed API exists in
memory, you cannot `ls` it); it has no trajectory-to-procedure compiler; it does
not use Voyage. *Threat: MEDIUM as inspirational ancestor.* AtlasFS specialises
Code Mode to MongoDB Atlas and adds the FS plus the procedure compiler; frame
AtlasFS as "Code Mode for Atlas, with persistence, and a filesystem you can `ls`."

Anthropic's parallel `code-execution-with-MCP`
([anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp))
work, published November 2025 within six weeks of Cloudflare's, is the same
architectural move. Anthropic's Tool Search and Tool Search Tool feature reports
Opus 4 jumping from 49% to 74% accuracy on MCP evaluations, and Opus 4.5 from
79.5% to 88.1%, when the agent uses a code-execution surface rather than direct
tool calls. *Threat: MEDIUM, same shape, different vendor.* AtlasFS owes the
pattern to both Cloudflare and Anthropic.

#### Skill-induction precedents (Axis 3)

Voyager (Wang et al., NVIDIA, Caltech, Stanford, UT, 2023, [arXiv:2305.16291](https://arxiv.org/abs/2305.16291),
[voyager.minedojo.org](https://voyager.minedojo.org/)) is the canonical paper for
"agent learns skills as executable code stored in a library." Three components:
automatic curriculum, ever-growing skill library indexed by description embedding,
iterative prompting with environment feedback. Reports 3.3x more unique items,
2.3x longer travel, 15.3x faster milestone progress versus prior state of the art
in Minecraft. Skills are JS callables, indexed by description embedding, retrieved
on novel tasks. AtlasFS's `procedures/` is a direct descendant: a procedure library
indexed by embedding, retrieved when the agent encounters a matching intent.
*Threat: LOW, foundational citation only.*

ASI (Wang, Gandhi, Neubig, Fried, CMU, 2025, [arXiv:2504.06821](https://arxiv.org/abs/2504.06821),
[github.com/zorazrw/agent-skill-induction](https://github.com/zorazrw/agent-skill-induction))
is the closest published research design. Trajectory-induction with verification:
the agent runs a primitive-action trajectory, induces higher-level program skills,
verifies them with test trajectories, and promotes verified skills into its action
space. Reports +23.5 percentage points in success rate plus 10 to 15.3% step
reduction on WebArena versus static and text-skill baselines. ASI works on web
navigation, not Atlas; the compiled artifact is a JS function, not a MongoDB
aggregation pipeline; there is no Voyage rerank in the loop; there is no
NFS-mounted typed FS surface. *Threat: HIGH on the "agent learns programmatic
skills with verification" axis specifically.* AtlasFS must cite ASI explicitly as
direct prior art for the trajectory-to-procedure pipeline. The novelty AtlasFS
adds is the database backend, the typed FS surface, the aggregation-pipeline
compile target (Axis 4), and the per-tenant scoping, none of which ASI claims.

The critical paper to internalise is Berlot-Attwell, Rudzicz, Si (NeurIPS MATH-AI
2024, [arXiv:2410.20274](https://arxiv.org/abs/2410.20274), [OpenReview p3z8VdaomU](https://openreview.net/forum?id=p3z8VdaomU))
*Library Learning Doesn't: The Curious Case of the Single-Use "Library"*. The
authors study LEGO-Prover and TroVE, both library-learning systems for
mathematical reasoning, find that function reuse is "extremely infrequent" on
miniF2F and MATH, and conclude via ablations that the apparent accuracy gains
from these systems are actually driven by self-correction and self-consistency,
not by genuine reuse of the induced library. The follow-up *LLM Library Learning
Fails* (Berlot-Attwell, [arXiv:2504.03048](https://arxiv.org/abs/2504.03048))
extends the result. AtlasFS's user-endorsement gate is the structural answer:
reuse rate is high *by construction* because every entry was endorsed before
promotion, which is why `kb/research.md` already names reuse rate as a
first-class metric. The Berlot-Attwell critique applies specifically to math
reasoning where queries do not repeat; the WebArena and Minecraft settings
where ASI and Voyager succeed are regimes where queries do repeat, and AtlasFS's
per-tenant procedure library lives in the second regime.

Cradle ([github.com/BAAI-Agents/Cradle](https://github.com/BAAI-Agents/Cradle),
[arXiv:2403.03186](https://arxiv.org/abs/2403.03186)) is the BAAI General Computer
Control framework with episodic plus procedural memory, demonstrated on Red Dead
Redemption 2 and Stardew Valley. Same Voyager lineage applied to GUI tasks. No DB,
no types, no Atlas. *Threat: LOW.*

The 2025 to 2026 follow-up papers SkillFlow ([arXiv:2504.06188](https://arxiv.org/abs/2504.06188)),
SkillsBench ([arXiv:2602.12670](https://arxiv.org/abs/2602.12670)), Skill Retrieval
Augmentation ([arXiv:2604.24594](https://arxiv.org/abs/2604.24594)), and the
Adaptation of Agentic AI survey ([arXiv:2512.16301](https://arxiv.org/abs/2512.16301))
confirm an active research thread on agent skill libraries; none target MongoDB or
a database substrate.

#### MongoDB's own agent surface (the squeeze risk)

The official MongoDB MCP server ([github.com/mongodb-js/mongodb-mcp-server](https://github.com/mongodb-js/mongodb-mcp-server),
[mongodb.com/products/tools/mcp-server](https://www.mongodb.com/products/tools/mcp-server),
[Winter 2026 Edition blog post](https://www.mongodb.com/company/blog/product-release-announcements/whats-new-mongodb-mcp-server-winter-2026-edition))
is the most direct competitor surface. It exposes Atlas plus database tools, ships
with collection-schema introspection, find, aggregate, insert-many with automatic
Voyage embedding for vector-indexed fields, Performance Advisor (`listClusterSuggestedIndexes`,
`listSchemaAdvice`, `listDropIndexes`), local cluster lifecycle management, and
`search-knowledge` against the MongoDB Assistant knowledge base. The server is
TypeScript-implemented, distributed via official MongoDB plugins for Claude Code,
Cursor, Codex, and Gemini. The architectural shape is *tool-call*, not *code-mode*:
the agent receives JSON schemas and tool descriptors, not generated TypeScript
modules, and writes one tool call per primitive. AtlasFS's pitch is precisely
that this is the wrong abstraction; per Cloudflare's measurements, tool-calling
forces per-step round-trips through the model and inflates context, while
code-mode collapses the whole multi-step interaction into one TypeScript snippet
executed in a sandbox. *Threat: MEDIUM in the present, HIGH in the six-to-twelve-month
window.* If MongoDB ships a "code-mode mode" for the official MCP server, the gap
narrows. The hackathon timing favours AtlasFS; the post-hackathon roadmap should
plan for MongoDB to converge on the same idea.

The companion `mongodb/agent-skills` repository ([github.com/mongodb/agent-skills](https://github.com/mongodb/agent-skills))
ships SKILL.md-style instructions for agents using the MCP server, plugin-installable
in Claude Code marketplace, with 98 stars at survey time and v1.1.0 in March 2026.
Static prose skills, not generated typed code; not a runtime, not crystallised from
trajectories. *Threat: MEDIUM.* Same official surface, AtlasFS goes beyond by being
a live, typed, trajectory-driven runtime.

The LangChain `MongoDBDatabaseToolkit` ([reference.langchain.com/python/langchain-mongodb/agent_toolkit](https://reference.langchain.com/python/langchain-mongodb/agent_toolkit/tool),
[mongodb.com/company/blog/.../introducing-text-to-mql-langchain](https://www.mongodb.com/company/blog/product-release-announcements/introducing-text-to-mql-langchain-query-mongodb-using-natural-language))
is the closest rival on "agent generates aggregation pipelines for MongoDB" specifically.
A LangGraph ReAct agent receives schema, sample documents, and a validate-query tool;
generates MQL aggregation pipelines from natural language; executes them. It is
one-shot generation, no learning; no FS abstraction; no code-mode; no compiled
procedures. *Threat: MEDIUM.* The differentiator AtlasFS leans on is durable
compiled procedures, not the act of generating MQL.

The MAAP framework ([github.com/mongodb-partners/maap-framework](https://github.com/mongodb-partners/maap-framework))
was refocused on 2025-09-26 from a framework program toward partnership ecosystem
work. The framework artifacts persist; the program does not. *Threat: LOW.*

`mongodb-rag` ([github.com/mongodb-developer/mongodb-rag](https://github.com/mongodb-developer/mongodb-rag),
[npmjs.com/package/mongodb-rag](https://www.npmjs.com/package/mongodb-rag)) is an
Atlas Vector Search RAG library: chunking, embedding, indexing, ingest. A reusable
component, not a competitor. *Threat: LOW.*

The `mongodb-chatbot-server` ([npmjs.com/package/mongodb-chatbot-server](https://www.npmjs.com/package/mongodb-chatbot-server))
is the framework MongoDB's own docs chatbot is built on. Production RAG server
pattern; not an FS or agent runtime. *Threat: LOW.*

#### Voyage AI integration partners

Anthropic, LangChain, Harvey, and Replit are cited as Voyage customers at the time
of the MongoDB acquisition. Harvey's `voyage-law-2-harvey` ([harvey.ai/blog/harvey-partners-with-voyage-to-build-custom-legal-embeddings](https://www.harvey.ai/blog/harvey-partners-with-voyage-to-build-custom-legal-embeddings))
is a custom legal embedding fine-tuned on 20B tokens of US case law: 25% reduction
in irrelevant top results, one-third the dimensionality of competitors. This is
the per-tenant or per-domain fine-tuning regime AtlasFS targets, except expressed
as model weights rather than as a procedure library. AtlasFS's pitch is that the
same per-tenant adaptation can happen as code rather than as weights, with the
auditability and determinism advantages that come with code. *Threat: LOW.*
Inspirational, validates the per-tenant-tuning thesis.

The Replit Agent demo `agentwithmemory.replit.app` shows LangGraph plus MongoDB plus
Voyage with persistent agent memory. Boilerplate; no FS, no code-mode, no
crystallisation. *Threat: LOW.*

#### Self-improving SQL agents (relational analogues)

Vanna ([github.com/vanna-ai/vanna](https://github.com/vanna-ai/vanna)) is the
canonical "agent learns queries and reuses them" project: open-source Python
RAG-for-SQL, trains on DDL plus docs plus question-SQL pairs, retrieves top-K
examples to ground generation, persistent vector cache. Vanna 2.0 added LLM
middlewares for caching. *Threat: MEDIUM on the "self-improving query agent" axis,
LOW on Mongo specifics.* AtlasFS goes beyond by promoting to a typed compiled
artifact rather than a retrieved exemplar.

Bedi's *Self-improving Text2SQL with Dynamic Context*
([ashpreetbedi.com/articles/sql-agent](https://www.ashpreetbedi.com/articles/sql-agent))
is a direct match for the user-endorsement loop: the agent asks the user to save
successful queries to a knowledge base, growing dynamic context. SQL not MQL, no
compile to aggregation pipeline, no FS, no Voyage. *Threat: MEDIUM* on the
endorsement mechanic, LOW on artifact shape.

RoboPhD ([arXiv:2601.01126](https://arxiv.org/abs/2601.01126)) is *Self-improving
Text-to-SQL through autonomous agent evolution*: a 70-line baseline grown to
1,500 lines over 18 iterations. More aggressive than AtlasFS's user-endorsed
promotion; same trajectory-feedback core. *Threat: LOW.*

#### Anthropic's filesystem and memory primitives

Anthropic Agent Skills ([anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills),
[platform.claude.com/docs/en/agents-and-tools/agent-skills/overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))
are filesystem-shaped capability primitives: a directory containing `SKILL.md` and
assets, loaded progressively. Adopted by Microsoft, OpenAI, Cursor, Goose, Amp,
OpenCode, Letta. The skill-folder pattern is the cousin of AtlasFS's `procedures/`.
AtlasFS's novelty is that procedures are induced from trajectories, then verified,
then compiled, rather than authored. *Threat: MEDIUM.*

The Anthropic Memory Tool ([platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool))
is a `/memories` directory the agent reads, writes, and edits across sessions, with
filesystem-backed memory on Managed Agents in public beta from April 2026
(Netflix, Rakuten, Wisedocs, Ando named as adopters). General-purpose freeform text;
not coupled to a database surface; not typed. *Threat: LOW to MEDIUM.* Closest
conceptual cousin for "agent's persistent memory as files."

Anthropic Cowork is the macOS desktop research-preview agent that operates with
read or write or create access to a folder. User-files-on-disk, not a virtualised
DB. *Threat: LOW.*

#### Schema-typing primitives for MongoDB

Prisma's MongoDB introspection ([prisma.io/docs/orm/prisma-schema/introspection](https://www.prisma.io/docs/orm/prisma-schema/introspection))
samples up to 1,000 docs per collection, infers a schema, generates type-safe
Prisma Client. One-shot codegen at developer-time, not lazy on agent-read.
Significant signal: Prisma v7 dropped MongoDB; only v6.19 supports it as of 2026,
indicating Prisma is not investing further in this space. *Threat: LOW.* Ancestor
primitive only.

Mongoose with Typegoose ([github.com/typegoose/typegoose](https://github.com/typegoose/typegoose))
provides TypeScript decorators and `InferSchemaType` for deriving types from
developer-authored Mongoose schemas. *Threat: LOW.*

`mongodb-schema` ([npmjs.com/package/mongodb-schema](https://www.npmjs.com/package/mongodb-schema),
[github.com/mongodb-js/mongodb-schema](https://github.com/mongodb-js/mongodb-schema))
is MongoDB's official schema-inference library. A reusable component AtlasFS
leans on for type synthesis. *Threat: LOW, this is a building block.* Default
sample size is 100 documents; Compass schema analyser samples up to 1,000 per
[mongodb.com/docs/compass/current/sampling](https://www.mongodb.com/docs/compass/current/sampling/),
with documented warning that this can miss rare fields in collections of millions.

#### Per-tenant agentic search applications (analogues outside MongoDB)

Glean ([docs.glean.com/security/architecture/data-flow](https://docs.glean.com/security/architecture/data-flow),
[zenml.io/llmops-database/fine-tuning-custom-embedding-models-for-enterprise-search](https://www.zenml.io/llmops-database/fine-tuning-custom-embedding-models-for-enterprise-search))
fine-tunes per-customer embedding models. The closest commercial analogue to
AtlasFS's per-tenant adaptation thesis. Expressed as model weights, not as code.
*Threat: LOW.* Different substrate, validates the demand for per-tenant adaptation.

Sourcegraph Cody ([sourcegraph.com/blog/how-cody-understands-your-codebase](https://sourcegraph.com/blog/how-cody-understands-your-codebase),
[sourcegraph.com/docs/cody/enterprise/features](https://sourcegraph.com/docs/cody/enterprise/features))
is a per-tenant code search and assistant with enterprise audit logs. Adjacent
positioning. *Threat: LOW.*

Outerbase ([outerbase.com](https://outerbase.com/), [github.com/outerbase/sdk](https://github.com/outerbase/sdk))
is a universal database UI with AI assistance over Mongo plus eight other
backends. Human UI focus, not agent-FS. *Threat: LOW.*

Hex Magic ([learn.hex.tech/docs/getting-started/ai-overview](https://learn.hex.tech/docs/getting-started/ai-overview))
is per-tenant SQL plus Python notebook AI, with saved queries. SQL-focused. *Threat:
LOW.*

`AskDB` ([askdb.dev](https://askdb.dev/)) is an MCP server for safe LLM access to
Postgres and MongoDB. MCP-tool-shaped; no FS, no code-mode, no trajectory.
*Threat: LOW.*

#### Past MongoDB hackathon submissions

A search for prior hackathon entries mounting Mongo as a filesystem or doing
code-mode over Atlas returned no relevant prior art. The MongoDB GenAI showcase
repository contains many RAG and agent samples, none with the AtlasFS conjunction.
LiveKit participated in the same Agentic Evolution Hackathon ([tipranks.com/news/private-companies/livekit-highlights-ai-agent-capabilities-through-participation-in-mongodb-hackathon](https://www.tipranks.com/news/private-companies/livekit-highlights-ai-agent-capabilities-through-participation-in-mongodb-hackathon))
in a different theme (real-time voice agents). *Threat: LOW.*

#### Adjacent-projects synthesis

The 40-project survey collapses to one sentence: each axis of AtlasFS has prior
art, no project unifies even three of the four axes, and the conjunction is
genuinely unclaimed at roughly 80% confidence as of May 2026. The risk that
matters is not displacement by an existing competitor; it is convergence by
MongoDB itself, plus possibly Anthropic plus Cloudflare in parallel, within a
six-to-twelve-month window. The hackathon is the cheapest credible falsification
window for the conjunction; post-hackathon, the team should plan to publish the
measurement framework and the typed-FS-as-primitive layer before MongoDB ships
its own.

### Part B. The MongoDB Atlas + Voyage Substrate (May 2026 State of Play)

The Atlas + Voyage stack changed substantially between MongoDB.local San Francisco
(2026-01-15) and the hackathon (2026-05-02). The brief below catalogs only what
Atlas + Voyage natively expose so AtlasFS knows what to wrap, what to lean on, and
what is too unstable to depend on.

#### `$vectorSearch` aggregation stage (GA, with Preview sub-features)

Must be the first stage in any pipeline where it appears; cannot be used inside
view definitions, `$lookup` sub-pipelines, or `$facet`. Results pass through
`$lookup` downstream.

Required parameters: `index` (vector index name), `path` (field with the
embedding), `queryVector` (the query embedding) or `query.text` (auto-embed
entry, Preview), `numCandidates` (HNSW search width, rule of thumb >= 10 to 20x
limit), `limit` (documents returned). Optional: `filter` (pre-filter MQL with
`$eq, $ne, $gt, $lt, $gte, $lte, $in, $nin, $exists, $not, $nor, $and, $or`),
`exact` (boolean for ENN vs ANN).

Index configuration: type `vectorSearch`, algorithm selected by `indexingMethod`
in `{hnsw, flat}` per [docs.mongodb.com/atlas/atlas-vector-search/vector-search-type](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/).
HNSW exposes `m` and `efConstruction` since 2025-06-10. Flat indexes are exhaustive
per-segment scan, optimal for selective `tenant_id` pre-filters. Quantization:
`scalar` gives ~3.75x RAM reduction, `binary` gives ~24x with rescoring; Voyage's
`voyage-3-large` and `voyage-context-3` are quantization-aware-trained, so binary
plus rescoring is the recommended default. Dimension limit raised to 8,192 on
2025-03-30 per the [Vector Search Changelog](https://www.mongodb.com/docs/atlas/atlas-vector-search/changelog/).

Lexical pre-filters in Public Preview as of 2025-11-24: a new `vector` index type
plus `vectorSearch` operator combine fuzzy, phrase, wildcard with similarity in
one stage; useful but Preview-only.

*AtlasFS relevance:* Wrap as `vector(query, opts)` in the typed namespace. Default
to manual embedding via the Atlas Embedding API; treat `query.text` as opt-in
optimisation behind a typed flag.

Sources: [Run Vector Search Queries](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/),
[Vector Quantization](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-quantization/),
[Auto-quantize with Voyage AI](https://www.mongodb.com/docs/vector-search/tutorials/auto-quantize-with-voyage-ai/).

#### `$search` (MongoDB Search) aggregation stage (GA)

Engine internally `mongot`, also being open-sourced under codename "T" announced
at MongoDB.local SF 2026.

Operator catalog per [docs.mongodb.com/atlas/atlas-search/operators-and-collectors](https://www.mongodb.com/docs/atlas/atlas-search/operators-and-collectors/):
`autocomplete, compound, embeddedDocument, equals, exists, geoShape, geoWithin,
hasAncestor, hasRoot, in, knnBeta (deprecated), moreLikeThis, near, phrase,
queryString, range, regex, span (deprecated), text, vectorSearch, wildcard`, plus
the `facet` collector.

Scoring: `text`, `phrase`, `autocomplete`, and `queryString` default to BM25.
Per-field `similarity.type` is configurable. Compound query scores sum across
`must` and `should`; `filter` and `mustNot` are non-scoring (use `filter` for
non-scoring predicates to skip scoring overhead). Custom analyzers and
multi-analyzer fields are supported.

*AtlasFS relevance:* Wrap as `search(spec)` with sub-builders for each leaf
operator. `compound` is the natural surface to expose. Skip `knnBeta` and `span`
(deprecated).

#### `$rankFusion` aggregation stage (GA on 8.0+)

Reciprocal-rank-fusion hybrid search, GA on 8.0. Algorithm: `RRFscore(d) = sum
over pipelines of w * 1 / (60 + rank(d))` with sensitivity constant `k = 60`.

Spec per [docs.mongodb.com/manual/reference/operator/aggregation/rankfusion](https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankfusion/):

```js
{ $rankFusion: {
    input: { pipelines: { lex: [...], vec: [...] } },
    combination: { weights: { lex: 1.0, vec: 1.0 } },
    scoreDetails: false
} }
```

Constraints: same collection only (cross-collection requires `$unionWith`
outside); each sub-pipeline must be both a Selection and a Ranked Pipeline; no
`$project, $addFields, $set, $unset` inside sub-pipelines (apply after); pipeline
names must not be empty, start with `$`, contain `\0`, or contain `.`. Cannot run
inside view definitions or on time-series collections; can run *on* views (8.0+).
Documents are de-duplicated; RRF score lands in the `score` metadata field.

Reported impact: up to 30% improvement in context retrieval accuracy for an AI
chatbot per [the announcement post](https://www.mongodb.com/community/forums/t/announcing-hybrid-search-support-via-rankfusion/324476).
8.1 added `$vectorSearch` inside the input pipelines, allowing multiple vector
queries against the same collection in one stage.

`$scoreFusion` is the score-normalised companion (Public Preview on 8.2+ per
[$scoreFusion Public Preview announcement](https://www.mongodb.com/products/updates/public-preview-mongodb-native-hybrid-search-with-scorefusion/)),
where each pipeline's scores are normalized to 0.0 to 1.0 and combined via
weighted average or a custom expression. More granular control than `$rankFusion`,
useful when scores are interpretable.

*AtlasFS relevance:* Single most valuable stage. Wrap as `hybrid({ lex, vec,
weights })`. The "no-modifying-stages-inside" constraint maps cleanly onto a
typed builder where projection happens on the outer pipeline.

#### Atlas Embedding and Reranking API (Public Preview, 2026-01-15)

Announced at MongoDB.local San Francisco on 2026-01-15 per [the Public Preview
announcement](https://www.mongodb.com/products/updates/now-in-public-preview-embedding-and-reranking-api-on-mongodb-atlas/).
API doc version 1.1, last updated 2026-01-14 per [the API spec](https://www.mongodb.com/docs/api/doc/atlas-embedding-and-reranking-api/).

- Base URL: `https://ai.mongodb.com/v1`
- Auth: `Authorization: Bearer <model_api_key>` (model API keys are managed
  separately from Atlas database API keys)
- Database-agnostic, serverless, token-priced, with 200M-token free tier per
  current model.
- Endpoints: `POST /embeddings` (voyage-4-large, voyage-4, voyage-4-lite),
  `POST /contextual-embeddings` (voyage-context-3), `POST /multimodal-embeddings`
  (voyage-multimodal-3.5), `POST /rerank` (rerank-2.5, rerank-2.5-lite).

Request body parameters: `input` (string or array), `model`, `input_type`
(`query` or `document`, materially affects recall because Voyage prepends
model-specific prefix tokens), `output_dtype` (`float, int8, uint8, binary,
ubinary`), `output_dimension` (Matryoshka truncation `256, 512, 1024, 2048`),
`encoding_format` (`base64` supported), `truncation` (boolean).

Two integration paths: (1) standalone API call, plug `queryVector` into
`$vectorSearch` (the safe, GA-compatible path today), or (2) automated embedding
inside the database via `autoEmbed` field type plus `query.text` inside
`$vectorSearch` (Preview on Community 8.2+, Atlas access "coming soon" per
[the Automated Embedding announcement](https://www.mongodb.com/company/blog/product-release-announcements/unlocking-ai-search-introducing-automated-embedding-in-mongodb-vector-search)
and [the auto-embedding how-to](https://www.mongodb.com/docs/vector-search/crud-embeddings/create-embeddings-automatic/)).

*AtlasFS relevance:* The typed namespace's embedding backend. Wrap once in a
`voyage` namespace exporting `embed`, `contextualEmbed`, `multimodalEmbed`,
`rerank`. **Build on path 1 for the demo**, expose path 2 behind a typed flag.
The free tier is more than enough for any hackathon corpus.

#### Voyage AI's full surface (post-acquisition, 2026-02-24)

The Voyage 4 family launched 2026-01-15, simultaneous with the Embedding and
Reranking API.

| Model | $/1M tok | Free tokens | Notes |
|-------|----------|-------------|-------|
| voyage-4-large | $0.12 | 200M | MoE architecture, ~40% cheaper to serve than dense peers |
| voyage-4 | $0.06 | 200M | Recommended general-purpose default |
| voyage-4-lite | $0.02 | 200M | High-volume |
| voyage-4-nano | n/a | n/a | Open-weights |
| voyage-context-3 | $0.18 | 200M | Contextualized chunk embeddings; +6.76% chunk-level vs Anthropic Contextual Retrieval per Voyage's own eval |
| voyage-multimodal-3.5 | $0.12/M tok + $0.60/B px | 200M tok + 150B px | 1120 px = 1 token, 32K-token max |
| voyage-code-3 | $0.18 | 200M | 300+ programming languages |
| voyage-finance-2, voyage-law-2 | $0.12 | 50M | Domain-specific |
| rerank-2.5 | $0.05 | 200M | 32K context, instruction-following |
| rerank-2.5-lite | $0.02 | 200M | Lower-cost cross-encoder |

The Voyage 4 *shared embedding space* is the headline new capability: all four
Voyage 4 models produce compatible embeddings, so you can index with
`voyage-4-large` and query with `voyage-4-lite` (or vice versa) without
re-indexing. This is unique among major embedding vendors as of May 2026 per
[the Voyage 4 announcement](https://investors.mongodb.com/news-releases/news-release-details/mongodb-sets-new-standard-retrieval-accuracy-voyage-4-models).

Quantization on Voyage 4 plus `voyage-context-3`: `output_dtype` in `{float,
int8, uint8, binary, ubinary}` and `output_dimension` in `{256, 512, 1024 (default),
2048}`. Embeddings are L2-normalized so cosine and dot-product produce identical
rankings. All `input_type` values matter for retrieval quality; omitting them
materially hurts recall.

Tier 1 rate limits (after adding payment): 2,000 RPM across models. TPM tiered
by model, e.g., voyage-4-large at 3M TPM Tier 1, voyage-4 at 8M, voyage-4-lite at
16M, voyage-multimodal-3.5 at 2M, rerank-2.5 at 2M per [the Rate Limits
docs](https://docs.voyageai.com/docs/rate-limits).

TypeScript SDK note: there is no first-party `@voyageai/sdk` package as polished
as the Python one as of May 2026. Best path for AtlasFS is to hit the Atlas
Embedding API endpoints directly under `https://ai.mongodb.com/v1`, which uses
the same shape.

*AtlasFS relevance:* Default to `voyage-4` for general-purpose, `voyage-context-3`
for chunked content, `voyage-code-3` for code (the AtlasFS use case for typed-TS
procedure embedding), `rerank-2.5` for the post-retrieval pass. The shared Voyage
4 embedding space is a typed feature worth surfacing.

#### RTEB benchmark caveat

Voyage's RTEB benchmark claims `voyage-4-large` +14% over OpenAI text-embedding-3-large
and +8.2% over Cohere embed-v4; `voyage-context-3` +14.24% chunk-level / +7.89%
doc-level vs OpenAI. Independent reproduction is mixed: a [GitHub issue on
embeddings-benchmark/mteb #3901](https://github.com/embeddings-benchmark/mteb/issues/3901)
flagged Voyage receiving RTEB results before model artifacts were public.
Single-digit margins on cross-vendor benchmarks are noise. Pitch the integration
story, not the leaderboard delta.

#### Change Streams (GA, since 3.6; pre/post images GA since 6.0)

`db.col.watch(pipeline, options)` backed by the oplog. Resumable via `resumeAfter`
and `startAtOperationTime`. Filter via standard aggregation operators in
`pipeline`.

Event types: `insert, update, replace, delete, drop, dropDatabase, rename,
invalidate, create, createIndexes, modify, shardCollection, reshardCollection`.
Update events expose `updateDescription.updatedFields` (dot-notation map of
changed fields), `removedFields` (array), `truncatedArrays`. Pre/post images via
`fullDocumentBeforeChange: "required" | "whenAvailable"` and `fullDocument:
"required" | "whenAvailable" | "updateLookup"`.

*AtlasFS relevance:* Direct fit. AtlasFS keeps a per-collection schema fingerprint
per procedure; a change stream on `{ ns: <coll>, operationType: { $in:
["insert","update","replace"] } }` with `fullDocument: "updateLookup"` lets the
readdir layer detect new fields, type-mutated fields, and removed fields, then
invalidate the typed namespace. Resume tokens give cheap restart-after-crash
semantics. Note Change Streams report `updatedFields` paths but not types, so
AtlasFS still needs a sampled inference pass to confirm type information; use
Change Streams as the *invalidation signal*, not the *inference signal*.

Sources: [Change Streams manual](https://www.mongodb.com/docs/manual/changestreams/),
[Change Streams spec](https://github.com/mongodb/specifications/blob/master/source/change-streams/change-streams.md).

#### Search Nodes (GA), Flat Indexes (Public Preview)

Search Nodes are dedicated infra for `$search` and `$vectorSearch`, isolated from
primary nodes, scaling 2 to 32 nodes, with high-CPU and storage-optimized tiers
per [Search Nodes infrastructure](https://www.mongodb.com/products/updates/available-now-search-nodes-dedicated-infrastructure/).
Storage-optimized is ~40% cheaper than high-CPU when anchored on RAM.

Flat Indexes are in Public Preview on AWS, GCP, and Azure across all Atlas tiers
per [the Flat Indexes announcement](https://www.mongodb.com/company/blog/product-release-announcements/improved-multitenancy-support-in-vector-search-introducing-flat-indexes).
Set `indexingMethod: "flat"` on a `vectorSearch` index. Optimal for tenants with
fewer than ~10,000 vectors each, up to ~1,000,000 tenants total. With a `tenant_id`
pre-filter, latency is independent of which tenant is queried; HNSW shows up to 3x
latency variance across tenants. Recommended pattern: one collection, one
`tenant_id` filter field, `flat` index for small tenants, per-tenant MongoDB
Views with HNSW for tenants exceeding 10,000 vectors.

The hackathon sandbox cluster (M10 dedicated tier, replica set only) does not
include Search Nodes; Search Node behaviour is for the post-demo "what would you
do at scale" slide, not the demo itself. M10 is the lowest dedicated tier as of
2026-01-22 (M0/M2/M5 Shared and Serverless were retired) per
[mongodb.com/docs/atlas/manage-clusters](https://www.mongodb.com/docs/atlas/manage-clusters/).

#### Aggregation pipeline as the optimisation target

The whole AtlasFS pitch turns on this. The agent emits a single TypeScript
expression that desugars to one aggregation pipeline. Stages that collapse
multi-call ReAct sequences include `$lookup` (left-outer-join with sub-pipelines),
`$graphLookup` (recursive traversal up to `maxDepth`), `$facet` (parallel
sub-pipelines into named buckets), `$unionWith` (cross-collection union),
`$documents` (synthetic in-pipeline collection), plus `$rankFusion`,
`$vectorSearch`, and `$search`. `$facet` plus `$rankFusion` plus `$lookup` plus
`$graphLookup` lets a single pipeline replace 4 to 8 ReAct turns.

Hard limits: BSON document size 16 MB; in-memory aggregation stage limit 100 MB
per stage (exceed it requires `allowDiskUse: true`, which spills to disk and adds
latency); pipelines run on primary or Search Nodes depending on stage,
`$vectorSearch` and `$search` go to `mongot`. Plan for the 100 MB cap by
exposing `allowDiskUse` as a typed option on long pipelines.

#### MongoDB MCP server (GA, "Winter 2026 Edition")

Already covered in the adjacent-projects part. Notable AtlasFS-relevant tools:
`insert-many` with automatic Voyage embedding for fields with vector indexes,
`listSchemaAdvice` (a Performance Advisor tool that suggests schema improvements
based on real data), unified `CreateIndexTool` covering regular and vector
indexes, `search-knowledge` against the MongoDB Assistant knowledge base.

`readOnly` flag restricts to read/connect/metadata operations.
`confirmationRequiredTools` defaults to `drop-database, drop-collection,
delete-many, atlas-create-db-user, atlas-create-access-list`. Connection strings
should go via env vars not CLI args (process lists log them otherwise).

#### What MongoDB offers, in one paragraph

As of May 2026, AtlasFS sits on a substrate that has, in the past 18 months,
quietly become the most coherent retrieval-and-database stack in the industry.
The aggregation pipeline is the optimization target; `$rankFusion` plus
`$vectorSearch` plus `$search` plus `$lookup` plus `$graphLookup` plus `$facet`
in one pipeline is the architectural moat over MCP tool-calling. Voyage 4's
shared embedding space lets AtlasFS index once with the largest variant and query
with the cheapest. The standalone Embedding and Reranking API at
`https://ai.mongodb.com/v1` is the safe wrapping target for embeddings and
reranking. Change streams provide invalidation signals for procedure schema
fingerprints. Flat Indexes give multi-tenant isolation up to a million tenants.
The substrate is at least Public Preview across the board; only database-native
auto-embedding via `query.text` is too unstable to bet a demo on.

### Part C. The Schema-Emergent Thesis: Is the Pitch a Fit or a Misfit?

The user's doubt, restated: MongoDB shines on unstructured data; AtlasFS's
typed-filesystem pitch reads like it presupposes structured data; if the right
match is structured-leaning, the document-store positioning is wrong; but if the
schema-emergent claim is right, AtlasFS sits exactly where MongoDB customers
already live, and the pitch is a strong fit.

The doubt is **partly valid but largely answerable**, landing in category (c)
something in between with specific failure modes and specific wins.

#### Evidence that the worry has merit

Three measurements lean on the worry side.

First, *text-to-MQL is measurably worse than text-to-SQL*. The SM3-Text-to-Query
benchmark (NeurIPS 2024, summarised in [Towards Data Science: Can LLMs talk SQL,
SPARQL, Cypher, and MongoDB Query Language equally well?](https://towardsdatascience.com/can-llms-talk-sql-sparql-cypher-and-mongodb-query-language-mql-equally-well-a478f64cc769/))
reports 47.05% zero-shot accuracy on SQL, 34.45% on Cypher, **21.55% on MQL**, and
3.3% on SPARQL across 10K question-query pairs. The 2026 EvoMQL paper *Draft,
Refine, Optimize* ([arXiv:2604.13045](https://arxiv.org/abs/2604.13045)) reports
state-of-the-art at 76.6% in-distribution and 83.1% out-of-distribution on
EAI/TEND, still trailing the best Spider 1.0 SQL agents at ~91% per [CallSphere's
text-to-SQL evaluation roundup](https://callsphere.ai/blog/text-to-sql-evaluation-spider-bird-benchmarks-accuracy-testing).
Models simply produce worse MQL than SQL on average, partly because MQL's
aggregation pipeline is compositional and non-local (the EvoMQL paper's framing),
partly because polymorphic document fields force the model to ground mentions to
nested JSON paths that may or may not exist, and partly because MQL is less
common in training data than SQL. *This is the strongest empirical case for the
worry.*

Second, *library learning has been shown to underdeliver on reuse*. Berlot-Attwell
et al. NeurIPS 2024 *Library Learning Doesn't* found that function reuse is
"extremely infrequent" in LEGO-Prover and TroVE on miniF2F and MATH, and that
their accuracy gains came from self-correction and self-consistency, not
genuine library reuse. If AtlasFS's procedure library follows the same pattern,
the divergence chart that is supposed to bend in the team's favour will instead
stay flat. *kb/research.md* already names this as a load-bearing risk.

Third, *MongoDB documents anti-patterns that polymorphic-typing makes easy to
hit*. The [Schema Design Anti-Patterns manual page](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/)
plus [the dev.to deep-dive](https://dev.to/mhmd_zbib/mongodb-at-scale-common-anti-patterns-that-silently-kill-performance-jci)
flag unbounded arrays, bloated documents, missing indexes, and `$lookup` overuse.
A naive AtlasFS sample-and-codegen step on a polymorphic collection produces
typed signatures that imply much smaller, much cleaner shapes than the actual
data, leading the agent into exactly these traps. The mongodb-schema npm package
defaults to 100 documents; Compass samples up to 1,000; both can miss rare fields
in collections of millions per [the Compass Sampling docs](https://www.mongodb.com/docs/compass/current/sampling/).
The polymorphic-data manual page itself notes that "filtering and aggregating
across multiple document types in the same collection may require additional
indexing and query optimizations."

#### Evidence that the worry is overstated

Five counter-evidence points lean in the other direction.

First, *MongoDB's polymorphism is exactly what `oneOf` JSON Schema validation is
for*. The [Specify Validation for Polymorphic Collections](https://www.mongodb.com/docs/manual/core/schema-validation/specify-validation-polymorphic-collections/)
page walks through expressing discriminated unions over heterogeneous document
shapes, which is isomorphic to a TypeScript discriminated union with a `kind` or
`type` discriminant. AtlasFS does not need to pretend a polymorphic collection is
uniform; it can lift the polymorphism into the type system and the agent can
pattern-match on the discriminator. This is a real technical alignment, and the
pattern is also the same as Mongoose's discriminator key, so there is substantial
training data for the LLM to draw on.

Second, *the schema-on-read movement validates the principle*. Iceberg v3's
VARIANT type (Feb 2025, [docs.databricks.com/blog/next-era-open-lakehouse-apache-icebergtm-v3-public-preview-databricks](https://www.databricks.com/blog/next-era-open-lakehouse-apache-icebergtm-v3-public-preview-databricks))
adds native semi-structured columns to a relational table, queryable with
standard SQL without schema migration, exactly the bet AtlasFS makes (BSON stays
the lake; the typed view is regenerated when the fingerprint changes). Iceberg
plus Delta Lake plus Hudi have collectively settled the industry argument: schema
can be enforced at read time without losing flexibility at write time. AtlasFS is
the same principle expressed at the agent layer rather than the data-engineering
layer.

Third, *typed surfaces measurably help agents*. Cloudflare Code Mode reports
1.17M tokens of MCP descriptions reduced to ~1,000 tokens via a typed namespace
and an 81% to 99.9% reduction depending on metric. Anthropic's Tool Search Tool
reports Opus 4 jumping from 49% to 74% on MCP evaluations and Opus 4.5 from
79.5% to 88.1%. The mechanism is the same: types compress, types compose, and
types let the agent write code the model has seen a lot of. AtlasFS's
typed-filesystem surface is on the right side of this trend regardless of whether
the underlying data is structured or polymorphic.

Fourth, *Voyager and ASI demonstrate that trajectory libraries do work in
domains where queries repeat*. Voyager: 3.3x more unique items, 2.3x longer
travel, 15.3x faster milestones in Minecraft. ASI: +23.5 percentage points on
WebArena versus static baselines, +11.3 versus text-skill, 10.7% to 15.3% step
reduction. Berlot-Attwell's deflation applies specifically to math reasoning
where queries do not repeat; AtlasFS's per-tenant procedure library lives in
the regime where they do. Reuse rate is high *by construction* under
user-endorsement gating.

Fifth, *MongoDB customers already operate in genuinely polymorphic, content-heavy
domains and use Atlas for it*. Novo Nordisk runs clinical-study reports on Atlas
([customer case study](https://www.mongodb.com/solutions/customer-case-studies/novo-nordisk)),
turning a 12-week document workflow into 10 minutes via Atlas's flexibility for
highly variable clinical content. Okta runs Customer Identity Cloud's Inbox feature
on Atlas with Atlas Vector Search; Delivery Hero migrated its product catalog in
2021 then added Atlas Search and Vector Search for an Item Replacement Tool
serving 12,000 requests per second across 2.2 billion customers per
[their Vector Search case study](https://www.mongodb.com/solutions/customer-case-studies/delivery-hero-vector-search);
Kovai stores knowledge-base articles plus embeddings together in Atlas to answer
questions in 2 to 4 ms; VISO TRUST runs three collections of paragraphs, sentences,
and table rows extracted from SOC2s and ISOs through Atlas Vector Search at the
tens-of-millions scale per
[the discussion blog](https://www.mongodb.com/company/blog/discussion-viso-trust-expanding-atlas-vector-search-provide-better-informed-risk-decisions).
None of these is a relational migration; all are polymorphic, content-heavy, and
production-scale. AtlasFS is built for exactly this slice.

#### The structural-vs-emergent reframing

The user's "structured versus unstructured" axis smuggles in an assumption from
the relational era that does not hold. Per [Databricks' Structured vs
Unstructured Data](https://www.databricks.com/blog/structured-vs-unstructured-data)
and [Estuary's framing](https://estuary.dev/blog/structured-vs-unstructured-data/),
the spectrum is not binary: "unstructured" data almost always carries internal
structure that the consumer extracts at read time. A PDF has a layout, a chat has
turns, a log has fields. What is unstructured is the *uniform schema across
instances*, not the structure of any individual instance.

The right two axes are *schema stability across documents* and *schema stability
across queries*. A relational table is stable on both. A naive document collection
is stable on neither. The interesting middle ground, where most MongoDB workloads
live, is **stable on the queries axis but unstable on the documents axis**. A
product catalog has wildly different attributes for shirts vs laptops vs books,
but queries against it repeat: by SKU, by category, by price range, by
availability. A clinical-study corpus has heterogeneous document structures but
queries are ritualised: extract eligibility criteria, build adverse-events tables,
find dosing regimens. A security-artifact corpus has wildly different document
classes but queries are bounded: find evidence of a SOC2 control, link a policy
paragraph to a risk framework.

This is the axis on which AtlasFS wins, and it is also the axis on which the
Berlot-Attwell critique loses traction. A library is single-use because every
math problem demands a fresh lemma; that is failure on the queries axis. A
library where the same handful of aggregation pipelines repeats across thousands
of queries, even when underlying documents have diverse shapes, is succeeding on
the queries axis exactly because polymorphism is concentrated in the data, not
the access. Trajectory learning crystallises the *query shape*, not the
*document shape*, and that is the structure that emerges from usage.

Reframing the pitch around this distinction makes the argument bullet-proof:
**AtlasFS is for collections where document polymorphism is high but query
patterns repeat once the application matures.**

#### Specific failure modes for AtlasFS on polymorphic data

1. **Sample bias in initial codegen.** 30% of customers have a `loyaltyAccount`
   nested object, but mongodb-schema's 100-doc default sample misses it; the
   generated TypeScript silently omits the field; 30% of subsequent agent runs
   fail. *Mitigation:* sample with explicit attention to field presence
   frequency, expose presence percentages in the generated type's JSDoc, increase
   sample size adaptively when variance is high.

2. **Union type explosion.** A collection with 12 polymorphic shapes produces an
   unwieldy 200-line union; the Cloudflare Code Mode token-efficiency story
   collapses; the agent fights type narrowing on every call. *Mitigation:* detect
   polymorphic collections via discriminator-field inference, generate
   `oneOf`-style discriminated unions with a single `kind` field, emit per-variant
   helper namespaces.

3. **Anti-pattern leakage through the typed surface.** A 12 MB document with an
   unbounded `events` array; the typed `getEvents()` method invites a 12 MB
   round-trip; performance collapses. *Mitigation:* generate bounded methods
   (`getEvents({ limit, since })`) by default; the trajectory layer reinforces
   bounded access patterns by promoting them when they appear in successful runs.
   This is exactly the place where the schema-emergence story does real work,
   because the procedure library is the natural home for "the right way to query
   a 12 MB document."

4. **Cross-tenant codegen collisions.** AtlasFS's per-cluster codegen cache must
   be ruthlessly per-tenant scoped, because each tenant has a different schema
   by design. *Mitigation:* per-tenant trajectory libraries, per-tenant JSON
   Schema fingerprints, per-tenant cache keys, mirroring Glean's per-customer
   embedding-model isolation.

5. **Trajectory drift.** Schema evolves; old procedures silently break or return
   subtly wrong results. *Mitigation:* schema fingerprints with content hashing
   over a sample, procedure invalidation on fingerprint mismatch, re-induction
   pipeline that prompts the agent to retry the failed procedure under the new
   schema. This is exactly what the existing AtlasFS design includes; the change-
   stream-driven invalidation pipeline is the right answer.

#### Specific wins for AtlasFS on polymorphic data

1. **Trajectory-driven query-shape discovery.** In a polymorphic collection, you
   cannot pre-design every query. Once the agent has run a thousand successful
   trajectories, the procedure library captures, with high precision, *which*
   polymorphic shape mattered for *which* business question. The library is
   small, dense, and tenant-specific. This is the per-tenant equivalent of
   what Glean does with per-customer embedding models, but expressed as code
   rather than weights, with the auditability advantages that come with code.

2. **Vectors absorb the irregularity, types impose discipline on access patterns.**
   Voyage embeddings reach the *content* of polymorphic fields (long descriptions,
   policy text, chat turns) regardless of where in the document they sit. The
   typed surface is only responsible for the *operations* over that content. A
   clean division of labour.

3. **The schema-on-read story is right for evolving products.** Most early-stage
   SaaS products do not know what their schema should be. A relational migration
   is expensive and irreversible; a MongoDB write is a one-line change. AtlasFS
   keeps pace without manual codegen because the schema fingerprint plus
   procedure library are continuously regenerated.

4. **Typed procedures as the audit log.** A pure vector-RAG system has no record
   of what queries the agent ran, in a form humans can review. AtlasFS's
   procedure library is, by construction, that record. Each promoted procedure
   is named, typed, replayable, and reviewable. This is a concrete answer to
   enterprise concerns about agentic determinism, differentiating AtlasFS from
   "chat with your database" tools that produce ephemeral SQL or MQL on every
   turn.

#### Recommendation: corpus characteristics for the demo

The supply-chain risk corpus (already chosen per `kb/research.md`) is structurally
a good fit because it sits in the middle of the polymorphism axis. The
recommendation is to deliberately blend three sub-shapes within a single MongoDB
collection (or two related collections) to maximise the polymorphism the demo
exercises:

(a) npm package metadata as one document family, with the natural variance across
`versions`, `dist-tags`, `repository`, and per-version fields. The
`registry.npmjs.org/<package>` document is up to ~10 MB of JSON with hoisted
fields, distribution tags, and per-version objects whose fields vary wildly
across packages.

(b) Advisories as a second family, including both structured CVE fields and
free-text descriptions, embedded with Voyage.

(c) Dependents-graph snapshots as a third family, with adjacency lists that
exercise lookup-style operations.

Store them in a single `entities` collection with a `kind` discriminator (the
JSON Schema `oneOf` pattern). This delivers schema variance, mid-million-document
scale, query diversity (similarity, traversal, advisory lookup, version
comparison), and a moderate update rate as new advisories and versions arrive.

Demo data target characteristics:

- **Schema variance**: 4 to 12 distinct discriminator values, each with at least
  10% presence in the collection, with at least 30% of documents having an
  optional field that 70% of documents lack.
- **Mid-scale size**: 100,000 to 5,000,000 documents.
- **Query diversity**: 5 to 20 distinct query shapes, with at least three
  requiring vector similarity (Voyage gets to do real work) and at least three
  requiring traversal (the procedure library captures composition).
- **Moderate update rate**: fast enough that schema fingerprints actually evolve
  during the demo (a new advisory appears, a new version is published), slow
  enough that the procedure library stabilises.
- **Latent emergence**: the right structure for the agent's view is not obvious
  from the raw data; the agent has to discover that combining metadata + advisory
  text + dependent counts answers "is this dependency safe", and that the
  canonical version of that procedure is reusable across tenants.
- **Tenant-specific divergence**: same underlying schema crystallises into
  different procedure libraries for different tenants, the demonstration that
  bends the divergence chart.
- **Competitor failure**: pick a corpus where the obvious alternative ("just
  write SQL against PostgreSQL" or "just dump the JSON in Postgres `jsonb`")
  visibly struggles. Supply-chain delivers this because the npm package-metadata
  document is genuinely 10 MB of nested structure with deep version histories
  and irregular per-version fields, and any naive relational ingestion either
  flattens it lossily or creates a dozen tables.

The corpus must *not* be drawn from a tightly-typed registry like a relational
stock ticker (no friction for the typed-FS story to overcome) and *not* from a
chaotic dump with no discoverable discriminator (the schema-fingerprint story
collapses). The goal is the messy middle, exactly where MongoDB lives in
production.

#### Prepared rebuttal: "Isn't this just SQL?"

Three points, in order.

Point one: text-to-SQL agents work because relational schemas are stable across
rows and SQL is densely represented in training data. Text-to-MQL agents are
measurably worse, **21.55% zero-shot on SM3** versus SQL's 47.05%, even after
EvoMQL fine-tuning at 76.6% / 83.1% versus Spider 1.0's ~91%. Code Mode with a
typed TypeScript surface is the workaround the field is converging on (Cloudflare
1.17M to ~1,000 tokens, Anthropic Tool Search Opus 4 +25 percentage points).
**AtlasFS is the application of that pattern to MongoDB collections.**

Point two: schema in AtlasFS is not pre-imposed, it is fingerprinted on read.
Iceberg v3 plus Delta Lake won the lakehouse argument with this principle at the
data-engineering layer; AtlasFS lifts it to the agent layer. Documents stay
polymorphic in BSON; the typed view is regenerated when the fingerprint changes;
JSON Schema `oneOf` (since MongoDB 3.2) expresses polymorphism faithfully as
a TypeScript discriminated union. Trying to force the data into Postgres `jsonb`
costs you both the operational ergonomics MongoDB customers buy Atlas for and
the native Voyage integration that Atlas now ships.

Point three: the procedure library is the per-tenant moat. SQL agents share
queries across customers; AtlasFS crystallises trajectories per tenant, so each
tenant's view is its own typed surface, refined by its own usage. This is the
equivalent of Glean's per-customer fine-tuned embedding model, expressed as code
rather than weights, with the auditability and determinism advantages that come
with code. Voyager and ASI establish that agent-induced procedure libraries do
work in domains where queries repeat; Berlot-Attwell's critique applies to math
reasoning where queries do not. AtlasFS's domain (a per-tenant search application
over a polymorphic operational store) is squarely in the regime where induction
works.

Close by inverting the question: **if a tenant's schema is so stable, so well
understood, and so regular that SQL solves the problem, that tenant probably does
not need AtlasFS.** AtlasFS is for the much larger middle, where the schema is
alive, the documents disagree, the embeddings carry semantic load, and the
procedure library is the only durable thing in the system. That is where
MongoDB customers live, that is where the document-store thesis is correct, and
that is where the schema-emergent argument earns its keep.

---

## Strengths

The integrated AtlasFS thesis is unusually robust because each leg is supported
by both prior art and recent measurements:

- **The conjunction is unclaimed.** 40 surveyed projects across ten target areas,
  none unifies three or four AtlasFS axes; ~80% confidence the system-level
  conjunction is novel.
- **The substrate is real and ready.** `$rankFusion` GA on 8.0+; `$vectorSearch`
  GA with Flat Indexes in Public Preview for multi-tenancy; the Atlas Embedding
  and Reranking API in Public Preview at `https://ai.mongodb.com/v1`; Voyage 4
  family with shared embedding space; 200M-token free tier per model.
- **The schema-emergent thesis maps to the right axis.** Document polymorphism +
  query repetition is the regime where MongoDB lives, and that is exactly the
  regime where trajectory crystallisation works (per Voyager and ASI), and where
  the Berlot-Attwell deflation does not apply.
- **The architectural moat is the aggregation pipeline.** $facet plus $rankFusion
  plus $lookup plus $graphLookup plus $vectorSearch plus $search in one pipeline
  collapses 4 to 8 ReAct turns into one optimization target. This is the part
  the official MCP server does not address and would have to ship a "code-mode
  mode" to claim.
- **Code-mode plus typed namespace is consensus.** Cloudflare 99.9% token reduction,
  Anthropic Opus 4 +25 percentage points on MCP evals, GitHub Copilot SKILL.md
  cross-agent compatibility (April 2026). The pattern is settled; the question
  is what the typed surface evolves into. AtlasFS's answer is "into a
  trajectory-crystallised procedure library compiled to aggregation pipelines."

---

## Limitations & Risks

- **Convergence by MongoDB itself.** The official MCP server has all the
  connection plus auth plus Voyage-on-insert primitives needed; a "code-mode
  mode" is a six-to-twelve-month away. Hackathon timing favours AtlasFS;
  post-hackathon, the team must ship the publishable measurement framework
  before MongoDB ships the same thing themselves.
- **Database-native auto-embedding via `query.text` is too unstable for the demo
  path.** Preview on Community 8.2+, Atlas access "coming soon." Build on the
  standalone Embedding API at `https://ai.mongodb.com/v1`.
- **Text-to-MQL is genuinely harder than text-to-SQL.** 21.55% zero-shot vs
  47.05% on SM3. Code-mode plus typed surface is the workaround, but the agent
  will still produce more incorrect drafts than a SQL agent would. The
  user-endorsement gate plus verifier-checked promotion is the structural
  defense; lean on it.
- **`$rankFusion` constraints are real.** Same collection only; no `$project`
  inside sub-pipelines; no time-series collections; pipeline names cannot be
  empty or contain `.`. The typed surface must surface these constraints.
- **`$scoreFusion` is Public Preview only on 8.2+.** Do not depend on it; the
  GA on 8.0 path uses `$rankFusion`.
- **Voyage RTEB benchmark numbers are vendor-reported and contested.** Independent
  reproduction is mixed. Pitch the integration architecture, not the leaderboard
  delta.
- **Sample-bias-driven codegen is the easy way to ship a typed surface that
  silently lies about 30% of documents.** Adaptive sampling with presence-frequency
  metadata is the mitigation; it is engineering work that must be done.
- **Cross-tenant codegen cache pollution is a multi-tenant correctness issue.**
  Per-tenant scoping is mandatory, mirroring Glean's per-customer isolation.
- **Atlas M10 sandbox (the hackathon cluster) does not include Search Nodes.**
  Search Node behaviour is a post-demo "what would you do at scale" slide, not
  the demo itself.
- **License verification on AgentFS pending.** No SPDX identifier in the GitHub
  metadata, license files exist in `licenses/`. Day 1 task per
  `kb/product-design.md` open-design-questions section.
- **Library Learning Doesn't (Berlot-Attwell 2024) is the strongest published
  attack on the pitch.** The user-endorsement gate is the structural answer;
  reuse rate must be reported as a first-class metric.

---

## Integration Analysis

### What to extract

From the **MongoDB substrate**:

1. **Standalone Embedding and Reranking API as the wrapping target.** Database-
   agnostic, in Public Preview, free-tier-funded for the hackathon, identical
   shape regardless of which Atlas cluster AtlasFS mounts. Wrap once, use
   everywhere.
2. **`$rankFusion` plus `$vectorSearch` plus `$search` in one pipeline** as the
   architectural moat. Lean into this in the pitch and the demo.
3. **Voyage 4 shared embedding space** as a typed feature. Index with
   `voyage-4-large`, query with `voyage-4-lite` for latency-sensitive paths.
4. **Change Streams as the schema-fingerprint invalidation signal**, not the
   inference signal. Resume tokens give cheap restart-after-crash.
5. **Flat Indexes plus View routing** for the multi-tenant story. Required for
   credibility on the "any Atlas cluster, mountable" pitch.
6. **JSON Schema `oneOf` polymorphic validation** lifted into TypeScript
   discriminated unions. The right typed encoding for polymorphic collections.
7. **mongodb-schema npm with adaptive sampling**, with presence-frequency
   metadata exposed in the generated TypeScript JSDoc.

From the **adjacent-projects survey**:

1. **AgentFS as the FileSystem interface.** Adopt as a primitive; author only
   `MongoFS` (~10 methods plugged into AgentFS's `FileSystem` interface).
2. **Cloudflare Code Mode pattern.** The static typed namespace plus single
   `runCode(snippet)` tool. AtlasFS specialises it to Atlas and adds the FS
   abstraction.
3. **ASI's verifier-checked promotion**, applied to AtlasFS's procedure
   crystallisation pipeline. Replay the procedure's final synthesised typed call
   against a held-out shadow input; compare to the trajectory's recorded result.
   Pass to promotion, fail to rejection-with-reason.
4. **Voyager's skill-library indexing-by-description-embedding**, for procedure
   retrieval on novel intents.
5. **Berlot-Attwell's reuse-rate metric**, as a first-class measurement axis to
   inoculate against the same deflation.

### Bootstrap path

The existing `kb/product-design.md` already specifies the bootstrap path. The
research findings above support its choices:

- Day 1: pre-register the eval, license-check AgentFS, set up the M10 cluster
  with the supply-chain corpus seeded with the three-family discriminator.
- Day 1: configure the Atlas Embedding API access, manual embedding path only.
- Day 2 morning: ship `MongoFS` as the FileSystem implementation, with adaptive
  sampling and presence-frequency metadata in JSDoc.
- Day 2 afternoon: ship the procedure crystallisation loop, the verifier shadow-
  input gate, the `$rankFusion` typed wrapper, and the cluster heatmap.
- Round 1 demo: 30s setup, 90s crystallisation moment, 60s deterministic-replay
  moment, 30s divergence chart.

### Effort estimate

**Medium** for a working demo (~1 day for `MongoFS`, ~1 day for the
crystallisation pipeline plus eval, ~half-day for the cluster heatmap and
demo polish). The substrate work (Atlas + Voyage configuration) is **Quick**
(<1h once the API key is provisioned). Hardening for non-hackathon use is
**Large** (>1 day) per `br/01`.

---

## Key Takeaways

1. **The conjunction is unclaimed at ~80% confidence.** Lead the pitch with the
   conjunction (typed FS + code-mode + trajectory-crystallised procedures
   compiled to aggregation pipelines + Voyage rerank), not with any single axis.
   Each piece has prior art; the thesis is in the assembly. Cite Voyager, ASI,
   Cloudflare Code Mode, AgentFS, hf-mount, and the official MongoDB MCP server
   explicitly as ancestors. Do not pretend to invent in a vacuum.

2. **Build on the Atlas Embedding API at `https://ai.mongodb.com/v1`, not on
   database-native auto-embedding.** The standalone API is in Public Preview,
   database-agnostic, free-tier-funded; auto-embedding via `query.text` is
   Preview on Community 8.2+ with Atlas access "coming soon" and is too unstable
   for the demo path. Wrap Voyage 4 + voyage-context-3 + voyage-multimodal-3.5 +
   rerank-2.5 once in a typed `voyage` namespace. Default to `voyage-4` for
   general-purpose, `voyage-context-3` for chunked content, `voyage-code-3` for
   the typed-TS procedure embeddings, `rerank-2.5` for post-retrieval.

3. **Reframe the pitch around schema-stability-across-queries, not
   structured-vs-unstructured.** MongoDB collections that are polymorphic across
   documents but stable across query intents are the regime where AtlasFS wins.
   The supply-chain risk corpus fits naturally if blended into three discriminator
   families (npm metadata, advisories, dependents). Trajectory crystallisation
   captures the *query shape*, not the *document shape*. This framing is the
   answer to both the "isn't this just SQL?" objection and the "MongoDB is for
   unstructured data" framing of the user's doubt.

4. **The aggregation-pipeline compile target is the most under-claimed and most
   defensible novelty.** No surveyed project compiles agent trajectories to
   `$rankFusion` + `$lookup` + `$facet` pipelines. ASI compiles to JS functions;
   Voyager to Minecraft skills; Vanna to retrieved SQL examples. AtlasFS's
   compile-to-pipeline budget worker is the part that takes the agent out of the
   hot path and the part that makes the divergence chart bend. Treat it as the
   load-bearing demo moment alongside the crystallisation flash.

---

## Sources

### MongoDB official docs and announcements

- [Announcing the MongoDB MCP Server](https://www.mongodb.com/company/blog/announcing-mongodb-mcp-server)
- [What's New in the MongoDB MCP Server: Winter 2026 Edition](https://www.mongodb.com/company/blog/product-release-announcements/whats-new-mongodb-mcp-server-winter-2026-edition)
- [MongoDB MCP Server tools reference](https://www.mongodb.com/docs/mcp-server/tools/)
- [GitHub: mongodb-js/mongodb-mcp-server](https://github.com/mongodb-js/mongodb-mcp-server)
- [GitHub: mongodb/agent-skills](https://github.com/mongodb/agent-skills)
- [Atlas Embedding and Reranking API documentation](https://www.mongodb.com/docs/api/doc/atlas-embedding-and-reranking-api/)
- [Embedding and Reranking API on MongoDB Atlas (Public Preview announcement)](https://www.mongodb.com/products/updates/now-in-public-preview-embedding-and-reranking-api-on-mongodb-atlas/)
- [Introducing the Embedding and Reranking API on MongoDB Atlas](https://www.mongodb.com/company/blog/product-release-announcements/introducing-the-embedding-and-reranking-api-on-mongodb-atlas)
- [Unlocking AI Search: Automated Embedding announcement](https://www.mongodb.com/company/blog/product-release-announcements/unlocking-ai-search-introducing-automated-embedding-in-mongodb-vector-search)
- [Auto-embeddings how-to](https://www.mongodb.com/docs/vector-search/crud-embeddings/create-embeddings-automatic/)
- [MongoDB Sets a New Standard for Retrieval Accuracy with Voyage 4 Models](https://investors.mongodb.com/news-releases/news-release-details/mongodb-sets-new-standard-retrieval-accuracy-voyage-4-models)
- [InfoQ: MongoDB Introduces Embedding and Reranking API on Atlas](https://www.infoq.com/news/2026/02/mongodb-embedding-reranking-api/)
- [$rankFusion (aggregation) docs](https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankfusion/)
- [$scoreFusion Public Preview announcement](https://www.mongodb.com/products/updates/public-preview-mongodb-native-hybrid-search-with-scorefusion/)
- [$scoreFusion docs](https://www.mongodb.com/docs/manual/reference/operator/aggregation/scorefusion/)
- [Boost Search Relevance With Native Hybrid Search](https://www.mongodb.com/company/blog/product-release-announcements/boost-search-relevance-mongodb-atlas-native-hybrid-search)
- [Native Hybrid Search in MongoDB Atlas with $rankFusion](https://www.mongodb.com/products/updates/public-preview-native-hybrid-search-in-mongodb-atlas-with-rankfusion/)
- [Announcing Hybrid Search support via $rankFusion](https://www.mongodb.com/community/forums/t/announcing-hybrid-search-support-via-rankfusion/324476)
- [$vectorSearch docs](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/)
- [Vector Quantization docs](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-quantization/)
- [Vector Search Changelog](https://www.mongodb.com/docs/atlas/atlas-vector-search/changelog/)
- [Auto-quantize with Voyage AI](https://www.mongodb.com/docs/vector-search/tutorials/auto-quantize-with-voyage-ai/)
- [Atlas Search Operators and Collectors](https://www.mongodb.com/docs/atlas/atlas-search/operators-and-collectors/)
- [Improved Multitenancy Support in Vector Search: Flat Indexes](https://www.mongodb.com/company/blog/product-release-announcements/improved-multitenancy-support-in-vector-search-introducing-flat-indexes)
- [Multi-Tenant Architecture for MongoDB Vector Search](https://www.mongodb.com/docs/atlas/atlas-vector-search/multi-tenant-architecture/)
- [Search Nodes infrastructure availability](https://www.mongodb.com/products/updates/available-now-search-nodes-dedicated-infrastructure/)
- [MongoDB Manage Clusters](https://www.mongodb.com/docs/atlas/manage-clusters/)
- [Sample Datasets](https://www.mongodb.com/docs/atlas/sample-data/)
- [Change Streams manual](https://www.mongodb.com/docs/manual/changestreams/)
- [Change Streams capabilities overview](https://www.mongodb.com/resources/products/capabilities/change-streams)
- [Polymorphic Schema Pattern docs](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/polymorphic-data/polymorphic-schema-pattern/)
- [Specify Validation for Polymorphic Collections](https://www.mongodb.com/docs/manual/core/schema-validation/specify-validation-polymorphic-collections/)
- [Schema Design Anti-Patterns](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/)
- [Bloated Documents anti-pattern](https://www.mongodb.com/developer/products/mongodb/schema-design-anti-pattern-bloated-documents/)
- [Compass Sampling docs](https://www.mongodb.com/docs/compass/current/sampling/)
- [Compass Schema Analyzer docs](https://www.mongodb.com/docs/compass/schema/)
- [npm: mongodb-schema](https://www.npmjs.com/package/mongodb-schema)
- [GitHub: mongodb-js/mongodb-schema](https://github.com/mongodb-js/mongodb-schema)
- [Mastra integration docs](https://www.mongodb.com/docs/atlas/ai-integrations/mastra/)
- [Introducing Text-to-MQL with LangChain](https://www.mongodb.com/company/blog/product-release-announcements/introducing-text-to-mql-langchain-query-mongodb-using-natural-language)
- [Natural-Language Agents: Text-to-MQL + LangChain](https://www.mongodb.com/company/blog/technical/natural-language-agents-mongodb-text-mql-langchain)
- [GitHub: mongodb-developer/mongodb-rag](https://github.com/mongodb-developer/mongodb-rag)
- [npm: mongodb-rag](https://www.npmjs.com/package/mongodb-rag)
- [GitHub: mongodb-partners/maap-framework](https://github.com/mongodb-partners/maap-framework)
- [Customer case study: Novo Nordisk](https://www.mongodb.com/solutions/customer-case-studies/novo-nordisk)
- [Customer case study: Delivery Hero Vector Search](https://www.mongodb.com/solutions/customer-case-studies/delivery-hero-vector-search)
- [Customer case study: Kovai](https://www.mongodb.com/solutions/customer-case-studies/kovai)
- [Blog: Building AI: VISO TRUST](https://www.mongodb.com/blog/post/building-ai-how-viso-trust-transforming-cyber-risk-intelligence)

### Voyage AI documentation

- [Voyage AI Pricing](https://docs.voyageai.com/docs/pricing)
- [Voyage AI Rate Limits](https://docs.voyageai.com/docs/rate-limits)
- [Models Overview](https://www.mongodb.com/docs/voyageai/models/)
- [Voyage AI by MongoDB landing](https://www.mongodb.com/products/platform/ai-search-and-retrieval)
- [voyage-context-3 announcement](https://blog.voyageai.com/2025/07/23/voyage-context-3/)
- [Contextualized Chunk Embeddings docs](https://docs.voyageai.com/docs/contextualized-chunk-embeddings)
- [Voyage Reranker API](https://docs.voyageai.com/reference/reranker-api)
- [RTEB introduction](https://thecerebralai.com/introducing-rteb/)
- [GitHub issue: Clarity and Fairness in RTEB](https://github.com/embeddings-benchmark/mteb/issues/3901)
- [Harvey + Voyage custom legal embeddings](https://www.harvey.ai/blog/harvey-partners-with-voyage-to-build-custom-legal-embeddings)

### Adjacent projects, primary sources

- [GitHub: tursodatabase/agentfs](https://github.com/tursodatabase/agentfs)
- [Turso AgentFS docs](https://docs.turso.tech/agentfs/introduction)
- [The Missing Abstraction: Agent Filesystem](https://turso.tech/blog/agentfs)
- [GitHub: huggingface/hf-mount](https://github.com/huggingface/hf-mount)
- [hf-mount changelog announcement](https://huggingface.co/changelog/hf-mount)
- [GitHub: xgerman/documentdbfuse](https://github.com/xgerman/documentdbfuse)
- [GitHub: gilles-degols/mongofs](https://github.com/gilles-degols/mongofs)
- [Cloudflare Blog: Code Mode](https://blog.cloudflare.com/code-mode/)
- [Cloudflare Blog: Code Mode entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)
- [Cloudflare Codemode reference docs](https://developers.cloudflare.com/agents/api-reference/codemode/)
- [npm: @cloudflare/codemode](https://www.npmjs.com/package/@cloudflare/codemode)
- [Anthropic: Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic: Equipping Agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Anthropic Memory Tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Anthropic Tool Search Tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [Tessl: Anthropic Tool Search](https://tessl.io/blog/anthropic-brings-mcp-tool-search-to-claude-code/)

### Academic and research papers

- [Voyager (Wang et al., 2023, arXiv:2305.16291)](https://arxiv.org/abs/2305.16291)
- [Voyager project page](https://voyager.minedojo.org/)
- [ASI: Agent Skill Induction (arXiv:2504.06821)](https://arxiv.org/abs/2504.06821)
- [GitHub: zorazrw/agent-skill-induction](https://github.com/zorazrw/agent-skill-induction)
- [Library Learning Doesn't (arXiv:2410.20274)](https://arxiv.org/abs/2410.20274)
- [LLM Library Learning Fails (arXiv:2504.03048)](https://arxiv.org/abs/2504.03048)
- [Cradle (arXiv:2403.03186)](https://arxiv.org/abs/2403.03186)
- [Draft-Refine-Optimize / EvoMQL (arXiv:2604.13045)](https://arxiv.org/abs/2604.13045)
- [Towards Data Science: Can LLMs talk SQL, SPARQL, Cypher, MQL equally?](https://towardsdatascience.com/can-llms-talk-sql-sparql-cypher-and-mongodb-query-language-mql-equally-well-a478f64cc769/)
- [CallSphere: Text-to-SQL benchmark roundup](https://callsphere.ai/blog/text-to-sql-evaluation-spider-bird-benchmarks-accuracy-testing)

### Schema-on-read and lakehouse references

- [Apache Iceberg v3 Public Preview on Databricks](https://www.databricks.com/blog/next-era-open-lakehouse-apache-icebergtm-v3-public-preview-databricks)
- [Databricks: Structured vs Unstructured Data](https://www.databricks.com/blog/structured-vs-unstructured-data)
- [Estuary: Structured vs Unstructured](https://estuary.dev/blog/structured-vs-unstructured-data/)

### Adjacent commercial products

- [GitHub: vanna-ai/vanna](https://github.com/vanna-ai/vanna)
- [Bedi: Self-improving Text2SQL](https://www.ashpreetbedi.com/articles/sql-agent)
- [Glean Data Flow Architecture](https://docs.glean.com/security/architecture/data-flow)
- [ZenML: Glean Custom Embedding Models](https://www.zenml.io/llmops-database/fine-tuning-custom-embedding-models-for-enterprise-search)
- [Sourcegraph Cody Codebase Understanding](https://sourcegraph.com/blog/how-cody-understands-your-codebase)
- [Outerbase](https://outerbase.com/)
- [LangChain + MongoDB partnership](https://www.langchain.com/blog/announcing-the-langchain-mongodb-partnership-the-ai-agent-stack-that-runs-on-the-database-you-already-trust)
- [Hex AI overview](https://learn.hex.tech/docs/getting-started/ai-overview)
