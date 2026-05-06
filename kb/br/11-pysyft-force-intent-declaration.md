---
title: "PySyft UserCode and Policy Model: Forcing Agents to Declare Intent Before Execution"
date: 2026-05-05
mode: scan
sources: 6
status: complete
---

# PySyft UserCode and Policy Model: Forcing Agents to Declare Intent Before Execution

## Executive Summary

PySyft is a 9.9K-star Python framework from OpenMined for "data science on data that remains in someone else's server", currently at v0.9.5 (released 2025-02-13). The federated-learning, secure-aggregation, and datasite-hosting parts are out of scope for this project. The interesting primitive, evaluated against plan 006's VFS-native discovery and reuse goals, is PySyft's submission boundary: a data scientist cannot run arbitrary code against a remote dataset; they must write a function decorated with `@sy.syft_function`, which captures the literal source, the Python signature, an explicit `InputPolicy` declaring which assets the function will touch, and an explicit `OutputPolicy` constraining how results leave. The decorator produces a `SubmitUserCode` object; the runtime refuses to execute anything that was not submitted through this envelope.

That submission envelope is structurally close to plan 006's `fn({ intent, examples, input, output, body })` flat-file model. The mapping is direct: PySyft's `raw_code` is the body, the `signature` is the input/output schema, `InputPolicy` is what `input` declares, `OutputPolicy` is what `output` plus the missed-reuse-warning policy declares, and `code_hash` plus `service_func_name` are the addressing primitives. The pattern PySyft enforces, and the one this brief recommends adapting for AtlasFS, is "the agent cannot run a snippet against `/db` without a declared envelope; the envelope is the intent contract; the runtime treats the envelope as the addressable, dedupable, reusable unit." This is the structural answer to the adherence failure plan 006 names: agents drift back to ad-hoc primitive recomposition because the system never required them to declare intent in the first place.

The PySyft model does not solve discovery. Their saved-code search is exact-match-only: `get_by_code_hash(hash)` and `get_by_service_func_name(name)` are the only query paths over the UserCode store, with no intent search, no fuzzy match, no tag indexing, and no apropos. That gap is exactly the work plan 006 phase 1 already proposes (`src/discovery/librarySearch.ts` shared scorer over fn metadata, frontmatter, examples, and source comments). PySyft's contribution is at the submission and execution boundary, not at the discovery surface. Keep the plan 006 discovery work as-is; lift the PySyft policy primitives into the `fn` envelope to make intent declaration structurally enforceable rather than convention-dependent.

---

## Overview

**What it is.** PySyft is a Python library for privacy-preserving data science. The user-facing model: a data owner creates a `Datasite` with `Dataset`s containing `Asset`s; each Asset has a `mock` representation visible to all logged-in users and a `private` representation that only resolves server-side. A data scientist logs in, browses datasets, and writes a `@sy.syft_function`-decorated function that takes Asset references as inputs. The function is submitted as a `Request` to a `Project`; the data owner approves; only then can the function run against the private side. Results are returned as `ActionObject` UIDs that the client can fetch.

**Traction.** 9,884 stars, 2,001 forks, 67 open issues, Apache-2.0, dev branch is the default. Created 2017-07-18, last push 2025-07-15. Latest release `v0.9.5` on 2025-02-13. Backed by OpenMined (non-profit, the same org that publishes the federated-learning textbook). The repo has been through several major rewrites; v0.9.x is the "Datasite" generation, distinct from the older PyTorch federated-learning hooks.

**Why it matters here.** The repo is large and most of it is irrelevant to plan 006. The relevant slice is roughly 8 files in `packages/syft/src/syft/service/code/` and `packages/syft/src/syft/service/policy/`. The architectural question the slice answers is: how do you force a remote actor to declare intent before they can execute against your data? PySyft's answer is "make submission through a typed envelope mandatory, make the envelope the addressable object, make policy a first-class runtime-enforced field on the envelope." That answer is directly portable to plan 006.

---

## How It Works

### The submission envelope (`@syft_function`)

The decorator is at `packages/syft/src/syft/service/code/user_code.py:1376`. The signature:

```python
def syft_function(
    input_policy: InputPolicy | UID | None = None,
    output_policy: OutputPolicy | UID | None = None,
    share_results_with_owners: bool = False,
    worker_pool_name: str | None = None,
    name: str | None = None,
) -> Callable: ...
```

The inner `decorator(f)` (line 1402) does, in order:

1. `inspect.getsource(f)` captures the literal source text into `raw_code`.
2. `inspect.signature(f)` captures the Python signature object.
3. `f.__code__.co_varnames` extracts input kwarg names into `input_kwargs`.
4. `parse_user_code(...)` validates the source (no globals, no banned imports, no nested function definitions that escape the policy contract).
5. Packs the lot into a `SubmitUserCode` (line 1421) which the user holds locally.
6. The user later calls `project.create_code_request(submit_user_code)` to push it to the server.

Two important properties: the agent cannot bypass this and execute code directly; and the `SubmitUserCode` object is opaque to the agent at the call site (no execution happens client-side). The same shape exists as `syft_function_single_use_input` (line 1355) which hard-wires `input_policy=ExactMatch(...)` and `output_policy=SingleExecutionExactOutput()`.

### What the envelope captures (the `UserCode` record)

Once submitted and approved, `SubmitUserCode` becomes a server-side `UserCode` record at `packages/syft/src/syft/service/code/user_code.py:485`. Fields relevant to plan 006:

| Field | Type | Role |
| --- | --- | --- |
| `raw_code` | `str` | Literal Python source as submitted; visible to data owner and scientist. |
| `parsed_code` | `str` | Source after AST rewrite (renamed to `unique_func_name`, transformed for execution). |
| `service_func_name` | `str` | The user-facing name. |
| `unique_func_name` | `str` | Collision-safe variant (used for execution). |
| `code_hash` | `str` | `sha256(raw_code + user_verify_key)`, the dedup key. |
| `signature` | `inspect.Signature` | Full Python signature with annotations and defaults. |
| `input_kwargs` | `list[str]` | Argument names. |
| `input_policy_type` | `type[InputPolicy] | UserPolicy` | The class that gates which assets the function may bind. |
| `input_policy_init_kwargs` | `dict` | The actual asset UIDs (or shape constraints) the policy was constructed with. |
| `input_policy_state` | `bytes` | Serialized runtime state (counter, last-bound inputs, etc.). |
| `output_policy_type` / `_init_kwargs` / `_state` | analogous | Constrains how outputs leave and how often the function can run. |
| `status_link` | `LinkedObject` | Foreign key to a `UserCodeStatusCollection` holding per-server `ApprovalDecision`. |
| `nested_codes` | `dict[str, tuple[LinkedObject, dict]]` | Composable sub-functions, the only "this function calls another approved function" affordance. |
| `submit_time` | `DateTime` | Auditable ordering. |

Notably absent: there is no `description`, no `intent` text, no `tags`, no `examples` field. PySyft does not capture user-facing intent; only execution-relevant metadata. (This is a gap, not a feature.)

`UserCode.__attr_searchable__` (line 528) indexes only `user_verify_key`, `service_func_name`, and `code_hash`. The DB has lookup support for nothing else.

### The InputPolicy and OutputPolicy primitives

This is the load-bearing pattern. Defined in `packages/syft/src/syft/service/policy/policy.py`. Two built-in input policies:

- `ExactMatch(asset_a=..., asset_b=...)`, line ~600. The function may bind exactly these asset UIDs at exactly these parameter names; no other inputs accepted.
- `MixedInputPolicy`, allows a mix of approved-asset references and free-form parameters.
- `CustomInputPolicy`, a user-defined policy class with a `filter_kwargs` method that runs server-side at every invocation.

Two built-in output policies:

- `OutputPolicyExecuteOnce` (alias `SingleExecutionExactOutput`), line 798. `limit=1`. After one execution the policy refuses, but the runtime serves the cached output via `_call`'s output-history fallback (see "Result reuse" below).
- `OutputPolicyExecuteCount(limit=N)`, line 761. Allows N calls.
- `CustomOutputPolicy`, user-defined.

The `InputPolicy.filter_kwargs(kwargs, context)` method runs server-side every call. It rejects any kwarg that does not match the policy. This is structural: the body cannot read an unbound asset because it never receives it. Mutation pressure on the data is structurally impossible because the body only sees the resolved input objects, not the substrate.

### The execution boundary

`UserCodeService.call()` at `packages/syft/src/syft/service/code/user_code_service.py:418` is the entry point. The flow:

1. Verify the `UserCodeStatusCollection` says `APPROVED` for this server.
2. Run `input_policy.filter_kwargs(kwargs, context)` to bind asset UIDs to actual `ActionObject`s.
3. Call `ActionService._user_code_execute(...)` at `packages/syft/src/syft/service/action/action_service.py:351`.
4. That function calls `execute_byte_code(code_item, filtered_kwargs, context)` at `packages/syft/src/syft/service/code/user_code.py:1859`.
5. `execute_byte_code` does `exec(parsed_code, _globals, _locals)` then `eval(f"{unique_func_name}(**kwargs)", _globals, _locals)` at lines 1962 and 1969.
6. The result is wrapped, `output_policy.apply_to_output(result)` runs, and a result UID is returned to the client.

There is no process isolation; the body runs in the server's Python interpreter. This is fine for plan 006's analog (we already run snippets in just-bash). The architectural invariant is that *every* call goes through the policy gate; there is no "raw query" path that bypasses the envelope.

### Result reuse and short-circuit

`UserCodeService._call` at `user_code_service.py:516` has the cache logic. When `output_policy.is_valid()` returns false (the limit is exhausted), the service does not refuse outright. It looks up `output_history` for the `UserCode`, checks whether the most recent `ExecutionOutput` has matching `input_ids` (the UIDs of the input assets), and if so returns the cached output UIDs directly. Keying is `(user_code_id, input_action_object_uids)`. So "same approved function, same input asset references" produces cached results without re-execution.

This is exactly the pattern plan 006 wants for missed-reuse: when an agent submits a snippet whose effective input shape has been seen before via an existing learned function, the runtime should redirect, not re-execute. PySyft does this on a UID basis (which we don't have); the AtlasFS analog would do it on a (intent-shape-hash, input-shape-hash) basis using the librarySearch scorer plus shape fingerprinting.

### What the client sees

The lazy typed surface lives at `packages/syft/src/syft/client/api.py`. `SyftAPI.for_user(role)` (line 930) iterates `UserServiceConfigRegistry.from_role(role)` plus all approved `UserCode` items plus admin-defined `TwinAPIEndpoint` records, assembling a flat `dict[str, APIEndpoint]` keyed by dotted path. Then `generate_endpoints()` (line 1118) walks that dict, splits each `module_path` on `.`, and recursively calls `_add_submodule` (line 1095) to graft `APIModule` namespace nodes and leaf callables onto a tree.

So `client.api.services.code.do_something()` resolves through:

```
+-----------------------------+    +---------------------------+
|  client.api  (lazy property |--> |  _fetch_api(credentials)  |
|   on SyftClient)            |    |  -> connection.get_api()  |
+-----------------------------+    +---------------------------+
                                              |
                                              v
                                   +---------------------------+
                                   |  SyftAPI.for_user(role)   |
                                   |   filter UserCode by role |
                                   |   filter services by role |
                                   |   build flat dict         |
                                   +---------------------------+
                                              |
                                              v
                                   +---------------------------+
                                   |  generate_endpoints()     |
                                   |   build APIModule tree    |
                                   |   from dotted paths       |
                                   +---------------------------+
                                              |
                                              v
                                   +---------------------------+
                                   |  client.api.services.X.Y  |
                                   |   = generated stub        |
                                   |   wrapping SyftAPICall    |
                                   +---------------------------+
```

The whole tree is built at login time, not on per-attribute access. There is no TypeScript stub generation, no `.pyi` file. The signature lives on the stub as `__ipython_inspector_signature_override__` (line 1126), so `help(stub)` and `inspect.signature(stub)` work in a notebook. `print(client.api)` prints the whole tree in text form, which functions as a poor-man's apropos.

`APIModule.__getattr__` (line 708) has one quality-of-life affordance: on `AttributeError`, if `refresh_callback` is set, it re-fetches the whole API once and retries before raising. The error message tells the user to call `client.refresh()`. This is the only auto-discovery behavior; everything else is materialized eagerly.

### The discovery gap

PySyft has no equivalent of plan 006's `apropos` or `man` over the saved code library. Direct evidence: `__attr_searchable__` on `UserCode` indexes only `user_verify_key`, `service_func_name`, and `code_hash`; the only stash queries are `get_by_code_hash(hash)` and `get_by_service_func_name(name)` (both exact match); the only listing methods are `get_all(context)` and `get_all_for_user(context)` (full scans, returned as a Tabulator HTML table in notebooks via the auto-`_repr_html_` patch in `types/syft_object.py:786`). There is no fuzzy match, no tag-based filter, no docstring search, no semantic search. A scientist who wants to know whether someone has already submitted a function that does what they want must scan the `get_all()` table by eye.

This is a deliberate-feeling gap. PySyft optimizes for "make sure the right function is approved before it runs"; plan 006 optimizes for "make sure the right function is found before another one is written." Different problems; complementary primitives.

---

## Strengths

- **Submission as the only execution path.** The `@syft_function` decorator is the *only* way to get code onto a datasite. There is no escape hatch. This is the structural property that makes "force intent declaration" tractable: the runtime can refuse anything that did not come through the envelope, with no policy or user training required.

- **Policy as a first-class field.** `input_policy` and `output_policy` are not advisory metadata; they are runtime-checked guards. `ExactMatch` is enforced on every call. This is the right abstraction for "the function declares which assets it touches and how its output may leave"; both checks are structural.

- **Dedup via code hash.** `code_hash = sha256(raw_code + user_verify_key)` plus an indexed `get_by_code_hash(hash)` query gives O(1) "is this exact source already approved?" lookup. Plan 006 already has shape-hash dedup for crystallised functions; the code-hash pattern is complementary (one is by source, one is by execution shape).

- **Cached output on input-UID match.** The `_call` short-circuit returns cached `ExecutionOutput` records when `(user_code_id, input_ids)` match the history, even when the output policy says the function is "exhausted." This is the structural pattern for "we have seen this before; serve the cached answer." The AtlasFS analog is "this snippet's intent and input shape match an existing learned function; redirect to it, do not re-execute and do not crystallise a wrapper."

- **Source retention is total.** Both `raw_code` (verbatim) and `parsed_code` (post-rewrite) are retained. The data owner can read the source at any time. This is the right hygiene for an audit-shaped system; submissions cannot be "compiled away."

- **Lazy typed surface from a flat dict.** `generate_endpoints()` taking a flat `{path: endpoint}` dict and building an `APIModule` tree from dotted paths is the same pattern plan 006 phase 4 uses for the mount path manifest. PySyft does it client-side over the wire; AtlasFS does it server-side on the bash session. Same primitive, different placement.

- **Per-role visibility filtering.** `SyftAPI.for_user(role)` filters which endpoints the user sees by role. Plan 006 has the analog for tenant pruning of the mount manifest (out of scope for the MVP but flagged in R6). PySyft demonstrates that the predicate-at-construction pattern scales to "thousands of saved functions, only the ones you may call appear in your tree."

- **Approval state as a separate linked object.** `status_link: LinkedObject` to a `UserCodeStatusCollection` keeps the approval state out of the immutable `UserCode` record. This is the right shape if you want an audit trail of who approved what, when, on which server, without rewriting the code record. Plan 006 doesn't need approval today, but the same shape would work for "this function is endorsed by tenant X, evidence trail Y" if endorsement ever becomes multi-actor.

---

## Limitations & Risks

- **No discovery surface over saved code.** As noted: only exact-name and exact-hash lookups, plus a full-table scan rendered as HTML. PySyft does not solve the problem plan 006 phase 1 is solving; it only solves a different problem (execution authorization).

- **No `intent`, `description`, `examples`, or `tags` field on UserCode.** The `signature` and `service_func_name` are the only user-facing intent signals captured. This means even if someone wrote a discovery search over UserCode, they would have very thin material to score against (function name + parameter names). Plan 006's `fn({intent, examples, ...})` envelope is richer than PySyft's by design.

- **Approval is a human-in-the-loop step.** PySyft's gate is "data owner approves." There is no analog of "automated endorsement based on shape match" or "auto-approve below a confidence threshold." For an agent-only system like AtlasFS, the approval-as-policy pattern would have to be replaced by something automatic (shape-hash match, verifier suite pass, observer-author confidence).

- **No process isolation.** Approved code runs via `exec()` in the same Python interpreter as the server. PySyft's security model assumes the data owner has reviewed the source. For an autonomous system this is unacceptable as a default; AtlasFS's just-bash already does the right thing here.

- **Result cache keyed by input-UID, not input-shape.** PySyft can serve a cached result only if the *exact same `ActionObject` UIDs* are passed. If the same logical input arrives via a different UID (a re-uploaded asset, a different copy, a derived view), the cache misses. AtlasFS would need shape-fingerprint keying for the analog to work on novel queries.

- **Code parsing is conservative.** `parse_user_code` rejects nested function definitions, lambdas-with-closures, and many dynamic constructs to keep the policy enforceable. This is correct for PySyft's threat model but constrains expressivity. Plan 006's `body: agent({skill})` and `body: llm({...})` would have to live outside this kind of static parsing because they are intentionally meta.

- **The `nested_codes` field is the only composability surface.** A `UserCode` may call other approved `UserCode` records via `nested_codes` (a `dict[str, tuple[LinkedObject, dict]]`). It is not a general "import any approved function" affordance; each nested call must be declared at submission time and the linked code's policy must compose. This is more rigid than plan 006's "any `df.lib.X` may call any other `df.lib.Y`" model.

- **PySyft is large.** ~150K LOC in `packages/syft`, plus `syftbox`, `syft-extras`, `syftcli`, and `grid`. The relevant slice for our purposes is ~5K LOC across `service/code/`, `service/policy/`, `service/action/`, and `client/api.py`. Lifting code wholesale is not on the table; lifting patterns is.

- **Active development risk.** v0.9.x is the current Datasite generation; the codebase has been through major rewrites (v0.7 PySyft Core, v0.8 Hagrid, v0.9 Datasite). Whatever we lift is a *pattern*, not a dependency. Pinning a version of PySyft into this project would be a mistake.

- **Documentation-vs-code drift.** OpenMined's docs site (docs.openmined.org) describes a slightly older API in places. When the docs and the v0.9.5 source disagreed on field names and method signatures, the source was the ground truth.

---

## Integration Analysis

### The asymmetry the src/ review reveals

A review of `src/` reveals a useful asymmetry that sharpens this brief's recommendation. Today AtlasFS structurally blocks WRITES to `/db` via `ReadOnlyFs` at `src/bash/fs/readOnly.ts`, which throws a real EROFS errno on every mutation method. The "you cannot mutate the substrate from a snippet" half of the PySyft pattern is already implemented and structurally enforced. What is not enforced is the symmetric primitive: today nothing constrains which `/db` paths a snippet can READ. The just-bash adapter, the `df` proxy at `src/snippet/dfBinding.ts:59`, and the trajectory recorder at `src/trajectory/recorder.ts:93-112` all observe reads but none refuse them.

PySyft's `InputPolicy.filter_kwargs` pattern points at the natural completion: the same architectural location (the call boundary), the same kind of error (refuse to resolve, surface a typed runtime error), but applied to reads against a declared `paths: string[]` set on the envelope. The boundary is already a chokepoint; every `df.db.<ident>.<method>` call goes through the proxy. Adding an "is this primitive's path in the declared set?" check at the wrap site is one if-statement plus one new `FnInit` field.

The other observation from the src/ review is how much of the proposed enforcement is structurally simple given the existing implementation. The `fn({...})` envelope exists (`src/sdk/fn.ts`, `src/sdk/body.ts`). `DispatchContext` exists with mutable cost rollup and trajectory threading (`src/sdk/runtime.ts:55-76`). YAML frontmatter on crystallised wrappers exists with `name`, `description`, `trajectory`, `shape-hash` (`src/observer/author.ts:441-477`). The shared discovery scorer reads `fn.spec` automatically (`src/discovery/librarySearch.ts:85`). The crystallisation gate is already a list of predicates accepting easy extension (`src/observer/gate.ts:54-177`). Mode classification already runs post-hoc on the call list (`src/snippet/runtime.ts:132-142`). The work to lift PySyft's pattern is substantially populating fields and adding small gates at known chokepoints, not restructuring.

### What's actually useful for plan 006

Reframed against the user's clarifying note: *the goal is to force agents to declare intent before executing queries, rather than recompose primitives ad-hoc.* PySyft is directly informative on this and only this. The primitives worth lifting:

**1. The submission envelope as the only execution path.** Plan 006 already has the `fn({ intent, examples, input, output, body })` flat-file model. PySyft's lesson is structural: make this the *only* path from agent intent to substrate execution. Today an agent can run an arbitrary `.ts` snippet via `npx tsx` against `/db` without any `fn` envelope; the snippet path is the escape hatch. To force intent declaration, narrow the surface so that *any* snippet that touches `/db` must either be a `fn` envelope or be tagged "exploratory and non-reusable" with a structural marker that prevents crystallisation. PySyft enforces this with `parse_user_code` rejecting submissions; plan 006 could enforce it with a runtime check that any snippet executing against `/db` either resolves through `df.lib.X(...)` or carries an `intent` field on the snippet envelope.

**2. Input/output policy as runtime-checked fields on `fn`.** Today plan 006's `fn({...})` has `input` and `output` schemas as type contracts. Add an *enforcement* dimension: a function with `input: { intent: "yoy_revenue_change", entity: string, metric: string, period: [year, year] }` should declare which `/db` paths it may read (e.g., `["/db/finqa/companies/", "/db/finqa/financials/"]`). The runtime checks the body's actual reads against this declaration; reads outside the declared set fail. PySyft's `InputPolicy.filter_kwargs` does the analog server-side. This makes "spelled-out intent" structural: the `fn` envelope is not a comment, it is a contract the runtime enforces.

**3. The `intent`-shape-hash plus input-shape-hash dedup primitive.** Plan 006 already has shape-hash. Add intent-hash: a function's declared `intent` plus its `input` schema is hashed; submissions whose hash matches an existing approved `fn` are short-circuited to the existing function. This is the "missed reuse warning" of plan 006 phase 7, made structural rather than warning-based at the runtime level, while remaining warning-only at the agent-facing CLI. The result is: when an agent emits a snippet with declared intent that matches a learned function, the runtime can either serve the cached answer (PySyft's pattern) or warn-and-fail (plan 006's stated preference). Either way, intent must have been declared first.

**4. The lazy typed surface built from a flat dict.** PySyft's `generate_endpoints()` takes `{path: endpoint}` and builds `APIModule.services.X.Y` from dotted paths. AtlasFS already does this for `df.d.ts` generation in `src/server/manifest.ts`. The pattern is sound; no change needed. Worth noting plan 006 phase 4 (`src/bash/mountManifest.ts`) is the same primitive applied to mount-side typed paths, which validates that one shape generalises across the server-side and the bash-session-side.

**5. The `service_func_name` collision-resolution pattern.** PySyft uses `service_func_name` (user-facing) plus `unique_func_name` (collision-safe internal). Plan 006 phase 5 wants intent-shaped names like `rangeTableMetric`. Adopting the pattern means: the user-facing name in `intent` and the file basename can be `rangeTableMetric`, but the on-disk record carries a stable `unique_id` (current shape hash) for dedup and audit. This is already implicitly the design; flagging it because it's the right hygiene.

### What NOT to lift from PySyft

- **The approval workflow.** Plan 006 has no data owners; agents are autonomous. The runtime check should be automatic (intent-hash and input-shape match), not human-mediated.
- **The exec-in-same-interpreter execution model.** just-bash already isolates per-`exec`; no change needed.
- **The privacy budget and DP machinery.** Out of scope; ignore entirely.
- **The `nested_codes` rigid composition graph.** Plan 006's `df.lib.*` is naturally composable through TypeScript imports; PySyft's per-call linked-object graph is not the right model for a TS-first system.
- **The empty-on-intent design.** PySyft has no `intent` text on UserCode. Plan 006's choice to make `intent` and `examples` first-class is *better* than PySyft's; preserve it, do not regress.
- **The full PySyft as a dependency.** Lift patterns, not code.

### Bootstrap path

The list below is structured as recommendation, the file:line where the change lands, and effort grounded in the existing implementation. The `fn({...})` envelope, `DispatchContext`, YAML frontmatter, gate predicates, and mode classifier already exist; most items extend those primitives, not new abstractions.

**Quick (< 1h):**
- Add `intent_hash: string` to `FnInit` (`src/sdk/fn.ts`) and emit it in the YAML frontmatter writer (`src/observer/author.ts:441-477`). The librarySearch scorer at `src/discovery/librarySearch.ts:85` already reads `fn.spec` plus frontmatter; the new field surfaces in apropos and man with no scorer change.
- Add an optional `paths: string[]` field to `FnInit.input` shape (`src/sdk/fn.ts`, `src/sdk/body.ts`). Documentary first; persisted in YAML frontmatter alongside `shape-hash`.
- Add a new mode tag `"exploratory"` to the post-hoc classifier at `src/snippet/runtime.ts:132-142`, set when the snippet contains `df.db.*` reads but no declared envelope.
- Add a new gate predicate (predicate 7) at `src/observer/gate.ts:54-177`: `mode !== "exploratory"`. Reason on rejection: "exploratory snippet, no declared intent; not eligible for crystallisation."
- Add a doc note in `kb/prd/decisions.md`: any execution against `/db` is either through a `fn({...})` envelope or tagged exploratory and structurally non-crystallisable. This is the structural answer to plan 006's adherence failure.

**Short (< 4h):**
- Track `/db` read paths per snippet by sidecar on the trajectory recorder (`src/trajectory/recorder.ts:93-112`). Every `db.*` primitive call passes through `recorder.call(primitive, input, fn)`; populate `readPaths: Set<string>` from the primitive prefix. Cost: one new field on `TrajectoryRecord`, one line of bookkeeping in `recorder.call`.
- Enforce `paths` declaration when set: hook the call site at `src/snippet/dfBinding.ts:59` (the `df` proxy that wraps every `df.db.<ident>.<method>` call); if the primitive's path is not in the envelope's declared paths, throw a typed `PathsPolicyViolation` error. Strict mode behind env flag `DATAFETCH_PATHS_STRICT=1`; warn-mode is the default.
- Implement the intent-shape-hash plus input-shape-hash short-circuit at `src/snippet/runtime.ts:86`. At observer write time (`src/observer/author.ts`), index the new lib function under `(intent_hash, input_shape_hash)`. At snippet entry, look up; on hit, redirect: invoke `df.lib.<existing>(input)` directly and tag the result `mode: "redirected"`.

**Medium (< 1d):**
- Implement envelope-as-only-execution-path enforcement at `src/bash/commands/npx.ts:141` (the `runTsx` delegate). Static-parse the snippet for declared `intent` literal or for `fn({...})` envelope; refuse strict-mode snippets that touch `df.db.*` without declaring intent. Warn-mode is the default.
- Implement an `OutputPolicy`-equivalent on `FnInit`: `{ maxInvocations?: number }` field, checked inside the fn callable wrapper at `src/sdk/fn.ts:195-199`. Default unlimited; finite for verifier-low-confidence functions surfaced by future drift detection.

**Large (> 1d):**
- Implement a tenant-scoped `for_user(tenantId)` filter for `df.d.ts` regeneration at `src/server/manifest.ts:41`, so each tenant's bash session sees only their `/lib` plus the substrate-shared seeds. This is partially in scope for plan 006 R6; flagged Large because tenant binding intersects with auth, which is out of MVP scope.
- Replace trace-shaped names (`crystallise_<topic>_<hash>` at `src/observer/template.ts:141`) with semantic names plus a separate stable `unique_func_name` field. This is plan 006 phase 5 explicitly; the PySyft `service_func_name` plus `unique_func_name` split is the structural validation. The shape hash stays as the dedup key; the semantic name becomes the addressing key.

### Effort estimate

- Populating fields and adding gate predicates against existing chokepoints: **Quick** for the field additions, **Short** for the path-tracker plus enforcement, **Short** for the redirect short-circuit. Most of the "PySyft pattern" lift is small new code at known sites.
- Replacing trace-shaped names with semantic ones: **Large**, but already plan 006 phase 5; PySyft is the design citation, not a new scope item.
- Lifting PySyft as a runtime or as `parse_user_code`-style static analysis: **not applicable**. Different language, different threat model. The existing TypeScript compiler plus the `df` proxy plus the trajectory recorder cover the equivalent enforcement surface.

### Open questions

- **Where exactly is the envelope boundary enforced?** At the just-bash adapter (no `/db` read without `fn` envelope), at the `npx tsx` runtime (intercept and check before executing), or at the snippet observer (post-hoc tag the trajectory as exploratory vs declared)? PySyft chooses the adapter; the AtlasFS-equivalent choice is probably the just-bash adapter in `src/bash/session.ts` since it is the single bottleneck for substrate access.

- **What is the `intent_hash` schema?** PySyft hashes raw source. Plan 006 should hash the declared `intent` text plus the `input` schema's structural fingerprint. The intent text is fuzzy (string), the input schema is structural (typed), and the body is irrelevant for dedup. The exact normalization (lowercase, stem, drop stopwords?) needs a decision before phase 1 lands.

- **How does the warn-vs-fail decision get made?** The user's note ("force agents to execute queries programmatically rather than without explicitly spelling out their intent") implies fail. Plan 006's R9 + R10 imply warn first, then assert in the harness. PySyft's pattern is fail. Recommend: warn for the MVP (matches plan 006 phase 7 as written), upgrade to fail behind an env flag once the discovery surface is good enough that the warn is not a footgun.

- **Should `body: agent({skill})` get a more lenient envelope?** `agent` bodies are intentionally exploratory (the LLM may need to read across `/db` in unpredictable ways). Strict input-paths declaration may not work. Either: declare `paths: ["**"]` for `agent` bodies and rely on the discovery warning, or: keep `agent` bodies as-is but tag them so the observer does not crystallise them into reusable `fn` records without first proposing a tighter envelope.

---

## Key Takeaways

1. **The submission-boundary primitive maps onto an existing chokepoint.** The `df` proxy at `src/snippet/dfBinding.ts:59` already wraps every `df.db.*` and `df.lib.*` call. Adding the PySyft-shaped "is this read declared in the envelope?" check is one if-statement at the wrap site plus one new `FnInit` field. The src/ review changed the framing from "this is a structural addition" to "this is a population of an existing chokepoint."

2. **The asymmetry: writes are blocked, reads are not.** AtlasFS already enforces EROFS on `/db` writes via `ReadOnlyFs` at `src/bash/fs/readOnly.ts`. PySyft's `InputPolicy` pattern is the symmetric completion: declared-path enforcement on reads. Same architectural location (the FS adapter or the call proxy), same kind of error (typed refusal at the boundary), different verb. This framing makes the lift a one-side completion of an existing pattern, not a new abstraction.

3. **The fn envelope plus the trajectory recorder already provide the metadata; the gate predicate plus the mode classifier already provide the enforcement scaffolding.** New fields go on `FnInit` (`src/sdk/fn.ts`) and into the YAML frontmatter writer (`src/observer/author.ts:441-477`). New predicates go on the gate's predicate list (`src/observer/gate.ts:54-177`). The new `"exploratory"` mode goes on the post-hoc classifier (`src/snippet/runtime.ts:132-142`). No new substrate, no new persistence model, no new abstraction.

4. **Redirect, do not silently cache, on intent-shape-hash hits.** PySyft's `_call` returns the cached output transparently. AtlasFS should make the redirect visible: tag mode `"redirected"`, surface the redirected lib function name in the result envelope, and let the harness assert against it. The agent learns the lib functions exist; the cache works structurally; the trajectory record retains the audit trail. This is a stronger pedagogical loop than PySyft's silent cache and matches plan 006 phase 7's "missed reuse is observable" requirement.

5. **Documentary anchors first, structural enforcement second.** The src/ review surfaced that `SCHEMA_VERSION` and `pins` are documentary, not enforced (`kb/learnings.md` M3). Adopt the same staged approach for `paths` and `intent_hash`: ship them as documentary fields first (just records what was declared), upgrade to warn behind a flag, then promote to enforce-by-default once the discovery surface is mature enough that the enforcement isn't a footgun. This matches plan 006's scope-limited posture and avoids the trap of pretending a string-on-disk is a guard.

6. **Semantic name plus stable id is plan 006 phase 5; PySyft validates the split.** PySyft separates `service_func_name` (user-facing) from `unique_func_name` (collision-safe internal). AtlasFS already has the stable id (`shape-hash` in the YAML frontmatter); what's missing is the semantic name layer. Plan 006 phase 5 calls for this; PySyft is the architectural blueprint. Keep the shape hash as the dedup key; replace the trace-shaped name with a semantic one; PySyft confirms this is the right structural split.

7. **Do not lift PySyft as a dependency or as a runtime.** Conclusion unchanged. The 150K-line Python library is aimed at human-in-the-loop privacy-preserving data science. AtlasFS is autonomous, smaller, TypeScript-first. Lift the patterns; reference the citations; build them at the existing chokepoints listed in the bootstrap path above.

---

## Sources

### Primary repository
- [OpenMined/PySyft on GitHub](https://github.com/openmined/pysyft), 9,884 stars, 2,001 forks, 67 open issues, Apache-2.0, default branch `dev`, last push 2025-07-15. Latest release [v0.9.5](https://github.com/openmined/pysyft/releases/tag/v0.9.5), 2025-02-13.

### Files cited above (clone path: `/tmp/scout-pysyft/PySyft`, removed after writing)
- `packages/syft/src/syft/service/code/user_code.py:485`, `UserCode` record (raw_code, parsed_code, signature, code_hash, status_link, nested_codes).
- `packages/syft/src/syft/service/code/user_code.py:1305`, `get_code_hash(code, verify_key)` SHA-256 of source plus user verify key.
- `packages/syft/src/syft/service/code/user_code.py:1376`, `syft_function` decorator (the submission boundary).
- `packages/syft/src/syft/service/code/user_code.py:1355`, `syft_function_single_use_input` convenience.
- `packages/syft/src/syft/service/code/user_code.py:1859`, `execute_byte_code(code_item, kwargs, context)`.
- `packages/syft/src/syft/service/code/user_code_stash.py:14`, `get_by_code_hash`, `get_by_service_func_name` exact-match queries (the only saved-code search).
- `packages/syft/src/syft/service/code/user_code_service.py:418`, `UserCodeService.call` execution gate.
- `packages/syft/src/syft/service/code/user_code_service.py:516`, `_call` cached-output short-circuit on input-UID match.
- `packages/syft/src/syft/service/policy/policy.py:600`, `ExactMatch` input policy.
- `packages/syft/src/syft/service/policy/policy.py:761`, `OutputPolicyExecuteCount`.
- `packages/syft/src/syft/service/policy/policy.py:798`, `OutputPolicyExecuteOnce` (alias `SingleExecutionExactOutput`).
- `packages/syft/src/syft/service/action/action_service.py:351`, `_user_code_execute` (runs `input_policy.filter_kwargs` then dispatches to byte-code execution).
- `packages/syft/src/syft/client/api.py:889`, `SyftAPI`.
- `packages/syft/src/syft/client/api.py:930`, `SyftAPI.for_user(role)` role-filtered tree construction.
- `packages/syft/src/syft/client/api.py:1118`, `generate_endpoints` flat-dict to tree builder.
- `packages/syft/src/syft/client/api.py:708`, `APIModule.__getattr__` refresh-on-miss fallback.
- `packages/syft/src/syft/types/twin_object.py:41`, `TwinObject(private_obj, mock_obj)`.
- `packages/syft/src/syft/service/dataset/dataset.py:85`, `Asset(action_id, mock_is_real, shape, ...)` with no embedded payload.
- `packages/syft/src/syft/service/dataset/dataset.py:443`, `Dataset` metadata record.

### Related project context
- [`kb/plans/006-vfs-native-discovery-and-reuse.md`](../plans/006-vfs-native-discovery-and-reuse.md), the integration target; this brief addresses R8, R9, R10, plus the "force intent declaration" reframe the user added.
- [`kb/br/10-mintlify-chromafs-virtual-filesystem.md`](10-mintlify-chromafs-virtual-filesystem.md), the prior brief; ChromaFs covers the read-side VFS pattern, PySyft covers the write-side (submission boundary, policy enforcement, dedup-on-hash, cached-output short-circuit).
- [`kb/prd/decisions.md`](../prd/decisions.md), locks the `fn({...})` flat-file model as the only reusable unit; PySyft's `UserCode` is the closest external analog and validates the choice.
- [`kb/elevator.md`](../elevator.md), the AtlasFS framing; PySyft addresses the "novel intent enters a ReAct loop" half by saying: the loop should not start until the agent has declared the intent through a typed envelope.

### External
- [OpenMined documentation](https://docs.openmined.org/), high-level user docs; defers to the source for v0.9.x specifics, which is why this brief cites the source rather than the docs.
