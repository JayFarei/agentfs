---
title: "Voyage AI as the Retrieval Backbone for a Code-Mode Data Interface"
date: 2026-05-01
mode: deep
sources: 17
status: complete
---

# Voyage AI as the Retrieval Backbone for a Code-Mode Data Interface

## Executive Summary

Voyage AI is the highest-accuracy retrieval stack on the market today (state-of-the-art on the RTEB benchmark, beating OpenAI `text-embedding-3-large` by roughly 14% NDCG@10 and Cohere `embed-v4` by 8.2%) and is now wholly owned by MongoDB after the February 24, 2025 acquisition. Its surface is small and orthogonal: text embeddings, contextualized chunk embeddings, multimodal embeddings, and rerankers, each exposed as a single function. That tight surface is what makes it the right primitive for the integration the user is exploring: a virtualized, thin data interface that exposes a vast vector-addressable corpus to an agent without ever turning each search, filter, or rerank into a separately-registered MCP tool.

The Cloudflare Code Mode pattern shows the upper bound of what such an interface can look like. By converting an MCP server's tool catalog into a TypeScript namespace and asking the LLM to write code that calls it inside a V8 isolate, Cloudflare collapsed a 2,500-endpoint MCP from over a million tokens of context to roughly a thousand, an 81 to 99.9% reduction depending on the metric, and let the agent chain calls without round-tripping each result through the model. Voyage's API maps onto this almost too cleanly: `embed`, `contextualized_embed`, `rerank`, and `multimodal_embed` are exactly the four verbs an agent needs to navigate "an incredibly vast array of data points," and they compose naturally inside a single sandboxed code block.

The integration thesis: do not expose `voyage-search-collection-A`, `voyage-search-collection-B`, ..., `voyage-rerank-finance` as N MCP tools. Expose one `data` namespace whose typed methods wrap Voyage + a vector store (Atlas Vector Search is the obvious pairing post-acquisition), and let the agent write JavaScript that does retrieval, reranking, and parent-document expansion in a single sandboxed pass. The token budget stays flat as the corpus grows; the agent learns the schema by reading TypeScript types it has seen millions of times in training instead of contrived tool-call JSON.

## Overview

**What it is.** Voyage AI provides REST endpoints and SDKs (Python, TypeScript) for four model families:

1. **Text embeddings** , `voyage-4-large`, `voyage-4`, `voyage-4-lite`, plus domain-specialized `voyage-code-3`, `voyage-finance-2`, `voyage-law-2`. All current 4-series models are mutually compatible (you can mix vectors across them).
2. **Contextualized chunk embeddings** , `voyage-context-3`, a drop-in for standard embeddings that encodes chunk-level detail plus document-level context in a single vector. Same dimension and storage cost as standard embeddings.
3. **Multimodal embeddings** , `voyage-multimodal-3.5` (the only current model), handles interleaved text + images + video frames in a single embedding call. Supports PIL image objects and video.
4. **Rerankers** , `rerank-2.5` and `rerank-2.5-lite` are cross-encoders that re-score candidate documents against a query. They support optional instructions appended to the query.

**Adoption and traction signals.**
- Acquired by **MongoDB** on **2026-02-24** for the purpose of pulling embedding generation and reranking into the database layer. Voyage previously raised $28M from Snowflake Ventures, Databricks, and others.
- Customers cited at acquisition: **Anthropic, LangChain, Harvey, Replit**.
- Highest-rated zero-shot embedding models in the Hugging Face / MTEB community at the time of acquisition.
- Standalone API remains available post-acquisition (phase 1 of MongoDB's three-phase integration plan); phase 2 is "auto-embedding service" inside Atlas Vector Search; phase 3 is multi-modal retrieval and instruction-tuned models native to Atlas.
- Native support in **LlamaIndex**, **LangChain**, **LiteLLM**, and **Docling**.

**Why it matters now.** The combination of (a) Voyage's lead on retrieval accuracy, (b) MongoDB's commitment to "the embedding belongs in the database layer," and (c) the emerging consensus that tool-call MCP doesn't scale (Cloudflare, Anthropic Tool Search, the pctx / CMCP open-source projects) creates an unusually clean substrate for a code-mode data interface. The hackathon timing (`MongoDB-AE-Hackathon`, May 2026) is on the leading edge of native Atlas + Voyage integrations going GA.

## How It Works

### Voyage architecture

All four product lines share the same shape:

```
                  +------------------------+
client (HTTP) ->  |  api.voyageai.com/v1   |  -> embedding tensor / score list
                  |  /embeddings           |
                  |  /contextualizedembeddings
                  |  /multimodalembeddings
                  |  /rerank               |
                  +------------------------+
```

The Python SDK (`voyageai.Client`) wraps these endpoints with one method per model family. The TypeScript SDK (npm: `voyageai`) covers the same surface; this matters because code-mode agents will write TypeScript.

**Key API contracts** (concise, condensed from official docs):

```typescript
// Text embeddings
client.embed({
  texts: string[],          // up to 1000 items, model-dependent token cap
  model: "voyage-4-large" | "voyage-4" | "voyage-4-lite" | "voyage-code-3" | ...,
  input_type?: "query" | "document" | null,   // changes the prepended prompt
  output_dimension?: 256 | 512 | 1024 | 2048, // Matryoshka, 4-series only
  output_dtype?: "float" | "int8" | "uint8" | "binary" | "ubinary",
})  // -> { embeddings: number[][], total_tokens: number }

// Contextualized chunk embeddings (groups chunks by parent document)
client.contextualized_embed({
  inputs: string[][],       // each inner list = chunks of one document, ordered
  model: "voyage-context-3",
  // ... same dimension/dtype options as embed()
  chunk_fn?: (doc: string) => string[],  // server-side chunking convenience
})  // -> { results: [{ embeddings: number[][], index: number }], total_tokens }

// Multimodal embeddings
client.multimodal_embed({
  inputs: Array<Array<string | PIL.Image | Video>>,
  model: "voyage-multimodal-3.5",
  input_type?: "query" | "document",
})  // -> { embeddings, text_tokens, image_pixels, total_tokens }

// Reranker (cross-encoder)
client.rerank({
  query: string,
  documents: string[],     // up to 1000
  model: "rerank-2.5" | "rerank-2.5-lite",
  top_k?: number,
})  // -> { results: [{ index, document, relevance_score }], total_tokens }
```

**Quantization is a real lever, not a footnote.** Voyage publishes that `voyage-context-3` at binary-512 *outperforms* OpenAI v3-large at float-3072 by 0.73% while reducing vector-DB storage by 99.48%. Treat output_dtype and output_dimension as core knobs in any production design.

**Pricing** (at 2026-05-01):

| Model | $/M tokens | Free tier |
|---|---|---|
| `voyage-4-large` | $0.12 | 200M tokens |
| `voyage-4` | $0.06 | 200M tokens |
| `voyage-4-lite` | $0.02 | 200M tokens |
| `voyage-code-3`, `voyage-context-3` | $0.18 | 200M tokens |
| `voyage-multimodal-3.5` | $0.12 / M tokens, $0.60 / B pixels | 200M / 150B |
| `rerank-2.5` | $0.05 | 200M tokens |
| `rerank-2.5-lite` | $0.02 | 200M tokens |

Batch API gives 33% off with a 12-hour completion window. File storage is $0.05/GB/month. The free tiers are large enough for any hackathon to never see a bill.

### The Cloudflare Code Mode pattern (for reference)

Code Mode reframes "tool calling" as "code execution against a typed API." The pattern, in three moves:

1. **Convert** an MCP server's tool catalog into a TypeScript namespace with doc comments derived from each tool's input schema. The Cloudflare Agents SDK does this automatically: `import { codemode } from "agents/codemode/ai"`.
2. **Expose** to the LLM not the N tools but a single `eval`-style tool that takes a TypeScript snippet. The full TS namespace is loaded into the agent's context (currently statically; future work allows dynamic browsing).
3. **Execute** the snippet in a V8 isolate (Worker Loader API in production, `workerd` locally). The isolate has `globalOutbound: null` (no internet) and only the typed bindings it was given. Results return via `console.log()` and are folded back into the next agent turn.

Two efficiency wins compound:

- **Token budget**: a 2,500-endpoint MCP exposed as one tool per endpoint costs ~1.17M tokens; the same surface as a code-mode TS namespace plus `search()` / `execute()` primitives costs ~1,000 tokens. Cloudflare measured an 81% reduction on smaller surfaces and "99.9% reduction in input tokens" on the full Cloudflare API.
- **Chaining**: when an agent needs to thread the output of one call into the input of the next, traditional tool calling pumps every intermediate JSON blob through the LLM neural net just to copy it. Code mode lets the agent write `const a = await x.foo(); const b = await x.bar(a.id)` and only `console.log` the final answer. This is the larger win on multi-step retrieval.

The security story is also better: bindings replace network access. The sandbox can only reach what the host explicitly hands it. No API keys ever enter the model's context, so leakage via prompt injection becomes structurally impossible.

### How they compose: thin code-mode interface over Voyage + a vector store

The minimum viable surface for a "vast data points, no API" interface:

```typescript
// What the agent sees in its TS namespace (loaded once, ~1k tokens):

interface DataInterface {
  /** Semantic search across all collections. Returns top-k hits with snippets. */
  search(args: {
    query: string;
    k?: number;
    collections?: string[];    // optional collection scoping
    filter?: Record<string, unknown>;  // MongoDB-style filter on metadata
    rerank?: boolean;          // run rerank-2.5 on top-50 before returning top-k
  }): Promise<Hit[]>;

  /** Lookup by stable ID. Returns full document, not just chunk. */
  get(args: { id: string }): Promise<Document>;

  /** Hybrid lex + vec, when the user wants exact-term grounding. */
  searchHybrid(args: { query: string; k?: number; alpha?: number }): Promise<Hit[]>;

  /** For multimodal corpora (PDFs, slide decks, screenshots). */
  searchMultimodal(args: {
    query: string | { text?: string; image?: ImageRef };
    k?: number;
  }): Promise<Hit[]>;

  /** Walk parent-doc context when a chunk hit needs surrounding context. */
  expandChunk(args: { chunk_id: string; window?: number }): Promise<Document>;
}

interface Hit {
  id: string;
  doc_id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}
```

Inside the sandbox, Voyage and the vector store are wired up by the host:

```typescript
// Host-side glue (parent worker / agent runtime), invisible to the agent.

const voyage = new Voyage({ apiKey: env.VOYAGE_API_KEY });
const atlas = new MongoClient(env.MONGO_URI).db("rag");

const data: DataInterface = {
  async search({ query, k = 10, collections, filter, rerank }) {
    const [qVec] = (await voyage.embed({
      texts: [query],
      model: "voyage-4-large",
      input_type: "query",
    })).embeddings;

    const hits = await atlas.collection("chunks").aggregate([
      { $vectorSearch: {
          index: "voyage_idx", path: "vec", queryVector: qVec,
          numCandidates: rerank ? 50 : k * 4, limit: rerank ? 50 : k,
          filter: filter ?? {} } }
    ]).toArray();

    if (!rerank) return hits.map(toHit);

    const reranked = await voyage.rerank({
      query, documents: hits.map(h => h.text),
      model: "rerank-2.5", top_k: k,
    });
    return reranked.results.map(r => toHit(hits[r.index], r.relevance_score));
  },
  // ... other methods
};
```

The agent then writes one snippet that does what would otherwise be 3 to 5 round-trip tool calls:

```typescript
// Agent-authored, runs in the V8 isolate.
const hits = await data.search({
  query: "How did Greenery Corp Q2 2024 revenue change vs Q1?",
  k: 20, rerank: true,
  filter: { sector: "agriculture", year: { $gte: 2024 } },
});
const top = hits.slice(0, 3);
const expanded = await Promise.all(top.map(h => data.expandChunk({ chunk_id: h.id, window: 1 })));
console.log(expanded.map(d => ({ id: d.id, text: d.text })));
```

That snippet calls Voyage twice, Atlas twice, and returns one structured payload to the agent. None of the 20 mid-pipeline hits ever enter the model's context.

## Strengths

- **Retrieval accuracy lead is real and measured**, not just marketing. RTEB internal benchmark: Voyage beats OpenAI `text-embedding-3-large` by 14% NDCG@10, Cohere `embed-v4` by 8.2%. On domain-specific retrieval (code, legal, medical, finance), Voyage 3-large is 4 to 6 MTEB points ahead per third-party comparisons.
- **`voyage-context-3` is unusually well-suited to code-mode data access.** It removes the engineering tax of manual context augmentation (no more "decorate every chunk with title/author/date strings before embedding"), and at binary-512 it costs 0.5% of OpenAI v3-large storage at parity quality. For a "vast array of data points," storage scaling is the constraint; Voyage attacks it directly.
- **32K-token context window** across the current generation. Larger than OpenAI/Cohere comparable tiers. Lets a single chunk actually be a meaningful unit (whole API page, whole legal section).
- **Matryoshka dimensions and quantized dtypes are first-class.** Same model, same vectors, four dimension options and five dtype options. Keeps the storage / accuracy tradeoff under the host's control without re-embedding.
- **Tight, orthogonal API surface.** Four functions, no irregularities. This is what makes it ideal for code-mode wrapping: a TypeScript namespace describing the entire surface is roughly 60 lines of types.
- **MongoDB acquisition reduces, not increases, integration risk** for this hackathon specifically. Atlas Vector Search + Voyage is now a first-party pairing with auto-embedding on the roadmap.
- **Free-tier generosity is hackathon-friendly**: 200M tokens free across the 4-series and rerank-2.5. A typical hackathon corpus does not approach this ceiling.
- **Reranker quality matters more than embedding quality at small k.** Voyage's `rerank-2.5` supports instruction-following, which composes nicely with code-mode (the agent can supply task-specific instructions in the same code snippet).

## Limitations & Risks

- **No native MCP server.** Voyage exposes REST + SDKs; there is no `voyage.mcp.run` or equivalent today. Code-mode integration requires writing the typed wrapper yourself. (This is also an *opportunity* for the project: be the canonical code-mode wrapper.)
- **Free-tier rate limits without a payment method are punishing**: 3 RPM and 10K TPM. Indexing-time backfills can fail silently from rate-limit 429s. Always add a card before any meaningful corpus ingestion, and implement exponential backoff. The SDK does not auto-backoff in a robust way.
- **Python SDK has a 128-document batch limit on some legacy paths**, returns 400 instead of auto-batching above this. Call sites must chunk inputs manually or check the per-model 1000-input cap.
- **Rate-limit headers are not exposed**, per developer feedback in their forum. Manual tracking drifts out of sync. Plan for retry-after parsing instead of preemptive rate-limit accounting.
- **No SOC2 / HIPAA certifications** as of mid-2026. Regulated data must stay outside Voyage or use Atlas-side controls.
- **Vendor lock-in via vector format**: switching providers requires re-embedding the full corpus. Linear in document count. Mitigate by keeping raw text alongside embeddings (you should do this anyway for rerank/expansion) and by using `voyage-context-3` so the chunk text is recoverable.
- **Platform risk after the MongoDB acquisition**: phase 2 and 3 of MongoDB's roadmap may make Voyage's standalone API a second-class citizen vs Atlas-native auto-embedding. Hackathon-scale projects are insulated; production migrations should anticipate the standalone API receiving fewer new features than the Atlas-integrated path.
- **Multimodal model has a hard 16M-pixel-per-image and 20MB-per-input ceiling**, with images under 50K pixels upscaled and billed as 50K. PDF-screenshot pipelines must pre-resize.
- **No JavaScript reranking SDK historically** (though TypeScript library now exists for the full API). Verify TS coverage before assuming parity with Python.
- **Code-mode integration introduces its own risk**: the V8 sandbox must be hardened. Cloudflare's Worker Loader is in closed beta for production; locally you can use `workerd` via Wrangler, but a self-hosted equivalent (Deno's permission system, isolated-vm) requires careful configuration. The bindings-only-no-network discipline must be enforced; if the sandbox can fetch arbitrary URLs, a prompt-injection attack reads `process.env`.

## Integration Analysis

The hackathon project is `MongoDB-AE-Hackathon` and the `kb/` files are still placeholders. The user's framing ("a virtualized, thin interface to data that doesn't use an API but uses code mode to access an incredibly vast array of data points") is the design thesis itself. This brief is therefore as much a design seed as a fit assessment.

### Fit assessment: Strong Fit

The Voyage API and the Cloudflare Code Mode pattern were not designed for each other but they meet at the right joint. Voyage's surface is exactly the right size to expose as a typed namespace. Atlas Vector Search is the natural backing store, and post-acquisition both are MongoDB-owned, which makes a hackathon entry on this stack thematically aligned with the host event.

### What to extract

From the **Code Mode pattern**:
1. **Convert tool catalogs to TypeScript namespaces, not tool lists.** The single design move that makes the rest possible.
2. **One eval-style tool per agent, not N domain tools.** The agent calls `runCode(snippet)`, the runtime executes it in a sandbox.
3. **Bindings, not network.** The sandbox gets typed objects (Voyage client, Atlas client), no general fetch. Hides API keys structurally.
4. **`console.log` is the return channel.** Anything not logged stays inside the sandbox and out of the model's context. This is the chaining win.
5. **V8 isolates over containers** for hackathon-scale throughput. A new isolate per code execution costs milliseconds.

From **Voyage**:
1. **`voyage-context-3` as default**, not standard `voyage-4`. Same storage cost, better retrieval, removes the "stuff metadata into the chunk" engineering tax.
2. **`rerank-2.5` always-on for top-k <= 10.** The retrieve-50, rerank-to-10 pattern is well-trodden and Voyage's reranker leads its category.
3. **Multimodal-3.5 as the PDF / slide-deck path.** Skip OCR. Embed the screenshot directly.
4. **Quantization (`binary` or `int8`) for the storage dimension** when the corpus exceeds ~1M chunks. Negligible quality drop, 8 to 32x storage win.
5. **Domain models (`voyage-code-3`, `voyage-finance-2`, `voyage-law-2`)** when the corpus is mono-domain. The 4 to 6 MTEB-point lead pays for itself in fewer rerank calls.

### Bootstrap path

**Minimum viable code-mode data interface in 4 hours:**

1. **30 min** , Spin up MongoDB Atlas free tier with Vector Search index.
2. **30 min** , Write an ingestion script that: (a) chunks docs with LangChain's recursive splitter, (b) calls `voyage.contextualized_embed` per parent doc, (c) inserts `{doc_id, chunk_id, text, vec, metadata}` into Atlas with a `voyage_idx` vector index. Cap at 1000 chunks per `inputs` list, 16K chunks total per call.
3. **45 min** , Implement the 5-method `DataInterface` (search, get, searchHybrid, searchMultimodal, expandChunk) as a thin Node.js module wrapping `voyageai` SDK + MongoDB driver.
4. **45 min** , Wire in a code-mode runtime. For a hackathon, the simplest path is **`isolated-vm`** (npm) for Node, or fork the Cloudflare Agents SDK `agents/codemode/ai` helper and run it under `workerd` via Wrangler. Either way: the agent gets one tool, `runCode(snippet: string)`, and the snippet sees only the `data` binding.
5. **45 min** , Generate the TypeScript namespace by reflecting over `DataInterface`. Inject the resulting `.d.ts` (about 60 lines) into the agent's system prompt.
6. **45 min** , End-to-end test: ask "summarize Q2 2024 revenue trends across all SEC filings in the corpus" and verify the agent writes a single snippet that retrieves, reranks, expands parent docs, and synthesizes, with no intermediate hits leaking into context.

**Effort estimate: Medium (~1 day)** for a working demo. **Large (>1 day)** to harden the sandbox for non-hackathon use.

### Open questions

- **Does Atlas Vector Search support `voyage-context-3` natively in May 2026, or does the hackathon project drive embeddings client-side?** MongoDB docs note the "Embedding and Reranking API is in **Preview**" and details are not finalized. Verify before committing to auto-embedding.
- **Sandbox runtime for the demo: `workerd` vs `isolated-vm` vs Deno Deploy?** Each has different security and packaging tradeoffs. `workerd` matches the Cloudflare reference implementation but requires Wrangler in the loop; `isolated-vm` is the lowest-friction Node-native option but has had memory-leak history; Deno's permission system gives a clean middle ground.
- **Static or dynamic schema discovery?** Static (whole TS namespace in context) is simplest and matches Cloudflare's current implementation. Dynamic (`search()` + `execute()` primitives over an OpenAPI-like spec) scales to thousands of methods but adds complexity. For one Voyage-backed `data` object the static path is fine; if the project later exposes M tenant-specific or domain-specific namespaces, revisit.
- **How to handle non-deterministic reranker scores in the agent's reasoning?** `relevance_score` is not calibrated across queries. The agent's snippet should compare scores within a single query, not threshold across queries.

## Key Takeaways

1. **Voyage's API is the rare API that genuinely benefits from being unwrapped into a code-mode TypeScript namespace.** Four orthogonal verbs, all I/O is JSON, no irregularities. Investing 60 lines of type definitions plus a 5-method host wrapper buys an agent that can chain retrieval, reranking, and parent-doc expansion in one sandboxed snippet, with the corpus-side data never entering the LLM context. This is the highest-leverage move the project can make in week one.
2. **Default to `voyage-context-3` + `rerank-2.5`, not `voyage-4-large` alone.** Contextualized chunk embeddings remove the "stuff metadata into chunks" engineering tax and stay storage-equivalent to standard embeddings; the reranker is a cross-encoder that fixes the top-k that bi-encoder embeddings get wrong. Combined cost on the 200M free tiers is effectively zero for any hackathon corpus.
3. **Use bindings, not API keys, in the sandbox.** Whatever sandbox runtime the project picks (`workerd`, `isolated-vm`, Deno), the host should expose Voyage and Atlas as typed objects rather than handing the agent the raw clients. This makes prompt-injection key exfiltration structurally impossible and matches the Cloudflare reference implementation. It also keeps the "no API" framing honest: the agent literally cannot make HTTP calls.
4. **Plan for the platform risk explicitly.** Voyage's standalone REST API is phase 1 of a three-phase MongoDB integration. Keep the host wrapper thin (one file, one Voyage client, one Atlas client) so that swapping the standalone API for Atlas's native auto-embedding service in phase 2 is a one-file change. This also leaves the door open to swapping in Cohere or a self-hosted BGE model if any of the Voyage limitations (no SOC2, rate limits, premium pricing) bite later.

## Sources

**Primary, official:**
- [Voyage AI: Introduction](https://docs.voyageai.com/docs/introduction) , product overview and architecture rationale.
- [Voyage AI: Text Embeddings](https://docs.voyageai.com/docs/embeddings) , `voyage-4-*` model surface, Python and TS SDKs, REST endpoint contracts.
- [Voyage AI: Contextualized Chunk Embeddings](https://docs.voyageai.com/docs/contextualized-chunk-embeddings) , `voyage-context-3` API and quickstart with parent-document retrieval.
- [Voyage AI: Multimodal Embeddings](https://docs.voyageai.com/docs/multimodal-embeddings) , `voyage-multimodal-3.5` surface for interleaved text + image + video.
- [Voyage AI: Rerankers](https://docs.voyageai.com/docs/reranker) , `rerank-2.5` cross-encoder API and instruction-following.
- [Voyage AI: Pricing](https://docs.voyageai.com/docs/pricing) , per-token pricing table, free tier, batch API discount.
- [Voyage AI by MongoDB: Docs](https://www.mongodb.com/docs/voyageai/) , post-acquisition integration landing.
- [Cloudflare Blog: Code Mode, the better way to use MCP](https://blog.cloudflare.com/code-mode/) , primary reference for the code-mode pattern, Worker Loader API, and isolate sandbox.
- [Cloudflare Blog: Code Mode, give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/) , the `search()` / `execute()` two-primitive pattern for very large API surfaces.
- [Cloudflare Agents Codemode docs](https://developers.cloudflare.com/agents/api-reference/codemode/) , API reference for the `codemode()` helper.

**Secondary, analysis and benchmarks:**
- [MongoDB acquires Voyage AI (SiliconANGLE, 2025-02-24)](https://siliconangle.com/2025/02/24/mongodb-acquires-embedding-model-provider-voyage-ai/) , acquisition context and three-phase integration plan.
- [Embedding Models Comparison 2026: OpenAI vs Cohere vs Voyage vs BGE](https://reintech.io/blog/embedding-models-comparison-2026-openai-cohere-voyage-bge) , third-party benchmark synthesis.
- [Voyage 3.5 vs OpenAI vs Cohere Embedding Models 2026](https://www.buildmvpfast.com/blog/best-embedding-model-comparison-voyage-openai-cohere-2026) , RTEB benchmark numbers.
- [Introducing voyage-context-3 (Voyage Blog, 2025-07-23)](https://blog.voyageai.com/2025/07/23/voyage-context-3/) , storage / quality tradeoffs for contextualized chunk embeddings.
- [InfoQ: Cloudflare Launches Code Mode MCP Server (2026-04)](https://www.infoq.com/news/2026/04/cloudflare-code-mode-mcp-server/) , 81% token reduction figure and dynamic-worker context.
- [Cloudflare: Sandboxing AI agents, 100x faster (Dynamic Workers blog)](https://blog.cloudflare.com/dynamic-workers/) , isolate vs container performance basis.
- [HN discussion: Code Mode, the better way to use MCP](https://news.ycombinator.com/item?id=45399204) , practitioner reactions, alternative sandbox suggestions (Deno).
- [Voyage AI Rate Limits docs](https://docs.voyageai.com/docs/rate-limits) , per-tier RPM and TPM ceilings.
