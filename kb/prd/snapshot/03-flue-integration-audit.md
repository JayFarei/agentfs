---
title: "PRD 005 — Flue Integration Audit"
summary: "How the current Flue integration works (subprocess shell-out + sentinel-marker JSON), and where it diverges from the Cloudflare Worker posture in product-design.md"
type: prd
status: stable-snapshot
date: 2026-05-04
related: [002-product-design-delta, 006-datafetch-sdk-design]
---

# Flue Integration Audit

Short answer: **Flue is wired in as a subprocess shell-out, not as an in-process SDK call.** Each LLM-backed step spawns `pnpm exec flue run <agent> --target node` and parses the resulting stdout for a JSON block between sentinel markers.

---

## 1. Topology

Two halves:

```
src/datafetch/db/                      .flue/agents/
─────────────────────                  ─────────────────────────
finqa_observe.ts  ──spawns──▶  finqa-observer.ts                 (codify a TS function)
                  ──spawns──▶  finqa-outlook-agent-factory.ts    (mint a scorer agent spec)

finqa_outlook.ts  ──spawns──▶  tenant-agent-launcher.ts          (mode: "outlook-score")

finqa_agent.ts    ──spawns──▶  finqa-agent-factory.ts            (mint a sentiment agent spec)
                  ──spawns──▶  tenant-agent-launcher.ts          (mode: "sentiment")
```

The host-side classes — `FlueCliObserverRuntime`, `FlueOutlookAgentRuntime`, `FlueCliTaskAgentRuntime` — implement the `*Runtime` interfaces used by `runner.ts` / `planner/runner.ts`. The `Fixture*`, `Anthropic*`, and `FlueCli*` runtimes are interchangeable behind the same contract.

---

## 2. The subprocess protocol

Every `runFlueJson(agent, payload)` call (defined identically in three files: `finqa_observe.ts:701`, `finqa_outlook.ts:135`, `finqa_agent.ts:143`) does this:

1. **Marshal the payload to a tempfile.** `mkdtemp(/tmp/atlasfs-<agent>-…)` then `writeFile(payloadFile, JSON.stringify(payloadData))`. The `--payload` arg passed to Flue is just `{"payloadFile": "/tmp/.../payload.json"}` — the real payload is read by the agent inside the subprocess. This indirection sidesteps argv size limits.

2. **Spawn the CLI.**
   ```
   pnpm exec flue run <agent>
     --target node
     --id <agent>-<timestamp>
     --payload '{"payloadFile":"…"}'
     --output node_modules/.cache/atlasfs-flue/<agent>-<ts>-<rand>
     --env .env
   ```
   Note `--target node`, not `--target cloudflare` — directly contradicting Decision #15 of the product design.

3. **Pre-fill env.** `ANTHROPIC_API_KEY ?? ANTHROPIC_KEY` is forwarded; the agents themselves also handle either name (e.g. `tenant-agent-launcher.ts:8-10`).

4. **Parse stdout.** `parseFlueJson(stdout, label)`:
   - First, look for `---RESULT_START--- … ---RESULT_END---` blocks (regex, last match with valid JSON wins).
   - Fallback: any ```` ```json ``` ```` fenced block.
   - Last-ditch: scan for top-level `{...}` candidates and try `JSON.parse`.
   - If Flue wrapped the result as `{text: "…"}` (which it does for non-`v.object`-typed prompts), unwrap once and re-extract.

5. **Throw if no JSON found**, with the first 1000 chars of stdout as the diagnostic.

---

## 3. The four agents in `.flue/agents/`

Each is a TypeScript module exporting `default async function({ init, payload, env }: FlueContext)`. Common preamble:

```ts
if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_KEY) {
  process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_KEY;
}
const loadedPayload = payload.payloadFile
  ? JSON.parse(await readFile(payload.payloadFile, "utf8"))
  : payload;
const agent = await init({ model: "anthropic/claude-sonnet-4-6" });
const session = await agent.session();
return session.prompt(...)
```

Then they diverge:

| Agent | Job | Result format |
|---|---|---|
| `finqa-observer.ts` | "Codify a reusable TypeScript function for this intermediate FinQA table-reasoning step." Has detailed design-posture rules (Unix-philosophy, no I/O, no imports, `new Function`-compatible). | Sentinel-marker JSON: `{functionName, description, source}` |
| `finqa-outlook-agent-factory.ts` | "Create a reusable typed agent interface, not a one-off answer." Hardcodes `agentName: "negativeOutlookReferenceScorerAgent"`, caps prompt under 900 chars, dictates exact output schema. | Sentinel-marker JSON: `{agentName, description, prompt}` |
| `finqa-agent-factory.ts` | Creates a sentiment task-agent interface. | **valibot-typed** result via the second arg to `session.prompt`: `v.object({ agentName, description, prompt })` |
| `tenant-agent-launcher.ts` | Runs an already-minted scorer or sentiment agent. Two modes via `payload.launcher.mode`: `outlook-score` (sentinel-marker JSON, schema enforced via prompt) or `sentiment` (valibot-typed result). | Mixed |

The split between sentinel-marker JSON and valibot-typed results is inconsistent. The valibot path uses Flue/pi's typed-result feature (Decision #8 of the design referenced this); the marker path falls back to prompt-driven discipline.

---

## 4. How a single unit gets scored

The negative-outlook flow shows the fan-out:

```
runner.ts:runNegativeOutlookQuery
  → finqa_observe.createAgentPrimitive          (one Flue call to outlook-agent-factory)
    persists OutlookScorerAgentSpec to agents/<tenant>/<name>.json
  → finqa_outlook.scoreUnits                    (one Flue call PER UNIT)
    Promise.all(units.map(unit => runtime.scoreUnit({spec, unit, …})))
      each scoreUnit → tenant-agent-launcher with launcher.mode="outlook-score"
  → finqa_observe.codifyTableFunction           (one Flue call to finqa-observer)
    persists TS glue source, evaluated via new Function on replay
```

**A 50-sentence document = 50 subprocess spawns of `pnpm exec flue run tenant-agent-launcher`.** Each spawn cold-starts pnpm, the Flue CLI, and a fresh Anthropic client. There's no batching, no session reuse, no streaming.

---

## 5. Mode selection (fixture / anthropic / flue)

Each runtime has a factory that switches on a string:

```ts
// finqa_observe.ts:374
export function createObserverRuntime(kind = process.env.ATLASFS_OBSERVER ?? "fixture") {
  if (kind === "flue") return new FlueCliObserverRuntime();
  if (kind === "anthropic") return new AnthropicObserverRuntime();
  return new FixtureObserverRuntime();
}
```

Three real implementations of every runtime:
- **`Fixture*`** — deterministic mocks. Used by tests.
- **`Anthropic*`** — calls the Anthropic SDK directly in-process (`@anthropic-ai/sdk`). No Flue, no subprocess.
- **`FlueCli*`** — the subprocess path described above.

The live demo (`pnpm atlasfs demo`) hard-requires `--observer flue` and `--outlook-agent flue` (`src/cli.ts:179-184`). Tests can pick whichever they want via `ATLASFS_OBSERVER` / `ATLASFS_OUTLOOK_AGENT`.

---

## 6. Hardcoded surfaces in the host's relationship with Flue

- **Working directory.** `runFlueJson` does `cwd: process.cwd()` and reads `.env` and `node_modules` from cwd. Run from anywhere else and it breaks.
- **Output dirs are never cleaned.** Each call writes to `node_modules/.cache/atlasfs-flue/<agent>-<ts>-<rand>/` and leaves it. Over a long demo this accumulates.
- **Model is pinned in the agent files** (`anthropic/claude-sonnet-4-6`). The host can't override it without editing the `.flue/agents/*.ts`.
- **`pnpm exec` is hardcoded.** Won't work in npm or yarn projects.
- **Three near-duplicate copies** of `runFlueJson` + `parseFlueJson` + `extractJsonText` in `finqa_observe.ts`, `finqa_outlook.ts`, `finqa_agent.ts`. Same code, three places.

---

## 7. Where this diverges from the design's Flue posture

Decisions #8 + #15 + #16 in `kb/product-design.md` describe Flue as **the in-process agent runtime hosted in a Cloudflare Worker** — `flue build --target cloudflare`, `wrangler deploy`, agent loops persisted via a custom `DurableObjectSessionStore`, valibot results streaming back over SSE.

What the prototype actually does:
- `--target node`, not `cloudflare` — no Worker, no DO.
- Subprocess per call, not in-process; no shared session, no streaming.
- No custom session store; each subprocess starts a fresh `agent.session()`.
- The Worker-hosted "structural per-tenant isolation via DO instances" doesn't exist; tenancy is the host-side directory convention.
- `cwd: process.cwd()` + `--env .env` is the antithesis of "agent never sees secrets" (Core Design Principle #4) — but in this prototype the agent runs in a child Node process with full env and full fs.

Flue is here, but it's playing the role of "a CLI that runs my Anthropic prompts with valibot-typed results", not the role of "the sandboxed agent runtime in a Worker." It's the cheapest possible integration that lets the prototype claim Flue is in the path.

---

## 8. Implications for the SDK direction

PRD 006 calls for replacing this entirely:
- In-process agent runtime (Flue-as-library or Claude Agent SDK).
- Persistent session per tenant; no per-call cold start.
- Batching for fan-out (a 50-unit document → 1 call or N calls on a shared session).
- Single normalised result envelope; no marker-scraping.
- Model selection from the host, not pinned in agent files.

The four `.flue/agents/*.ts` files become *prompt templates* the SDK loads, not standalone executables.
