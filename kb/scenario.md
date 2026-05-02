# AtlasFS Scenario And Live-App Interfaces

This is the current executable scenario proven by the test suite and the
interfaces we should expose to a Next.js app next.

## System Shape

```text
USER / NEXT.JS APP                                      MONGODB ATLAS
        |                                                    |
        | POST /api/query                                    |
        v                                                    |
  +----------------+                                         |
  | Intent Runner  |                                         |
  | runQuery()     |                                         |
  +-------+--------+                                         |
          |                                                  |
          | check tenant evolution first                     |
          v                                                  |
  +--------------------------+                               |
  | Evolution Store          |                               |
  | local .atlasfs in tests  |                               |
  | Durable Object later     |                               |
  +----+---------------------+                               |
       |                                                     |
       | matching procedure?                                 |
       |                                                     |
       +--- yes ---------------------------------------------+
       |                                                     |
       v                                                     v
  +--------------------------+      findExact / search        |
  | Replay Procedure         | -----------------------------> |
  | procedures.<intent>      | <----------------------------- |
  +------------+-------------+          filings / rows         |
               |
               v
         answer + evidence
```

When no procedure exists, the runner evolves the tenant:

```text
USER / NEXT.JS APP                                      MONGODB ATLAS
        |                                                    |
        | query                                              |
        v                                                    |
  +----------------+                                         |
  | Intent Runner  |                                         |
  +-------+--------+                                         |
          |
          | no matching procedure
          v
  +---------------------+        search / hybrid / exact      |
  | Trajectory Recorder | ----------------------------------> |
  | logs every step     | <---------------------------------- |
  +----------+----------+          candidate filings           |
             |
             v
  +-----------------------------+
  | search / execute primitives |
  | - retrieve cases            |
  | - pick filing               |
  | - split document units      |
  | - run task agents           |
  +-------------+---------------+
                |
                | missing reusable capability or glue?
                v
  +-----------------------------+
  | observe primitive           |
  | Flue / observer agent       |
  | creates typed interface     |
  +-------------+---------------+
                |
                v
  +-----------------------------+
  | Persist tenant evolution    |
  | - trajectory                |
  | - draft, when review needed |
  | - procedure                 |
  | - reusable agent            |
  +-------------+---------------+
                |
                v
          answer + evidence
```

## What The Tests Prove

The strict tests start from a clean tenant home, input one query, measure the
result, inspect the recorded trajectory, inspect the intent-shaped interface
artifacts, then move on. They assert exact artifact deltas so tests cannot
quietly depend on state leaked from an earlier scenario.

Proven scenarios:

1. Average payment volume:
   - First query is novel and records calls:
     `findSimilar -> pickFiling -> locateFigure -> locateFigure -> divide`.
   - Endorsement creates
     `average_payment_volume_per_transaction.{json,ts}`.
   - A sibling query replays through one `procedures.average_payment_volume_per_transaction` call.

2. Observer-generated deterministic function:
   - First query asks for the highest average payment volume.
   - The observer codifies `largestAveragePaymentVolumePerTransaction`.
   - Endorsement creates a `ts_function` procedure.
   - Replay is one procedure call.

3. Task-specific agent procedure:
   - First query asks for sentiment about Visa competitive positioning.
   - The system creates a typed sentiment agent interface.
   - Endorsement creates a `task_agent` procedure.
   - Replay still uses the agent interface, but through one procedure call.

4. Multi-turn review:
   - First query creates a revenue-share draft with assumptions.
   - `confirm` records the user's acceptance.
   - `specify` changes requirements and recomputes.
   - `yes` asks the observer to codify the final reviewed procedure.
   - `refuse` marks a draft non-committable.

5. Reusable agent plus new glue:
   - Intent 1 creates `negativeOutlookReferenceScorerAgent` and sentence-level glue.
   - Intent 2 reuses the same agent for title/quote units and creates only new glue.
   - Replay uses the persisted agent and one title/quote procedure call.

6. Generic table-math crystallisation:
   - Intent 1 composes `findSimilar -> pickFiling -> finqa_table_math.inferPlan -> finqa_table_math.execute`.
   - The successful chain persists `table_math.{json,ts}` for the tenant.
   - A similar table-math query over the same filing replays through one `procedures.table_math` call.

## Four-Intent Demo Happy Paths

These are the two live-demo paths the tests now model. Each path starts from a
blank tenant home so the appearing files are attributable to the queries in
that path.

The demo proves the adaptive-retrieval loop, not just the answers. Starting
from `search / execute / observe`, the system records a successful trajectory,
turns it into typed tenant-owned interfaces, and then uses those interfaces to
shorten the next similar query.

### Path A: Deterministic Primitive Becomes A Procedure

```text
Intent 1
  User: range for chemical revenue, 2014-2016
  Chain: search -> execute -> observe/persist
  Result: 190
  New artifacts:
    trajectories/<id>.json
    procedures/table_math.json
    procedures/table_math.ts

Intent 2
  User: range for coal revenue, 2014-2016
  Chain: procedures.table_math
  Result: 1687
  New artifacts: none
```

What this proves: a generic execute primitive can become a typed procedure, and
the procedure shortens a similar future query without creating another chain.

Primitive and procedure notes:

| Primitive / Procedure | One-line Description |
| --- | --- |
| `finqa_cases.findSimilar` | Search primitive that retrieves candidate filings from the current data plane. |
| `finqa_resolve.pickFiling` | Execute primitive that chooses the filing whose retrieved text and table labels fit the intent. |
| `finqa_table_math.inferPlan` | Execute primitive that infers `{ operation, row, years }` from the question and filing table. |
| `finqa_table_math.execute` | Execute primitive that runs the inferred table operation and returns evidence. |
| `procedure_store.save` | Observe/persist step that crystallizes the successful chain into tenant-owned procedure files. |
| `procedures.table_math` | Replayed procedure that hides the previous chain behind one typed intent-interface. |

### Path B: A Primitive Can Be An Agent

```text
Intent 3
  User: negative competitive outlook references about Visa, sentence evidence
  Chain: search -> execute -> observe
  Result: 4 sentence references
  New artifacts:
    agents/negativeOutlookReferenceScorerAgent.json
    procedures/negative_outlook_references.json
    procedures/negative_outlook_references.ts

Intent 4
  User: negative competitive outlook references about Visa, titles or quotes
  Chain: search -> execute existing agent -> observe new glue
  Result: 1 title/quote reference
  New artifacts:
    procedures/negative_outlook_title_or_quote_references.json
    procedures/negative_outlook_title_or_quote_references.ts
```

What this proves: the agent itself is a typed primitive, and the second intent
can reuse it while the observer writes only the new compositional glue.

Primitive and procedure notes:

| Primitive / Procedure | One-line Description |
| --- | --- |
| `finqa_cases.findSimilar` | Search primitive that retrieves candidate filings from the current data plane. |
| `finqa_resolve.pickFiling` | Execute primitive that chooses the best filing for the target and evidence need. |
| `document_units.sentences` | Execute primitive that turns document text into sentence-level evidence units. |
| `document_units.titleOrQuoteUnits` | Execute primitive that changes the evidence surface to headings and quote-like units. |
| `agent_store.findReusable` | Observe/search step that checks whether the tenant already has a matching agent primitive. |
| `finqa_observe.createAgentPrimitive` | Observe primitive that creates the reusable typed scorer agent when none exists. |
| `agent_store.save` | Observe/persist step that stores the new agent primitive for future composition. |
| `finqa_outlook.scoreUnits` | Agent primitive that scores each evidence unit for negative competitive-outlook relevance. |
| `finqa_observe.codifyTableFunction` | Observe primitive that writes deterministic TypeScript glue around the scored units. |
| `finqa_observe.executeCodifiedFunction` | Execute primitive that runs the observer-created glue and returns answer plus evidence. |
| `procedure_store.save` | Observe/persist step that saves the composed intent-interface as procedure files. |
| `procedures.negative_outlook_title_or_quote_references` | Replayed procedure that reuses the persisted agent and generated title/quote glue. |

## Storage Boundary

MongoDB Atlas is the data plane:

```text
atlasfs_hackathon
  finqa_cases
    normalized filings, tables, text, metadata
    Atlas Search index: finqa_cases_text
  finqa_search_units
    row/text units prepared for search, hybrid, and future vector retrieval
    Atlas Search index: finqa_units_text
```

The live Atlas Search milestone loaded the available FinQA corpus into
`atlasfs_hackathon` and proved the same scenarios through MongoDB-backed
retrieval:

```text
finqa_cases:        8474 normalized cases
finqa_search_units: 243k+ retrieval units
search indexes:     READY / queryable
```

The important integration lesson was that Atlas relevance scores must stay part
of the resolver handoff. The full corpus has multiple plausible Visa filings;
`findSimilar()` now performs target-aware Atlas Search query shaping, and
`pickFiling()` preserves the backend search score instead of re-ranking only by
local token overlap.

Tenant evolution is the learned-behavior plane:

```text
trajectories
drafts
review-events
procedures
agents
```

Today the tests store that tenant evolution in `.atlasfs`. For the live app,
the runner should keep the same store contract and swap the backing store:

```ts
export type EvolutionStore = {
  listProcedures(tenantId: string): Promise<StoredProcedure[]>;
  saveProcedure(procedure: StoredProcedure): Promise<void>;
  findAgentByCapability(tenantId: string, capability: string): Promise<StoredAgentSpec | null>;
  findAgentByName(tenantId: string, agentName: string): Promise<StoredAgentSpec | null>;
  saveAgent(tenantId: string, spec: StoredAgentSpec): Promise<void>;
  saveTrajectory(record: TrajectoryRecord): Promise<void>;
  readTrajectory(tenantId: string, id: string): Promise<TrajectoryRecord>;
  saveDraft(draft: ProcedureDraft): Promise<void>;
  readDraft(tenantId: string, id: string): Promise<ProcedureDraft>;
  appendReviewEvent(event: ReviewEvent): Promise<void>;
};
```

The hackathon-faithful backing store is Cloudflare Durable Object. A short-lived
demo can keep `.atlasfs` locally, but Vercel production should not depend on
local filesystem state.

## Next.js API Contract

The UI only needs a small surface.

```ts
export type QueryRequest = {
  tenantId: string;
  question: string;
  mode?: "auto" | "forceNovel" | "forceReplay";
  observer?: "fixture" | "flue";
  taskAgent?: "fixture" | "flue";
  outlookAgent?: "fixture" | "flue";
};

export type QueryResponse = {
  mode: "novel" | "procedure";
  answer: number | string;
  roundedAnswer?: number;
  procedureName?: string;
  trajectoryId?: string;
  draftId?: string;
  calls: Array<{
    primitive: string;
    input: unknown;
    output: unknown;
  }>;
  evidence: unknown[];
  review?: {
    status: string;
    assumptions: string[];
    nextActions: Array<"confirm" | "specify" | "yes" | "refuse">;
  };
};
```

```text
POST /api/query
  runs runQuery()
  returns QueryResponse
```

```ts
export type ReviewRequest =
  | { tenantId: string; action: "confirm"; message?: string }
  | { tenantId: string; action: "specify"; message: string }
  | { tenantId: string; action: "yes"; observer?: "fixture" | "flue" }
  | { tenantId: string; action: "refuse"; message?: string };

export type ReviewResponse = {
  draft: ProcedureDraft;
  event: ReviewEvent;
  procedure?: {
    name: string;
  };
};
```

```text
POST /api/drafts/:draftId/review
  runs reviewDraft()
  returns ReviewResponse
```

```ts
export type TenantStateResponse = {
  tenantId: string;
  procedures: StoredProcedure[];
  agents: StoredAgentSpec[];
  recentTrajectories: Array<{
    id: string;
    question: string;
    createdAt: string;
    callCount: number;
  }>;
  openDrafts: ProcedureDraft[];
};
```

```text
GET /api/tenants/:tenantId/state
  renders the learned interface inventory in the app
```

## UI States

The first app screen should be the working console, not a landing page:

```text
+-------------------------------------------------------------+
| Query input                                      Run button  |
+-------------------------------------------------------------+
| Answer                                                      |
| Evidence                                                    |
+------------------------+------------------------------------+
| Trajectory             | Learned Interfaces                 |
| primitive calls        | procedures                         |
| timing                 | reusable agents                    |
+------------------------+------------------------------------+
| Review panel, when draft exists                            |
| Confirm | Specify | Refuse | Commit                         |
+-------------------------------------------------------------+
```

Minimum live flow:

1. User submits query.
2. App shows answer and primitive trajectory.
3. If review is required, app shows assumptions and review controls.
4. If a procedure or agent was created, app shows the new interface.
5. User submits a sibling query and sees replay collapse to one procedure call.

## Next Implementation Slice

1. Keep `runQuery()` and `reviewDraft()` as the backend contract.
2. Extract the local `.atlasfs` stores behind `EvolutionStore`.
3. Add a MongoDB smoke test that loads the three demo filings:
   - `dev/V/2008/page_17.pdf`
   - `private_test/UNP/2016/page_52.pdf`
   - `train/V/2012/page_28.pdf`
4. Scaffold a Next.js app with three server routes:
   - `POST /api/query`
   - `POST /api/drafts/:draftId/review`
   - `GET /api/tenants/:tenantId/state`
5. Point the routes at Atlas for data and the current local store for the first
   dev demo; swap the store backing to Durable Object once the UI loop is real.
