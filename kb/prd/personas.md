---
title: "Datafetch — Personas"
type: prd
status: design-target
date: 2026-05-04
---

# Personas

Three personas with three different interfaces over the same runtime. The data user's contract cascades to the others — provider has to deliver something a user can mount; agent has to do programmatically what a user does interactively. Read in order.

---

## 1. Data Provider

The provider owns a dataset and wants to expose it as a mountable surface. They care about: substrate adapter, warm-up policy, drift events, who can mount. They don't care about: tenant intents, individual queries, sub-agent internals.

### Lifecycle

1. Pick a substrate (Atlas, HuggingFace, Postgres, S3, JSONL).
2. Configure access policy (open / allow-list, read / read-write).
3. Publish the mount.
4. Watch warm-up status (or ignore if lazy).
5. Subscribe to drift / family-promotion events.
6. Version / fork the mount when the underlying data evolves.

### Mock — exposing FinQA from Atlas

```ts
import { datafetch } from "@datafetch/sdk";
import { atlasMount } from "@datafetch/adapter-atlas";

const finqa = await datafetch.publishMount({
  id: "finqa-2024",
  source: atlasMount({
    uri: process.env.ATLAS_URI!,
    db: "finqa",
  }),
  warmup: "lazy",                           // or "eager", or { mode: "eager", sampleSize: 1000, indexHints: true }
  policy: {
    access: "open",                         // or { allow: ["acme-*"] }
    write: false,                           // tenant overlays handle writable bits
  },
});

// Watch warm-up (lazy mode — stages run async)
for await (const event of finqa.status()) {
  console.log(event);
  // {stage: "probing"}
  // {stage: "sampling", collection: "cases", progress: 0.4}
  // {stage: "inferring", collection: "cases"}
  // {stage: "applying-meta-harness"}
  // {stage: "ready"}
}

// Operational signals
finqa.on("drift", (e) => {
  console.log(`drift on ${e.collection}: ${e.oldFingerprint} → ${e.newFingerprint}`);
  console.log(`${e.staleDependents.length} dependents flagged`);
});

finqa.on("family-promoted", (e) => {
  console.log(`new function in /lib/ for all tenants: ${e.name}`);
  console.log(`from ${e.contributingTenants} convergent trajectories`);
});

// Inspect what got synthesised
const inv = await finqa.inventory();
// [{name: "cases", rows: 8281, fingerprint: "sha256:c3f1...", indexes: ["finqa_cases_text"]}, ...]

const schemaSrc = await finqa.read("/db/cases.ts");
console.log(schemaSrc.slice(0, 500));      // peek at the typed module the bootstrap synthesised
```

### Variant — exposing the same dataset from HuggingFace

```ts
import { hfMount } from "@datafetch/adapter-huggingface";

await datafetch.publishMount({
  id: "finqa-hf",
  source: hfMount({ repo: "dreamerdeo/finqa", split: "train" }),
  warmup: "eager",
});
```

The provider's code shape is identical across substrates. The adapter encapsulates the source-specific bits.

### What the provider doesn't see

- Which tenants are active or what they're asking.
- Individual queries, trajectories, or sub-agent invocations.
- The contents of any tenant's private overlay.

They see *aggregate* drift and promotion events, mount inventory, mount fingerprint. The privacy line is at the meta-harness boundary.

---

## 2. Data User

The user is a developer building an app or a workflow that consumes a mounted dataset. They care about: typed call shape, result envelope, generated namespace methods, cost trend over time. They don't care about: how the SDK got the answer, which tier ran.

### Lifecycle

1. Connect to one or more mounts with a tenant identity.
2. Make typed calls (`df.query`, `df.run`, or per-tenant typed methods).
3. Read the result envelope for value + provenance + cost.
4. Subscribe to events for crystallisation + drift if needed.
5. Refresh types as the tenant's `/lib/` grows.

### Mock — full happy path

```ts
import { datafetch } from "@datafetch/sdk";
import * as v from "valibot";

const df = await datafetch.connect({
  tenant: "acme-finance",
  mounts: ["finqa-2024"],
});

// First call — novel intent, runs full ReAct, slow but works
const r1 = await df.query({
  intent: "what is total revenue for AAPL in 2017",
  expect: v.object({
    amount: v.number(),
    evidence: v.array(v.object({ source: v.string(), value: v.number() })),
  }),
});

console.log(r1.value.amount);              // 229_234_000_000
console.log(r1.mode);                      // "novel"
console.log(r1.cost.tier);                 // 4
console.log(r1.cost.tokens.cold);          // 8420

// Same intent shape, different params — procedure crystallised by observer behind the scenes
const r2 = await df.query({
  intent: "what is total revenue for MSFT in 2018",
  expect: v.object({ amount: v.number(), evidence: v.array(v.unknown()) }),
});

console.log(r2.mode);                      // "interpreted"
console.log(r2.cost.tokens.cold);          // 0

// After crystallisation, the typed namespace method autocompletes
const r3 = await df.lib.totalRevenue({ company: "GOOG", year: 2019 });
//                ^^^^^^^^^^^^ — auto-generated from /lib/totalRevenue.ts

// Or use df.run for direct snippet execution (codemode-style)
const r4 = await df.run(async () => {
  const cands = await df.db.cases.findSimilar("META 2020 revenue", 5);
  const filing = await df.lib.pickFiling({ question: "META 2020", candidates: cands });
  return df.lib.locateFigure({ question: "total revenue", filing });
});
```

### The result envelope

```ts
type Result<T> = {
  value: T;                              // typed by `expect` or by the function's output schema

  mode: "cache" | "compiled" | "interpreted" | "llm-backed" | "novel";

  cost: {
    tier: 0 | 1 | 2 | 3 | 4;
    tokens: { hot: number; cold: number };
    ms: { hot: number; cold: number };
    llmCalls: number;
  };

  provenance: {
    tenant: string;
    mount: string;
    functionName?: string;
    trajectoryId: string;
    pins: Record<string, string>;        // every artefact the call touched, with hashes
  };

  escalations: number;                   // 0 = direct hit, >0 = had to fall back

  warnings?: Array<{ code: string; message: string }>;
};
```

Three things every result carries:

- **Evidence** — substrate-level cells/rows that produced the answer. Carried in `value.evidence` when the schema declares it.
- **Provenance** — function name, trajectory ID, pin hashes. Lets the user (or auditor) trace back to specific files.
- **Cost** — the field that decreases over time. Surfaces what would otherwise be invisible.

### Optional event subscriptions

```ts
df.on("function-crystallised", (e) => {
  console.log(`new method available: df.lib.${e.name}`);
});

df.on("schema-drift", (e) => {
  console.log(`mount ${e.mount} schema changed; ${e.staleDependents} functions need re-verification`);
});
```

Default: silent. Let the cost line falling be the visible signal.

### Per-tenant `.d.ts` regeneration

As `/lib/` grows for this tenant, the SDK regenerates `node_modules/@datafetch/types/<tenant>.d.ts` so `df.lib.<method>(...)` autocompletes. The user calls `df.refresh()` to pull the latest after a long-running session, or relies on automatic refresh on connection.

---

## 3. Data Agent

The agent is an LLM in a tool-using loop. They care about: discovering what's available, calling typed functions, composing snippets, recovering from errors. They don't care about: SDK ergonomics, generated typed namespaces, async crystallisation timing.

### Lifecycle

1. Receive a user prompt or task.
2. Orient (cat AGENTS.md, ls /db, ls /lib).
3. Look for an existing function that matches (`apropos`, `man`).
4. Either call it directly, or compose a snippet from primitives.
5. If a needed capability is missing, write a new function file via `cat > /lib/<name>.ts <<EOF` using existing functions as templates.
6. Return the typed result to the caller.

The agent's only tool is `bash`. Each tool call runs one bash command. Multiple calls within one conversation share the same shell session (with the per-call shell-state-reset quirk noted in `design.md` §12.3).

### The FinQA worked example

A user asks: *"Looking at Visa, Mastercard, and American Express — which payment network had the most consistent revenue growth between 2014 and 2018?"*

#### Turn 1 — Orient

```bash
$ cat /AGENTS.md | head -30
# Datafetch workspace

You are in a datafetch workspace with the following mounts:
- /db/finqa-2024/ — FinQA filings, 8281 documents
- /lib/ — your function pool (read-write, tenant-private over mount-shared)
...

$ ls /db /lib
/db:
finqa-2024/

/lib:
arithmetic.ts  locateFigure.ts  pickFiling.ts  skills/

$ jq '{kind, rows: .cardinality.rows, fields: (.fields | keys)}' /db/finqa-2024/cases/_descriptor.json
{ "kind": "documents", "rows": 8281, "fields": ["filename","question","preText","postText","table","searchableText"] }
```

#### Turn 2 — Look for an existing function

```bash
$ apropos "compare consistency revenue across companies"
(no matches above 0.5)

$ apropos "filing lookup company year"
pickFiling (df.lib)        - select the most likely filing from search candidates
locateFigure (df.lib)      - locate a numeric cell in a filing's table given a textual question

$ man pickFiling | head -25
NAME
       pickFiling - select the most likely filing from search candidates given a question
SYNOPSIS
       df.lib.pickFiling({ question, candidates, priorTickers? })
INPUT SCHEMA
       question: string
       candidates: Case[]
       priorTickers: string[]
OUTPUT
       Case
EXAMPLES
       df.lib.pickFiling({ question: "Visa 2017", candidates: [...], priorTickers: ["V"] })
       → { filename: "V/2017/page_42.pdf", ... }
```

Nothing crystallised yet for cross-company comparison. I'll have to compose. Three primitives + the substrate retrieval should do it.

#### Turn 3 — Probe the chain

```bash
$ npx tsx -e "
  const cands = await df.db.cases.findSimilar('Visa 2017 operating revenue', 5);
  const filing = await df.lib.pickFiling({ question: 'Visa 2017', candidates: cands, priorTickers: ['V'] });
  const fig = await df.lib.locateFigure({ question: 'operating revenues 2017', filing });
  console.log(JSON.stringify({filename: filing.filename, ...fig}));
"
{"filename":"V/2017/page_42.pdf","value":18358,"row":"operating_revenues","column":"2017","evidence":"..."}
```

Chain works.

#### Turn 4 — Full composition

```bash
$ cat > /tmp/comparison.ts <<'EOF'
const companies = [
  { name: "Visa",                ticker: "V"   },
  { name: "Mastercard",          ticker: "MA"  },
  { name: "American Express",    ticker: "AXP" },
];
const years = [2014, 2015, 2016, 2017, 2018];

const figures = await Promise.all(
  companies.flatMap(c => years.map(async y => {
    const cands  = await df.db.cases.findSimilar(`${c.name} ${y} operating revenues`, 5);
    const filing = await df.lib.pickFiling({ question: `${c.name} ${y}`, candidates: cands, priorTickers: [c.ticker] });
    const fig    = await df.lib.locateFigure({ question: "operating revenues", filing });
    return { company: c.name, year: y, revenue: fig.value };
  }))
);

const byCompany = companies.map(c => {
  const series = figures.filter(f => f.company === c.name).sort((a,b) => a.year - b.year);
  const yoy = series.slice(1).map((curr, i) => ({
    year: curr.year,
    growthPct: ((curr.revenue - series[i].revenue) / series[i].revenue) * 100,
  }));
  const mean = yoy.reduce((s,x) => s + x.growthPct, 0) / yoy.length;
  const stddev = Math.sqrt(yoy.reduce((s,x) => s + (x.growthPct - mean) ** 2, 0) / yoy.length);
  return { company: c.name, yoy, meanGrowthPct: +mean.toFixed(2), stdDevPct: +stddev.toFixed(2) };
});

const mostConsistent = [...byCompany].sort((a,b) => a.stdDevPct - b.stdDevPct)[0].company;
console.log(JSON.stringify({ byCompany, mostConsistent }, null, 2));
EOF

$ npx tsx /tmp/comparison.ts | jq '{mostConsistent, summary: [.byCompany[] | {company, meanGrowthPct, stdDevPct}]}'
{
  "mostConsistent": "American Express",
  "summary": [
    { "company": "Visa",             "meanGrowthPct": 13.05, "stdDevPct": 5.21 },
    { "company": "Mastercard",       "meanGrowthPct": 12.25, "stdDevPct": 6.48 },
    { "company": "American Express", "meanGrowthPct":  2.28, "stdDevPct": 4.74 }
  ]
}
```

AmEx had the most consistent growth (lowest stddev). Returns to the user.

#### Turn 5 — Coming back the next day

```bash
$ ls /lib
arithmetic.ts  locateFigure.ts  pickFiling.ts  crossCompanyRevenueConsistency.ts  skills/

$ man crossCompanyRevenueConsistency | head -15
NAME
       crossCompanyRevenueConsistency - compare YoY revenue growth consistency across companies
SYNOPSIS
       df.lib.crossCompanyRevenueConsistency({ companies, years, metric? })
DESCRIPTION
       Composition. Pins: db.cases@a1f3, lib.pickFiling@b2e8, lib.locateFigure@c3d1
       @cost interpreted (~50ms, 0 LLM calls)
       @verified 1 trajectory replayed successfully
```

Observer crystallised the pattern from yesterday. I can call it directly.

```bash
$ npx tsx -e "console.log(JSON.stringify(await df.lib.crossCompanyRevenueConsistency({
  companies: [{name:'Visa',ticker:'V'},{name:'Mastercard',ticker:'MA'},{name:'American Express',ticker:'AXP'},{name:'Discover',ticker:'DFS'}],
  years: [2014,2015,2016,2017,2018]
})))"
```

#### Turn 6 — Need a new LLM-backed function

User follow-up: *"write me a one-paragraph narrative summary of which company is the steadiest and why."*

```bash
$ apropos "summarise narrative tone comparison"
(no matches)
```

Need to write one. Look at an existing LLM-backed function to use as a template:

```bash
$ apropos "score document"
scoreCompetitiveOutlook (df.lib)   - score one document unit for negative competitive-outlook references

$ man scoreCompetitiveOutlook
$ cat /lib/scoreCompetitiveOutlook.ts
$ cat /lib/skills/score_competitive_outlook.md
```

Now write the new function. Two ways: inline prompt (simpler, one file) or externalised skill (when the prompt is long enough to deserve its own file). The prompt here is moderate, so inline is fine:

```bash
$ cat > /lib/summariseConsistencyComparison.ts <<'EOF'
import { fn, llm } from "@datafetch/sdk";
import * as v from "valibot";

export const summariseConsistencyComparison = fn({
  intent: "summarise a cross-company revenue-consistency comparison as a one-paragraph narrative, identifying the steadiest company and explaining its character",
  examples: [
    {
      input: {
        byCompany: [
          { company: "X", meanGrowthPct: 10.0, stdDevPct: 2.1 },
          { company: "Y", meanGrowthPct: 12.0, stdDevPct: 6.0 },
        ],
        mostConsistent: "X",
      },
      output: {
        narrative: "Across the period, X exhibited the steadiest growth...",
        highlightedCompany: "X",
        keyMetric: "stddev 2.1pp vs 6.0pp",
      },
    },
  ],
  input:  v.object({
    byCompany: v.array(v.object({
      company: v.string(), meanGrowthPct: v.number(), stdDevPct: v.number(),
    })),
    mostConsistent: v.string(),
  }),
  output: v.object({
    narrative: v.string(),
    highlightedCompany: v.string(),
    keyMetric: v.string(),
  }),
  body: llm({
    model: "anthropic/claude-haiku-4-5",
    prompt: `You produce a single-paragraph narrative summary of a revenue-consistency comparison.
- Length: 80–120 words.
- Highlight the company named in 'mostConsistent' (lowest stddev).
- Contextualise its consistency relative to peers using the supplied numbers.
- Avoid superlatives; report the figures.`,
  }),
});
EOF

$ npx tsx -e "
  const c = await df.lib.crossCompanyRevenueConsistency({...});
  const s = await df.lib.summariseConsistencyComparison({byCompany: c.byCompany, mostConsistent: c.mostConsistent});
  console.log(s.narrative);
"
"Across 2014–2018, American Express posted the steadiest year-on-year operating revenue trajectory, with growth rates clustering at a mean of 2.3% and a stddev of 4.7 percentage points — narrower than Visa (mean 13.1%, stddev 5.2pp) and Mastercard (mean 12.2%, stddev 6.5pp). The trade-off is visible: AmEx's consistency comes alongside the lowest absolute growth..."
```

End of task.

### What this scenario demonstrates

| Property | Where it shows up |
|---|---|
| Bash-shaped discovery | Turns 1–2: `cat`, `ls`, `jq`, `apropos`, `man` |
| Composition from primitives | Turn 4: 15-way fan-out using `df.db.cases.findSimilar`, `df.lib.pickFiling`, `df.lib.locateFigure` |
| Async crystallisation | Turn 5: `crossCompanyRevenueConsistency.ts` appeared without ceremony |
| File-write as authorship | Turn 6: `cat > <<EOF` writes a new TS function with `body: llm({...})` inline |
| Full transparency | Turn 6: `man`, `cat` to inspect existing function as template |
| Cost implicit in calls | Turn 4 was tier-2/3; Turn 5 was tier-2; Turn 6 was tier-3 (new LLM call) |

The agent never wrote a Flue agent directly. Never picked a routing tier. Never thought about sandboxes or sessions. Never invoked a "synthesise" verb. They composed typed functions, wrote a new file when needed (using existing functions as templates), and returned typed results. That's the whole experience.

---

## What the three personas share

A single execution model under three different surfaces:

```
Provider: datafetch.publishMount(...)
   ↓
   data plane warm-up (probe → sample → infer → meta-harness apply → indexes)

User:     datafetch.connect(...).query/.run/.lib.<fn>(...)
Agent:    bash → npx tsx → df.*

   ↓ all three reduce to ↓
   one execution endpoint on the data plane: run a typed snippet
   one trajectory recorder
   one observer + optimiser pipeline
   one cross-tenant promotion mechanism
```

The provider sets the dataset boundary. The user sets the tenant boundary. The agent operates within both. All three share the same artefact contract, the same function model, the same VFS layout.

---

## What the user/agent doesn't worry about

Worth saying explicitly, because the prior iterations of this design exposed too much:

| Hidden | Surfaced when |
|---|---|
| Which procedure the runtime picked | `provenance.functionName` field, if asked |
| Which substrate (Atlas/Postgres/JSONL) is underneath | Available via `inventory()` and `_descriptor.json`; not in the call path |
| Sub-agent registry / capability tags | Internal to `agent({...})` body resolution; agent never names them |
| Schema fingerprints | In `provenance.pins`, only when relevant |
| Async crystallisation timing | Surface only via opt-in `function-crystallised` event |
| Index existence / structure | Hidden behind `findSimilar` / `hybrid` |
| Model selection for LLM bodies | Skill declares; runtime resolves; user/agent don't pick |
| Cost-tier routing logic | Implicit in what the agent calls; explicit in the result envelope |

The user sees value + cost. The agent sees a Unix shell. Everything else is plumbing.
