---
title: "Mintlify ChromaFs: Virtual Filesystem over a Vector DB as the Agent Interface"
date: 2026-05-05
mode: scan
sources: 4
status: complete
---

# Mintlify ChromaFs: Virtual Filesystem over a Vector DB as the Agent Interface

## Executive Summary

ChromaFs is Mintlify's production replacement for sandboxed-VM agent harnesses on their docs assistant. Instead of cloning a repo into a Daytona-style micro-VM, they expose their existing Chroma vector DB as a virtual UNIX filesystem and let the agent run `grep`, `cat`, `ls`, `find`, and `cd` against it. The shell layer is `just-bash` (Vercel Labs, 3.3K stars, MIT-ish, TypeScript reimplementation of bash with a pluggable `IFileSystem` interface); ChromaFs is the `IFileSystem` adapter that translates filesystem calls into Chroma queries. Session bootstrap dropped from p90 ~46s to ~100ms, marginal compute per conversation dropped from ~$0.0137 to ~$0, and per-user RBAC fell out of pruning a single in-memory path tree before any queries run.

The pattern is the cleanest external analog to AtlasFS that has appeared so far. Both replace a generic sandbox with a typed virtualisation over a DB the team already pays for, both expose shell-shaped primitives as the agent's action surface, both push access control into the FS layer rather than container isolation, and both treat the substrate (Chroma documents, Atlas collections) as the load-bearing index. ChromaFs is read-only with no learning loop; AtlasFS adds endorsement-driven crystallisation on top. The relevant takeaways for AtlasFS are concrete: the gzipped `__path_tree__` document as a substrate-side bootstrap manifest, EROFS-only write enforcement at the FS adapter, coarse-then-fine query rewriting (DB-side filter to a candidate set, in-memory regex over only those candidates), and lazy file pointers that surface in `ls` but only fetch on `cat`.

The difference between the two systems is also clarifying. ChromaFs's "fake shell" makes sense because every doc page is roughly file-shaped and the agent's job is to read prose. AtlasFS's "typed TS modules" makes sense because every collection has stable query intents over polymorphic documents and the agent's job is to compose a retrieval pipeline. ChromaFs validates the architectural shape; AtlasFS extends it with crystallisation, two-dimensional adaptation (across tenants, within a tenant over time), and a typed surface that supports compilation into a single Atlas aggregation pipeline. Use ChromaFs as a reference for the FS-adapter primitives, not as a model for the procedure layer.

---

## Overview

**What it is.** ChromaFs is a closed-source production component inside Mintlify's docs assistant. It is a TypeScript implementation of `IFileSystem` (a `just-bash` interface) that backs every filesystem call with a query against a pre-existing Chroma collection. The agent gets a shell prompt, runs UNIX commands, and never knows the underlying storage is a vector DB. just-bash itself handles parsing, piping, redirection, flag handling, glob expansion, and command resolution, so ChromaFs only has to translate the leaf operations (`readFile`, `readdir`, `stat`, the grep escape hatch).

**Traction.** Closed source, no public repo. Powers the docs assistant for "hundreds of thousands of users across 30,000+ conversations a day" per the team's claim. The substrate, `just-bash`, has 3,361 stars, 187 forks, 58 open issues, created 2025-12-23, last push 2026-05-02. It is described by Vercel Labs as "Bash for Agents" and explicitly designed for this pattern (in-memory FS, custom commands via `defineCommand`, isolated shell state per `exec`). The original announcement is the densumesh tweet and a Mintlify engineering blog post by Dens Sumesh dated 2026-03-24.

**Why it matters.** Two reasons. First, it is the public reference architecture for "agent shell over a DB you already pay for", which is the same architectural shape AtlasFS uses. Second, it nails the cost story explicitly. Mintlify reports p90 session creation went from ~46 seconds (Daytona-style sandbox + GitHub clone) to ~100 milliseconds (ChromaFs init), and at 850,000 conversations a month a minimal sandbox setup (1 vCPU, 2 GiB RAM, 5-minute lifetime) would cost north of $70,000 a year on Daytona's per-second pricing. ChromaFs's marginal compute per conversation is ~$0 because the Chroma collection is already provisioned. This is the same "reuse the DB we have, never pay sandbox tax" argument that motivates AtlasFS.

---

## How It Works

### The shell substrate: just-bash

just-bash is a TypeScript reimplementation of bash designed for AI agents. It ships with InMemoryFs as the default and three other adapters (`OverlayFs`, `ReadWriteFs`, plus a pluggable `IFileSystem` interface). It supports the standard file commands (`cat`, `cp`, `ls`, `mkdir`, `mv`, `rm`, `find`, `tree`), text processing (`awk`, `grep`, `sed`, `head`, `tail`, `cut`, `sort`, `uniq`), data tools (`jq`, `sqlite3`, `xan`, `yq`), shell features (pipes, redirections, `if`, `for`, `while`, functions, glob patterns, `&&`/`||`/`;`), and optional QuickJS / CPython runtimes. Each `exec()` call gets isolated shell state but shares the FS, which is the right tradeoff for agent loops where command state should not leak across invocations but accumulated work products should persist within a session.

Custom commands extend the surface via `defineCommand((args, ctx) => ...)`, and they receive a `CommandContext` with `fs`, `cwd`, `env`, `stdin`, and a recursive `exec` for subcommands. This is the hook ChromaFs uses for grep optimisation: it intercepts grep, runs a coarse Chroma filter, and re-dispatches a narrower grep back into just-bash for fine in-memory matching.

### ChromaFs as an IFileSystem adapter

```
+------------------------------------------------------------+
|  Agent (LLM)                                                |
|    issues:  grep -r "access_token" /auth                    |
+------------------------------------------------------------+
                            |
                            v
+------------------------------------------------------------+
|  just-bash                                                   |
|    parses, expands globs, resolves piping                   |
|    calls IFileSystem.{readFile, readdir, stat, ...}         |
+------------------------------------------------------------+
                            |
                            v
+------------------------------------------------------------+
|  ChromaFs (IFileSystem implementation)                       |
|    in-memory:                                                |
|      Set<string>            file paths                       |
|      Map<string, string[]>  dir -> children                  |
|    on init:                                                  |
|      fetch __path_tree__ (gzipped JSON) from Chroma          |
|      decompress, prune by user permissions, build maps       |
|    per call:                                                 |
|      readFile(path)  -> Chroma get where page = slug         |
|      readdir(path)   -> in-memory map lookup                 |
|      grep -r intercept -> coarse Chroma + fine in-memory     |
|      writeFile/mkdir/rm/append -> throw EROFS                |
+------------------------------------------------------------+
                            |
                            v
+------------------------------------------------------------+
|  Chroma collection                                           |
|    one document per chunk, metadata: page, chunk_index,      |
|      isPublic, groups                                        |
|    one special document: __path_tree__ (gzipped JSON of      |
|      the entire site's path -> {isPublic, groups})           |
+------------------------------------------------------------+
```

### Bootstrapping the directory tree

ChromaFs needs the path tree before any agent command runs. They store the entire tree as one gzipped JSON document inside the Chroma collection, keyed `__path_tree__`. Shape:

```json
{
  "auth/oauth":                  { "isPublic": true,  "groups": [] },
  "auth/api-keys":               { "isPublic": true,  "groups": [] },
  "internal/billing":            { "isPublic": false, "groups": ["admin", "billing"] },
  "api-reference/endpoints/users": { "isPublic": true,  "groups": [] }
}
```

On init, the server fetches and decompresses this document into two in-memory structures: a `Set<string>` of file paths and a `Map<string, string[]>` mapping directories to children. Once built, `ls`, `cd`, and `find` resolve in local memory with zero network calls. The tree is cached, so subsequent sessions for the same site skip the Chroma fetch entirely. This is the bootstrap manifest pattern, and it generalises: any virtual FS over a DB needs a single, cheap-to-fetch document that names every leaf and encodes per-leaf access control.

### Access control via tree pruning

Before constructing the in-memory maps, ChromaFs filters the path tree using the current user's session token and the per-path `isPublic` and `groups` fields. Files the user lacks access to are excluded entirely; the agent cannot reference, list, or read a path that was pruned. The same predicate is then applied as a filter on every subsequent Chroma query (so even if the agent guesses a slug, the substrate-side query refuses to surface it). The blog post puts the contrast cleanly: in a real sandbox, this would require Linux user groups, `chmod`, or per-tier container images; in ChromaFs it is "a few lines of filtering before `buildFileTree` runs."

### Reading files, reassembling chunks

Chroma stores each page as multiple chunks (because chunk size is bounded by the embedding model's input). When the agent runs `cat /auth/oauth.mdx`, ChromaFs translates this into a Chroma `get` filtered by `page = slug` and `metadata IncludeEnum.documents | metadatas`. The retrieved chunks are sorted by `chunk_index` and joined into the full page, which is then cached so repeated reads during a grep workflow never hit the database twice. Pseudocode from the post:

```typescript
async readFile(path: string): Promise<string> {
  this.assertInit();
  const normalized = normalizePath(path);
  const slug = normalized.replace(/\.mdx$/, '').slice(1);
  const results = await this.collection.get<ChunkMetadata>({
    where: { page: slug },
    include: [IncludeEnum.documents, IncludeEnum.metadatas],
  });
  const chunks = results.ids
    .map((id, i) => ({
      document: results.documents[i] ?? '',
      chunkIndex: parseInt(String(results.metadatas[i]?.chunk_index ?? 0), 10),
    }))
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
  return chunks.map((c) => c.document).join('');
}
```

### Lazy file pointers

Not every "file" needs to live in Chroma. Large OpenAPI specs that customers store in their own S3 buckets are registered as lazy pointers: the agent sees `v2.json` in `ls /api-specs/`, but the bytes are only fetched (and possibly authenticated against the customer's bucket) when the agent runs `cat`. This is the right escape valve for a virtual FS, the index advertises the leaf, but the leaf's bytes can come from any backing store, including ones that are too large or too sensitive to embed.

### Read-only is enforced at the adapter

Every write operation throws `EROFS` (Read-Only File System) at the adapter level: `writeFile`, `appendFile`, `mkdir`, `rm` all immediately raise. The agent can explore freely but never mutate. Because the adapter is the single bottleneck and there is no per-session writable layer, the system is stateless: there is no session cleanup, no risk of one agent corrupting another's view, and no need to garbage-collect anything between conversations. This is structurally cleaner than a sandbox where you have to trust container teardown to prevent cross-tenant leakage.

### Optimised grep: coarse filter, then fine filter

`cat` and `ls` are straightforward. `grep -r` would be a disaster if naively translated, every file fetched over the network, every regex run client-side. ChromaFs intercepts grep through just-bash's custom-command hook, parses flags with `yargs-parser`, and translates them into a Chroma query: `$contains` for fixed strings, `$regex` for patterns. Chroma serves as the **coarse filter** that returns the candidate slugs that might contain a hit. Those chunks are then `bulkPrefetch`ed into a Redis cache. Finally, the grep command is rewritten to target only the matched files and handed back to just-bash, whose in-memory regex engine produces the **fine filter** match output. From the post:

```typescript
const chromaFilter = toChromaFilter(
  scannedArgs.patterns,
  scannedArgs.fixedStrings,
  scannedArgs.ignoreCase
);

// 1. Coarse filter: ask Chroma for slugs matching the string/regex
const matchedSlugs = await chromaFs.findMatchingFiles(chromaFilter, slugsUnderDirs);
if (matchedSlugs.length === 0) return { stdout: '', exitCode: 1 };

// 2. Prefetch: pull the chunked files into local cache concurrently
await chromaFs.bulkPrefetch(matchedSlugs);

// 3. Fine filter: narrow the arguments to ONLY the resolved hits
const matchedPaths = matchedSlugs.map((s) => '/' + s + '.mdx');
const narrowedArgs = [...args, ...matchedPaths];

// 4. Exec: let the in-memory RegExp engine format the final output
return execBuiltin(narrowedArgs, ctx);
```

The architectural shape is: keep the substrate doing what it is good at (high-recall candidate retrieval), and keep the in-memory engine doing what it is good at (precise, cheap pattern matching over a small candidate set). Recall vs precision is split at the substrate boundary, not handled in one layer.

### Numbers from the blog post

| Metric | Sandbox | ChromaFs |
| --- | --- | --- |
| P90 boot time | ~46 seconds | ~100 milliseconds |
| Marginal compute / conversation | ~$0.0137 | ~$0 (reuses provisioned DB) |
| Search mechanism | Linear disk scan via syscalls | DB metadata query |
| Infrastructure | Daytona or similar | Existing Chroma collection |
| Per-user RBAC | Linux groups, chmod, tiered images | Tree prune + query filter |

At 850K conversations/month, the sandbox bill on Daytona's per-second pricing crosses ~$70K/year for a minimal config. The post is honest that warm pools and shared containers would cut this, but the marginal-zero number for ChromaFs is structural, not optimisation.

---

## Strengths

- **Right action surface for the job.** Docs are mostly prose, mostly file-shaped, and an agent that can `grep -r` across them composes naturally. The choice to expose shell rather than a custom search API removes a layer of impedance between the LLM (which has read enormous amounts of bash) and the data.

- **Substrate reuse.** ChromaFs runs against a Chroma collection that was already provisioned for embedding-based RAG. The agent's filesystem is a *view* over that collection, not a parallel store. Marginal compute per conversation is approximately zero. This is the same property AtlasFS pursues by mounting Atlas at `/datafetch/`.

- **Bootstrap manifest is one gzipped document.** Storing the entire path tree as `__path_tree__` inside the same Chroma collection means init is one network round trip, no schema migration, no separate index. Cached after first session for the site. This is the cheapest possible bootstrap design.

- **RBAC pushed down to the adapter.** Pruning the tree and applying a matching filter to every subsequent query collapses two security questions ("can the user list it" and "can the user read it") into one predicate evaluated in one place. Cleaner than container isolation, cleaner than per-tier images.

- **Read-only as a structural property.** Every write throws `EROFS` at the adapter. Statelessness falls out of this: no cleanup, no cross-session contamination, no race conditions, no GC. This is the same property AtlasFS gets by writing endorsements to `procedures/<tenant_id>/` rather than mutating the substrate.

- **Coarse-then-fine grep is the right query architecture.** Substrate does recall (cheap, approximate), in-memory regex does precision (cheap on a small candidate set). It is the same split that distinguishes `$rankFusion` from a downstream rerank step. Worth lifting whole.

- **Lazy file pointers as an escape valve.** Not all leaves need to live in the substrate; some can be pointers that resolve to S3, to a customer-specific endpoint, to a function call. The agent's `ls` shows the leaf; `cat` triggers the resolution. This is exactly the abstraction we need for "this collection-shaped thing is in Atlas, but this dataset-shaped thing is in HF."

- **The shell substrate (just-bash) is a real third-party piece.** 3.3K stars, real maintenance, genuine command coverage including `awk`, `sed`, `jq`, `sqlite3`. ChromaFs gets all of bash for free and only has to implement the FS adapter. The same pattern would apply if AtlasFS ever wanted a shell front end.

---

## Limitations & Risks

- **Closed source.** ChromaFs itself is not on GitHub. The blog post and tweet describe the architecture in enough detail to reimplement, but there is no reference code to read. The substrate (just-bash) is open; the FS adapter is not.

- **Read-only is the whole story.** The system explicitly does not support `agent writes to FS, FS persists across sessions`. If you want endorsement, procedure crystallisation, or any kind of accumulation, ChromaFs doesn't help; you build that layer yourself. (AtlasFS does build that layer; ChromaFs is a reference for the read path only.)

- **No semantic ranking on the FS surface.** `ls`, `cd`, `find` resolve over the in-memory map without any retrieval intelligence. The agent has to know the slug to read it, or do a `grep` first. There is no `find . -name '*similar to oauth*'`. Anything that requires intent-conditioned retrieval has to be expressed as grep over a substring or as a separate Chroma query outside the FS abstraction.

- **Hostname / slug coupling.** Page slugs are the primary key. If your docs reorganise (move `auth/oauth.mdx` to `security/auth/oauth.mdx`), every cached path tree and every prior conversation reference becomes stale. The post does not describe a migration story.

- **Substrate locks you in.** ChromaFs is named after Chroma; the chunking, the `$contains`/`$regex` filter language, the `IncludeEnum.documents` API are all Chroma-specific. Porting it to another vector DB would mean rewriting the readFile and grep paths. (For AtlasFS, the analog is: typed surfaces that depend on Atlas $rankFusion would not transparently lift to another DB.)

- **Grep regex translation is partial.** Chroma's `$regex` is not the same as JavaScript regex; some grep flag combinations may have to fall back to "fetch everything matching a coarse $contains then run client-side regex," which is the worst case. The post mentions both `$contains` and `$regex` but does not detail the regex feature parity.

- **No public benchmarks beyond the latency claim.** "p90 ~46s to ~100ms" and "$70K/year to ~$0 marginal" are the only numbers. There are no published comparisons of agent task success rate before vs after, no measurement of grep result quality, no breakdown of where the latency now lives, no bottom-line accuracy delta. This is a launch post, not an evaluation.

- **Path tree fits in memory.** For a docs site of "30,000+ conversations a day" the tree is presumably a few thousand entries; for a hypothetical multi-million-page corpus, the gzipped JSON manifest stops being free. The pattern has a scaling limit that is not discussed.

- **Cache coherence is implicit.** Path tree cached "for the same site" between sessions; chunks cached during a session. The post does not describe the invalidation story for either cache (presumably docs republish triggers an invalidation, but the mechanism is not in the post).

---

## Integration Analysis

### What to extract for AtlasFS

**1. The path-tree-as-substrate-document pattern.** Today AtlasFS infers schema lazily on read. ChromaFs's pattern of "one gzipped JSON document inside the same DB that names every leaf and carries access control metadata" is a complementary primitive: instead of (or alongside) sampled inference, write a single substrate-side manifest per mount that names the typed paths, their inferred schemas, and their per-tenant visibility. Cheap to fetch, cached after first session, single source of truth for `ls /datafetch/`. This is the substrate-shaped analog of `mount/<mountId>/meta/primitive_registry.json`.

**2. RBAC at the adapter layer via tree pruning.** Multi-tenant AtlasFS already has the constraint that two tenants on the same Atlas cluster see two different `procedures/` overlays. ChromaFs's "prune the tree before constructing maps, then apply a matching filter to every subsequent query" pattern is the right shape for the data layer too: prune the typed path manifest by tenant identity, then apply the same predicate as a `$match` stage in every aggregation pipeline. One predicate, evaluated in one place, applied at both the listing layer and the read layer. PRD-007's "tenant binding" question gets a concrete implementation pattern.

**3. EROFS-only at the FS adapter for the read path.** AtlasFS's read path (the typed module surface) should be structurally read-only against the substrate; all mutation goes through `procedures/<tenant_id>/<name>.ts` writes, which are explicitly tenant-local and never touch raw Atlas collections. ChromaFs makes this an adapter-level invariant: every write throws `EROFS`. We should make the same invariant explicit in the typed module surface (the `data/<schema_name>/` exports must be pure reads; any side-effect goes through a separate, audited path).

**4. Coarse-then-fine query rewriting.** Atlas already has `$rankFusion` over `$vectorSearch + $search`, which is a coarse filter. The Mintlify pattern adds: take the result-set, prefetch the chunks, and run a precise regex / structural match in-process on the small candidate set. This is the architectural shape the AtlasFS budget worker should adopt for any retrieval where intent specificity exceeds what `$rankFusion` can express: substrate produces a candidate set, in-process derivation refines. The "two-link chain (substrate primitive + LLM observation), then collapse the second link" framing in the AtlasFS elevator is exactly this pattern.

**5. Lazy file pointers as a federation primitive.** The OpenAPI-spec-in-S3 example is the right escape valve. AtlasFS should support typed paths whose backing store is not Atlas: HF datasets, customer-provided endpoints, side files. The pattern is: the path manifest advertises the leaf with its inferred schema; the leaf resolution dispatches to a registered handler when the agent reads. This means the typed surface stays uniform but the substrate is federated.

**6. just-bash as a candidate reference for any AtlasFS shell front end.** If AtlasFS ever wants to expose a shell prompt alongside the typed TS module surface (for exploration, for CLI scripting, for debug), just-bash is the right substrate to lift. It has 3.3K stars, real maintenance, grep/cat/ls/find/jq/sqlite3 already implemented, pluggable `IFileSystem`, and `defineCommand` for custom verbs. The lift is one adapter (Atlas-as-IFileSystem) plus any custom verbs that want to surface domain operations (e.g., `endorse`, `replay`).

### What NOT to copy

**Don't replicate ChromaFs's "shell as primary agent surface."** Docs are file-shaped; AtlasFS's collections are query-shaped. The agent should compose typed TS retrievals, not run grep over the substrate. ChromaFs is read-only and prose-centric; AtlasFS is read-write-via-endorsement and query-centric. The right surface for AtlasFS is `import { byTicker } from "/datafetch/finqa/companies"`, not `cat /datafetch/finqa/companies/AAPL.json`.

**Don't replicate the slug-as-primary-key approach.** ChromaFs keys by URL slug, which works because docs have stable URLs. AtlasFS already keys by `sha256(inferred_schema)` for mount fingerprinting, which is more robust to substrate reorganisation. Keep the schema-fingerprint key.

**Don't replicate the closed-source learning loop.** ChromaFs has no learning loop at all; it is a static virtual filesystem. AtlasFS's whole second half (endorsement, crystallisation, budget worker) is the differentiator. Adopting ChromaFs's primitives doesn't mean adopting its scope.

### Bootstrap path

**Quick (< 1h):**
- Document the path-tree-as-substrate-document pattern in `kb/prd/design.md` as one option for the typed-path manifest. Note the gzipped-JSON-keyed-`__path_tree__` shape and the tree-prune RBAC pattern.
- Add a note in PRD-007 about EROFS-only enforcement on the typed read surface.

**Short (< 4h):**
- Sketch the lazy file pointer pattern in PRD-007, with one worked example (an HF dataset surfaced under `/datafetch/` whose bytes are fetched on read but whose schema is precomputed in the manifest).
- Sketch a coarse-then-fine query rewriting pattern in the budget worker spec: substrate produces a candidate set via `$rankFusion`, in-process derivation refines.

**Medium (< 1d):**
- Implement the typed-path manifest as a substrate-side document (or mount-meta file) that names every typed export with its inferred schema and per-tenant visibility. Wire it into `ls /datafetch/<mountId>/`.
- Implement RBAC by manifest pruning: every typed import resolves through a tenant-bound predicate that filters the manifest before resolution and applies the same predicate as a `$match` stage in every pipeline.

**Large (> 1d):**
- Build a `just-bash`-based shell front end for AtlasFS as an exploration surface alongside the typed module surface. This is optional and probably premature; flagged as a "if a shell prompt becomes a UX requirement" path.

### Effort estimate

- Adopting the conceptual primitives (manifest doc, RBAC pruning, EROFS, coarse-fine, lazy pointers): **Quick to Short** for the design notes, **Medium** for the implementations.
- Lifting ChromaFs as a runtime: **not applicable**. Different problem (prose vs query), different shape (read-only static vs endorsement-driven crystallisation), different substrate (Chroma vs Atlas).
- Lifting `just-bash` as a shell front end: **Medium**, contingent on a UX requirement that doesn't exist yet.

---

## Key Takeaways

1. **The architectural shape is validated.** AtlasFS's "fake shell over a DB you already pay for" was, until this post, the kind of architectural claim that lived only in our PRD. ChromaFs is a public production reference: same shape, real numbers (p90 from 46s to 100ms, marginal compute from $0.0137 to ~$0, RBAC via tree prune). Cite it in PRD prose where the case for the pattern is being made externally.

2. **Adopt the substrate-side manifest pattern.** Add a typed-path manifest to AtlasFS, written into the substrate as a single gzipped document keyed by mount, naming every typed export with its inferred schema and per-tenant visibility. This generalises the elevator's "schema is induced at three tiers" by giving the cheapest tier (sampled inference) a concrete artifact: a manifest document. Bootstrap is one fetch, cached forever, single source of truth for `ls /datafetch/`. Effort: Medium.

3. **Make EROFS-on-substrate an explicit invariant.** ChromaFs enforces "every write to the FS adapter throws EROFS" and gets statelessness for free. AtlasFS should make the same invariant explicit on the typed read surface: every typed import is read-only against Atlas; all mutation flows through `procedures/<tenant_id>/<name>.ts`, which is tenant-local and audit-logged. State this in PRD-007 prose and enforce it in the typed-surface generator.

4. **Coarse-then-fine query rewriting is the right shape for the budget worker.** Atlas's `$rankFusion` is the coarse filter; in-process derivation is the fine filter. The budget worker's "swap embedding search that consistently resolves to a known filter for a deterministic codified query" is a special case of this pattern. Generalise the pattern in the budget worker spec: every retrieval primitive produces a candidate set, every derivation refines, and the budget worker's job is to identify which links can be promoted to substrate-side and which must remain in-process.

5. **Don't copy the surface; copy the primitives.** ChromaFs's "shell as the agent surface" is a wrong fit for AtlasFS (collections are query-shaped, not file-shaped). The primitives (manifest, RBAC by prune, EROFS, coarse-fine, lazy pointers) are universal. Lift the primitives, leave the surface to the typed TS module path.

---

## Sources

### Primary
- [@densumesh tweet, 2026-04-02](https://x.com/densumesh/status/2039765361533637016?s=46), the X recap of the ChromaFs architecture, ~1145 words.
- [Mintlify blog: How we built a virtual filesystem for our Assistant](https://www.mintlify.com/blog/how-we-built-a-virtual-filesystem-for-our-assistant), Dens Sumesh, 2026-03-24, the canonical write-up with the architecture diagram, the metrics table, and the code excerpts.

### Substrate
- [vercel-labs/just-bash on GitHub](https://github.com/vercel-labs/just-bash), 3,361 stars, 187 forks, 58 open issues, created 2025-12-23, last push 2026-05-02. The TypeScript bash reimplementation that ChromaFs uses; pluggable `IFileSystem`, `defineCommand` for custom verbs, broad command coverage including `grep`, `awk`, `sed`, `jq`, `sqlite3`.
- [just-bash package README](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/README.md), 2,612 words, full API and supported-command list.

### Related project context
- [AtlasFS elevator pitch](../elevator.md), the "code-mode adaptive retrieval system that crystallises query shape from agent usage" framing that ChromaFs is the closest external analog to.
- [09-browser-use-browser-harness.md](09-browser-use-browser-harness.md), the previous external-analog brief; ChromaFs and browser-harness are the two production references for the pattern (DB-shaped vs browser-shaped).

### Cited specifics
- ChromaFs `readFile` pseudocode (Chroma `get` filtered by `page = slug`, sorted by `chunk_index`, joined).
- ChromaFs grep pseudocode (`toChromaFilter`, `findMatchingFiles`, `bulkPrefetch`, `narrowedArgs`, `execBuiltin`).
- `__path_tree__` JSON shape with `isPublic` and `groups` per slug.
- p90 boot time: ~46s sandbox, ~100ms ChromaFs.
- Cost: ~$70K/year sandbox at 850K conversations/month; ~$0 marginal for ChromaFs.
- Production scale: "30,000+ conversations a day" docs assistant.
- [Daytona pricing](https://www.daytona.io/pricing), $0.0504/h per vCPU, $0.0162/h per GiB RAM, the basis of the cost calculation.
