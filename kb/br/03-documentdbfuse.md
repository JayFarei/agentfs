---
title: "documentdbfuse: The Closest Public Expression of MongoFS, and What to Take From It"
date: 2026-05-01
mode: deep
sources: 12
status: complete
---

# documentdbfuse: The Closest Public Expression of MongoFS, and What to Take From It

## Executive Summary

documentdbfuse is a single-author Go binary, ~1,662 production lines, 2 GitHub stars, MIT-licensed, that mounts any MongoDB-wire-compatible database (MongoDB Atlas, Microsoft DocumentDB, FerretDB) as a POSIX filesystem via FUSE on Linux. Databases appear as top-level directories, collections as subdirectories, documents as `.json` files. Aggregation pipelines are addressable as nested directory paths, for example `cat /mnt/db/sampledb/users/.match/city/Seattle/.sort/-age/.limit/3/.json/results`. The author (`xgerman`) built it in a single 48-hour burst on 2026-04-06, cited TigerFS as inspiration, and described it on Hacker News as "a solution in search of a problem" that "feels like a toy". It is the closest existing public expression of the **MongoFS** component described in `kb/product-design.md`.

The bottom line for AtlasFS: this strengthens the framing rather than threatening it. A judge who has seen documentdbfuse will immediately recognise the AtlasFS delta (typed TypeScript modules, schema fingerprinting, hybrid retrieval as a typed call, trajectory crystallisation, cross-platform NFS via AgentFS) as substantive. Cite it explicitly in Related Work. Three small ideas are worth porting today: `--ls-limit` with `.all/` opt-in, `.count` as a virtual file, and the three-format export directory. Three big AtlasFS design decisions are validated by documentdbfuse's mistakes: read-only `db/`, NFS-not-FUSE, and typed-TS-with-fingerprint. In a live test on this machine on 2026-05-01, documentdbfuse passed every advertised read-side feature against documentdb-local in Docker, and shipped one confirmed bug, in-place document replace via `echo > existing.json` returns ENOTSUP, contradicting the README.

The bigger external signal is the trend. documentdbfuse, TigerFS (Postgres-backed), and AgentFS (SQLite-backed) all converged on "DB-as-filesystem for agents" inside a six-week window in early 2026. AtlasFS is the only project combining hybrid retrieval, typed discovery, and crystallisation in one system. The "DB-as-FS for agents" framing is now defensible without further argument; pitch words should go to the *delta*.

## Overview

**What it is.** A 1.6k-LOC Go FUSE daemon that exposes a MongoDB-wire server as a Linux filesystem. Built on `github.com/hanwen/go-fuse/v2 v2.9.0` and `go.mongodb.org/mongo-driver/v2 v2.5.0`, packaged as a single binary, plus a `docker-compose.yml` that brings up `documentdb-local` and the FUSE container together. Mount point exposes one directory per database, one subdirectory per collection, one `.json` file per document keyed by `_id`. Aggregation pipelines compose as nested directory paths via dot-prefixed segments (`.match`, `.sort`, `.limit`, `.skip`, `.project`, plus terminal `.count`, `.all/`, `.json/results`, `.csv/results`, `.tsv/results`).

**Maturity and traction signals.** Created 2026-04-06 by a single author. ~11 commits, all between 2026-04-06 and 2026-04-08; no activity since. 2 stars, 0 forks, 0 issues, 0 PRs, 0 discussions. Hard-coded version `v0.1.0` in `cmd/root.go:32`, no tagged releases. No CI workflows, no CODEOWNERS, no release artifacts. The single Hacker News submission ([item 47682849](https://news.ycombinator.com/item?id=47682849)) has 1 point and 1 comment (the author's own). It is an unfinished prototype, not a product.

**Why it matters now.** Three projects converged on the "DB-as-FS for agents" thesis in early 2026: documentdbfuse (April, MongoDB), TigerFS (April, Postgres, by Tiger Data / Timescale, FUSE on Linux + NFS on macOS, Franck Pachot of MongoDB called it "I love this, mounting a database as a filesystem"), and AgentFS (Turso, SQLite-backed, 3,100+ stars, the VFS engine `kb/product-design.md` plans to adopt). documentdbfuse explicitly cites TigerFS as inspiration. None of the three combine the typed-TS-discovery surface with hybrid retrieval and trajectory crystallisation that AtlasFS targets. The space is hot enough that the framing is recognised on first read, which lowers the explanation budget AtlasFS has to spend with a judge.

**Competitive landscape.**

| Project | Backend | Transport | Differentiator | Trade-off |
|---|---|---|---|---|
| **documentdbfuse** | MongoDB-wire (Atlas, DocumentDB, FerretDB) | FUSE, Linux only | Path-segment aggregation DSL, MongoDB-native | No hybrid, no typing, no audit, single author, prototype-stage |
| **TigerFS** | PostgreSQL | FUSE on Linux, NFS on macOS | ACID file ops, automatic versioning, directory-as-state-machine | Postgres-only, no native vector or Mongo |
| **AgentFS** (Turso) | SQLite (single file) | FUSE on Linux, NFS on macOS, virtio-fuse | Tool-call audit table, CoW snapshots, time-travel | Local SQLite only, does not mount a database server |
| **gilles-degols/mongofs**, **mgfs**, **scotthernandez/mongo-fuse**, **davidknoll/mongofuse** | MongoDB or GridFS | FUSE | Various older approaches | All inactive seven or more years |

## How It Works

### Architecture

```
+--------------+     +--------------+     +-----------------+
|  Unix tools  | --> | FUSE daemon  | --> |  MongoDB wire   |
| ls/cat/grep  | <-- |    (Go)      | <-- |     server      |
+--------------+     +--------------+     +-----------------+
```

The daemon is a stateless go-fuse v2 server. There is no in-process cache; every kernel `Lookup`, `Readdir`, `Getattr`, and `Read` becomes a fresh round trip to the MongoDB wire server. Kernel-side attribute caching is set to one second (`internal/documentdbfuse/fuse/fuse.go:17-18`).

### Filesystem layout, verified live

```
/mnt/db/
+-- sampledb/                           # database
    +-- scoutusers/                     # collection
        +-- alice.json                  # one document per _id
        +-- bob.json
        +-- .count                      # cat -> "3\n"
        +-- .all/                       # uncapped listing, bypasses --ls-limit
        +-- .match/
            +-- city/
                +-- Seattle/
                    +-- alice.json      # only matched IDs appear
                    +-- bob.json
                    +-- .count          # cat -> "2\n"
                    +-- .json/results
                    +-- .csv/results
                    +-- .tsv/results
                    +-- .sort/-age/.limit/1/.json/results
```

`ls` shows ONLY document files; the magic dot-paths are addressable via `Lookup` but excluded from `Readdir`. Verified live on 2026-05-01: `ls -a /mnt/db/sampledb/scoutusers/` returned just `alice.json bob.json carol.json`, no `.count` or `.match` entries. That is a deliberate UX win for listing, with the cost that the magic paths are invisible from the shell, the user has to know they exist.

### Path-segment pipeline DSL

The parser is a single linear-scan switch in `internal/documentdbfuse/fs/pipeline.go:19-105`. No recursion, no grammar. Each segment consumes 2 or 3 tokens.

| Path | Aggregation stage | Tokens consumed |
|---|---|---|
| `.match/<field>/<value>` | `{$match: {field: value}}` | 3 |
| `.sort/<field>` or `.sort/-<field>` | `{$sort: {field: ±1}}` | 2 |
| `.limit/<N>` | `{$limit: N}` | 2 |
| `.skip/<N>` | `{$skip: N}` | 2 |
| `.project/<f1,f2,...>` | `{$project: {_id:1, f1:1, ...}}` | 2 |
| `.json/results` | terminal: `[]bson.M` to `MarshalIndent` | terminal |
| `.csv/results`, `.tsv/results` | terminal: dynamic schema, sorted header row | terminal |
| `.count` | terminal: appends `{$count:"count"}` then reads | terminal |

Match values are auto-typed via `parseMatchValue` (`pipeline.go:109-126`): tries `null`, `bool`, `int64`, `float64`, falls back to string. **There is no support for `$vectorSearch`, `$search`, `$rankFusion`, `$lookup`, `$group`, `$facet`, or any operator outside the table above.** This is the most important fact in this brief: the hybrid-retrieval primitives `kb/product-design.md` builds AtlasFS on are entirely absent from documentdbfuse.

### FUSE node tree

Seven typed inode types in `internal/documentdbfuse/fuse/fuse.go`: `Root` (line 27, lists databases), `DatabaseNode` (line 71, lists collections, supports `Mkdir`/`Rmdir`), `CollectionNode` (line 130, lists document IDs, supports `Create`/`Unlink`), `AllDocsNode` (line 268, the uncapped listing), `PipelineNode` (line 381, accumulates pipeline segments on each `Lookup`), `FormatDirNode` (line 539, the `.json`/`.csv`/`.tsv` dir holding a `results` file), `PipelineResultNode` (line 580, executes the aggregation on `Read`). Plus `CountNode` (line 625) and `PipelineCountNode` (line 663) for the two `.count` paths. Inode numbers are auto-assigned by go-fuse via `NewInode()`.

### Write path, verified live

| Shell op | FUSE handler | Mongo op |
|---|---|---|
| `mkdir /mnt/db/<db>/<coll>` | `DatabaseNode.Mkdir` (fuse.go:113-124) | `CreateCollection` |
| `echo '{...}' > /mnt/db/<db>/<coll>/id.json` | `CollectionNode.Create` + `DocumentNode.Write` (fuse.go:219-234, 365-373) | `ReplaceOne` with `SetUpsert(true)` |
| `rm /mnt/db/<db>/<coll>/id.json` | `CollectionNode.Unlink` (fuse.go:236-241) | `DeleteOne` |
| `rmdir /mnt/db/<db>/<coll>` | `DatabaseNode.Rmdir` (fuse.go:256-262) | `DropCollection` |

**Confirmed bug, README contradicts behaviour.** `echo '{...}' > /mnt/db/.../existing.json` fails with `Operation not supported` (ENOTSUP) when the document already exists. The README explicitly advertises in-place replace: `echo '{"name":"Bob","age":31}' > /mnt/db/mydb/newcoll/bob.json  # replace document`. Live test (commit d4577fd, 2026-05-01) yields `cannot create /mnt/db/.../alice.json: Operation not supported`. `truncate -s 0` fails identically. Workaround is `rm` then `echo`, which costs an extra round trip and races. Root cause is that go-fuse calls `Open` (with O_TRUNC or O_WRONLY) on an existing inode rather than `Create`, and the daemon does not implement `Open`/`Setattr` for existing documents, only `Create` for new ones. Any agent UX promise built on `echo > file` has to account for this.

**You also cannot create top-level databases via `mkdir`** at the mount root: `mkdir /mnt/db/newdb` returns ENOTSUP. Databases must already exist; only collections can be created from the FS layer. `Root` does not implement `Mkdir`. One-line fix.

### Live-test artefacts

Reproduced on this machine, 2026-05-01, against `docker compose up -d` from the cloned repo. Stack came up healthy in roughly 25 seconds (documentdb-local healthcheck). Sample interactions, redacted for length:

- `cat /mnt/db/sampledb/scoutusers/.count` returned `3`, then `2` after `rm carol.json`.
- `cat /mnt/db/sampledb/scoutusers/.match/city/Seattle/.json/results` returned a two-element JSON array, pretty-printed, fields in alphabetical order.
- `cat /mnt/db/sampledb/scoutusers/.sort/-age/.limit/2/.csv/results` returned `_id,age,city,name\ncarol,35,Portland,Carol\nalice,30,Seattle,Alice`.
- Chained: `.match/city/Seattle/.sort/-age/.limit/1/.json/results` returned `[{alice}]`.
- `grep -l Seattle /mnt/db/sampledb/scoutusers/*.json` returned both Seattle docs.
- Replace-on-existing-doc failed with ENOTSUP, as documented above.

## Strengths

- **The dot-path pipeline DSL is genuinely clever.** Each segment maps one-to-one to a `bson.D` aggregation stage. Composability is just appending to the path. There is no embedded query language, no escaping rules, no parser bugs to worry about. For BSON-typed primitives, this is arguably better than mongosh's own syntax for shell scripting.
- **`ls` is clean.** Magic paths are addressable but not enumerated. You can `cat /coll/.count` but `ls /coll` shows only documents. This is the right design; it preserves the natural reading of a directory.
- **Cross-database compatibility is real.** A single MongoDB-wire URI targets MongoDB Atlas, Microsoft DocumentDB, FerretDB, or any wire-compatible server (`db/client.go:19-35`). Pointing at Atlas instead of documentdb-local is a one-line URI swap. Verified that the Atlas CLI is installed and authenticated on this machine, but the user's org has no provisioned cluster, so the live test ran against documentdb-local.
- **Stateless and minimal.** ~1.6k lines of Go, no global state, no caches, no goroutines, no mutexes. The whole thing is `lookup -> mongo round trip -> reply`. Easy to read end-to-end in under an hour, which made the architecture audit for this brief tractable.
- **Sensible default safety on reads.** `--ls-limit` defaults to 10,000 documents per `Readdir` to prevent a `ls` from triggering a full collection scan (`mount.go:82`); `--ls-limit 0` opts into unlimited. `.all/` exposes the uncapped listing as an explicit subdirectory, so the user has to ask for the slow path.
- **Live test passed every advertised read-side feature** in this session: ls, cat, grep, find, .count, .match, .sort, .limit, .json/results, .csv/results, chained pipelines, pipeline `.count`, `rmdir` collection, `rm` document, `mkdir` collection.

## Limitations & Risks

The list is long because the project is genuinely a prototype, but every item below is a concrete observation from the live test or the cloned source on 2026-05-01.

1. **No hybrid retrieval.** Zero support for `$vectorSearch`, `$search`, `$rankFusion`, `$lookup`, `$group`, `$facet`, `$unwind`, embeddings, or reranking. The pipeline DSL covers basic CRUD slicing only. AtlasFS's thesis (`kb/product-design.md` §"Data Flow" step 5) is built around hybrid retrieval expanding inside a single typed call. documentdbfuse cannot express this even in principle without grammar changes.
2. **No typing, no schema fingerprint.** Documents come back as raw JSON. There is no `interface User`, no `SCHEMA_VERSION` constant, no inferred schema, no drift detection. The agent's discovery surface is "open file, eyeball field names", exactly the failure mode that AtlasFS's typed TypeScript modules (`kb/product-design.md` core principle 2) are designed to escape.
3. **No procedure crystallisation, no audit log, no overlay.** documentdbfuse is a pure read/write proxy. There is no `tool_calls` table, no notion of a trajectory, no `procedures/` directory, no CoW. This is the entire feedback loop AtlasFS is built around.
4. **Confirmed write bug.** In-place replace via `echo` is not implemented; the README lies. Detail in §"How It Works", write path.
5. **Cannot create top-level databases.** `mkdir /mnt/db/newdb` returns ENOTSUP because `Root` doesn't implement `Mkdir`.
6. **No application-level cache.** Every `cat` round-trips Mongo at least twice (once for `Getattr`, once for `Read`; `fuse.go:319-355`). Per-document reads are fast but a `find . | xargs cat` over 10k docs is 20k+ queries. Kernel attr cache is one second, which is short.
7. **Credentials in `argv`.** The full `mongodb://user:pass@…` URI is the second positional argument to `documentdbfuse mount`, stored verbatim in the `Client` struct (`db/client.go:15`). It will appear in `/proc/<pid>/cmdline` and `ps aux` output. There is no env-var, no secrets file, no Vault or SSM integration. For the AtlasFS threat model (`kb/product-design.md` §"Security Model"), this is a regression compared to AgentFS-style bindings; the credentials live one process boundary away from anything that runs in the agent's sandbox.
8. **Path-segment values become BSON field names verbatim.** `pipeline.go:34-36` passes path tokens straight into `bson.D` keys. A path like `/.match/$where/sleep(1000)` will pass `$where` as a field name. The driver sanitises operator-injection on the value side but not on the field name side. For an LLM that is allowed to compose paths, this is an exfiltration or DoS surface.
9. **FUSE-only, Linux only.** Dockerfile and docker-compose.yml require `cap_add: SYS_ADMIN`, `/dev/fuse`, and `apparmor:unconfined`. There is no macOS path. The README headline ("Mount any MongoDB-compatible database as a filesystem via FUSE/NFS") implies NFS support, but **there is no NFS code in the repo**; the only FS library imported is `github.com/hanwen/go-fuse/v2 v2.9.0` (`go.mod:6`). The "/NFS" in the description is aspirational. AtlasFS's choice to delegate to AgentFS for cross-platform NFS (`kb/product-design.md` Decision #1) bypasses this problem entirely.
10. **Tests don't cover the daemon.** 317 lines of test, none of which exercise `fuse/fuse.go` (727 lines, the largest file) in process. The only integration coverage is the `scripts/test.sh` shell script that runs after `docker compose up`. The `db/` package (connection, aggregation, formatting) has zero Go-level tests. The replace bug above made it through this test surface unnoticed.
11. **Errors collapse to `EIO`.** Every non-ENOENT failure in the FUSE layer becomes `syscall.EIO` with no logged detail (`fuse.go:39, 53, 239`, etc.). For an agent that has to understand a failure to retry, this is almost no signal.
12. **Single author, single weekend.** All ~11 commits land on 2026-04-06 to 2026-04-08. The author has not pushed since. Treat the project as frozen at v0.1.0 until proven otherwise.
13. **License hygiene is light.** MIT licence is present, but there is no NOTICE file, no DCO, no CLA, no contributor list, no PR or issue templates. Vendoring code from this repo is technically permissible but evidence of upstream maintenance discipline is thin.

## Integration Analysis

> Project context: per `kb/product-design.md` §"What It Is" and §"Key Components", the hackathon novel-infra deliverable is a TypeScript class implementing AgentFS's `FileSystem` interface (~10 methods) backed by MongoDB Atlas. documentdbfuse is the closest existing thing on the public web. This section answers the convention's three questions.

**Fit assessment: strong fit as a baseline and as a source of small design ideas, weak fit as code to vendor.** Languages don't match (Go vs TypeScript), the FS contract doesn't match (raw FUSE vs AgentFS's TypeScript `FileSystem` interface), and the design philosophy points the other way (raw JSON vs typed modules, full-CRUD on `db/` vs read-only `db/`). But every design decision in documentdbfuse is a useful data point, sometimes confirming, sometimes warning.

### What to extract

Three small ideas to port today.

1. **`--ls-limit` with `.all/` opt-in.** documentdbfuse caps `Readdir` at 10k documents by default and exposes `.all/` for the uncapped listing (`internal/documentdbfuse/cmd/mount.go:82`, `fuse/fuse.go:268-281`). MongoFS will see the same problem (a 10M-row collection should not return 10M `_samples.json` entries from `readdir`). Adopt the same pattern: cap at 1k by default, expose `db/<coll>/_all/` as the explicit uncapped path. About 30 lines of TypeScript.
2. **`.count` as a virtual file.** `cat .../.count` returns an integer plus newline (`fuse/fuse.go:625-660`). It is a natural agent affordance; trivially understood by any LLM, and avoids exposing aggregation syntax for a one-shot count. MongoFS can expose `db/<coll>/_count` and `db/<coll>/_match/<field>/<value>/_count` for the same reason. About 15 lines.
3. **The three-format export directory pattern.** `.json/results`, `.csv/results`, `.tsv/results`, with schema inferred per result-set and headers sorted alphabetically (`fuse/fuse.go:413-428`, `db/aggregate.go:66-180`). Exactly the pattern AtlasFS should use when an agent's snippet emits structured output, and a stable deterministic format that diff tools can compare across rounds of the eval. Useful for the eval harness even if not exposed under `db/`.

Three big design decisions in `kb/product-design.md` that documentdbfuse validates by demonstrating the alternative is worse.

1. **Read-only `db/` was the right call.** documentdbfuse allows writes to collections via `echo > id.json` and shipped an in-place-replace bug to v0.1 that contradicts its own README. AtlasFS's MongoFS blocks writes to `db/` with EACCES (`kb/product-design.md` §"MongoFS"), which sidesteps the entire class of bug. A reviewer who points at documentdbfuse's `mkdir`/`rm`/`echo` and asks "why don't you support that?" gets a clean answer: the writable surface is `procedures/` and `scratch/`, served by AgentFS's CoW overlay; `db/` is a deterministic read view of the cluster.
2. **NFS-not-FUSE was the right call.** documentdbfuse's README claims "FUSE/NFS" but the codebase ships only FUSE. The repo cannot run on macOS without macFUSE (kernel extension, requires user reboot, blocked on Apple Silicon). AgentFS's NFS server gives AtlasFS macOS plus Linux coverage with zero install friction.
3. **TypeScript-with-typed-methods was the right call.** documentdbfuse's raw-JSON-document surface forces an agent to invent its own field names on every query, with no compile-time check that those field names exist. AtlasFS's `db/<coll>.ts` modules with `interface <Coll>` and `findExact(filter: Partial<Coll>)` close that loop at the type system, not at runtime. This is what the schema fingerprint and drift detection build on.

One thing to consider for the roadmap, not v1: a `views/_query/<pipeline-path>/results.json` debug surface that re-implements documentdbfuse's path DSL inside AtlasFS, as a human-and-agent-readable affordance for verifying what the agent is doing at the database level. About 1 day. Hold for now; add only if the demo flow benefits.

### Bootstrap path

The minimum viable integration with the AtlasFS hackathon:

1. **30 min**, write the "Related Work" subsection of the AtlasFS README. Cite documentdbfuse, TigerFS, and AgentFS as the three points in the converging "DB-as-FS for agents" trend, with one paragraph each on the AtlasFS delta.
2. **1 hr**, port the `--ls-limit` plus `.all/` pattern into MongoFS. Cap `readdir` at 1k by default, expose `db/<coll>/_all/` as the explicit uncapped path.
3. **30 min**, add `_count` virtual files to MongoFS for `db/<coll>/_count` and (post-v1) the post-pipeline equivalent.
4. **2 hr**, lift the `Dockerfile` plus `docker-compose.yml` shape from documentdbfuse as the reference for a one-command judge demo. AtlasFS will need its own Dockerfile, but the compose pattern (Atlas connection or documentdb-local plus the AtlasFS daemon together, with healthcheck wait) is exactly right.
5. **1 hr**, add a single live-test e2e script that runs against documentdb-local in a CI-friendly way, modelled on `documentdbfuse/scripts/test.sh`. Keeps eval hygiene visible to a judge.

### Effort estimate

- "Related Work" cite plus three-pattern port (`_count`, `_all/`, three-format export pattern as roadmap): **Medium (~1 day)** total, but spread across other workstreams.
- Vendor any documentdbfuse code: **Not recommended.** Wrong language, wrong contract, no upstream maintenance discipline visible.
- Optional `views/_query/` debug surface in AtlasFS: **Large (>1 day)**, post-hackathon roadmap only.

## Key Takeaways

1. **documentdbfuse is the closest existing public expression of MongoFS, and that strengthens AtlasFS's framing rather than threatening it.** A judge familiar with the project will immediately recognise the AtlasFS delta (typed modules, schema fingerprinting, hybrid retrieval, crystallisation, cross-platform NFS) as substantive rather than cosmetic. Cite it explicitly in the README's "Related Work" section. Pre-empts the obvious reviewer question.
2. **Three small ideas are worth porting today:** `--ls-limit` with `.all/` opt-in, `.count` as a virtual file, and the three-format `.json|.csv|.tsv/results` export pattern. All three are half-day-or-less additions that improve human-and-agent ergonomics without compromising the typed-TS primary surface.
3. **Three big design decisions in `kb/product-design.md` are validated by documentdbfuse's mistakes:** read-only `db/` (avoids the in-place-replace ENOTSUP bug class), NFS-not-FUSE (the README claims NFS but the repo ships only FUSE; macOS impossible), and typed-TS-with-fingerprint (raw JSON forces field-name guessing on every query). Each was already correct in the design doc; the live test gives them concrete supporting evidence for the demo writeup.
4. **The bigger external signal is the trend, not this project.** documentdbfuse, TigerFS, and AgentFS converged on "DB-as-FS for agents" inside a six-week window in early 2026. AtlasFS is the only one combining hybrid retrieval, typed discovery, and trajectory crystallisation in one system. The "DB-as-FS for agents" framing is now defensible without further argument; pitch words should go to the *delta*.

## Sources

**Primary, repo-level:**
- [xgerman/documentdbfuse on GitHub](https://github.com/xgerman/documentdbfuse), repo cloned and live-tested 2026-05-01, commit `d4577fd`.
- Live Docker test on this machine, 2026-05-01: `documentdbfuse-mongofuse-1` container against `documentdbfuse-documentdb-1` (documentdb-local), all advertised read-side features verified, replace bug reproduced.

**Primary, author framing:**
- [DocumentDB Fuse, FS interface for the database, Hacker News submission by xgerman, ~2026-04-08](https://news.ycombinator.com/item?id=47682849), 1 point, author's own self-deprecating comment, cites TigerFS as inspiration.

**Secondary, adjacent landscape:**
- [TigerFS, mounting PostgreSQL as a filesystem for developers and AI agents, InfoQ April 2026](https://www.infoq.com/news/2026/04/tigerfs-postgresql-filesystem/), the project documentdbfuse cites as inspiration; FUSE on Linux plus NFS on macOS, ACID, automatic versioning.
- [tursodatabase/agentfs](https://github.com/tursodatabase/agentfs), the VFS engine `kb/product-design.md` plans to adopt as a primitive; 3.1k stars, MIT, FUSE on Linux plus NFS on macOS, tool-call audit table, CoW snapshots, time-travel forking.
- [DocumentDB joins the Linux Foundation, Microsoft Open Source Blog, August 2025](https://opensource.microsoft.com/blog/2025/08/25/documentdb-joins-the-linux-foundation/), context on the underlying DocumentDB engine documentdbfuse targets by name.
- [documentdb/documentdb on GitHub](https://github.com/documentdb/documentdb), the Postgres-backed MongoDB-compatible engine.

**Secondary, tooling primitives:**
- [hanwen/go-fuse v2.9.0](https://github.com/hanwen/go-fuse), the FUSE library used by documentdbfuse (`go.mod:6`).
- [go.mongodb.org/mongo-driver/v2 v2.5.0](https://github.com/mongodb/mongo-go-driver), the MongoDB driver used.

**Project-internal:**
- `kb/product-design.md` (AtlasFS / MongoFS design, read 2026-05-01), §"What It Is", §"Key Components → MongoFS", §"Security Model", "Key Decisions".
- `kb/br/01-voyage-ai-code-mode-data-interface.md` (the broader code-mode-data-interface thesis AtlasFS sits inside).
- `kb/br/02-mongodb-fit-and-adjacent-projects.md` (companion to this brief on the Atlas plus Voyage axis).
