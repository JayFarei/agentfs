---
title: "feat: Product Design Delta Delivery"
summary: "Assess the delta between kb/product-design.md and the current implementation, then define and track the delivery plan."
type: feat
status: completed
date: 2026-05-03
related_research:
  - kb/product-design.md
  - kb/elevator.md
  - kb/plans/002-local-filesystem-generalisation.md
---

# Product Design Delta Delivery

## Objective

Deliver the remaining `kb/product-design.md` product shape against the current
implementation, using the completed local filesystem runtime as the executable
substrate. The elevator story is considered realised when a judge can see:

1. a typed data surface,
2. novel intent exploration through hooks/primitives,
3. reviewed crystallisation into tenant-scoped procedures,
4. cheaper replay through an optimisation path,
5. drift and eval evidence,
6. two-axis adaptation across tenants and baselines.

## Current Implementation Baseline

Already built:

- Local `ATLASFS_HOME` workspace with `fixture-finance/orders` and
  `fixture-support/tickets`.
- Lazy `/datafetch/db/<collection>.ts` synthesis with `SCHEMA_VERSION`, inferred
  row type, examples, and `findExact`, `findSimilar`, `search`, `hybrid`.
- Shared hooks for `finance.customer_total_revenue` and
  `support.customer_open_tickets`.
- Novel local trajectories, drafts, verifier-backed review, tenant-scoped
  procedures, procedure replay, budget metadata, drift checks, eval ledger, and
  learned deterministic `stats.stddev`.
- Web/API state exposing collections, hooks, procedures, learned functions,
  drift, and eval metrics.
- Repo-root Flue agent boundary reduced to observer/factory templates plus one
  generic `tenant-agent-launcher`.
- Local eval ledger now records three baselines per tenant:
  `vanilla_rag`, `static_typed`, and `atlasfs`.
- Polymorphic `fixture-events/events` collection proves discriminated union
  synthesis with presence-frequency JSDoc.
- `/datafetch/hooks/<domain>/<intent>.ts` is a virtual read path that renders
  hook JSON into JSDoc plus a typed intent interface.
- Budget writes a compiled local plan artifact under `compiled/<tenant>/`.

## Delta Matrix

| Product-design requirement | Current state | Delivery plan |
|---|---|---|
| MongoFS over any Atlas cluster | Local JSONL workspace plus FinQA Atlas adapter | Keep local contract stable; add Atlas workspace hydration adapter after local demo. |
| Adaptive sampling with presence-frequency JSDoc | Shape fingerprint and examples exist; no presence-frequency comments | Add presence-frequency metadata in synthesized modules. |
| Polymorphism lifted to discriminated unions | Fixture rows are simple; no `oneOf`/discriminator proof | Add a polymorphic fixture collection and synthesizer test. |
| Hooks as TypeScript/JSDoc files | Hooks are JSON manifests rendered as TS in the UI | Add `.ts` hook mirrors or synthesize hook TS through `DatafetchWorkspace`. |
| Primitive modules as uniform typed siblings | FinQA primitives and local primitives coexist; local utility modules are mostly route-specific | Add local utility primitive synthesis for learned functions and hooks. |
| Verifier-checked crystallisation | Implemented for local procedures | Extend support-ticket procedure promotion and add verifier-failure test. |
| Optimisation compiles to Atlas aggregation | Local budget records cost reduction; no executable pipeline body | Add deterministic local compiled-plan source and show it in web/API state. |
| Drift workflow | Local schema fingerprint drift implemented | Add red/yellow/green severity and state badges. |
| Eval harness with baselines | Implemented locally with three baseline facets | Add chart-ready aggregation endpoint/state shape. |
| Cluster heatmap/procedure library UI | Web shows procedures, hooks, metrics textually | Add compact baseline/eval and drift panels suitable for the elevator demo. |
| BIRD + full FinQA + supply-chain corpus | FinQA fixtures and local finance/support fixtures | Keep full corpora as optional adapters; do not block local demo on them. |
| Cloudflare DO/Vercel deploy | Local Hono/Vite only | Treat as deploy adapter after the executable local proof is stable. |
| Security: no keys in agent context | Local path has no external keys; live path still host-owned | Keep local acceptance keyless; document live adapter boundary. |

## Implementation Order

1. **Baseline eval facet**: record `vanilla_rag`, `static_typed`, and `atlasfs`
   rows in the local eval ledger.
   - Status: done.
   - Evidence: `tests/workspace-local-runtime.test.ts` asserts six rows for two
     tenants and all three baselines.

2. **Polymorphic typed surface**: add a fixture collection with at least two
   discriminated shapes, then synthesize a union type with presence comments.
   - Status: done.
   - Public behavior: `DatafetchWorkspace.readFile("/datafetch/db/events.ts")`
     emits `type EventsRow = DeployEvent | IncidentEvent` plus
     `SCHEMA_VERSION`.

3. **Hook TS surface**: expose `/datafetch/hooks/<domain>/<intent>.ts` through
   `DatafetchWorkspace.readFile`, not just JSON state.
   - Status: done.
   - Public behavior: reading the hook path returns JSDoc and a typed intent
     interface.

4. **Compiled local procedure source**: budget should write a compiled plan file
   and replay should expose the compiled plan in web state.
   - Status: done.
   - Public behavior: `atlasfs budget customer_total_revenue` writes
     `compiled/customer_total_revenue.json` and subsequent replay reports one
     compiled call.

5. **Verifier failure test**: corrupt the shadow fixture and prove review records
   a rejected promotion without publishing a procedure.
   - Status: done.
   - Public behavior: a failed shadow replay writes `review-events/<draft>.jsonl`
     with `rejected_promotion` and no procedure JSON appears.

6. **Web demo polish**: add compact drift/eval panels with baseline labels and
   L_n so `kb/elevator.md` can be demoed without explaining JSON.
   - Status: done.
   - Public behavior: the data panel shows drift plus eval baseline facets and
     latest AtlasFS `L_n`.

7. **Atlas hydration adapter**: mirror a local workspace collection into Atlas
   and keep the same `/datafetch/` and procedure contracts.
   - Status: done for the testable local contract.
   - Public behavior: `atlasfs hydrate-atlas --dry-run --db <name>` emits a
     collection/document-count hydration plan without requiring credentials.

## Acceptance Gates

- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir web typecheck`
- `pnpm --dir web build`
- `pnpm exec flue build --target node --workspace ./.flue --output /tmp/atlasfs-flue-build-check`
- Disposable `ATLASFS_HOME` lifecycle:
  `init`, local finance run, local support run, learned-function run, review,
  replay, budget, drift, eval.

## Completion Checklist

- [x] Delta assessed against `kb/product-design.md`.
- [x] Delivery plan written.
- [x] First product delta built: three-baseline eval ledger.
- [x] Polymorphic typed surface built.
- [x] Hook TypeScript read surface built.
- [x] Compiled local plan artifact built.
- [x] Verifier-failure path covered.
- [x] Web chart/panel polish built.
- [x] Atlas hydration dry-run adapter built.
