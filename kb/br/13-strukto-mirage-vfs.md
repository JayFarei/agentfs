---
title: "Strukto Mirage: A Unified Virtual Filesystem for AI Agents, and What It Means for a Hosted Multi-Service Datafetch"
date: 2026-05-07
mode: deep
sources: 18
status: complete
---

# Strukto Mirage: A Unified Virtual Filesystem for AI Agents, and What It Means for a Hosted Multi-Service Datafetch

## Executive Summary

Mirage is a brand-new (open-sourced 2026-05-06, 247 stars in under 24 hours, v0.0.1-alpha) Apache-2.0 Python and TypeScript library from Strukto (Stanford / YC / AWS-backed) that mounts arbitrary external services, S3, Slack, GitHub, Notion, MongoDB, Postgres, SSH, Gmail, and roughly twenty more, side-by-side as a single virtual filesystem the agent drives through bash. The pitch is the inverse of datafetch's: where datafetch keeps a single substrate (MongoDB Atlas) and virtualises the dataset interface so the same intent can be answered through a typed `df.lib.*` callable, Mirage keeps a single agent surface (`grep`, `cat`, `ls`, `cp`, custom commands) and virtualises the substrate so any service, no matter how exotic its native API, becomes file-shaped. Mirage is the production analogue of the architectural pattern datafetch borrowed from Mintlify ChromaFs (`kb/br/10`) and browser-harness (`kb/br/12`), generalised across roughly 25 backend types in one shipped library.

For datafetch's "hosted version that supports multiple services out of the box" question, the honest answer is that Mirage is *the substrate datafetch's data plane could be hosted on*, not a competitor to datafetch's product. Mirage explicitly disclaims the agent-harness layer: their docs say "Skills are the agent harness's job. Mirage owns the gesture layer." That is precisely the seam datafetch occupies, intent-bound workspaces, crystallisation, the cold-to-warm flip, the typed `df.d.ts` namespace, the `df.answer({...})` commit primitive. Adopting Mirage as a multi-service mount layer beneath datafetch would give the hosted product a 25-resource catalog, a tarball-snapshot-with-credential-redaction primitive, an async per-path locking cache, and a provision dry-run cost estimator for free, in exchange for replacing today's `just-bash` MountableFs with Mirage's tree-sitter-bash + custom executor. It would not give datafetch multi-tenancy: Mirage's server has zero auth, no tenant concept, no RBAC, and the "self-hosted only" claim in their docs is structurally accurate.

The recommended posture is *adopt selectively, do not lift wholesale*. Three Mirage primitives are worth lifting into datafetch: the snapshot-tarball-with-credential-redaction shape (currently we have nothing comparable for hosted intent workspaces), the provision dry-run pattern with `(network_read_low, network_read_high, cache_hits, precision)` (a cleaner upstream gate than relying on tier classification post-execution), and the per-resource per-extension command override (`@command(name="cat", resource="s3", filetype="parquet")`, useful for the "agent runs `cat` on a Mongo collection and gets paginated JSON instead of bsondump"). The runtime, the 25-resource catalog, the bash executor, and the metaphor layer (Eyes / Hands / Arm / Gestures) are not load-bearing for datafetch's pitch and lifting them would dilute the cold-to-warm flip story rather than strengthen it. The most ambitious framing, "datafetch is the learning layer Mirage explicitly leaves open," is genuine and would be a real architectural narrative if hosted-datafetch ever wants to grow beyond the MongoDB Atlas substrate, but it is roadmap, not Q2.

---

## Overview

**What it is.** Mirage is "a Unified Virtual File System for AI Agents", in their own framing. The agent gets a `Workspace` with mounted resources (`/data` to RAM, `/s3` to an S3 bucket, `/slack` to a Slack workspace, `/github` to a GitHub repo) and runs `await ws.execute("grep alert /slack/general/*.json | wc -l")` against any of them through one bash interface. The shell is a real tree-sitter bash parser plus a custom executor (no `os.system`, no shell-out to `/bin/bash`); each leaf operation (`read`, `readdir`, `stat`, `write`, `mkdir`, `unlink`, `rename`) is dispatched to the per-mount resource accessor through a longest-prefix-match registry. Resources implement the small "Fingers" interface (their term for ops); shell commands are "Gestures" composed from fingers; cross-mount commands like `cp /s3/a /gdrive/b` are "Handshakes". The whole system runs in-process, with optional FUSE exposure if you want host editors and language servers to see the mount.

**Traction at moment of launch.** First public commit 2026-05-06 17:00 UTC (`https://github.com/strukto-ai/mirage`), v0.0.1 release tagged 2026-05-06 18:44 UTC, 247 stars by 2026-05-07 morning. PyPI publishes `mirage-ai` and npm publishes `@struktoai/mirage-core`, `mirage-node`, `mirage-browser`, and `mirage-cli`. The git history is a single squash commit by Zecheng Zhang (`zecheng@strukto.ai`); the public docs site (`docs.mirage.strukto.ai`) is fully populated; the company landing page lists Stanford, YCombinator, and AWS AI as backers. Hacker News and Reddit have no discussion as of this writing, the launch is too recent. The repo's own `docs/plans/` directory contains 45 internal design documents dated between 2026-04-16 and 2026-05-04, indicating roughly three weeks of pre-launch private development by what reads as a small team.

**Why it matters for datafetch right now.** Three reasons. First, Mirage is the externally-shipped, externally-marketed reference architecture for the pattern datafetch's elevator pitch already commits to, "agent reasons in bash, substrate is mounted as a virtual filesystem", and its existence validates the pattern at production scale across ~25 backends. Second, the user's specific question is whether a hosted datafetch should support multiple services out of the box, and Mirage is exactly the catalog of services a hosted datafetch would otherwise have to build resource-adapter-by-resource-adapter. Third, Mirage explicitly draws a line at the Skill / Gesture boundary, leaving the learning layer open, which is the layer datafetch occupies. There is a coherent reading of the two systems where datafetch sits on top of Mirage as the crystallisation layer Mirage is structurally missing; whether to take that reading seriously is the integration analysis section's job.

**The brand-new caveat, stated upfront.** Mirage is v0.0.1-alpha, single-commit public history, single named author. The codebase is substantial (roughly 142K lines of Python and 228K lines of TypeScript across the four published packages, with 533 Python test files and 529 TypeScript test files), and the design documentation is unusually thorough for a freshly-launched project, but production-readiness signals are mixed: error handling is inconsistent across resources, no Python type-checker in CI, the SSH resource has empty credential redaction, and the server has zero authentication. This brief treats Mirage as "production-ready for controlled scenarios, alpha for hosted multi-tenant" and the integration recommendations follow that read.

---

## How It Works

### The mental model: Brain, Eyes, Hands, Arm, Fingers, Gestures, Recall

Mirage's docs introduce an anatomical metaphor that the codebase actually follows. The **Brain** is the agent (Claude Code, Codex, OpenAI Agents SDK, etc.); Mirage owns nothing here. The **Arm** is the `Workspace` object, the agent's reach into external systems; one `Workspace` holds many mounts and many sessions. **Eyes** are the mounted Resources (S3, Slack, GitHub, etc.). **Hands** are the operations the agent performs. **Fingers** are the seven primitive ops every backend implements (`read`, `readdir`, `stat`, `write`, `mkdir`, `unlink`, `rename`); they are the "M" in their "N + M" promise. **Gestures** are the named bash commands composed from fingers (`cat`, `grep`, `cp`, `jq`, around 75 verbs); they are the "N". **Handshakes** are gestures that span two resources (`cp /s3/a /gdrive/b`). **Recall** is the cache layer, split into Index Store (directory listings, metadata) and File Store (file content). The metaphor is consistent across the docs and the source code; it is not load-bearing for understanding the system, but it is load-bearing for understanding the team's framing of what they own (gestures down to fingers) versus what they leave to harness authors (skills, learning, intent).

### The execute flow, end to end

A call like `await ws.execute("grep -r alert /s3/")` traverses the following path (file paths verified against the cloned repo):

```
+-----------------------------------------------------------------+
|  Workspace.execute(cmd)                                         |
|    python/mirage/workspace/workspace.py:481                     |
|                                                                 |
|    1. parse(cmd) -> tree-sitter-bash AST                        |
|       python/mirage/shell/parse.py:22                           |
|                                                                 |
|    2. _execute_node(ast, session, ...) walks AST                |
|       python/mirage/workspace/node/execute_node.py:59           |
|       (handles program, command, pipeline, list, for, while)    |
|                                                                 |
|    3. handle_command() for a leaf command                       |
|       python/mirage/workspace/executor/command.py:516           |
|                                                                 |
|    4. registry.resolve_mount(cmd_name, paths, cwd)              |
|       longest-prefix match -> S3 Mount                          |
|                                                                 |
|    5. _parse_flags(parts, mount, cmd_name, cwd)                 |
|       uses CommandSpec to classify positional args as           |
|       PATHs (resolved through mount table) vs TEXTs             |
|                                                                 |
|    6. mount.execute_cmd("grep", paths, texts, **kw)             |
|       python/mirage/workspace/mount/mount.py:299                |
|       cascade: (cmd, ext) -> (cmd, None) -> general[cmd]        |
|                                                                 |
|    7. cmd.fn(accessor, paths, *texts, **kw)                     |
|       e.g. python/mirage/commands/builtin/s3/grep/grep.py       |
|       streams S3 objects, applies regex                         |
|                                                                 |
|    8. apply_io(io)                                              |
|       cache reads in io.reads, invalidate dirs in io.writes     |
|       python/mirage/workspace/workspace.py:524                  |
|                                                                 |
|    9. _record_execution()                                       |
|       appends to ExecutionHistory, fires Observer               |
+-----------------------------------------------------------------+
```

The `IOResult` returned to the agent carries `stdout` (a lazy `ByteSource`), `stderr`, `exit_code`, plus the side-channel `reads: dict[path, bytes]` and `writes: dict[path, bytes]` and `cache: list[path]` that the workspace uses to populate the cache. Pipes are demand-driven: when downstream stops reading, upstream stops being asked for chunks. The exception is the cache-drain task: when a file is flagged for caching, a background task continues downloading even after downstream exits, so the cache entry is complete for the next read. This is a deliberate trade-off the docs flag explicitly.

### The Resource interface, in 60 lines

A new backend is a `BaseResource` subclass. The minimum viable implementation declares a `name`, exposes an `Accessor` object (the SDK-bound client), and registers `@command(...)` and `@op(...)` decorated functions. Reading from `python/mirage/resource/base.py:28` and confirmed against `python/mirage/resource/s3/s3.py`:

```python
from mirage.resource.base import BaseResource
from mirage.commands.registry import command
from mirage.commands.spec import CommandSpec

class MyResource(BaseResource):
    name = "mybackend"
    is_remote = True
    PROMPT = "A short string describing the resource for the LLM."
    WRITE_PROMPT = "Additional prompt fragment when mounted writable."

    def __init__(self, config):
        super().__init__()
        self.accessor = MyAccessor(config)
        self.register_op(read_bytes_op)
        self.register_op(readdir_op)
        # ... seven primitive ops ...
        self.register(grep_my)        # @command(resource="mybackend")
        self.register(cat_my)
        # ... register more commands as needed ...

    def get_state(self):
        return {"config": self._redact(self.config)}

    def load_state(self, state):
        self.config = state["config"]
```

That is the full surface area for a new resource. The "N + M" promise is real: implementing the seven primitive ops gives a backend access to all 75 built-in shell commands automatically, because the commands talk to ops, not to backend SDKs. A resource that wants per-extension behaviour (e.g. `cat` on Parquet returning a formatted table instead of raw bytes) registers `@command(name="cat", resource="mybackend", filetype="parquet")` and the dispatch table picks it up via `(command_name, extension)` cascade resolution.

### The cache layer (Recall): Index Store + File Store

Recall is per-Workspace, not per-Session. Two stores:

- **Index Store** (`python/mirage/cache/index/`) caches directory listings and metadata. Each `BaseResource` holds its own Index Store instance with a default 600s TTL. Backends: `RAMIndexCacheStore`, `RedisIndexCacheStore`. Invalidated whenever `io.writes` contains a path under that resource.
- **File Store** (`python/mirage/cache/file/`) caches file content. One instance shared across all mounts in a workspace, default 512 MiB cap, LRU eviction. Backends: `RAMFileCacheStore` (extends `RAMResource` so it inherits all RAM commands, neat), `RedisFileCacheStore` (gated behind `pip install mirage-ai[redis]`).

The cache supports two consistency policies. `LAZY` is stale-while-revalidate (read from cache if present, validate in background). `ALWAYS` revalidates on every access by stat-fingerprint comparison. Per-path async locking (`python/mirage/cache/lock.py`'s `KeyLockMixin`) prevents concurrent reads on the same path from racing on the cache entry; concurrent reads on different paths run in parallel.

The RAM file cache is included in workspace snapshots (so a snapshot is "warm"); the Redis file cache is not (its content lives outside the workspace, by design). This is a small but consequential detail for hosted-mode planning.

### Snapshot and clone: tarball with credential redaction

`Workspace.snapshot(target, compress=None)` writes a tarball (`python/mirage/workspace/snapshot/tar_io.py`). Inside the tarball: a `manifest.json` describing all mounts, sessions, cache entries, history, and finished jobs, plus blob sidecar files for any binary content extracted from the manifest. Resource classes are serialised by dotted module path (e.g. `"mirage.resource.s3.s3.S3Resource"`), reconstructed via `importlib` on load.

The interesting bit is credential handling. Every remote resource that holds secrets overrides `get_state()` and returns a redacted form (`aws_secret_access_key` becomes `"<REDACTED>"`); the resource is also marked `needs_override=True`. `Workspace.load(source, resources=...)` requires the caller to provide live resource objects for every `needs_override=True` mount, so credentials are re-injected at load time and never leak through the snapshot. This is consistently implemented across S3, Slack, GitHub, Notion, Linear, Discord, Telegram, Trello, MongoDB, Postgres, Redis, GDrive, GSheets, Gmail, GCS, R2, OCI, Supabase, with one exception: SSH has an empty `redacted = []` and `needs_override=False`. That is a real bug; flagged.

### Provision dry-run

`ws.execute("...", provision=True)` (or `ws.provision("...")` in TS) returns a `ProvisionResult` instead of running the command. The result carries `network_read_low/high`, `network_write_low/high`, `cache_read_low/high`, `cache_hits`, `read_ops`, `estimated_cost_usd`, and `precision` (one of `EXACT`, `RANGE`, `UPPER_BOUND`, `UNKNOWN`). The implementation walks the AST through a parallel `provision_node` tree (`python/mirage/workspace/provision/`) and dispatches to per-command `provision_fn` handlers; rollups handle pipes (sum), AND/`;` (sum), and OR (min, only one branch executes). Cache-hit detection subtracts already-cached paths from the network estimate.

The honest read on accuracy: only commands whose authors registered a `provision_fn` produce `EXACT` or `RANGE`; the default is `UNKNOWN` and most commands have no provision function. The cost-estimation infrastructure is real, but the cost coverage is incomplete at this maturity level.

### Custom commands and per-resource overrides

The `@command` decorator (`python/mirage/commands/config.py`) is the registration mechanism. Signature in practice:

```python
@command(
    name="summarize",
    resource="ram",
    spec=CommandSpec(...),
    filetype=None,             # optional file extension narrowing
    provision=summarize_plan,  # optional dry-run estimator
    write=False,
)
async def summarize(accessor, paths, *texts, **kwargs):
    ...
```

`CommandSpec` is a typed flag/operand DSL that drives parsing, tab completion, and `--help` text. Per-resource per-extension overrides are first-class: `python/mirage/commands/builtin/disk/grep/grep_parquet.py` is `@command(name="grep", resource="disk", filetype="parquet")` and is dispatched ahead of the general `grep` whenever the path's extension is `.parquet`. The same pattern works for Feather, HDF5, ORC. This is the cleanest "different bytes-format under the same verb" abstraction in the survey of agent VFS designs.

There is *no* `Workspace.command(name, body)` instance method on either Python or TypeScript Workspace classes, despite the README marketing snippet using it. The actual idiom is `@command` decoration plus `ws.mount(prefix).register_fns([fn])`. This is a small documentation drift, not a functional gap.

### Sandboxing properties

The shell only sees mounted resources. Unknown commands return `exit_code=127, stderr="cmd: command not found"` (`python/mirage/workspace/executor/command.py:630`); there is no fallback to host shell. The escape hatches:

- `python3` requires a mount with `MountMode.EXEC` set (`execute_node.py:688`); otherwise it is denied.
- `bash -c "..."` re-enters Mirage's executor recursively, not a real `/bin/bash` (`builtins.py:447`).
- `Workspace.execute(..., native=True)` invokes `asyncio.create_subprocess_shell` against the FUSE mountpoint; this is the only true host-shell escape and it requires FUSE to be mounted.
- The workspace context manager (`with ws: ...`) monkey-patches `builtins.open` and `sys.modules["os"]`, redirecting Python `open("/s3/...")` calls through the VFS for the duration of the with-block.

The isolation is process-level soft isolation, not container or seccomp. For untrusted code the docs explicitly recommend pairing Mirage with Daytona, E2B, or Modal. For our purposes (a hosted datafetch with co-resident tenants), this is the load-bearing concern, see Limitations.

### FUSE optional integration

`python/mirage/fuse/` is the FUSE adapter via `mfusepy`. The dependency is structurally optional: `WorkspaceConfig.fuse: bool = False` by default; `FuseManager.setup()` defers `from mirage.fuse.mount import mount_background` until called. `MirageFS(fuse.Operations)` bridges FUSE syscalls to the `Ops` layer through a background asyncio event loop in a daemon thread. `mfusepy` is unfortunately listed as both a core and optional dependency in `pyproject.toml`, so it gets pulled into every install whether FUSE is used or not, that is a packaging oversight rather than a design problem.

The relevant property for datafetch: FUSE makes Mirage's filesystem visible to host editors and language servers, so an agent and a human can both work against the same mount tree through their respective tools. This is structurally the same property as datafetch's intent workspace appearing as a real directory the human can `ls`; the difference is that Mirage's FUSE goes one layer deeper, exposing remote backends (S3, Slack) as real filesystem entries, while datafetch's directory contains only synthesised files (`scripts/`, `result/`, `db/` symlink to a local mount).

### Hosted / multi-tenant claims, verified

The docs state "Self-hosted. Mirage is a library plus a thin local daemon. The daemon lives in your process or sandbox." This is *structurally true* in the source. The daemon (`python/mirage/server/`) is a FastAPI app with a `WorkspaceRegistry` (`server/registry.py:43`), exposing REST endpoints for `POST /v1/workspaces`, `GET /v1/workspaces`, `POST /v1/workspaces/{id}/execute`, `GET /v1/workspaces/{id}/snapshot`, `POST /v1/workspaces/load`, `POST /v1/workspaces/{id}/clone`. Each workspace runs in its own `WorkspaceRunner` (a dedicated thread plus asyncio loop), and the daemon can snapshot all workspaces on shutdown and restore them on restart.

What does NOT exist:

- Zero authentication. No API keys, no Bearer tokens, no middleware on the FastAPI app. Any client that can reach the daemon socket can list, execute against, or delete any workspace.
- No tenant concept. The registry is flat; workspace_id is the only identifier.
- No RBAC beyond MountMode (READ / WRITE / EXEC) set at workspace creation.
- No rate limiting, quota, or workspace-size enforcement.
- No isolation between workspaces sharing the same Python process. A buggy resource implementation can crash the daemon for everyone.

If a hosted datafetch wanted to lift Mirage's daemon as the multi-resource mount layer, it would be building auth, tenant resolution, RBAC, quotas, and workspace-process isolation on top. That is real work, weeks rather than days.

---

## Strengths

- **The N + M decoupling is genuinely clean.** Backends implement seven Finger ops; the 75-verb Gesture catalog works against them automatically. New backends do not require touching commands; new commands do not require touching backends. The architectural shape is correct, and the codebase actually enforces it (no command file imports a backend SDK directly; commands always go through the Accessor).

- **The resource catalog is unusually broad for a launch-day project.** Twenty-five backends in Python (RAM, Disk, Redis, S3, R2, OCI, GCS, Supabase, GDrive, GDocs, GSheets, GSlides, Gmail, GitHub, GitHub CI, Slack, Discord, Telegram, Email, Linear, Notion, Trello, MongoDB, Postgres, SSH, Langfuse, Paperclip) plus six TypeScript-only (Dropbox, Box, Vercel, PostHog, SemanticScholar, OPFS). Compare to ChromaFs (1 backend, Chroma) and browser-harness (1 backend, Chromium DevTools). This is the "actually shipped" answer to the "agent shell over arbitrary services" pattern.

- **Tree-sitter bash plus a custom executor is the right architectural choice.** Real bash grammar coverage (parsing pipes, redirects, control flow, `for`, `while`, `if`, command substitution `$(...)`, arithmetic expansion `$(())`) without shelling out to `/bin/bash`. The executor is the single bottleneck for sandbox properties, not relying on container teardown for isolation.

- **Per-resource per-extension command override is a genuinely novel primitive.** `@command(name="cat", resource="s3", filetype="parquet")` lets the same `cat /s3/file.parquet` invocation render the file as JSON rows instead of raw bytes, automatically. This is the cleanest answer in the survey to "different content types under the same verb"; ChromaFs and browser-harness both punt on this. Useful directly for datafetch, see Integration.

- **Snapshot with credential redaction and rebind-at-load.** Twenty-three of twenty-five resources implement `get_state()` redaction and `needs_override=True` consistently. A snapshot tarball does not contain raw credentials; loading requires re-injecting live resource objects. This is the right hosted-mode primitive.

- **Provision dry-run with cost estimation.** Real infrastructure (`ProvisionResult` with low/high bands, precision enum, rollup across pipes and AND/OR/`;`). Even when individual command coverage is incomplete, the framework is in place; new commands can plug in `provision_fn` handlers incrementally.

- **Per-path async locking in the cache.** `KeyLockMixin` ensures concurrent reads on the same path serialize on a per-path lock; different paths run in parallel. Correct concurrency model for an agent harness with multiple sessions.

- **The `file_prompt` property auto-generates LLM system prompt fragments** describing every mounted resource and its paths. Agents do not need handcrafted prompt-engineering for each new mount; the system prompt updates automatically as mounts come and go. Small but useful primitive datafetch could borrow.

- **Snapshot, clone, restore work cross-machine.** Combined with credential rebind, this is the clean "move agent workloads between hosts" property datafetch's intent workspaces lack. (Datafetch workspaces today are filesystem-rooted on one machine; portability is implicit and not a load-bearing primitive.)

- **TypeScript stack is parallel-architected, not a thin client.** Both Python and TS have full Workspace, Resource, Mount, Session, executor, cache, agent integrations, daemon (TS via `packages/server`), CLI. This is real cross-runtime engineering investment.

- **Strong tooling discipline for v0.0.1.** TypeScript at maximum ESLint strictness (`tseslint.configs.strictTypeChecked` + `stylisticTypeChecked`), pre-commit pipeline (yapf, isort, autoflake, flake8, ruff for Python; Prettier + ESLint for TS), CI workflows (`pre-commit.yml` and `test.yml`) with a Redis service container for integration tests, locked dependency files committed.

- **Active design discipline pre-launch.** Forty-five dated design plan documents in `docs/plans/` between 2026-04-16 and 2026-05-04 (TS Notion MCP design, Postgres resource, SSH resource, server/CLI architecture, Discord resource, Slack attachments, VFP extraction). For v0.0.1 this is extraordinary.

---

## Limitations & Risks

- **Single named author, single squash commit.** Bus factor visible from the public repo is 1 (Zecheng Zhang). The 45 design documents and the codebase volume suggest a small team worked privately, but team size, code review practices, and release cadence are unknowable from the public artefact. For a hosted-datafetch dependency, this is a real risk: if Strukto raises and pivots, or if the lead author leaves, the upstream stops. Mitigation: Apache 2.0, fork is always available; but a fork inherits maintenance.

- **No multi-tenancy story.** Zero authentication on the FastAPI daemon. No tenant namespace. No RBAC. No quotas. No rate limiting. No workspace process isolation. The "self-hosted only" framing in their docs is structural, not a marketing position. For datafetch's hosted-version question, this is the load-bearing limitation: lifting Mirage means building tenancy on top.

- **Inconsistent error handling across resources.** S3 translates `NoSuchKey` to `FileNotFoundError`; everything else propagates raw boto3 exceptions. Slack collapses every API error into a generic `RuntimeError(f"Slack API error: {err}")`, including auth failures and rate limits. GitHub uses raw `aiohttp.ClientResponseError` with no 429/403 retry logic. Discord and Telegram do have rate-limit handling with `asyncio.sleep`. The FUSE layer translates `FileNotFoundError` to `ENOENT` and `PermissionError` to `EACCES`, but does not translate read-only mount violations to `EROFS` (it raises `PermissionError` instead). For a hosted environment, the unevenness shows up as inconsistent failure modes the hosting layer would have to paper over.

- **SSH resource has empty credential redaction.** `SSHResource.get_state()` (`python/mirage/resource/ssh/ssh.py:108-118`) has `redacted = []` and `needs_override = False`. The `SSHConfig` includes `identity_file` (path to a private key on disk). A snapshot tarball will leak local filesystem layout, and the rebind-at-load workflow does not require the caller to re-inject SSH config. Real bug; needs upstream fix or local patch before SSH would be safe in a hosted snapshot.

- **`mfusepy` is a core dependency, not optional.** Listed twice in `pyproject.toml`, once in core deps and once in the `fuse` extra. Every `pip install mirage-ai` pulls it whether FUSE is used or not. Packaging oversight, not a security issue, but it widens the surface.

- **Some claimed integrations are not in the source.** README and docs claim Claude Code CLI plugin and Codex CLI plugin support; the source has only `CLAUDE.md` and `AGENTS.md` as developer-workflow docs, no Claude Code extension manifest, no `mcp.json`, no plugin entrypoint. The OpenAI Agents SDK, Vercel AI SDK, LangChain, Pydantic AI, CAMEL, OpenHands, Mastra, and pi integrations are real and present in `python/mirage/agents/` and `typescript/packages/agents/src/`. The Claude Code / Codex pieces appear aspirational at this snapshot.

- **No Python type-checker in CI.** `mypy` and `pyright` are absent. Pre-commit runs ruff/flake8 (lint) and yapf (format). TypeScript has strict type-checking but it is unclear from the workflow files whether `typecheck` runs in CI. Type discipline is lighter on the Python side than the TS side.

- **Session-level concurrency is incomplete.** The `SessionManager` exposes `lock_for(session_id)` but `Workspace.execute()` does not acquire it. Concurrent calls to `execute()` with the same `session_id` can race on `session.last_exit_code` and `self._current_agent_id`. The cache layer is correctly locked per-path; the session layer is not.

- **`jq-wasm` pinned to an exact version (`1.1.0-jq-1.8.1`).** If that version is yanked from npm, every Mirage install breaks. Fragile pin.

- **Real-backend integration tests are not in CI.** Slack, GitHub, Linear, Notion etc. tests skip when their respective env vars are absent (`pytest.mark.skipif(not os.environ.get("NOTION_API_KEY"), ...)`). CI does not provide credentials, so the integration correctness of the cloud-API resources is untested in the automated pipeline. S3 is tested via `moto` mocks, which is fine for the parsing layer and weak for the actual API contract.

- **The TS package naming differs from the README.** README refers to `mirage-core`, `mirage-node`, `mirage-browser`, `mirage-cli`; the on-disk package directories are `core`, `node`, `browser`, `server`, `cli`, `agents`. Minor friction for anyone trying to navigate the source from the README.

- **Cache snapshot omits Redis cache.** `state.py:183-185` skips the Redis file cache "because its content lives outside the workspace." Correct in principle, but a portable snapshot of a Redis-cached workspace will have cold cache on restore, and there is no metadata signalling the eviction. For hosted mode, this is an observability gap.

- **No upstream community signal yet.** Hacker News and Reddit have no discussion as of 2026-05-07 morning. The 247 stars in 24 hours indicate organic interest at launch, but there is no production-user list, no published latency or correctness benchmarks, no third-party blog posts. The architectural shape is validated through ChromaFs (Mintlify production, prior brief `kb/br/10`) and browser-harness (10K+ stars, prior brief `kb/br/12`); Mirage's specific implementation has zero independent verification.

- **`docs/plans/` was left in the public repo.** This is a strength (transparency, design rigor) and a weakness (the team's roadmap is fully exposed; a competitor could ship the planned features first). Net positive, but worth flagging as a sign the public-repo posture is informal.

- **The "skills are someone else's job" line is also a defensive perimeter.** Mirage explicitly carves out the gesture layer and leaves skills to the harness. Read charitably, this is good architectural humility. Read uncharitably, it is a way to ship a v0.0.1 without committing to the harder problem (learning, accumulation, intent reuse) that browser-harness and datafetch are working on. If Mirage later expands into Skills, datafetch has direct competition.

---

## Integration Analysis

This is the section the user asked for explicitly: how Mirage compares to the bash datafetch is using today, and how it might fit a hosted-datafetch strategy that supports multiple services out of the box.

### Side-by-side: Mirage vs current datafetch

```
+--------------------+-------------------------------+-------------------------------+
| Property           | Mirage v0.0.1                 | Datafetch (current)           |
+--------------------+-------------------------------+-------------------------------+
| Substrate          | ~25 backends, side-by-side    | 1 substrate (MongoDB Atlas)   |
| Bash shell         | tree-sitter + custom executor | just-bash MountableFs         |
|                    | Python AND TypeScript         | TypeScript only               |
| Agent surface      | 75 bash gestures              | bash + 4-verb allowlist       |
|                    |                               | + typed df.d.ts namespace     |
| Workspace shape    | Kernel: many mounts, many     | Intent-bound: one tenant,     |
|                    | sessions, no intent           | one dataset, one intent       |
| Tenancy            | None (flat registry, no auth) | Per-tenant lib/<tenant>/      |
|                    |                               | overlay; structural primitive |
| Learning loop      | None (skills = harness's job) | Crystallisation from accepted |
|                    |                               | df.answer({...}) commits      |
| Cost model         | Provision dry-run, low/high,  | Trajectory tier (0..4) and    |
|                    | precision, per-command        | mode (novel/interpreted/...), |
|                    | provision_fn                  | post-execution               |
| Snapshot/clone     | Tarball with credential       | None today; intent workspace  |
|                    | redaction + rebind-at-load    | is FS-rooted on one machine   |
| Cache              | Recall = Index Store + File   | None at substrate layer       |
|                    | Store, per-Workspace, async   | (Mongo Atlas owns its own)    |
|                    | per-path locks                |                               |
| Custom commands    | @command(filetype=..., ...)   | fn({intent, input, output,    |
|                    | per-resource per-extension    | body}) factories under        |
|                    | overrides                     | lib/<tenant>/<name>.ts        |
| FUSE               | Optional, mfusepy             | None (no kernel mount)        |
| License            | Apache 2.0                    | Internal (hackathon)          |
| Maturity           | v0.0.1, single-commit history | Pre-1.0, hackathon WIP        |
+--------------------+-------------------------------+-------------------------------+
```

The two systems are *complementary*, not competitive, in the strongest reading. Mirage owns "many backends, one bash interface"; datafetch owns "one backend, one typed interface that learns from accepted work." Where they overlap is the bash shell layer and the workspace concept; the rest of the surfaces are orthogonal.

### What to extract

Six Mirage primitives are worth lifting into datafetch, ordered by ROI:

**1. Snapshot tarball with credential redaction and rebind-at-load.** Datafetch's intent workspaces are filesystem-rooted; there is no portable artifact today. For a hosted-datafetch where workspaces live in object storage and need to be cloned, paused, resumed, or moved between machines, Mirage's pattern is exactly right: the workspace is a tarball with `manifest.json` plus blobs, every credential-bearing resource declares `redacted` fields and `needs_override=True`, the load API requires the caller to provide live resource objects for those mounts. Lift the whole shape: format, redaction conventions, the override-at-load API. Datafetch has nothing comparable, and a hosted product needs it.

**2. The provision dry-run pattern.** `ProvisionResult(network_read_low, network_read_high, cache_read_low, cache_read_high, cache_hits, read_ops, estimated_cost_usd, precision)` with rollup across pipes and AND/OR/`;`. Datafetch today classifies cost *post-execution* as a tier (0..4) and mode (`novel | interpreted | llm-backed | cache | compiled`) on the trajectory; a *pre-execution* dry-run that can be shown to the agent before it commits to a tier-4 ReAct composition would be a real ergonomic and economic win. Frame it as: `datafetch provision scripts/answer.ts` returns "estimated $0.XX, precision: RANGE, primary cost: 1 LLM dispatch + 4 substrate calls" before the agent runs anything. The infrastructure shape (per-call provision_fn handlers, AST-walking rollup, precision enum) is directly liftable. Datafetch's `df.answer({...})` envelope is a natural place to add a `cost_estimate` field that the runtime fills before execution.

**3. The per-resource per-extension command override.** `@command(name="cat", resource="s3", filetype="parquet")` letting `cat /s3/file.parquet` render as JSON rows. Datafetch today routes everything through typed `df.db.<coll>.findExact|search|findSimilar|hybrid`, but the agent's bash shell gets `cat`, `ls`, `jq` against the local `db/` symlink. If the agent runs `cat /db/finqa/cases/<id>` today it gets raw BSON; the same `@command` pattern would let datafetch render Mongo documents as paginated JSON, render Parquet samples as tables, and render Atlas Vector Search results as ranked JSONL, all under the same `cat` verb. Lift the pattern as a small extension to `just-bash`'s command registry. (just-bash already supports `defineCommand`, the hook is there; this is just adding the per-extension dispatch table.)

**4. The Recall split: Index Store + File Store.** Datafetch does not cache substrate reads today; every `findSimilar` is a fresh Atlas query. For a hosted-datafetch with paying tenants, a per-tenant Index Store (cached collection metadata, sample counts, capability flags) and a per-tenant File Store (cached `findSimilar` result sets, validated against fingerprint) would be a real cost and latency win. Mirage's per-Workspace cache shape is the right structural starting point; per-tenant means using `tenantId` as the cache namespace instead of `workspaceId`. The async per-path lock pattern transfers directly.

**5. The `file_prompt` auto-generated system-prompt fragment.** Mirage's Workspace exposes a `file_prompt` property that returns a string describing every mounted resource and its paths, suitable for inclusion in the LLM system prompt. Datafetch's analog is the auto-generated `AGENTS.md` and `df.d.ts`; Mirage's is shorter and substrate-agnostic. Combine: keep the typed `df.d.ts` (it is strictly stronger than prose, see prior brief `kb/br/10`) but adopt Mirage's "the prompt updates automatically as mounts change" property. Today datafetch regenerates `AGENTS.md` after observer writes (`src/bootstrap/workspaceMemory.ts`); make sure the same loop runs after any new dataset mount in hosted mode.

**6. The `MountMode` (READ / WRITE / EXEC) primitive.** Datafetch today has implicit read-only on `db/` and writable on `lib/<tenant>/`; the constraint lives in the `MountableFs` config, not in a typed enum. Adopt Mirage's explicit `MountMode` and propagate it through the workspace API. The benefit is twofold: tenants can be granted EXEC on some mounts (for `python3` / `bash -c` escape hatches) and not others, structurally; and the snapshot/restore primitive can carry mode per-mount in the manifest, so a tenant cannot escalate by reloading a snapshot with elevated modes.

### Bootstrap path

The integration is staged. No big bang; each stage is independently shippable.

**Quick (under one hour each)**
- Document Mirage's existence and the "skills are the harness's job" framing in `kb/research.md`. The architectural validation, "production-shipped, ~25 backends, same shell-as-agent-surface pattern", is worth a paragraph.
- Add a `MountMode` enum to datafetch's mount config and surface it in the workspace API. Today the read-only / writable distinction is implicit; making it explicit unlocks (4) and (6) below.
- Add a one-line note in `kb/principles.md` under "Adopt over invent": Mirage is the reference for the hosted multi-resource catalog if/when datafetch grows beyond MongoDB Atlas. We are not lifting it for the MVP, but the pattern is validated.

**Short (under four hours each)**
- Sketch the snapshot-with-credential-redaction shape for hosted intent workspaces in `kb/prd/`. Concrete schema for `manifest.json`, the list of fields each resource type would redact, and the rebind-at-load API. Reference `python/mirage/workspace/snapshot/state.py` and `python/mirage/resource/s3/s3.py:get_state` as the model. This is the load-bearing primitive for any hosted-datafetch story; designing it now is cheap.
- Sketch a `datafetch provision scripts/answer.ts` verb that runs the snippet through a dry-run path: classify each `df.db.*` and `df.lib.*` call, return `ProvisionResult{ tier_estimate, calls_estimate, llm_dispatches_estimate, precision }`. The TS implementation can borrow the AST-walk pattern from Mirage; the per-call estimator is a function of the existing `lib/<tenant>/` manifest.
- Add per-extension `cat` overrides to `just-bash`'s command registry on the datafetch side. `cat /db/finqa/cases/<id>.bson` as JSON, `cat /db/<mount>/<coll>/<id>.parquet` as a table preview, `cat /db/.../<vector>.npy` as shape + first 8 entries. This is small, agent-facing UX work that lifts the bash experience without changing the typed surface.

**Medium (under one day each)**
- Implement the snapshot-with-credential-redaction primitive end to end: workspace serialises to a tarball, MongoDB Atlas connection strings are redacted with `<REDACTED>`, load requires a `connections={mountId: AtlasMount(uri)}` override dict. Include the `lib/<tenant>/` overlay state in the manifest so a snapshot is a complete "moveable workspace". Ship a `datafetch workspace snapshot <intent-id> <output.tar>` and `datafetch workspace load <input.tar>` verb pair.
- Implement the per-tenant Recall (Index Store + File Store) over Atlas. Index Store: cached collection metadata and sample counts keyed by `(tenantId, mountId, collectionName)`. File Store: cached `findSimilar` result sets keyed by `(tenantId, queryHash, limit)` with validity gated on the substrate's `_descriptor.json` fingerprint. Per-path async lock (`KeyLockMixin` shape) on the cache for concurrent same-key reads. This is independently useful for the cold-to-warm flip story: cache hits are tier-1 in the existing taxonomy, currently aspirational.
- Implement `datafetch provision` with per-call estimators for the seed primitives (`pickFiling`, `inferTableMathPlan`, `executeTableMath`, `findSimilar`) and a fallback `precision: UNKNOWN` for everything else. Wire it into the `datafetch run` and `datafetch commit` workflows so the agent (and the hosted control plane) can see "this is going to be a tier-4 run, ~$0.XX" before the snippet executes.

**Large (more than one day each)**
- *Optional, not recommended for the MVP*: lift Mirage as a substrate library under datafetch's data plane to grow beyond MongoDB Atlas. Mount Mongo at `/db/atlas/<dataset>/`, S3 at `/db/s3/<bucket>/`, Postgres at `/db/pg/<db>/`, and let datafetch's typed surface (`df.db.<ident>.findExact|search|findSimilar|hybrid`) work uniformly across all three. This is the genuinely ambitious version of the user's "hosted datafetch supporting multiple services out of the box" question. The cost is significant: replacing `just-bash` MountableFs, building auth on top of Mirage's daemon, mapping datafetch's typed primitives to Mirage's per-resource ops, and validating that the cold-to-warm crystallisation loop still works when the substrate is heterogeneous. Not for Q2; worth a design doc in `kb/prd/` if the hosted-multi-substrate pitch becomes load-bearing for the company narrative.
- *Optional, more interesting*: position datafetch as the Skill / Learning layer Mirage explicitly leaves open. Concretely: write a small `datafetch-on-mirage` adapter that takes a Mirage `Workspace` and a tenant id, watches `ws.execute(...)` calls for `df.answer({...})`-shaped commits, and crystallises the trajectory into `lib/<tenantId>/<name>.ts` files registered as Mirage custom commands via `@command`. The agent calling `datafetch.answer "what is X"` against a Mirage-backed workspace would get the cold-to-warm flip even if the underlying substrate is GitHub, Slack, or Notion rather than Atlas. This is an architectural narrative, not a near-term build, but it is the strongest version of "datafetch is the missing learning layer".

### Effort estimate

- Adopting the design notes (Quick + Short tier above): **Quick** to **Short** total, no production code, refines the kb and PRD.
- Implementing the three Medium-tier primitives (snapshot+redaction, per-tenant Recall, `datafetch provision`): **Medium** each, **Medium-Large** in aggregate (so 1 to 3 days of focused work each).
- Lifting Mirage as the multi-resource substrate (Large path 1): **Large**, weeks rather than days, with the multi-tenancy work alone being a one-to-two-week project.
- The "datafetch on Mirage" adapter (Large path 2): **Medium** for a working sketch, **Large** for a hardened integration, contingent on Mirage v0.1.x stabilising the API.

### Open questions for the hosted-datafetch decision

1. *Does the hosted product need to support substrates beyond MongoDB Atlas at launch?* If yes, lifting Mirage (or building Mirage-shaped resource adapters in datafetch) is not optional. If no, the Medium-tier primitives (snapshot, Recall, provision) are sufficient and the substrate stays Atlas. The user's framing ("hosted version that supports out of the box multiple hosted services") leans toward yes; worth confirming.

2. *Is "the agent runs bash against arbitrary services" actually the hosted-datafetch pitch, or is it "the agent gets a typed surface over a curated dataset that learns from use"?* These are different products. Mirage is the first; datafetch is the second. The hosted version could be either; the choice determines whether Mirage is the right substrate or the wrong one.

3. *How load-bearing is the cold-to-warm flip in the hosted product?* If the answer is "very" (the demo's call-graph collapse is the headline), then the substrate matters less than the learning loop, and Mirage is a fine plumbing layer for whatever services the hosted product mounts. If the answer is "less than we thought" (the headline becomes "look at all the services we support"), then datafetch is competing with Mirage rather than complementing it.

4. *What is the hosted-datafetch tenant story?* Tenant namespace, auth, RBAC, quotas, isolation. Mirage has none of these. Adopting Mirage means building them; not adopting Mirage means building them anyway. The question is whether to build them once (against datafetch's mount layer) or twice (against datafetch's mount layer plus on top of Mirage). This is the deciding factor for the "lift Mirage" question.

---

## Key Takeaways

1. **Mirage validates the architectural shape, not the product.** The "agent reasons in bash, substrate is mounted as a virtual filesystem" pattern is now production-shipped at ~25 backends in one library, with strong tooling, snapshot+redaction, and provision dry-run. Cite Mirage in `kb/research.md` as the third public reference (alongside ChromaFs and browser-harness) for the architectural pattern datafetch already commits to. Do not let "Mirage exists" become "we should use Mirage"; the pattern validation is the takeaway, not the migration.

2. **Lift three Mirage primitives now.** Snapshot tarball with credential redaction and rebind-at-load (load-bearing for hosted mode), provision dry-run with cost estimate (cleaner upstream gate than post-execution tier), per-resource per-extension command override (small UX win for `cat` over BSON / Parquet / vectors). Each is independently shippable in **Medium** or less. None require committing to Mirage as a runtime dependency.

3. **Do not lift Mirage's runtime for the MVP.** It is v0.0.1, single named author, single squash commit, no multi-tenancy, inconsistent error handling, one real credential-redaction bug (SSH). Datafetch already uses `just-bash` MountableFs; the architectural shape works; the catalog of services is one substrate (MongoDB Atlas) and there is no shipping pressure to expand it. The risk-reward of replacing the bash layer with a brand-new dependency is negative for Q2.

4. **The strongest narrative reading is "datafetch is the learning layer Mirage explicitly leaves open."** Mirage's docs say "Skills are the agent harness's job. Mirage owns the gesture layer." Datafetch's pitch is precisely the agent-harness skill layer, with the cold-to-warm flip and the typed `df.lib.*` surface as the differentiators. If a future Strukto pitch goes "buy Mirage + your favorite skill layer", datafetch is the favourite skill layer. This is roadmap, not Q2, but it is the most ambitious framing of the relationship and worth holding in mind for narrative continuity.

5. **The hosted-datafetch decision turns on a single question: how heterogeneous is the substrate at launch?** If MongoDB Atlas is enough, the three lifted primitives plus per-tenant overlays plus auth are the whole job, and Mirage stays a reference architecture in the kb. If "hosted means S3 plus Slack plus Notion plus Postgres plus Atlas", then either build Mirage-shaped resource adapters in datafetch (which is genuinely a lot of work) or lift Mirage as a substrate (which is also a lot of work, with different risks). The middle option, "lift only the resource adapters from Mirage, keep our own bash shell and our own tenant story", is feasible if Mirage's Apache 2.0 license accommodates that pattern; it is the cheapest path to "out of the box multiple hosted services" if the user's framing is the load-bearing one.

---

## Sources

### Primary sources (Mirage)

- [strukto-ai/mirage on GitHub](https://github.com/strukto-ai/mirage), 247 stars at 2026-05-07 morning, single squash commit by Zecheng Zhang, Apache 2.0, first release v0.0.1 tagged 2026-05-06 18:44 UTC.
- [docs.mirage.strukto.ai](https://docs.mirage.strukto.ai/home/introduction), the published documentation site (Mintlify-hosted), full coverage of concepts, design (VFS / fingers / gestures / handshakes / FUSE / limitations), Python and TypeScript quickstarts, resource matrix, agent framework integrations.
- [Strukto.ai homepage](https://www.strukto.ai/), lists Mirage and AgentBox as products, names Stanford / YCombinator / AWS AI as backers.
- [PyPI: mirage-ai](https://pypi.org/project/mirage-ai/), version 0.0.1, Development Status :: 3 - Alpha.
- [npm: @struktoai/mirage-node](https://www.npmjs.com/package/@struktoai/mirage-node), version 0.0.1.

### Cited Mirage source files (from the cloned repo at /tmp/scout-mirage-XurZa3/mirage)

- `python/mirage/workspace/workspace.py:481-538`, the Workspace.execute path.
- `python/mirage/shell/parse.py:22`, tree-sitter bash parser entry.
- `python/mirage/workspace/node/execute_node.py:59`, AST walker.
- `python/mirage/workspace/executor/command.py:516, 630`, leaf command handler.
- `python/mirage/workspace/mount/mount.py:29, 89-108, 162-186, 299-376`, Mount and registration.
- `python/mirage/workspace/mount/registry.py:26`, MountRegistry longest-prefix sort.
- `python/mirage/resource/base.py:28`, BaseResource interface.
- `python/mirage/resource/s3/s3.py`, S3 resource implementation including `get_state` redaction.
- `python/mirage/resource/ssh/ssh.py:108-118`, SSH `get_state` (the empty-redaction bug).
- `python/mirage/cache/file/ram.py`, `python/mirage/cache/file/redis.py`, the File Store implementations.
- `python/mirage/cache/index/{store,ram,redis}.py`, the Index Store implementations.
- `python/mirage/cache/lock.py`, KeyLockMixin per-path async locking.
- `python/mirage/workspace/snapshot/{tar_io,state}.py`, snapshot tarball format.
- `python/mirage/workspace/provision/{command,control,pipes,rollup}.py`, provision dry-run pipeline.
- `python/mirage/provision/types.py:27`, ProvisionResult schema.
- `python/mirage/commands/config.py:68`, the @command decorator.
- `python/mirage/commands/builtin/disk/grep/grep_parquet.py`, per-extension command override example.
- `python/mirage/server/registry.py:43, 145-165`, daemon WorkspaceRegistry.
- `python/mirage/agents/openai_agents/sandbox.py`, OpenAI Agents SDK integration.
- `python/mirage/agents/langchain/backend.py`, LangChain deepagents integration.
- `python/mirage/agents/pydantic_ai/backend.py`, Pydantic AI integration.
- `python/mirage/agents/camel/terminal.py`, CAMEL integration.
- `python/mirage/agents/openhands/workspace.py`, OpenHands integration.
- `python/mirage/fuse/{mount,fs}.py`, FUSE adapter via mfusepy.
- `typescript/packages/core/src/workspace/workspace.ts`, TS Workspace.
- `typescript/packages/agents/src/{openai,vercel,langchain,mastra,pi}/...`, TS agent framework integrations.
- `pyproject.toml`, Python deps (`mfusepy>=1.0.0`, `tree-sitter>=0.25.2`, `tree-sitter-bash>=0.25.1`, FastAPI, etc.).
- `typescript/packages/core/package.json`, `node/package.json`, TS deps (jq-wasm pinned, web-tree-sitter, tree-sitter-bash).
- `docs/plans/`, 45 internal design documents dated 2026-04-16 to 2026-05-04 (visibility into pre-launch roadmap).

### Related project context (datafetch internal docs)

- [kb/elevator.md](../elevator.md), the cold-to-warm flip pitch.
- [kb/mission.md](../mission.md), "Virtualize the dataset interface, not the dataset"; "Adopt over invent: just-bash for the in-process bash"; the seven-step crystallisation arc.
- [kb/mental-model.md](../mental-model.md), tenant / mount / lib / db / intent workspace vocabulary.
- [kb/br/10-mintlify-chromafs-virtual-filesystem.md](10-mintlify-chromafs-virtual-filesystem.md), the closest external analog before Mirage; production reference for the "agent shell over a DB you already pay for" pattern.
- [kb/br/12-browser-harness-vfs-adaptive-retrieval.md](12-browser-harness-vfs-adaptive-retrieval.md), the agent-editable action-space pattern; the "Bitter Lesson of Agent Harnesses" framing; the stub-as-slot pattern.
- [kb/br/03-documentdbfuse.md](03-documentdbfuse.md), the FUSE-as-VFS-over-MongoDB precedent.

### Comparable agent-VFS projects

- [tursodatabase/agentfs on GitHub](https://github.com/tursodatabase/agentfs), the SQLite-as-agent-filesystem proposal; orthogonal to Mirage (one substrate, KV plus FS plus toolcall audit).
- [johannesmichalke/agent-vfs on GitHub](https://github.com/johannesmichalke/agent-vfs), persistent VFS backed by SQLite or Postgres.
- [Mesa, the versioned filesystem for AI agents](https://www.mesa.dev/), commercial VFS positioned around versioning and snapshots.
- [vercel-labs/just-bash on GitHub](https://github.com/vercel-labs/just-bash), the TS bash reimplementation with pluggable IFileSystem; what datafetch uses today; what Mirage *did not* use (built their own tree-sitter+executor).
