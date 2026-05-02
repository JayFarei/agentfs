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

## Storage Boundary

MongoDB Atlas is the data plane:

```text
atlasfs_hackathon
  finqa_cases
    normalized filings, tables, text, metadata
  finqa_search_units
    row/text units prepared for search, hybrid, and future vector retrieval
```

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
