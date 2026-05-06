import { describe, expect, it, beforeEach } from "vitest";

import { buildDf } from "../src/snippet/dfBinding.js";
import { isAnswerEnvelope } from "../src/snippet/answer.js";
import {
  InMemoryMountRuntimeRegistry,
  makeMountRuntime,
  setMountRuntimeRegistry,
} from "../src/adapter/runtime.js";
import {
  costZero,
  TrajectoryRecorder,
  type CollectionHandle,
  type DispatchContext,
  type MountAdapter,
} from "../src/sdk/index.js";

function buildAdapter(handle: CollectionHandle<unknown>): MountAdapter & {
  close: () => Promise<void>;
} {
  return {
    id: "stub",
    capabilities: () => ({ vector: false, lex: false, stream: false, compile: false }),
    probe: async () => ({ collections: [] }),
    sample: async () => [],
    collection: <T>() => handle as unknown as CollectionHandle<T>,
    close: async () => {},
  };
}

function buildHandle(rows: unknown[]): CollectionHandle<unknown> {
  return {
    findExact: async () => rows,
    search: async () => rows,
    findSimilar: async () => rows,
    hybrid: async () => rows,
  };
}

function buildDispatchCtx(recorder?: TrajectoryRecorder): DispatchContext {
  return {
    tenant: "t",
    mount: "m",
    pins: {},
    cost: costZero(),
    ...(recorder !== undefined ? { trajectory: recorder } : {}),
  };
}

describe("buildDf — df.db.<ident>", () => {
  beforeEach(() => {
    setMountRuntimeRegistry(new InMemoryMountRuntimeRegistry());
  });

  it("resolves df.db.<ident> via the registered MountRuntime", async () => {
    const reg = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(reg);
    const handle = buildHandle([{ id: "a" }, { id: "b" }]);
    reg.register(
      "demo",
      makeMountRuntime({
        mountId: "demo",
        adapter: buildAdapter(handle),
        identMap: [{ ident: "cases", name: "raw_cases" }],
      }),
    );

    const recorder = new TrajectoryRecorder({ tenantId: "t", question: "q" });
    const df = buildDf({
      sessionCtx: { tenantId: "t", mountIds: ["demo"], baseDir: "/tmp/x" },
      dispatchCtx: buildDispatchCtx(recorder),
    });
    const result = await df.db.cases!.findExact({}, 5);
    expect(result).toEqual([{ id: "a" }, { id: "b" }]);
    // The call should have produced a trajectory record under
    // primitive `db.cases.findExact`.
    const calls = recorder.snapshot.calls;
    expect(calls.find((c) => c.primitive === "db.cases.findExact")).toBeDefined();
  });

  it("throws when accessing an ident that no registered mount publishes", async () => {
    const df = buildDf({
      sessionCtx: { tenantId: "t", mountIds: [], baseDir: "/tmp/x" },
      dispatchCtx: buildDispatchCtx(),
    });
    expect(() => df.db.unknownIdent).toThrow(/ident not found/);
  });

  it("throws an ambiguity error when two mounts publish the same ident", async () => {
    const reg = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(reg);
    const ident = { ident: "shared", name: "x" };
    reg.register(
      "m1",
      makeMountRuntime({
        mountId: "m1",
        adapter: buildAdapter(buildHandle([])),
        identMap: [ident],
      }),
    );
    reg.register(
      "m2",
      makeMountRuntime({
        mountId: "m2",
        adapter: buildAdapter(buildHandle([])),
        identMap: [ident],
      }),
    );
    const df = buildDf({
      sessionCtx: { tenantId: "t", mountIds: ["m1", "m2"], baseDir: "/tmp/x" },
      dispatchCtx: buildDispatchCtx(),
    });
    expect(() => df.db.shared).toThrow(/ambiguous/);
  });

  it("charges substrate tier (2) and accumulates ms.cold on each call", async () => {
    const reg = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(reg);
    reg.register(
      "demo",
      makeMountRuntime({
        mountId: "demo",
        adapter: buildAdapter(buildHandle([])),
        identMap: [{ ident: "rows", name: "rows" }],
      }),
    );
    const ctx = buildDispatchCtx();
    const df = buildDf({
      sessionCtx: { tenantId: "t", mountIds: ["demo"], baseDir: "/tmp/x" },
      dispatchCtx: ctx,
    });
    expect(ctx.cost.tier).toBe(0);
    await df.db.rows!.findExact({}, 1);
    expect(ctx.cost.tier).toBeGreaterThanOrEqual(2);
    expect(ctx.cost.llmCalls).toBe(0);
    expect(ctx.cost.ms.cold).toBeGreaterThanOrEqual(0);
  });

  it("creates marked structured answer envelopes via df.answer", () => {
    const df = buildDf({
      sessionCtx: { tenantId: "t", mountIds: [], baseDir: "/tmp/x" },
      dispatchCtx: buildDispatchCtx(),
    });

    const answer = df.answer({
      status: "answered",
      value: 42,
      evidence: [{ ref: "case-1" }],
      derivation: { operation: "constant" },
    });

    expect(answer).toMatchObject({
      status: "answered",
      value: 42,
      evidence: [{ ref: "case-1" }],
      derivation: { operation: "constant" },
    });
    expect(answer.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(isAnswerEnvelope(answer)).toBe(true);
  });
});
