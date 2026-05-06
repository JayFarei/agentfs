## What AtlasFS is

A code-mode adaptive retrieval system that crystallises query shape from agent usage, per-tenant, over a polymorphic document store.

## How it works?

Atlas → mounted at /datafetch/ over NFS. Each collection becomes a typed TS module synthesised lazily on read.

The agent writes TS snippets against typed paths.

Audit log captures every typed call.

User/Agent endorses successful trajectories (or it is derived via after the fact attribution)

Endorsements crystallise into procedures/<tenant_id>/<name>.ts.

A budget worker compiles each procedure into a single Atlas aggregation pipeline so the LLM exits the hot path.

The core insight:

- schema is never imposed,
- it is induced at three tiers
  - sampled inferred type
  - endorsed query trajectory
  - compiled aggregation pipeline

MongoDB collections are polymorphic across documents but stable across query intents once an app matures.
AtlasFS crystallises the query shape, not the document shape, once per tenant.

## Two dimensions of adaptation (the load-bearing pitch)

1. Across tenants (library divergence, L_n). Same Atlas cluster, different procedures/ overlays per tenant. Security analyst → compliance procedures. ML researcher → discovery procedures. Compliance officer → audit procedures. Visible as a two-pane diverging file-tree.
2. Within a tenant over time (cost convergence). Novel intent → expensive ReAct loop. Endorsement → deterministic procedure. Budget worker → single aggregation pipeline. Same intent runs cheap. Metrics: T_n, D_n, R_n, I_n.

## Per-dataset typed interfaces

Every dataset exposes three typed interfaces under `data/<schema_name>/`, all leveraging the hybrid search primitive (`$rankFusion` over `$vectorSearch` + `$search`, optional rerank). The agent imports from a typed path and composes those three entry points; it never picks a raw retrieval mode and never sees the underlying pipeline.

## Novel intent, the ReAct loop

User intent with no matching hook enters a ReAct loop whose job is to narrow the search space.

1. An LLM call resolves the user-aligned fields (which entity, which window, which metric, which discriminator).
2. TypeScript derivation runs first pass, an assembly of: typed-schema primitives for retrieval, an LLM call to observe the retrieved shape, and code-mode derivation that transforms the observation into the answer.
3. The trajectory (primitives + LLM observation + derivation code) is recorded for endorsement.

First pass is expensive by design. It is also valid TypeScript, so endorsement is `git add`.

## Generalisation pass (cost falls one link at a time)

Once a trajectory exists, the budget worker walks it and replaces expensive links with cheaper equivalents whenever user-alignment makes the substitution safe.

- Embedding search that consistently resolves to a known filter on user-aligned input → swap for a deterministic codified query.
- LLM observation that only reshapes data into a known form → swap for regex or additive transforms in the next link of the chain.
- LLM-driven control flow that has stabilised → swap for branching on the user-aligned field.

End state, after enough volume on a familiar intent, the trajectory collapses to a single endpoint call.

## Worked example, FinQA family functions

Three intents, each crystallising a separate trajectory at first:

- year-on-year revenue growth
- year-on-year operating income
- R&D expense change

Over volume, the shared shape (year-on-year change of a named line item) generalises into a family function parameterised by metric. The next novel YoY question pays the family-function price, not the full ReAct price. The chart of cost per intent shows three independent staircases collapsing into one shared floor.

## What this is really doing (the product framing)

Turning unstructured search into an application.

A user searches. Each search is typed and composed. Procedures crystallise. The procedure library _is_ the application: each entry is a named affordance with a typed parameter surface, and a UI surface falls out of it (parameter form in, result card out). The application is not designed up front, it emerges from the intents the tenant actually exercises, shaped by the data they actually have.

Users can always morph it. Endorsement adds an affordance, branching forks the application, re-endorsement on a branch reshapes a procedure without losing its history. Two tenants on the same cluster end up with two different applications because their intents diverge.

The product is intent-shaped applications. Search is the input modality, the typed procedure library is the application surface, the document store is the substrate that lets both stay polymorphic until intent fixes them.
