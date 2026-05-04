// `df.*` global binding — what the snippet runtime injects as `globalThis.df`
// before evaluating an `npx tsx` snippet.
//
// Shape (tracking kb/prd/personas.md §11.2 + the design doc):
//
//   df.db.<ident>.findExact(filter, limit?)    -> Promise<unknown[]>
//   df.db.<ident>.search(query, opts?)          -> Promise<unknown[]>
//   df.db.<ident>.findSimilar(query, limit?)    -> Promise<unknown[]>
//   df.db.<ident>.hybrid(query, opts?)          -> Promise<unknown[]>
//   df.lib.<name>(input)                         -> Promise<Result<unknown>>
//   df.run(asyncFn)                              -> Promise<Result<unknown>>
//
// Every method threads the snippet's shared `DispatchContext` (cost
// accumulator + active trajectory + tenant/mount/pins). For substrate
// methods we record one `PrimitiveCallRecord` per call and charge tier-2
// cost (interpreted; no LLM); for library calls the `Fn` factory already
// records and charges its own cost block, and we then fold the returned
// Result's tokens/ms back into the snippet-level accumulator.

import { performance } from "node:perf_hooks";

import { getMountRuntimeRegistry } from "../adapter/runtime.js";
import {
  getLibraryResolver,
  makeResult,
  type CollectionHandle,
  type CostTier,
  type DispatchContext,
  type Result,
} from "../sdk/index.js";

import type { SessionCtx } from "../bash/snippetRuntime.js";

// --- Public types ----------------------------------------------------------

export type DfBinding = {
  db: Record<string, DbCollectionBinding>;
  lib: Record<string, (input: unknown) => Promise<Result<unknown>>>;
  run<T>(fn: () => Promise<T> | T): Promise<Result<T>>;
};

export type DbCollectionBinding = {
  findExact(filter: Record<string, unknown>, limit?: number): Promise<unknown[]>;
  search(query: string, opts?: { limit?: number }): Promise<unknown[]>;
  findSimilar(query: string, limit?: number): Promise<unknown[]>;
  hybrid(query: string, opts?: { limit?: number }): Promise<unknown[]>;
};

export type BuildDfOpts = {
  sessionCtx: SessionCtx;
  dispatchCtx: DispatchContext;
};

// --- buildDf ----------------------------------------------------------------

const TIER_SUBSTRATE: CostTier = 2;

export function buildDf(opts: BuildDfOpts): DfBinding {
  const { sessionCtx, dispatchCtx } = opts;

  // Per-snippet ident map: ident -> {mountId, collection-name}. Single-mount
  // is the common MVP case; we still walk every mount to support future
  // multi-mount sessions. Conflicts surface as a clear error from the
  // proxy at access time, not at build time.
  const identIndex = buildIdentIndex(sessionCtx.mountIds);

  // db proxy — `df.db.<ident>`
  const dbProxy: Record<string, DbCollectionBinding> = new Proxy(
    {} as Record<string, DbCollectionBinding>,
    {
      get(_target, prop): DbCollectionBinding | undefined {
        if (typeof prop !== "string") return undefined;
        const entry = identIndex.get(prop);
        if (!entry) {
          throw new Error(
            `df.db.${prop}: ident not found across mounts ${JSON.stringify(
              sessionCtx.mountIds,
            )}`,
          );
        }
        if (entry.kind === "ambiguous") {
          throw new Error(
            `df.db.${prop}: ident is ambiguous between mounts ` +
              `${JSON.stringify(entry.mounts)}; specify the collection ` +
              `via mount-scoped lookup once supported`,
          );
        }
        return makeDbCollectionBinding({
          ident: prop,
          mountId: entry.mountId,
          collectionName: entry.collectionName,
          dispatchCtx,
        });
      },
    },
  );

  // lib proxy — `df.lib.<name>`
  const libProxy: Record<string, (input: unknown) => Promise<Result<unknown>>> =
    new Proxy(
      {} as Record<string, (input: unknown) => Promise<Result<unknown>>>,
      {
        get(_target, prop): ((input: unknown) => Promise<Result<unknown>>) | undefined {
          if (typeof prop !== "string") return undefined;
          return async (input: unknown): Promise<Result<unknown>> => {
            const resolver = getLibraryResolver();
            if (!resolver) {
              throw new Error(
                "df.lib: no LibraryResolver registered. Call setLibraryResolver(...) at boot.",
              );
            }
            const callable = await resolver.resolve(sessionCtx.tenantId, prop);
            if (!callable) {
              throw new Error(
                `df.lib.${prop}: function not found in tenant "${sessionCtx.tenantId}" or seed layer`,
              );
            }

            // Snapshot cost accumulator state before the inner call. The
            // Fn callable threads `dispatchCtx` and writes additively into
            // it (cost contract in src/sdk/runtime.ts top-of-file). We
            // record a per-call trajectory row that captures input/output
            // for the inner call.
            const startedMs = performance.now();
            const result = (await callable(input, {
              tenant: dispatchCtx.tenant,
              mount: dispatchCtx.mount,
              cost: dispatchCtx.cost,
              functionName: prop,
              ...(dispatchCtx.trajectory
                ? { trajectory: dispatchCtx.trajectory }
                : {}),
              ...(dispatchCtx.pins ? { pins: dispatchCtx.pins } : {}),
            })) as Result<unknown>;
            const elapsedMs = performance.now() - startedMs;

            if (dispatchCtx.trajectory) {
              const recorder = dispatchCtx.trajectory;
              // Use a one-shot inline record. The fn() callable's body
              // doesn't itself populate a trajectory record; the snippet
              // runtime is the one that knows about df.lib.<name> as a
              // primitive boundary, so we record here.
              await recorder.call(`lib.${prop}`, input, async () => result.value);
            }
            void elapsedMs; // ms charging is done by the inner fn() / dispatcher.
            return result;
          };
        },
      },
    );

  return {
    db: dbProxy,
    lib: libProxy,
    async run<T>(asyncFn: () => Promise<T> | T): Promise<Result<T>> {
      const startedMs = performance.now();
      const value = await asyncFn();
      const elapsedMs = performance.now() - startedMs;
      // df.run lives inside the snippet's shared accumulator; charge wall
      // clock as `ms.cold` if no nested call has charged yet. Nested
      // calls already populated `dispatchCtx.cost` in place; we surface
      // it as the Result's cost block.
      if (dispatchCtx.cost.ms.cold === 0 && dispatchCtx.cost.ms.hot === 0) {
        dispatchCtx.cost.ms.cold = Math.round(elapsedMs);
      }
      return makeResult<T>({
        value,
        mode: "interpreted",
        cost: {
          tier: dispatchCtx.cost.tier,
          tokens: { ...dispatchCtx.cost.tokens },
          ms: { ...dispatchCtx.cost.ms },
          llmCalls: dispatchCtx.cost.llmCalls,
        },
        provenance: {
          tenant: dispatchCtx.tenant,
          mount: dispatchCtx.mount,
          trajectoryId: dispatchCtx.trajectory?.id ?? "no-trajectory",
          ...(dispatchCtx.functionName
            ? { functionName: dispatchCtx.functionName }
            : {}),
          pins: dispatchCtx.pins ?? {},
        },
        escalations: 0,
      });
    },
  };
}

// --- Substrate binding helper ----------------------------------------------

type DbBindingArgs = {
  ident: string;
  mountId: string;
  collectionName: string;
  dispatchCtx: DispatchContext;
};

function makeDbCollectionBinding(args: DbBindingArgs): DbCollectionBinding {
  const { ident, mountId, collectionName, dispatchCtx } = args;
  // Resolve the live handle lazily per call. The mount runtime registry
  // returns a long-lived adapter keyed by mountId; calling
  // `runtime.collection(name)` is cheap (no substrate roundtrip).
  function handle<T>(): CollectionHandle<T> {
    const reg = getMountRuntimeRegistry();
    const runtime = reg.get(mountId);
    if (!runtime) {
      throw new Error(
        `df.db.${ident}: mount "${mountId}" not registered in MountRuntimeRegistry`,
      );
    }
    return runtime.collection<T>(collectionName);
  }

  // Wrap a substrate method with trajectory + cost accounting. Each
  // invocation:
  //   - records one PrimitiveCallRecord into the snippet's recorder (if any)
  //   - charges tier 2 (interpreted, substrate roundtrip; no LLM)
  //   - measures wall-clock elapsed and folds it into ctx.cost.ms.cold
  type SubstrateFn = (
    h: CollectionHandle<unknown>,
  ) => Promise<unknown[]>;

  async function run(
    primitiveLabel: string,
    input: unknown,
    invoke: SubstrateFn,
  ): Promise<unknown[]> {
    const trajectory = dispatchCtx.trajectory;
    const startedMs = performance.now();
    const exec = async (): Promise<unknown[]> => invoke(handle<unknown>());
    let output: unknown[];
    if (trajectory) {
      output = await trajectory.call(primitiveLabel, input, exec);
    } else {
      output = await exec();
    }
    const elapsedMs = performance.now() - startedMs;
    chargeSubstrate(dispatchCtx, elapsedMs);
    return output;
  }

  return {
    async findExact(filter, limit) {
      return run(
        `db.${ident}.findExact`,
        { filter, limit },
        async (h) => h.findExact(filter, limit),
      );
    },
    async search(query, opts) {
      return run(`db.${ident}.search`, { query, opts }, async (h) =>
        h.search(query, opts),
      );
    },
    async findSimilar(query, limit) {
      return run(
        `db.${ident}.findSimilar`,
        { query, limit },
        async (h) => h.findSimilar(query, limit),
      );
    },
    async hybrid(query, opts) {
      return run(`db.${ident}.hybrid`, { query, opts }, async (h) =>
        h.hybrid(query, opts),
      );
    },
  };
}

function chargeSubstrate(ctx: DispatchContext, elapsedMs: number): void {
  ctx.cost.tier = Math.max(ctx.cost.tier, TIER_SUBSTRATE) as CostTier;
  ctx.cost.ms.cold += Math.round(elapsedMs);
  // tokens / llmCalls left alone — substrate calls don't spend either.
}

// --- Ident index ------------------------------------------------------------

type IdentIndexEntry =
  | {
      kind: "unique";
      mountId: string;
      collectionName: string;
    }
  | {
      kind: "ambiguous";
      mounts: string[];
    };

function buildIdentIndex(mountIds: string[]): Map<string, IdentIndexEntry> {
  const reg = getMountRuntimeRegistry();
  const index = new Map<string, IdentIndexEntry>();
  for (const mountId of mountIds) {
    const runtime = reg.get(mountId);
    if (!runtime) continue;
    for (const pair of runtime.identMap) {
      const existing = index.get(pair.ident);
      if (!existing) {
        index.set(pair.ident, {
          kind: "unique",
          mountId,
          collectionName: pair.name,
        });
      } else if (existing.kind === "unique") {
        index.set(pair.ident, {
          kind: "ambiguous",
          mounts: [existing.mountId, mountId],
        });
      } else {
        existing.mounts.push(mountId);
      }
    }
  }
  return index;
}
