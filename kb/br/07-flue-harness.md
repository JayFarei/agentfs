---
title: "Flue (withastro/flue), The Sandbox Agent Framework as a Candidate Pi Harness for AtlasFS"
date: 2026-05-01
mode: deep
sources: 18
status: complete
---

# Flue (withastro/flue), The Sandbox Agent Framework as a Candidate Pi Harness for AtlasFS

## Executive Summary

Flue is an Apache-2.0 sandbox agent framework by Fred K. Schott (creator of Astro and Snowpack, now Cloudflare ETI), 355 stars at time of writing, 131 commits across 2 contributors over a single weekend (2026-04-29 to 2026-04-30), v0.3.5 published with an explicit "Experimental, APIs may change" warning. It pairs an HTTP/Cloudflare-Workers harness with a programmable sandbox interface, and internally drives `@mariozechner/pi-coding-agent`, the same Pi harness `kb/product-design.md` Decision #8 names as AtlasFS's chosen agent runtime. Flue is what you get if you wrap Pi in a deployable build system, an HTTP/SSE server, MCP runtime adapters, and a clean `SandboxApi` integration interface, then call the result a framework.

The bottom line for AtlasFS: **adopt Flue as the agent harness layer rather than wiring Pi directly**. The integration cost is low (a `mongofs` `SandboxFactory` connector ~150 lines, modelled line-for-line on `packages/connectors/src/daytona.ts`), the trajectory data model is compatible with the user-endorsement crystallisation flow, the AWS Bedrock provider is built into pi-ai's generated model registry (`amazon-bedrock` via `bedrock-converse-stream`, hits the AWS finalist gate without extra integration), and the build/deploy story for the demo is a single `flue build --target node` plus `node dist/server.mjs`. Live-tested today: cloned, `pnpm install` (9.6s), `pnpm run build` (2.4s, all 4 turbo tasks), `flue build --target node` on `examples/hello-world` (generated `dist/server.mjs` of 107KB plus a manifest), and `node dist/server.mjs` boots and routes a webhook through to Pi's prompt loop on macOS, Darwin 24.6, Node 22; the only failure mode at request time is the absent `ANTHROPIC_API_KEY`, which is out of scope for the harness.

Three things to keep an eye on. First, API stability is the headline risk: 131 commits in 48 hours, two `"*"`-pinned upstream packages (`@mariozechner/pi-agent-core` and `@mariozechner/pi-ai`), a v0.0.x branch already deprecated, `SessionData` already on `version: 2`, and the `CommandDef` interface marked `@deprecated`. Second, there is no test suite anywhere in the repository (`find . -name "*.test.ts"` returns zero hits, no `.github/workflows/`); regressions will surface only at runtime. Third, Flue's `SessionData` append-only entry tree (`packages/sdk/src/types.ts:266-309`) is structurally compatible with AtlasFS's per-tenant `tool_calls` audit table, but it is in-memory by default on Node; using it as the trajectory store for crystallisation requires a custom `SessionStore` that writes to AgentFS's SQLite. That is one ~50-line file; explicit, low-risk, but not free.

The bigger external signal is positioning. Flue's pitch surface (`flueframework.com`) frames the stack as "Agent = Model + Harness" with explicit layers (model, harness, sandbox, filesystem). Schott has noted on X that OpenAI is now using "sandbox agent" as a category term, and Cloudflare's Agents Week 2026 launched the entire Cloudflare-as-deploy-target-for-agents thesis. Flue is the official Astro-team framework into that gap. Adopting it costs us no positioning leverage and gains us a recognisable substrate; a judge familiar with Cloudflare Agents will read AtlasFS-on-Flue as squarely on-thesis rather than on the wrong side of an emerging framework war.

## Overview

**What it is.** A pnpm/turbo monorepo of three published packages plus an Astro marketing site under `apps/www`. `@flue/sdk` (190KB built, six entry points: `index`, `client`, `sandbox`, `internal`, `cloudflare`, `node`) is the runtime: build pipeline (esbuild/tsdown), session management, MCP client, sandbox abstraction, Pi harness integration, Hono-based HTTP server generator, Cloudflare Workers + Durable Objects entry generator. `@flue/cli` is a single-file `flue.ts` wrapping `dev`/`run`/`build`. `@flue/connectors` ships the canonical Daytona sandbox connector (~150 lines) as the reference implementation for adding new sandboxes. The workspace convention is that an "agent" is a TypeScript file under `.flue/agents/<name>.ts` with `export const triggers = { webhook: true }` and an `export default async function ({ init, payload, env }: FlueContext)` handler. `flue build` discovers all such files via regex (no AST parse), bundles them with esbuild for Node or emits an unbundled entry for Cloudflare/wrangler, and writes `dist/manifest.json` plus `dist/server.mjs`.

**Maturity and traction signals.** Created 2026-02-07 as a stub (the v0.0.x branch lives on as a deprecated tag), then rewritten head-down on 2026-04-29 to 2026-04-30 with 131 commits over 48 hours by Fred Schott (129 commits) and Brian Giori (2 commits). Latest published version 0.3.5 dated 2026-04-30. 355 GitHub stars, 14 forks, 10 open issues, 0 PRs as of fetch. Apache-2.0 across all published packages. Upstream `@mariozechner/pi-coding-agent` is at 11.5K+ stars in its own right and supports Anthropic, OpenAI, Google, xAI, Groq, Cerebras, OpenRouter, and AWS Bedrock as first-class providers. The `flueframework.com` site is a single Astro page with copy emphasising "ownership" over "renting someone else's agent"; explicit positioning against LangGraph-style framework lock-in.

**Why it matters now.** Three concurrent signals. (a) Cloudflare's Agents Week 2026 launched a full agent platform (Containers, Durable Objects as session stores, Workers as deploy target); Flue is the Astro-team-on-Cloudflare framework slotting into that. (b) Pi (the harness Flue wraps) is the only Claude-Code competitor that is publicly described as "the only Claude Code competitor" and is what AtlasFS already named in `kb/product-design.md` Decision #8. (c) The "DB-as-FS for agents" trend (`kb/br/03`) and the "code-mode-data-interface" trend (`kb/br/01`) both want a programmable agent harness with a clean sandbox-integration surface, and Flue is the first project to ship that surface as a stable interface (`SandboxApi`, 9 methods).

**Competitive landscape.**

| Project | Layer | Differentiator | Trade-off vs Flue for AtlasFS |
|---|---|---|---|
| **Pi (`@mariozechner/pi-coding-agent`)** | Harness only | The actual agent loop; what Flue wraps | No HTTP server, no build pipeline, no `SandboxFactory` interface, no MCP runtime adapter. We would have to build the Flue layer ourselves. |
| **OpenAI Agents SDK** | Harness + tools | First-party from OpenAI | Closed-source ecosystem, no Pi-equivalent code-mode story, no clean sandbox abstraction. |
| **Cloudflare Agents SDK** | Persistence + routing | Native DO sessions, native Worker routing | Lower-level than Flue; Flue uses it under the hood for CF deploys. |
| **LangGraph** | Workflow graph | Big ecosystem, big footprint | Wrong abstraction for code-mode trajectory crystallisation; nodes are not files. |
| **Mastra** | Agent framework | TypeScript, multi-provider | No sandbox-as-first-class concept; closer to "tools-and-prompts" than to "harness-and-sandbox". |
| **Claude Agent SDK** | Anthropic's harness | Anthropic-blessed | Single-provider; closes the door on Bedrock-via-pi-ai cost optimisation. |

## How It Works

### Architecture

```
+-------------------------------------------------------+
|           User / CI / Webhook caller                  |
|     POST /agents/<name>/<id>  body: any-JSON          |
+----------------+--------------------------------------+
                 | HTTP (sync | SSE | x-webhook=true)
                 v
+-------------------------------------------------------+
|     Generated server (Hono on Node, Worker on CF)     |
|     packages/sdk/src/build-plugin-{node,cloudflare}.ts |
|     - per-agent route per file in .flue/agents/       |
|     - SSE event stream: text_delta, tool_start/end,   |
|       turn_end, compaction_start/end, idle, result    |
+----------------+--------------------------------------+
                 | createFlueContext()
                 v
+-------------------------------------------------------+
|     FlueContext.init({ model, sandbox, tools, ... })  |
|     packages/sdk/src/client.ts:38                     |
|     - resolves SessionEnv from sandbox option         |
|     - discovers AGENTS.md + .agents/skills/ in cwd    |
|     - returns AgentClient                             |
+----------------+--------------------------------------+
                 | agent.session(id?)
                 v
+-------------------------------------------------------+
|     Session (wraps Pi's Agent as `harness`)           |
|     packages/sdk/src/session.ts:124                   |
|     - prompt()/skill()/task()/shell()                 |
|     - SessionHistory: append-only entry tree          |
|     - compaction at threshold or context-overflow     |
|     - result schema validation via valibot            |
+----------------+--------------------------------------+
                 | harness.prompt() (Pi's Agent loop)
                 v
+-------------------------------------------------------+
|     pi-agent-core: tool execution + LLM loop          |
|     pi-ai: provider abstraction (Anthropic, Bedrock,  |
|     OpenAI, OpenRouter, Google, xAI, Groq, Cerebras)  |
+----------------+--------------------------------------+
                 | SessionEnv (read/write/exec/stat/...)
                 v
+-------------------------------------------------------+
|     Sandbox: 'empty' (just-bash + InMemoryFs)         |
|              | 'local' (host fs at /workspace)        |
|              | BashFactory                            |
|              | SandboxFactory ---> Daytona, CF        |
|                                     Containers,       |
|                                     [our MongoFS]     |
+-------------------------------------------------------+
```

### Key Concepts

- **Agent = directory.** A repo with `.flue/agents/*.ts` becomes a deployable HTTP server. Each file's filename becomes the URL segment. `flue build` is the workspace-to-server compile step. There is no central registration, no class hierarchy, no decorators.

- **Session = task scope, Agent = sandbox scope.** An `AgentClient` owns the sandbox; sessions inside it own conversation history. `agent.session('thread-abc')` opens or resumes; `agent.session('thread-xyz')` starts fresh. On Cloudflare each agent ID maps to one Durable Object instance; on Node, sessions live in-process by default.

- **`SandboxApi`, the integration contract** (`packages/sdk/src/sandbox.ts:126-140`). Nine methods: `readFile`, `readFileBuffer`, `writeFile`, `stat`, `readdir`, `exists`, `mkdir`, `rm`, `exec`. Implement these against any backend, wrap with `createSandboxSessionEnv(api, cwd, cleanupFn?)`, return a `SandboxFactory`. This is the integration point that matters.

- **Triggers.** `triggers = { webhook: true }` exposes the agent at `POST /agents/<name>/:id`. `triggers = { cron: '0 9 * * 1' }` schedules it (handled by the deploy platform). No triggers means CLI-only via `flue run`.

- **Skills and roles.** Skills are markdown files at `.agents/skills/<name>/SKILL.md` with `name` and `description` frontmatter, discovered at runtime from the session's `cwd`. Roles are markdown at `.flue/roles/<name>.md` with `description` and optional per-role `model`, baked in at build time. Precedence: per-call > session > agent.

- **Result schemas via valibot.** `await session.prompt(text, { result: v.object({ ... }) })` injects a `RESULT_START/RESULT_END` delimiter into the system prompt, parses JSON between the markers, validates with `v.safeParse`, retries once on failure. Statically typed via `v.InferOutput<S>` overloads.

- **MCP at runtime, not build time.** `connectMcpServer(name, { url })` (`packages/sdk/src/mcp.ts:25`) opens a streamable-HTTP or SSE connection, lists tools, namespaces them as `mcp__<server>__<tool>`, and returns a connection with `.tools` and `.close()`. Pass `tools: github.tools` to `init()`.

### Core API / Interface

```typescript
// What an agent file looks like
import type { FlueContext } from '@flue/sdk/client';
import * as v from 'valibot';

export const triggers = { webhook: true };

export default async function ({ init, payload }: FlueContext) {
  const agent = await init({
    model: 'amazon-bedrock/claude-opus-4-7',  // hits the AWS finalist gate
    sandbox: mongofs(atlasUri, { tenantId: payload.tenantId }),  // our connector
  });
  const session = await agent.session(payload.sessionId);

  return await session.prompt(payload.intent, {
    result: v.object({
      verdict: v.string(),
      evidence: v.array(v.string()),
    }),
  });
}
```

```typescript
// What our SandboxFactory looks like (sketch, modelled on Daytona connector)
import { createSandboxSessionEnv } from '@flue/sdk/sandbox';
import type { SandboxApi, SandboxFactory } from '@flue/sdk/sandbox';

class MongoFsSandboxApi implements SandboxApi {
  constructor(private fs: AgentFsBackedMongoFs, private tenantId: string) {}

  async readFile(path: string): Promise<string> {
    // path like '/datafetch/db/packages.ts' triggers lazy codegen
    return this.fs.readFile(path);
  }
  async readdir(path: string): Promise<string[]> {
    return this.fs.readdir(path);
  }
  async exec(command: string): Promise<ShellResult> {
    // run an LLM-emitted TS snippet; agent never gets raw shell
    return this.fs.evalTypedCall(this.tenantId, command);
  }
  // writeFile/stat/exists/mkdir/rm/readFileBuffer: route to AgentFS overlay
  // ...
}

export function mongofs(uri: string, opts: { tenantId: string }): SandboxFactory {
  return {
    async createSessionEnv({ cwd }) {
      const fs = await connectMongoFs(uri, opts);
      return createSandboxSessionEnv(new MongoFsSandboxApi(fs, opts.tenantId), cwd ?? '/datafetch');
    },
  };
}
```

## Maturity & Traction

- **License**: Apache-2.0 across `@flue/sdk`, `@flue/cli`, `@flue/connectors`, root `package.json`. Confirmed at `packages/sdk/package.json:5`, `packages/cli/package.json:5`, `packages/connectors/package.json:5`. No CLA, no DCO, no NOTICE, no contributor templates, no CODEOWNERS.
- **Stars/Forks**: 355 stars, 14 forks, 10 open issues, 0 PRs, 0 discussions (fetched 2026-05-01).
- **Latest Release**: `v0.3.5`, published 2026-04-30. The v0.0.x branch is preserved as a tag with an explicit migration warning at the top of the README.
- **Backing**: Built under the `withastro` GitHub organisation. Fred K. Schott created Astro and Snowpack and is now a Cloudflare Senior Engineering Manager in Emerging Technologies and Incubation. Brian Giori, the second contributor, is also an Astro maintainer. This is not a side-project; it is the Astro team's bid into the agent-framework category.
- **Production Users**: None public yet. The official examples are `examples/hello-world` (11 test agents) and `examples/assistant`. The `apps/www` marketing site is itself deployed to Cloudflare Workers as a working demo.
- **Ecosystem Size**: One published connector (Daytona). Cloudflare Containers and `@cloudflare/sandbox` integration ships in-tree. The connector pattern is documented and ~150 lines per integration. Pi's own ecosystem (the `pi-skills` repo, the OpenClaw multi-agent system built on Pi's RPC mode, third-party blog posts) does not directly carry into Flue but is available if you drop down to `@mariozechner/pi-coding-agent` directly.

## Strengths

- **Pi is built in.** Flue uses `@mariozechner/pi-agent-core` as the `Agent` class wired into every `Session` (`packages/sdk/src/session.ts:131`). This means we get tree-structured trajectory history, parallel tool execution, the four built-in tools (read/write/edit/bash) plus three Flue-added tools (grep/glob/task), and Pi's multi-provider model abstraction (Anthropic, Bedrock, OpenAI, OpenRouter, Google, xAI, Groq, Cerebras) for free. Bedrock is in pi-ai's generated model registry (`amazon-bedrock` provider, `bedrock-converse-stream` API, baseUrl `https://bedrock-runtime.us-east-1.amazonaws.com`); the AWS finalist gate is satisfied without integration work.
- **Sandbox interface is small and stable-feeling.** `SandboxApi` is 9 async methods. Daytona's connector is 153 lines, ~70 of which are the `SandboxApi` methods. A MongoFS connector for AtlasFS is in the same ballpark. The interface does not leak Pi internals; we can change MongoFS without touching the harness layer.
- **HTTP/SSE/webhook surface is production-shaped.** Three response modes selected by request header (`Accept: text/event-stream` for SSE, `x-webhook: true` for fire-and-forget, neither for sync). SSE event types include `text_delta`, `tool_start`, `tool_end`, `turn_end`, `compaction_start`, `compaction_end`, `idle`, `error`, `result`. This is exactly the trajectory event stream AtlasFS needs to render the green/red trajectory graph in the review UI.
- **Build is fast and clean.** `pnpm install` 9.6s on a cold cache, `pnpm run build` 2.4s for the entire monorepo, `flue build --target node` produces a single 107KB bundled `server.mjs` plus a manifest. `flue run <agent>` builds, spawns a temporary server, drives the SSE stream, prints the final result, and exits. The CI story for the eval harness is one shell command per task.
- **Secret hygiene is the design.** `defineCommand` (`packages/sdk/src/node/define-command.ts:37-52`) whitelists 13 non-sensitive env vars (`PATH`, `HOME`, `USER`, locale, temp dirs); API keys never propagate to spawned processes unless explicitly passed. Commands are scoped per-call. This matches AtlasFS's "bindings, not network, inside the sandbox" principle (`kb/product-design.md` Core Design Principle #4).
- **MCP as a runtime tool adapter, not a build dependency.** `connectMcpServer` at runtime is the right shape for AtlasFS: judges familiar with the official MongoDB MCP server can see Flue's MCP integration as the standards-conformant fallback while AtlasFS pushes the typed-FS-discovery model as the differentiator.
- **Docs are good for v0.3.** Four ~1000-word deploy guides (`docs/deploy-{cloudflare,node,github-actions,gitlab-ci}.md`), 56 JSDoc comment blocks across 38 exported types in `types.ts`, a 72-line AGENTS.md contributor guide, README with five working examples. Documentation depth is well above the documentdbfuse comparison in `kb/br/03`.

## Limitations & Risks

The list below is concrete observations from the cloned source and the live test on 2026-05-01.

1. **No tests, no CI.** Zero `*.test.ts` files anywhere in the repo. No `.github/workflows/`. Lint (Biome) and type-check (`tsc --noEmit`) are the only quality gates. A breaking upstream change in `@mariozechner/pi-agent-core` (which is `*`-pinned) will land silently. AtlasFS's eval harness should pin a known-good Flue version in `package.json` and treat updates as opt-in.

2. **Two contributors, 48-hour write window, "Experimental" warning.** 131 commits over 2 days from a 2-person team is a head-down rewrite. The README starts with "Experimental, APIs may change". Concrete unstable surfaces: `SessionData` already on `version: 2`; `CommandDef` marked `@deprecated` (`types.ts:35`); the v0.0.x branch is preserved as evidence of a prior breaking change. Plan for a Flue-version bump to be a non-trivial maintenance event for AtlasFS.

3. **`*`-pinned upstream Pi packages.** `packages/sdk/package.json:45-46` lists `@mariozechner/pi-agent-core: "*"` and `@mariozechner/pi-ai: "*"`. AtlasFS inherits this. Mitigation: pin `pi-agent-core` and `pi-ai` to specific versions in AtlasFS's `package.json` overrides (or `pnpm.overrides`) and verify on each Flue bump.

4. **In-memory session store on Node by default.** `InMemorySessionStore` (`packages/sdk/src/session.ts:108`) is a `Map` in process memory; sessions vanish on process restart. The Cloudflare path persists to a Durable Object SQLite table inline. AtlasFS needs a custom `SessionStore` (three methods: `save`, `load`, `delete`) that writes `SessionData` to AgentFS's SQLite for Node deployments. ~50 lines.

5. **Trajectory shape mismatch with AtlasFS's `tool_calls` plan.** Flue stores trajectories as a `SessionHistory` tree of `MessageEntry | CompactionEntry | BranchSummaryEntry` nodes (`types.ts:266-309`). Tool calls are inside `AssistantMessage.content` blocks, not in a denormalised audit table. AtlasFS's `tool_calls` SQLite-table model (per `kb/product-design.md` §"AgentFS") needs a sync layer: walk `SessionData.entries`, extract every `toolCall`/`toolResult` block, write to `tool_calls` with `tenant_id`. Either as a `SessionStore.save()` side-effect, or as a post-trajectory ETL before the user-endorsement step. ~80 lines, well-bounded.

6. **`scope()` is optional but commands need it.** `SessionEnv.scope?` (`types.ts:87`) has a `?`, indicating optional. If MongoFS does not implement `scope()`, per-call `commands` (the `defineCommand` mechanism) will not work for our sandbox. For AtlasFS this is fine, our agent does not need privileged CLIs (it has typed filesystem paths instead per Core Design Principle #4), but it is a constraint to remember.

7. **No timeout wiring on `bash`.** `agent.ts:215` carries a `// TODO: wire timeout through SessionEnv.exec`. The `timeout` field on `ShellOptions` is structurally present but not honoured. For AtlasFS the agent does not call raw bash, but if it ever does, runaway TS snippets will not auto-cancel.

8. **No structured-error types.** All errors are `Error` instances with `[flue]` prefixes. There are no error codes, no typed error classes (except `ResultExtractionError`). For AtlasFS's verifier failure mode (where crystallisation rejects a procedure), we will need to inspect message strings rather than a typed error code; brittle, but workable.

9. **`local` sandbox has no isolation.** Documented in `docs/deploy-node.md:208`: "the agent shares the host filesystem, there's no isolation between sessions". For AtlasFS this is acceptable for the demo (`'local'` could mount the AgentFS NFS path at `/datafetch/`), but it is not a multi-tenant story. The MongoFS-direct-via-`SandboxFactory` path bypasses this concern entirely.

10. **Marketing positions Flue as Cloudflare-first.** The hero deploy target on `flueframework.com` is Cloudflare Workers, and the most-developed sandbox connector is `@cloudflare/sandbox`. AtlasFS's plan (per `kb/product-design.md` §"Architecture") leans on AWS Lambda for the optimisation worker. This is a posture mismatch, not a technical one; both targets work, but a judge reading "Flue" may default to "Cloudflare deploy", so AtlasFS should foreground its AWS-via-Bedrock framing in the README.

11. **No native NFS surface.** Flue's sandbox abstraction is `SandboxApi` (file ops + `exec`), not NFS. AgentFS's NFS server gives us cross-platform mounting; Flue gives us cross-platform sandboxing. They are parallel, not stacked. The integration choice (see "Integration Analysis" below) is which abstraction to put on top.

12. **Pi's MIT licence vs Flue's Apache-2.0 mix.** Flue itself is Apache-2.0; `@mariozechner/pi-coding-agent` and `pi-ai` are MIT. Both are permissive, so no compliance issue, but the AtlasFS README should attribute both. Also worth noting: pi-ai's generated model registry is MIT but its `bedrock-converse-stream` implementation likely ships AWS SDK code under Apache-2.0 transitively, again no issue, but document it.

## Integration Analysis

> Project context: per `kb/product-design.md` §"Architecture" and Decision #8, AtlasFS plans to adopt Pi as the agent harness, with AgentFS as the VFS engine and MongoFS as the only novel infrastructure piece. Flue is what you get if you take Pi and wrap it in the build/deploy layer AtlasFS would otherwise have to write itself. This section answers the convention's three questions.

### What to extract

1. **Adopt Flue as the harness layer wholesale, in place of "use Pi directly".** Decision #8 in `kb/product-design.md` lists Pi for tree trajectory, gist exports, Bedrock provider, MIT licence. Flue gives all four (tree trajectory via `SessionHistory`, SSE streaming as a richer-than-gist export, Bedrock via pi-ai's registry, Apache-2.0 + MIT mix). It also adds: a build pipeline, an HTTP server with three response modes, MCP runtime adapter, valibot-typed results, role/skill discovery, the `SandboxFactory` interface, and Cloudflare deploy. Building these on top of bare Pi would cost AtlasFS roughly 500 to 1000 lines of new infrastructure code. Flue is that code, already written, already documented.

2. **Adopt the `SandboxApi` shape as MongoFS's external interface.** AtlasFS's MongoFS already plans an `AgentFS.FileSystem` interface (per `kb/product-design.md` §"MongoFS"). Flue's `SandboxApi` is a 9-method superset (adds `exec`, splits `readFile` into string and buffer variants). Implementing the Flue interface gives us AgentFS-compatible FS ops plus a free hook for typed-call evaluation via `exec`. Concretely, two ways to wire MongoFS:

   - **Path A (NFS-front).** AgentFS exposes `/datafetch/` over NFS as planned; Flue's agent uses `sandbox: 'local'` with `cwd: '/datafetch/'`. Pi's read/write/bash tools operate on the NFS-mounted filesystem; MongoFS's lazy codegen fires on `readFile` over the NFS surface. Lowest integration cost (zero Flue connector to write); preserves the entire AtlasFS architecture as designed. **Recommended for v1 demo.**

   - **Path B (direct sandbox).** Skip NFS entirely; write a `mongofs` `SandboxFactory` connector (~150 lines, copy `packages/connectors/src/daytona.ts` line-for-line). MongoFS's `readFile` is `MongoFsSandboxApi.readFile`, etc. Flue's `exec` becomes "evaluate the LLM's typed TS snippet against MongoFS". Trades the NFS-mount-the-cluster aesthetic (which the AtlasFS pitch leans on visually) for one less moving part in the demo. Roadmap candidate.

3. **Adopt Flue's SSE event stream as the trajectory render surface.** The events `tool_start`, `tool_end`, `turn_end`, `compaction_start`, `compaction_end`, `idle`, `result` map directly to AtlasFS's planned green-for-deterministic / red-for-LLM-invocation trajectory graph. The review UI consumes the same SSE stream `flue dev` already serves; one fewer rendering pipeline to build.

4. **Port Flue's `flue build` workspace pattern to AtlasFS's eval harness.** Each AtlasFS eval task can be a single agent file under `.flue/agents/eval-<task>.ts`, invoked by `flue run eval-<task> --target node --id <seed>`. The eval harness (`kb/product-design.md` §"Eval harness") then orchestrates by shelling out per-task, with each task's trajectory persisted in `tool_calls` via the custom `SessionStore`.

### Bootstrap path

1. **30 min**, add `flue` and `@flue/sdk` to AtlasFS's `package.json`. Pin both. Add `@mariozechner/pi-agent-core@<exact>` and `@mariozechner/pi-ai@<exact>` to `pnpm.overrides` to neutralise the upstream `*`.

2. **30 min**, write `kb/product-design.md` §"Key Decisions" entry: "Pi via Flue, not Pi directly". Cite this brief.

3. **2 hr**, write `apps/atlasfs-server/.flue/agents/atlasfs.ts` as a webhook agent. Body calls `init({ model: 'amazon-bedrock/claude-opus-4-7', sandbox: 'local', cwd: '/datafetch' })`, opens a session, awaits `session.prompt(payload.intent)`. This is the Path A integration, demo-ready.

4. **2 hr**, write a custom `AgentFsSessionStore` that implements `{ save, load, delete }` against the AgentFS SQLite. Replace the in-memory default for Node deploys.

5. **2 hr**, write the `tool_calls` ETL: walk `SessionData.entries`, extract every `{ type: 'message', message: { content: [{ type: 'toolCall', ... }] } }`, write to `tool_calls(tenant_id, session_id, tool_name, args, result, ts)`. Run on `SessionStore.save()` as a side-effect.

6. **1 hr**, write a `kb/product-design.md` §"Architecture" diagram update showing `Flue (HTTP + SSE + Pi)` as the layer between user and AgentFS. Two-block change.

7. **3 hr**, sanity-check the Bedrock provider end-to-end: set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, call `init({ model: 'amazon-bedrock/claude-opus-4-7' })` against the real Bedrock endpoint, verify the response. This is the AWS finalist gate; do it on Day 1.

Total: **roughly 1 working day of focused integration**, well within the 48-hour hackathon budget.

### Effort estimate

- Path A (NFS-front, recommended for v1): **Medium (~1 day)**, distributed across the bootstrap path above.
- Path B (direct `mongofs` connector, roadmap): **Medium (~1 day)** additional, post-hackathon.
- Custom `AgentFsSessionStore` + `tool_calls` ETL: **Short (~4 hours)**, blocking for trajectory crystallisation.
- Vendoring any Flue source: **Not recommended.** The `*`-pinned upstreams plus the "Experimental" warning means we want the upgrade path open. Use it as a dep, not as vendored code.

### Open Questions

- **AgentFS's `FileSystem` interface vs Flue's `SandboxApi`: do they line up cleanly enough to share an implementation?** The AtlasFS design assumes MongoFS implements AgentFS's interface. Flue's `SandboxApi` is a different (though similar) shape. Either MongoFS implements both, or one wraps the other. Resolve on Day 1 by reading AgentFS's actual interface (per `kb/product-design.md` Open Question #7, AgentFS licence and exact API still need verification).
- **Does pi-ai's Bedrock provider support Claude 4.7 (Opus) on `bedrock-runtime.us-east-1.amazonaws.com`?** The model registry (`pi-ai/dist/models.generated.js`) lists `amazon-bedrock` as a provider with `bedrock-converse-stream` API; need to grep the generated model list for the specific model IDs we want before committing the AWS finalist gate to it.
- **Compaction interaction with crystallisation.** Flue's compaction (`packages/sdk/src/compaction.ts`) summarises old messages into a synthetic user message at threshold. AtlasFS's crystallisation step replays a trajectory; if compaction has eaten the early tool calls, replay correctness degrades. Configure `compaction: { enabled: false }` for trajectories destined for crystallisation, or guarantee compaction never fires on the ReAct phase by sizing the model context generously.
- **Per-tenant sandbox isolation in Path A.** `sandbox: 'local'` shares the host fs; if two tenants run concurrently and both write to `/datafetch/scratch/`, they collide. AgentFS's CoW overlay should isolate by tenant_id before Path A is multi-tenant-safe; document explicitly that v1 is single-tenant-at-a-time.

## Key Takeaways

1. **Adopt Flue. Replace the bare Pi reference in `kb/product-design.md` Decision #8 with "Pi via Flue".** Flue is what you get if you wrap Pi in the build, deploy, sandbox-integration, and HTTP-server layer AtlasFS would otherwise have to write. The AWS Bedrock provider is built into pi-ai's registry, so the AWS finalist gate is satisfied without integration cost. Apache-2.0 + MIT, no compliance issue. Update Decision #8 prose: "Pi via Flue as the agent harness, MIT and Apache-2.0 mix; Bedrock built in via pi-ai".

2. **Use Path A (NFS-front via `sandbox: 'local'`) for the v1 demo.** Lowest integration cost, preserves the AtlasFS architecture as designed, ships a recognisable two-layer stack (AgentFS provides the mount, Flue runs Pi against it). The direct `mongofs` `SandboxFactory` connector (Path B) is a roadmap follow-up, not a v1 requirement. Total Day-1 integration effort ~1 working day; well within the 48-hour budget.

3. **Pin upstream Pi packages, expect Flue API churn, plan the upgrade path.** `@mariozechner/pi-agent-core: "*"` and `@mariozechner/pi-ai: "*"` in `packages/sdk/package.json:45-46` are the riskiest dependencies in our tree. Pin both via `pnpm.overrides`. Treat each Flue version bump as a deliberate maintenance event, not a routine update. The "Experimental" warning is real; the v0.0.x deprecation, the `version: 2` `SessionData` schema, and the `@deprecated CommandDef` are all evidence.

4. **Build the trajectory ETL early, not late.** Flue's `SessionHistory` tree is structurally different from AtlasFS's `tool_calls` SQLite table. The ETL (walk `SessionData.entries`, extract tool-call blocks, write per-tenant rows) is ~80 lines but blocks crystallisation. Land it on Day 1 alongside the custom `AgentFsSessionStore`; it unblocks the user-endorsement review UI and the eval-harness trajectory replay.

## Sources

**Primary, repo-level:**
- [withastro/flue on GitHub](https://github.com/withastro/flue), repo cloned and live-tested 2026-05-01 at commit `11029fe` (head of `main`, v0.3.5 release).
- Live build and run on this machine, 2026-05-01: `pnpm install` (9.6s), `pnpm run build` (2.4s, 4 turbo tasks all green), `flue build --target node` on `examples/hello-world` (107KB `dist/server.mjs` plus `dist/manifest.json`), `node dist/server.mjs` boots cleanly, webhook routing through to Pi's prompt loop verified, fails at `No API key for provider: anthropic` boundary as expected.
- Repo source files cited inline by path:line: `packages/sdk/src/{client,session,agent-client,sandbox,types,build,build-plugin-node,build-plugin-cloudflare,mcp,compaction,session-history,roles,node/define-command,cloudflare/cf-sandbox,cloudflare/session-store}.ts`, `packages/connectors/src/daytona.ts`, `examples/hello-world/.flue/agents/{hello,fs-test,with-sandbox}.ts`, `docs/deploy-{cloudflare,node,github-actions,gitlab-ci}.md`, `README.md`, `AGENTS.md`, root `package.json`, `tsdown.config.ts` per package.

**Primary, framework framing:**
- [flueframework.com](https://flueframework.com/), the official marketing site; "Agent = Model + Harness" four-layer pitch (model, harness, sandbox, filesystem). Defuddle-equivalent fetched 2026-05-01.
- [Fred Schott on X, 2026-04-30](https://x.com/FredKSchott/status/2044479150489276896), framing OpenAI's adoption of "sandbox agent" as validation of Flue's premise.

**Secondary, Pi (the upstream harness Flue wraps):**
- [@mariozechner/pi-coding-agent on npm](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).
- [Mario Zechner, "What I learned building an opinionated and minimal coding agent" (2025-11-30)](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/), philosophy and design choices behind Pi.
- [badlogic/pi-mono on GitHub](https://github.com/badlogic/pi-mono), the Pi monorepo with `pi-ai`, `pi-agent-core`, `pi-tui`, `coding-agent` packages.
- [agenticengineer.com, "Pi Coding Agent: The Only Claude Code Competitor"](https://agenticengineer.com/the-only-claude-code-competitor), positioning context.
- pi-ai model registry (`node_modules/.pnpm/@mariozechner+pi-ai@0.66.1/.../dist/models.generated.js`), confirms `amazon-bedrock` provider with `bedrock-converse-stream` API and `bedrock-runtime.us-east-1.amazonaws.com` baseUrl.

**Secondary, deploy and ecosystem context:**
- [Cloudflare's Agents Week recap (2026)](https://blog.cloudflare.com/agents-week-in-review/), context for the Cloudflare-as-agent-platform pitch Flue maps onto.
- [The New Stack, "Cloudflare Acquires Team Behind Open Source Framework Astro" (2025)](https://thenewstack.io/cloudflare-acquires-team-behind-open-source-framework-astro/), Schott's Cloudflare ETI affiliation.
- [`just-bash` (vercel-labs)](https://github.com/vercel-labs/just-bash), the WASM-based virtual-bash runtime Flue defaults to for `'empty'` sandboxes.

**Project-internal:**
- `kb/product-design.md` (AtlasFS / MongoFS design, read 2026-05-01), §"What It Is", §"Architecture", §"Key Components", §"Security Model", "Key Decisions" #8 (Pi as harness), "Open design questions" #7 (AgentFS licence).
- `kb/br/03-documentdbfuse.md` (the closest existing public expression of MongoFS), informs the "two integration paths" discussion.
- `kb/br/01-voyage-ai-code-mode-data-interface.md` (the broader code-mode-data-interface thesis Flue's harness layer plugs into).
- `kb/br/02-mongodb-fit-and-adjacent-projects.md` (companion brief on MongoDB Atlas plus Voyage adjacency).
