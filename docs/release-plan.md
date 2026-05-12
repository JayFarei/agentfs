# Datafetch release plan

> Audience: us, plus anyone who needs to understand what shipping
> datafetch looks like in concrete weeks-of-work units. This document
> covers two parallel tracks: making the project releasable as open
> source, and making it credibly useful to a paying client running a
> prototype.

## 1. Vision and positioning

Datafetch is a substrate for building learning agentic-search
interfaces over your own data. The pitch is one line:

> Agents that learn to use your data, your APIs, and your tools, and
> get cheaper and more accurate the more they are used.

The proof of that pitch is the SkillCraft eval (see
[`docs/proof-skillcraft.md`](./proof-skillcraft.md)). The substrate
exists today and the validation work is done. What is left is the
shape of the release, the boundary between open and commercial, and
the polish required to put it in someone else's hands.

### Who is it for

Primary user: an engineering team that has a useful dataset (CRM,
docs, support tickets, codebase, product catalog, internal SaaS,
operational metrics, whatever) and wants to expose an agentic-search
interface over it for their own users or internal tools.

Secondary user: a tool or product builder who wants to ship a
Datafetch-compatible mount as a way to make their product
agent-friendly with zero per-agent integration cost.

### What we are not

We are not competing with prompt-and-pray RAG libraries. We are not
trying to be the next LangChain. We are not building a hosted
all-in-one agent platform. Datafetch is substrate: a runtime, a
learning loop, a trust gate, an integration shape. The product on top
of it is what someone else builds with the substrate.

## 2. Current state, honestly

### What works today

- Snippet runtime with trajectory capture, timeout enforcement, host
  global injection, auto-invoke trailer.
- Hook registry with maturity / callability / quarantine semantics
  and per-tenant manifest storage.
- Observer that crystallises commit-phase trajectories into typed
  `df.lib` helpers.
- `df.*` proxy surface (`df.tool`, `df.db`, `df.lib`, `df.answer`,
  `df.run`).
- `pnpm datafetch:run` multi-turn probing affordance.
- Atlas mount, HuggingFace mount, publish mount, SkillCraft local-tool
  bridge.
- A reproducible end-to-end eval pipeline on the SkillCraft benchmark
  with 94.4% pass at 3,027 tokens per task.

### What is brittle or missing for a public release

- Eval harness is SkillCraft-coupled. Lives under `src/eval/` and
  `eval/skillcraft/` but the orchestration script encodes assumptions
  about SkillCraft tasks.
- No HTTP / MCP / server entrypoint. Everything is via the CLI eval
  harness today.
- No mount connectors for the cases most teams actually have:
  Parquet on disk, DuckDB, Postgres, an OpenAPI-described REST API,
  an MCP server.
- Snippet runtime sandboxing is minimal. It runs `tsx` in-process,
  with no resource isolation. Acceptable for an internal benchmark,
  not for running adversarial agent code in a multi-tenant server.
- No client SDK. A consumer has to call the CLI or hand-roll an HTTP
  client when the server exists.
- No public CI / external test discipline (the internal vitest suite
  is fine but is not set up to gate a release).
- Documentation assumes our internal context. The architecture doc and
  the eval doc shipped in this batch fix part of that; the rest is
  README-level.
- No security policy, no LICENSE clarity, no CONTRIBUTING guide, no
  code of conduct.
- No working `docker compose up` story.

## 3. Two-track plan

### Track A: open-source release as a prototype

This is the bar at which a developer can `git clone` the repo, follow
a README, and have a working datafetch instance running against their
own dataset within fifteen minutes.

#### Phase 0, prep (1-2 weeks)

- Decide on license. Apache 2.0 is the safe default for substrate
  projects that want commercial adoption.
- Move SkillCraft eval out of the top-of-mind path. Relocate to
  `examples/skillcraft/` with its own README. The main README should
  treat SkillCraft as one worked example, not the project's identity.
- Decide on the public API surface. Mark experimental boundaries
  with `internal` / `unstable` exports. The `df.*` runtime, the
  `MountAdapter` interface, the hook manifest shape, and the
  trajectory record format are the candidates for "stable".
- Repo hygiene: LICENSE, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md,
  CHANGELOG.md scaffold.
- Rewrite README. Lead with the substrate value, not with the demo.

#### Phase 1, bare prototype (2-3 weeks)

Goal: someone unfamiliar with the codebase can run datafetch against
their own Parquet or local JSONL file and get answers out.

- Implement a generic mount adapter for **DuckDB / Parquet / local
  JSONL**. This is the single best ROI connector: it covers analytics
  workloads, batch data, and ad-hoc datasets.
- Implement an HTTP server with one endpoint: `POST /v1/query`. Body
  is `{tenantId, query, datasetRefs[], sessionId?}`. Response streams
  trajectory updates and the final answer envelope as Server-Sent
  Events.
- Implement a CLI: `datafetch init` (scaffold a project), `datafetch
  serve` (run the HTTP server), `datafetch query "..."` (one-shot
  against the server).
- Write a second worked example end-to-end. Suggested: "Query the
  NYC taxi Parquet dataset via natural-language questions". Choose
  something whose ground truth a reader can verify themselves.
- Provide a `docker-compose.yml` that starts the server with a
  mounted volume for state and an example dataset preloaded.
- Bring CI online. Push the existing vitest suite to GitHub Actions.
  Add a smoke test that runs a tiny query end-to-end on every push.

Exit criteria: a stranger on the internet can follow the README and
get from `git clone` to a working query response in under fifteen
minutes.

#### Phase 1.5, soft launch (1 week)

- Publish to a public GitHub repo under the right org name.
- Cut a 0.1.0 release with tagged binaries and an npm publish of the
  client SDK.
- Write the launch post. Lead with the SkillCraft proof, not with
  features.
- Hacker News, Twitter, the relevant Slack communities, a tiny
  documentation site at datafetch.dev (or wherever the domain
  resolves).

### Track B: useful for a real client (running a prototype in production)

This is the bar at which we can hand the repo to a client's
infrastructure team and they can deploy it as part of a real product
without rewriting half of it.

Track B starts after Phase 1 of Track A is complete and runs in
parallel with Phase 1.5 of Track A. The features here are not blocking
for the OSS release; they unlock commercial use.

#### Phase 2a, deployment hardening (3 weeks)

- **Sandbox the snippet runtime.** Move `tsx` execution out of the
  server process, into a subprocess (or V8 isolate, but subprocess is
  the safer first hop). No host filesystem access except the episode
  workspace. No network except through `df.*` runtime. Enforce
  cgroup-level memory and CPU limits.
- **Per-tenant resource budgets.** Token budget, time budget, cost
  budget. Reject episodes that would exceed budget rather than failing
  mid-run.
- **Structured telemetry.** OpenTelemetry spans for each episode,
  structured logs for every hook invocation, metrics for pass rate /
  token usage / quarantine rate per tenant.
- **Authentication shape.** Bearer-token auth with tenant scoping.
  Pluggable backend so customers can wire SSO / their own user
  database.

#### Phase 2b, substrate maturity (3 weeks)

These are the items on the substrate roadmap that make the learning
loop reliable enough to leave running unattended at a client.

- **Smoke-replay gate.** When the observer authors a candidate
  helper, immediately replay it against the recorded trajectory
  inputs and require deep-equal of the recorded output. Promote to
  `validated-typescript` iff it matches. This closes the failure mode
  where a brittle helper crystallises and poisons future episodes.
- **Quality-gated `df.answer`.** When the answer-quality heuristic
  flags a low-confidence envelope in commit phase, refuse to commit
  it as `status: answered`. Force the agent to either iterate or
  commit `status: partial` / `status: unsupported`. Honest unsupported
  is preferable to confidently wrong.
- **Observed-only hooks.** Capture the calls the agent attempted on
  `df.lib.<name>` that did not exist, as `implementation.kind: none`
  hooks. This is the demand signal for the next set of helpers to
  author.
- **Iteration-warning observer.** Detect when the same shape is being
  rewritten across episodes without converging. This is a sign the
  helper is not generalising and the dataset shape itself may need
  to be revisited.

#### Phase 2c, ecosystem connectors (3-4 weeks, parallelisable)

Add mount connectors in priority order:

1. **Postgres** (read-only). Most internal datasets live here.
2. **HTTP / REST API with an OpenAPI spec**. Auto-generate a `df.tool`
   bundle from the spec, including auth shape.
3. **MCP server.** Already a near-universal agent integration point;
   accept any MCP server as a mount and expose its tools as a `df.tool`
   bundle.
4. **Pinecone / pgvector / Qdrant.** Vector DB mounts for `df.db`
   hybrid / similar / search methods.
5. **GraphQL.** Same shape as OpenAPI but introspection-driven.

Each connector ships as its own subpackage under `mounts/` so people
can take only what they need.

#### Phase 3, hosted commercial product (open ended)

Out of scope for the OSS release but worth marking as the direction:

- Managed dataset onboarding: someone uploads a CSV / SQL connection
  string / OpenAPI URL and gets a hosted Datafetch instance with the
  mount configured.
- Multi-region deployments with regional data residency.
- Marketplace of typed mounts. A third-party SaaS ships a Datafetch
  mount as an integration; their customers get an agent-ready surface
  for free.
- Observability dashboard: real-time view of every tenant's pass rate,
  quarantine list, token spend, helper reuse rate.
- SSO, audit logs, RBAC, on-prem deployment story for enterprise
  customers.

## 4. The server / client paradigm

For both Track A's HTTP server and Track B's hardened deployment, the
wire interface is the same simple shape:

### Wire protocol

```
POST /v1/query
Authorization: Bearer <tenant-scoped token>
Content-Type: application/json

{
  "tenantId": "...",
  "sessionId": "...",            # optional, threads multiple queries
  "datasetRefs": ["..."],        # which mounts to expose
  "query": "...",                # the user query
  "maxTokens": 10000,            # optional, per-episode budget
  "timeoutMs": 300000            # optional, per-episode budget
}
```

Response is `text/event-stream`:

```
event: trajectory
data: {"call": "df.tool.docs.search", "input": {...}, "output": {...}}

event: trajectory
data: {"call": "df.lib.summarise_week", "input": {...}, "output": {...}}

event: answer
data: {"status": "answered", "value": {...}, "evidence": [...]}
```

The streaming trace is part of the value: a downstream UI can render
the agent's reasoning in real time, and an SRE can read the same trace
to debug failures.

### Client SDK shape

A thin TypeScript client wraps the HTTP API:

```ts
const client = new DatafetchClient({ url, token, tenantId });
for await (const event of client.query({
  datasetRefs: ["support_tickets"],
  query: "Why are M3 customers churning this month?",
})) {
  if (event.type === "trajectory") render(event);
  if (event.type === "answer") show(event);
}
```

A Python client follows the same shape using `httpx`'s SSE support.
The Python client matters because Datafetch will live alongside data-
science tooling more often than not.

### Why server / client and not a library

Three reasons.

1. **The substrate has state.** Hooks, trajectories, learned helpers.
   Co-locating that state with a process the client controls is fine
   for development, miserable for production. The server / client
   split makes the state-bearing component a deployment unit.
2. **Tenant isolation needs an enforcement boundary.** A library
   embedded in a customer's process gives them no isolation from
   each other. A server process gives us a place to enforce auth and
   budgets.
3. **The agent code runs untrusted TypeScript.** That belongs behind a
   process boundary, sandboxed, not in the caller's process.

## 5. Open-source posture

### License

Apache 2.0. Permissive enough to encourage adoption, with a patent
clause that protects contributors. MIT is also viable but has weaker
patent protection.

### Open core, hosted commercial

Everything in this document's Tracks A and B is open. The commercial
product in Phase 3 (hosted dataset onboarding, marketplace,
observability dashboard, SSO, audit logs, enterprise support) is
proprietary. This is the standard substrate-OSS playbook (think:
Supabase, ClickHouse, dbt, MongoDB), and it works specifically because
the open project is genuinely useful on its own.

### Governance

For 0.1.x: BDFL model, us holding direction. Move to a more open
governance model (steering committee, technical RFC process) once
external contributions are non-trivial.

### Community shape

- GitHub repo: issues + discussions, no Discord for now (smaller
  surface area is better at this stage).
- Documentation site at the project domain.
- A monthly "what we shipped" post for the first six months. Cadence
  matters more than length.

## 6. Risks and mitigations

| risk | mitigation |
|---|---|
| Snippet runtime sandbox escape, agent runs malicious code on the host | Phase 2a sandboxing is non-negotiable for the hosted path. For the OSS prototype, the README explicitly states that the in-process runtime is for local development, not for running untrusted agent code. |
| LLM provider lock-in (we work best with prompt caching) | Keep the agent driver pluggable (already true). Document the cost story honestly: prompt caching is a 4-10x multiplier; without it, expect higher per-query token spend but the substrate-level wins on accuracy and reuse still apply. |
| Differentiation versus MCP | Datafetch is more than MCP. MCP exposes tools to an agent; Datafetch adds learning, trust, auditability, and a code-mode probing surface. The positioning is "MCP makes a tool agent-callable; Datafetch makes a dataset agent-learnable." We accept MCP servers as mounts as the strongest interoperability signal. |
| Cache-as-skill agent frameworks claim the same value prop | Our SkillCraft numbers are public and reproducible. The eval doc leads with the comparison. The substrate-level invariants (typed helpers, registry trust gate, deterministic reuse) are not what those frameworks do. |
| Open core boundary moves on us later | Pick the substrate / hosted split early and stick to it. Substrate stays open. Hosted is the monetization vehicle. Do not start adding "enterprise" features to the open core. |

## 7. Concrete next-week shopping list

If we had a Monday to start with, the actionable list:

1. Pick the license, write LICENSE, write SECURITY.md.
2. Move SkillCraft eval to `examples/skillcraft/`. Rewrite top-level
   README around the substrate.
3. Scaffold a DuckDB / Parquet mount adapter under `mounts/duckdb/`.
4. Sketch the `POST /v1/query` server entry point at `src/server/`.
5. Sketch the CLI: `bin/datafetch`.
6. Write a second worked example (NYC taxi or similar) end to end.

That is roughly two weeks of focused work for one developer, four to
five days if two people pair on it. By the end of that, we have
something that earns Hacker News attention rather than just being
shown to friends.

## 8. Timeline summary

| phase | track | duration | exits with |
|---|---|---|---|
| 0 | A | 1-2 weeks | Repo hygiene, license, README rewrite, SkillCraft moved to examples |
| 1 | A | 2-3 weeks | DuckDB mount, HTTP server, CLI, second example, Docker compose, CI |
| 1.5 | A | 1 week | Public 0.1.0 release, launch post |
| 2a | B | 3 weeks | Sandboxed runtime, per-tenant budgets, telemetry, auth |
| 2b | B | 3 weeks | Smoke-replay gate, quality-gated df.answer, observed hooks |
| 2c | B | 3-4 weeks (parallel) | Postgres / OpenAPI / MCP / vector / GraphQL connectors |
| 3 | commercial | open ended | Hosted product |

Track A's Phase 0 through 1.5 is **roughly six weeks calendar time** to a
credible public OSS release. Track B's Phases 2a/b/c overlap with the
public launch and run another **two months calendar time** before we
can put the substrate in a paying client's hands with a straight face.

## 9. Definition of done

For the OSS release (0.1.0):

- License, README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT in place.
- Two worked examples end to end, neither of them SkillCraft-specific.
- `docker compose up` brings up a working server with a preloaded
  dataset, queryable in under five minutes from clone.
- TypeScript client SDK published to npm.
- Documentation site live.
- CI green on every PR.
- A reproducible eval result (the SkillCraft headline) checked in and
  linked from the README.

For "useful to a client running a prototype":

- Sandboxed snippet runtime out of the server process.
- Per-tenant auth, budgets, and tenant-scoped state isolation enforced.
- Smoke-replay gate and quality-gated `df.answer` shipped.
- One real-world mount connector beyond DuckDB (probably Postgres or
  OpenAPI).
- Operational runbook (deployment, monitoring, common failure modes,
  upgrade path).
- A client-grade SLO target: 99% of episodes complete within their
  budget, 95% of completed episodes return `status: answered`,
  quarantine rate below 5%.
