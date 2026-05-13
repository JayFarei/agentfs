---
title: "OpenAI Codex Code Mode: V8 Isolates, exec/wait, and the Stacked Path for Datafetch"
date: 2026-05-11
mode: deep
sources: 18
status: complete
---

# OpenAI Codex Code Mode: V8 Isolates, exec/wait, and the Stacked Path for Datafetch

## Executive Summary

OpenAI Codex CLI shipped "Code Mode" in mid-March 2026 as an opt-in feature flag (`[features] code_mode = true`, with a strict `code_mode_only = true` variant that hides all non-code tools from the model). The implementation is a port of Cloudflare's pattern: the model sees exactly two tools (`exec` and `wait`), writes raw JavaScript as the `exec` input, and that JS runs in a fresh V8 isolate where every other tool, including MCP, is registered as a typed async function on a global `tools` object. The only data that escapes the isolate back into the model's context is what the script passes to `text(...)`. This kills the "wrap every MCP in a CLI to get composition back" meta because the agent now gets real composition, looping, mapping, and chaining without round-tripping intermediate JSON through the model.

The strategic implication for datafetch is not "we need to pivot" but "this just validated the substrate, and it stacks cleanly with what we already built." Datafetch's `df.d.ts` typed namespace is already a code-mode interface for the dataset layer, the same shape Cloudflare and now Codex apply at the tool-protocol layer. The two systems compose: Codex Code Mode is the wrapper around *all* tools, and datafetch is the wrapper around *one* tool surface, the data plane. An agent running Codex with `code_mode_only = true` plus a datafetch MCP server gets `tools.df_db_finqaCases_findSimilar(...)` and `tools.df_lib_rangeTableMetric(...)` as composable JS calls inside the same isolate. Crystallisation still works because datafetch records the call graph host-side through the binding, not by parsing model output.

The piece datafetch uniquely adds, and which Codex Code Mode explicitly does not provide, is the *learning* arc: trajectory observation, gate, crystallisation into `lib/<tenant>/<name>.ts`, and the warm-path tier collapse from 4 to 2. Code Mode makes the cold path cheaper per turn; datafetch removes the cold path entirely on the second similar intent. That distinction is now the cleanest one-liner for the product, "Code mode for *tools* compresses the input; code mode for *data*, plus crystallisation, compresses the work."

## Overview

**What it is.** Code Mode is a Codex CLI feature shipped quietly through a series of PRs by `@pakrym-oai` between mid-March and early May 2026 (`PR #14437` introduced the runtime, `PR #14617` added `code_mode_only`, `PR #20542` pruned unused globals, `PR #21146` enabled V8 sandboxing for source builds). There is no standalone OpenAI blog post for it; the only public marketing is a brief mention in the v0.120.0 changelog and a `js_repl` framing tweet from Dominik Kundel (OpenAI DevRel). It remains classified "under development" (one rung below "experimental") as of v0.130.0 on 2026-05-08.

**Where it lives in the source.** The implementation is the `codex-rs/code-mode/` crate (1,948 lines across `description.rs`, `service.rs`, `response.rs`, and a `runtime/` submodule with `callbacks.rs`, `globals.rs`, `module_loader.rs`, `timers.rs`, `value.rs`). The two public tool names are constants: `PUBLIC_TOOL_NAME = "exec"` and `WAIT_TOOL_NAME = "wait"`. The dispatcher that maps these to host-side tool invocations lives at `codex-rs/core/src/tools/code_mode/` (with `execute_handler.rs`, `execute_spec.rs`, `wait_handler.rs`, `wait_spec.rs`, `response_adapter.rs`).

**Adoption and traction signals.** Codex's own changelog has shipped at least four Code Mode-touching releases in a six-week window, which is the strongest signal that this is going from experimental to default. The community discourse is still anchored to Cloudflare's earlier introduction of the pattern (`blog.cloudflare.com/code-mode`, September 2025), Anthropic's "Code Execution with MCP" post, and open-source projects like CMCP that ship the same shape across runtimes. HN sentiment on the Cloudflare variant trends positive on token efficiency and skeptical on sandbox-escape surface and the debuggability of model-authored code. OpenAI has disclosed no benchmark numbers of its own; the only quantified claim in circulation is Cloudflare's 1.17M to roughly 1,000 tokens for the full Cloudflare API surface, an 81 to 99.9 percent reduction depending on which metric you read.

**Why it matters now.** The "wrap MCP in a CLI to get composition" hack was always a workaround for a protocol limitation, and the brief at `kb/br/01-voyage-ai-code-mode-data-interface.md` already argued this on the Cloudflare side a week ago. With Codex shipping the same primitive on the model-host side, both vendors that matter for datafetch's go-to-market (the Anthropic-hosted Claude Code path and the OpenAI Codex path) now agree on the substrate. The hackathon timing is fortunate: any demo built on a code-mode-shaped data interface is now demonstrably future-aligned rather than speculatively future-aligned.

## How It Works

### The two public tools

The Code Mode runtime exposes exactly two function-call tools to the model. Everything else, including every native Codex tool (`exec_command`, `apply_patch`, `web_search`, `view_image`) and every MCP-registered tool, is hidden behind those two.

```
+-----------------+         +---------------------------+
|  Codex CLI host |  -----> |  V8 isolate (fresh per   |
|  (Rust runtime) |         |   exec call, async       |
|                 |  <----- |   module evaluation)     |
+-----------------+         +---------------------------+
        |
        | exposes only:
        |   exec(source: string)
        |   wait(cell_id, yield_time_ms?, max_tokens?, terminate?)
        v
        (model)
```

`exec` accepts raw JavaScript source (no JSON wrapper, no quoted string, no markdown fences), optionally prefixed with a single-line pragma `// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}`. The runtime parses that pragma if present, then evaluates the rest as an async module in a fresh V8 isolate. `wait` resumes a still-running cell by `cell_id`, optionally with a different yield budget or a `terminate: true` to stop the script. Both tool names are reserved constants in `codex-rs/code-mode/src/lib.rs:35`.

### The isolate environment

Inside the isolate, the agent has access to a deliberately minimal global surface. The exact list, from `description.rs`:

- `tools.<name>(input)`: every nested tool, native or MCP, registered as an async function. Names are normalised to valid JavaScript identifiers, so an MCP tool registered as `ologs/get_profile` becomes `tools.mcp__ologs__get_profile`. Each accepts either a string or an object as input and returns either an object or a string per the tool's declared output schema.
- `text(value)`: the *only* return channel back to the model. Stringifies non-strings via `JSON.stringify`. Anything not passed to `text(...)` stays in the isolate and is discarded when the script ends.
- `image(imageUrlOrItem, detail?)`: append an image item to the response. Accepts an HTTPS URL, a base64 `data:` URL, or a forwarded MCP `ImageContent` block.
- `store(key, value)` and `load(key)`: durable key-value state across `exec` calls within the same session. This is how multi-turn workflows persist intermediate results without paying for them in context.
- `notify(value)`: immediately injects a `custom_tool_call_output` for the current `exec` call, useful for progress streaming.
- `setTimeout` and `clearTimeout`: scheduling primitives. Pending timeouts do not keep the script alive on their own; the script must explicitly `await` something to wait for one.
- `yield_control()`: hand current output back to the model immediately while the script keeps running. The model then calls `wait` to resume.
- `exit()`: end the script successfully, like an early top-level return.
- `ALL_TOOLS`: a metadata array of `{ name, description }` for every nested tool, including ones omitted from the description prompt to save tokens. The agent is explicitly told *not* to print the full array but to filter it.

What is conspicuously absent: no Node API, no `fs`, no `net`, no `child_process`, no `process`, no `console`, no `fetch`, no `WebAssembly` (pruned in `PR #20542`), no `SharedArrayBuffer`, no `Atomics`. The isolate is a pure-JS sandbox with only the typed bindings the host hands it. This is the Cloudflare-style "bindings, not network" discipline: any privileged action the agent takes must go through a registered tool, so prompt injection cannot exfiltrate API keys because the keys never enter the isolate.

### The `code_mode_only` strict mode

A second flag, `code_mode_only = true`, changes the tool-schema preface the model sees. Without it, both the standard tool schemas and the `exec`/`wait` tools are advertised together, and the model can choose either path on any turn. With it, the preface becomes `"Use exec/wait tool to run all other tools, do not attempt to use any other tools directly"`, and the standard schemas for native and MCP tools are pulled from the prompt entirely, replaced by their TypeScript signatures inside the `exec` description. This is the configuration that delivers the token-budget reduction; the dual-tool mode is closer to a transition mode.

### The pragma and yielding

The first-line pragma `// @exec: {"yield_time_ms": N, "max_output_tokens": M}` lets the model tune two behaviours per call:

1. `yield_time_ms`: after this many milliseconds of script runtime, yield whatever output has accumulated back to the model. The script keeps running; the model decides whether to `wait` for more or take a different action. Default is `DEFAULT_EXEC_YIELD_TIME_MS` (a few seconds).
2. `max_output_tokens`: cap the number of tokens of direct `exec` output. Default is 10,000 tokens, after which output is truncated.

This is the practical answer to one of the obvious objections to code mode, "what if the script runs forever or produces a giant blob." The runtime answers by making the model own the budget per-call via a pragma, and by making `wait` the explicit continuation primitive.

### Tool definition shape

When a tool is registered with Code Mode, the runtime takes its function-call shape (name, description, input/output JSON schema) and emits a TypeScript description that the model sees inside the `exec` tool description. From `description.rs`:

```
fn augment_tool_definition(def: ToolDefinition) -> ToolDefinition
fn render_json_schema_to_typescript(schema: &JsonValue) -> String
fn render_code_mode_sample(...)  // example invocations
```

A nested tool whose name does not look like a valid JS identifier is renamed (`code_mode_name_for_tool_name` in `codex-rs/tools/src/code_mode.rs:146`). The input JSON schema becomes a TypeScript parameter type. The output schema, if present, becomes the return type. The resulting description is a small block of TypeScript-flavoured docs the agent reads once, and then it writes calls like `await tools.web_search({ query: "..." })` directly. This is the exact same move as Cloudflare's TS-namespace generation, but built into the model-side host rather than the protocol-side gateway.

### Per-call lifecycle

1. The model emits one `exec` call with raw JS source.
2. The host parses the optional pragma, allocates a `cell_id`, spins up a fresh V8 isolate, registers the `tools` global with handlers that call back into the host's tool dispatcher (`CodeModeTurnHost::invoke_tool` in `service.rs`), and starts evaluating the source as an async module.
3. Nested tool calls inside the script reach the host through async channels, get dispatched as if the model had called them directly (preserving telemetry, approvals, sandboxing), and return their results into the isolate as plain JS objects.
4. When the script finishes, or yields, or hits the output cap, the runtime returns a `RuntimeResponse` containing whatever was passed to `text(...)` and `image(...)` plus a `cell_id` if the script is still running.
5. If still running, the model can call `wait` with the `cell_id` to either pull more output or terminate. If finished, the isolate is dropped and the `cell_id` is closed.

The host-side tool dispatcher is unchanged from non-code-mode operation. Tool authorisation, sandboxing, MCP transport, all of it sits behind the boundary the isolate sees as `tools.<name>(...)`. This is important for datafetch: every existing host-side observability hook still fires when called from inside an `exec` script.

## Strengths

- **Token compression is structural, not heuristic.** The agent never sees the full input or output JSON of intermediate tool calls. A 20-step retrieve-rerank-expand workflow that traditionally pumps 19 intermediate JSON blobs through the model collapses to one `exec` call and one `text(final)` response. The reduction is built into the protocol, not into a hand-tuned summariser. The figures Cloudflare disclosed (81 to 99.9 percent on a 2,500-endpoint MCP) bound the upside.
- **Composition is native.** The agent can use real control flow: `Promise.all`, `for...of`, `filter`, `map`, conditional retries, recursion. This is the "kills the bespoke CLI meta" claim from the announcement. The same agent that used to need a custom CLI wrapper around an MCP to chain calls now just writes the chain in JS.
- **Bindings, not network, is a real security property.** The isolate has no `fetch`, no env, no fs. An MCP tool key cannot leak via prompt injection because the isolate cannot see it. Native Codex tools that need credentials get them on the host side; the script only ever sees the function-call boundary. `PR #21146` strengthens this further by enabling V8 sandboxing for source builds.
- **`store`/`load` enables genuine multi-turn state.** A planning step in one `exec` call can persist a result the next `exec` call retrieves, with no model-side cost for the intermediate payload. This is the building block for long-running plans where the model directs but does not carry the working set.
- **MCP becomes useful at scale.** The protocol's biggest pre-Code-Mode problem was the linear context cost per tool; for thousands of tools the schema alone consumed the budget. Code Mode replaces N tool descriptions with one `ALL_TOOLS` array the model is told to filter, plus TS sigs in the `exec` description. The ceiling on practical MCP server size moves up by one to two orders of magnitude.
- **Backwards compatible by flag.** Without `code_mode = true`, Codex behaves exactly as before. With `code_mode = true` and not `code_mode_only`, both paths coexist. With both flags on, the strict-mode budget win kicks in. This gives integrators a clean migration ramp.
- **Numerical primitives are sane.** Integer outputs from tools are JS `number`s capped at `MAX_JS_SAFE_INTEGER` (2^53 - 1), which is the right choice for an agent-authored language that lacks BigInt-by-default. The runtime is explicit about the cap, so tool authors who exceed it must serialise.

## Limitations & Risks

- **No official benchmark numbers from OpenAI.** Every figure quoted in defence of Code Mode in the wider discourse is Cloudflare's. OpenAI has not published a measurement of the Codex-specific implementation's win on any standard benchmark. Hackathon pitches that quote percentages should attribute to Cloudflare, not OpenAI.
- **Still pre-experimental ("under development") as of v0.130.0.** The flag is gated, the description text is still being iterated (changelog entries about MCP `outputSchema` and globals pruning in just the last month), and v0 to v0 changes will likely break integrations that read the description format directly. Treat the runtime shape as stable enough to build against, but the description-format details as fluid.
- **`text()` is the only return channel and it discards type information.** Whatever the script computes inside the isolate must be serialised as a string (or images) to reach the model. A structured object that the agent wants to reason over in a later turn either round-trips through `JSON.stringify`/`JSON.parse` or sits in `store(...)` and is fetched in the next `exec`. The implicit pressure on the agent's authorship style is to keep returns small and use `store` aggressively.
- **No `console.log`.** This is a deliberate choice (the runtime says "no console" explicitly in the `exec` description) but it shifts debug-style introspection onto `text(...)`. A script that wants to show its work needs to call `text(...)` multiple times or build a structured log in JS and emit it once.
- **MCP `outputSchema` adoption is uneven.** Without a declared output schema, the agent only knows the tool returns "an object or string." With one, it knows the TS type. Many MCP servers in the wild today either omit `outputSchema` or under-specify it. Code Mode will magnify the value of well-typed MCP servers and equally magnify the pain of poorly-typed ones.
- **The agent can write bad JS.** Code mode shifts the failure surface from "agent produced a malformed tool call" (caught at protocol layer) to "agent's JS threw a TypeError at runtime" (caught only inside the isolate). The runtime returns the error as the `exec` response, so the model can retry, but the per-turn variance goes up. The `js_repl` framing from Kundel suggests OpenAI is leaning into "iterative debugging" rather than "got it right first time."
- **`yield_control()` and `wait` add a state-machine the model must learn.** PR review comments on `#14437` flagged that `yield_control` is really a fire-and-forget detach, but the name was kept. Models trained on the API need to internalise the lifecycle (still-running cells need explicit `wait` or `terminate`); fine-tuned models that don't know about this may leak running cells.
- **Head-of-line blocking in the host's tool-dispatch queue.** Reviewer `@cconger` flagged this in `PR #14437` and pakrym deferred ("one step at a time"). If a long-running tool call inside an `exec` script blocks the queue, the agent's other in-flight `exec` scripts may stall. For datafetch's long-tail retrieval calls this could matter; mitigation is per-tool concurrency on the dispatch side.
- **The implementation is V8, full stop.** No `workerd`, no Deno, no `isolated-vm`, no QuickJS. If a future Codex runtime drops V8 the description format and primitive shapes might survive, but the security and performance characteristics will be re-litigated. Cloudflare and Codex agreeing on V8 makes this risk modest in practice.
- **Limited observability into intermediate steps from the agent's side.** Because the agent only sees what `text(...)` produces, debugging *its own* script's intermediate state requires either rebuilding the script with more `text(...)` calls or asking the host to dump a trace. This is the inverse of the win: token compression is great for production, painful for the model when iterating.

## Integration Analysis

### Fit assessment: Strong Fit, Stacking Relationship

The integration question for datafetch is not "do we replace anything with Code Mode" or "do we compete with it." It is "where in our stack does Code Mode plug in, and what does that buy us." The honest answer is that datafetch already implements the same pattern at a different layer, and Codex Code Mode is *complementary at the layer above*. Three concrete relationships:

1. **Codex Code Mode is the model-host wrapper around all tools.** Datafetch is the wrapper around one tool, the data plane. They compose: an agent running Codex with `code_mode_only = true` and a datafetch MCP server sees `tools.df_*` calls alongside `tools.exec_command`, `tools.web_search`, and any other MCP it has, all composable in one isolate.
2. **Datafetch's snippet runtime is "code mode" for *data*, not for *tools*.** The brief at `kb/br/01-voyage-ai-code-mode-data-interface.md` already argued this. The `df.d.ts` typed namespace, the `df.db.<ident>.findSimilar(...)` shape, the `df.lib.<name>(input)` interpreted path, the `df.answer({...})` envelope, all of these are the same move at the dataset interface that Code Mode is making at the tool protocol. Codex Code Mode validates the substrate from the OpenAI side; Cloudflare validates it from the protocol side; Anthropic's "Code Execution with MCP" validates it from the client side. There are now three independent vendors converging on the same primitive, with datafetch already implementing it in a domain none of them have addressed.
3. **Crystallisation is the piece neither Code Mode nor Cloudflare nor Anthropic provides.** Code Mode compresses the cold-path turn. It does not learn. It does not collapse repeat work into a typed function that the next turn calls cheaply. Datafetch's observer plus `lib/<tenant>/<name>.ts` plus the `mode: "interpreted"` warm path is the unique contribution. The right product narrative is "Code Mode compresses the input; datafetch compresses the *work*."

### What to extract from Code Mode for datafetch

From the architecture:
1. **The `exec`/`wait` two-tool surface is the right shape for a future hardened datafetch runtime.** When Wave 6 swaps the in-process `tsx` evaluator for a V8 isolate (the comment in `src/snippet/runtime.ts:18-21` already names this as the intended path), the public surface should be `datafetch exec <snippet.ts>` and `datafetch wait <cell-id>`, mirroring Codex's shape. The agent then sees one tool from the bash side, parallel to how it sees one tool inside the Codex isolate.
2. **The pragma pattern (`// @exec: {...}`) is a clean way to pass per-call runtime knobs.** Datafetch snippets today rely on CLI flags. A first-line pragma in `scripts/answer.ts` for things like `yield_time_ms`, `max_output_tokens`, or the existing phase hint would mean the agent's source carries its own runtime metadata.
3. **`store`/`load` is a primitive datafetch could adopt without breaking anything.** The current `tmp/runs/NNN/result.json` is durable across runs but not addressable inside a snippet. A `df.store(key, value)` and `df.load(key)` pair, scoped to the intent workspace, would let the cold-path agent compose multi-step plans without writing intermediate files.
4. **Hide tool descriptions from the cold path, expose them on demand.** Code Mode's `ALL_TOOLS` is a metadata array the model filters when needed. The equivalent for datafetch is the `apropos` verb: do not load every learned interface into `df.d.ts` for huge libraries; instead expose a smaller "Learned Interfaces" preamble plus an `apropos(query)` lookup that returns the names and signatures of relevant matches. The plumbing for this already exists (`datafetch apropos`); the change is making `df.d.ts` itself smaller when the library is large.
5. **Two-layer description discipline: TS sigs at the top, MCP `outputSchema` semantics in the body.** Code Mode renders JSON schema to TypeScript inside the `exec` description. Datafetch already does this for `df.db.*` and `df.lib.*`. Whenever a new substrate verb is added (today's `findExact|search|findSimilar|hybrid`), ship it with a real return-type schema rather than `Promise<unknown[]>`. The brief at `kb/br/01` already argued the same point for the Voyage wrapper.

### Bootstrap path: datafetch as a Code Mode citizen

The minimum integration that makes datafetch usable inside Codex Code Mode is a thin MCP server.

1. **Short, less than four hours.** Add an MCP transport in front of the existing CLI verbs. The four datafetch verbs the agent actually calls are `mount`, `apropos`, `run`, `commit`. Expose them as MCP tools with proper input and output schemas (this is mostly mechanical translation of the existing valibot/zod-shaped CLI args). The session is identified by an MCP session id; the working directory and session id together replace the bash CWD.
2. **Wire `df.d.ts` rendering into the MCP `outputSchema`.** When `mount` returns the workspace, include the `df.d.ts` content as a structured field so that Codex Code Mode can render it as a TypeScript sub-namespace inside the `exec` description. The agent now sees `tools.datafetch_run(...)` with a TS type that explains what kinds of source strings it accepts.
3. **Optional, escalation path.** If the demo wants the agent to write *datafetch snippets* (TypeScript composing `df.*`) and have those run *inside* the Codex isolate, the agent has to escape the V8-no-network constraint somehow. The cleanest path is: the agent writes the snippet, calls `tools.datafetch_run({source})`, the host runs it on the data plane (which has Node and credentials), and returns the trajectory id and result. The agent's `exec` script then chains: `const r = await tools.datafetch_run({source}); text(r.summary)`. This keeps datafetch's existing runtime untouched.

The first two steps are the demo. The third step is the everyday usage.

### Open questions

- **Do we want the datafetch snippet runtime itself to become a V8 isolate to mirror Code Mode's security model?** The runtime comment names this as the Wave 6 intent. The benefit is end-to-end "bindings, not network" all the way to the data plane. The cost is rewriting the snippet evaluator and giving up Node's ecosystem inside the snippet. Recommendation: pursue this only after the MCP-server-fronts-the-existing-runtime path is shipped, and only if the data plane gains untrusted-snippet exposure (today it does not, since tenants are pre-authorised).
- **Should `df.answer({...})` be `text(JSON.stringify(envelope))` in a Code Mode world?** The current envelope is the commit primitive validated by `validateAnswerEnvelope` in `src/snippet/answer.ts`. In a Code-Mode-hosted snippet, the snippet's final action would still be `df.answer({...})`, and the wrapper returning it would `text(JSON.stringify(envelope))`. The host parses the JSON back and runs validation. No semantic change; a layer of serialisation tax. Acceptable.
- **How does crystallisation see calls when the model authors a Codex `exec` snippet that calls `tools.df_*` repeatedly?** This is the load-bearing question. Each `tools.df_*` call from inside the isolate becomes an MCP tool call back to the data plane. The data plane sees the calls, records them in a trajectory, runs the gate, and crystallises as usual. The agent sees one `exec` round-trip; the host sees the full call graph. This is the right asymmetry: token compression for the model, lineage retention for the audit and learning loop. No changes needed to the gate or the observer.
- **Token-budget behaviour with `df.tool.<bundle>` hooks?** Datafetch's `df.tool.*` namespace (visible in `src/snippet/dfBinding.ts:52`) is the experimental hook registry. If the agent writes Codex `exec` code that calls a datafetch hook that itself makes more MCP-tool calls, we are nested two layers deep. The host-side observer sees everything; the agent sees just the final `text(...)`. Same asymmetry, deeper. Worth a smoke test before any demo that uses both layers.
- **Tier mapping in a Code-Mode-fronted run.** Today the snippet's `Cost.tier` is computed from the nested call graph (4 = novel, 2 = interpreted, etc., per `kb/mental-model.md` glossary). When the wrapper is Codex Code Mode, the host-side cost should still aggregate correctly because the call graph is preserved. We should verify on a smoke test that no double-counting happens; the wrapper itself does not call the model again per nested tool, so the LLM-cost line should not inflate.

### Effort estimate

- **MCP server for datafetch verbs, plus a Code Mode demo on the hackathon laptop**: Medium (less than one day). The MCP transport is mechanical; the demo script is the same kind of "rangeTableMetric over FinQA" intent the project already uses for evals.
- **Wire `df.d.ts` into the MCP `outputSchema` so Codex renders it inline**: Quick (less than one hour, additive on top of the above).
- **Wave 6 swap of the snippet evaluator to a V8 isolate**: Large (more than one day). Deferred; not blocking the hackathon and not required for the Code-Mode demo.

## Key Takeaways

1. **Codex Code Mode validates the substrate from a third independent vendor.** Cloudflare introduced the pattern in September 2025; Anthropic shipped the same primitive at the client layer; OpenAI has now ported it into Codex. Datafetch's design thesis ("the agent writes typed code against a thin data interface, the host records the call graph, the host learns") is no longer the speculative bet it was three months ago. Use this in any pitch deck. Stop arguing the substrate and start arguing what we do on top of it.
2. **The product one-liner sharpens.** "Code mode for tools, like Cloudflare and Codex, compresses the input. Code mode for data, plus crystallisation, compresses the work." This is the cleanest framing. The cold-path token win from Code Mode is real and now industry-standard; the warm-path tier collapse from crystallisation is the part datafetch uniquely owns. Lead with the second.
3. **Ship a thin MCP server for datafetch this week.** Less than four hours of effort, opens the door to running the demo on Codex with `code_mode_only = true` next to Claude Code's existing skill path, and gives the hackathon a "works in both vendor flagships" story without any dual-runtime code on our side. The data plane stays exactly the same; only the front door changes.
4. **Adopt three Code Mode primitives in the existing datafetch surface without waiting for Wave 6.** First, a `// @datafetch: {...}` first-line pragma in `scripts/answer.ts` for per-run knobs. Second, a `df.store/df.load` pair scoped to the intent workspace, replacing the current "write a tmp file" pattern. Third, a smaller default `df.d.ts` that defers large `lib/` listings to `apropos`, mirroring Code Mode's `ALL_TOOLS` filter discipline. None of these change the data plane; each one is a smaller, more familiar agent surface, and each one is an independent commit.

## Sources

**Primary, source code and config:**
- [openai/codex on GitHub](https://github.com/openai/codex), the canonical repository.
- `codex-rs/code-mode/src/lib.rs`, `description.rs`, `service.rs`, `runtime/mod.rs`, the V8-isolate runtime crate (1,948 LOC across five files).
- `codex-rs/core/src/tools/code_mode/`, host-side dispatcher and response adapter (`execute_handler.rs`, `wait_handler.rs`, `response_adapter.rs`).
- `codex-rs/tools/src/code_mode.rs`, tool-spec to Code Mode definition adapter.
- `codex-rs/core/config.schema.json:391` and `:3947`, the `code_mode` and `code_mode_only` feature flag definitions.

**Primary, OpenAI surfaces:**
- [Codex CLI changelog](https://developers.openai.com/codex/changelog), with the relevant entries at v0.120.0 (2026-04-11, "Code-mode tool declarations now include MCP outputSchema details") and v0.129.0 (2026-05-07, "Prune unused code-mode globals").
- [Codex CLI overview](https://developers.openai.com/codex/cli/), no direct Code Mode documentation as of 2026-05-11.

**Primary, design rationale from PRs:**
- [PR #14437](https://github.com/openai/codex/pull/14437), the initial Code Mode runtime, including the `head-of-line blocking` discussion.
- [PR #14617](https://github.com/openai/codex/pull/14617), `code_mode_only` strict mode.
- [PR #14484](https://github.com/openai/codex/pull/14484), Code Mode integration plumbing.
- [PR #16153](https://github.com/openai/codex/pull/16153), added `setTimeout`/`clearTimeout`.
- [PR #20542](https://github.com/openai/codex/pull/20542), pruned `WebAssembly`, `SharedArrayBuffer`, `Atomics` from the isolate globals.
- [PR #21146](https://github.com/openai/codex/pull/21146), enabled V8 sandboxing for source builds.

**Secondary, the pattern's origin and community:**
- [Cloudflare: Code Mode, the better way to use MCP](https://blog.cloudflare.com/code-mode/), the September 2025 introduction.
- [Cloudflare: Code Mode, give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/), the February 2026 follow-up with the 1.17M-to-1000 figure.
- [InfoQ: Cloudflare Launches Code Mode MCP Server](https://www.infoq.com/news/2026/04/cloudflare-code-mode-mcp-server/), the third-party writeup of the 99.9 percent claim.
- [HN: Show HN, CMCP](https://news.ycombinator.com/item?id=47159188), community OSS implementation listing Codex as a supported client.
- [HN: Show HN, MCP code mode](https://news.ycombinator.com/item?id=45405584), practitioner reactions favouring Deno isolates.
- [Dominik Kundel on X, js_repl framing](https://x.com/dkundel/status/2029679518869532990), the closest OpenAI-side public framing.

**Project context (internal):**
- `kb/br/01-voyage-ai-code-mode-data-interface.md`, the prior brief on Cloudflare Code Mode and the Voyage data-interface design.
- `kb/mental-model.md`, the datafetch glossary and cold-path/warm-path arc.
- `src/snippet/runtime.ts:18-21`, the Wave 6 comment naming "Vercel Sandbox / V8 isolate" as the future evaluator.
- `src/snippet/dfBinding.ts:49-55`, the `DfBinding` shape (the existing "code mode for data" surface).
