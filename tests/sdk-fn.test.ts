import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as v from "valibot";

import {
  fn,
  llm,
  agent,
  setBodyDispatcher,
  type Body,
  type BodyDispatcher,
  type DispatchContext,
  TrajectoryRecorder,
} from "../src/sdk/index.js";

class StubDispatcher implements BodyDispatcher {
  calls: Array<{ kind: string; input: unknown }> = [];
  responses: unknown[] = [];
  async dispatch<I, O>(
    body: Body<I, O>,
    input: I,
    ctx: DispatchContext,
  ): Promise<O> {
    this.calls.push({ kind: body.kind, input });
    if (body.kind === "llm" || body.kind === "agent") {
      ctx.cost.llmCalls += 1;
      ctx.cost.tier = Math.max(ctx.cost.tier, 3) as DispatchContext["cost"]["tier"];
    }
    const next = this.responses.shift();
    return next as O;
  }
}

describe("fn() with pure body", () => {
  let savedDispatcher: BodyDispatcher | null = null;

  beforeEach(() => {
    setBodyDispatcher(null as unknown as BodyDispatcher);
  });

  afterEach(() => {
    if (savedDispatcher) setBodyDispatcher(savedDispatcher);
  });

  it("validates input, runs the body, validates output, returns Result", async () => {
    const double = fn({
      intent: "double a number",
      examples: [{ input: { n: 1 }, output: { n: 2 } }],
      input: v.object({ n: v.number() }),
      output: v.object({ n: v.number() }),
      body: ({ n }) => ({ n: n * 2 }),
    });
    const r = await double({ n: 7 });
    expect(r.value).toEqual({ n: 14 });
    expect(r.mode).toBe("interpreted");
    expect(r.cost.tier).toBeGreaterThanOrEqual(0);
    expect(r.cost.llmCalls).toBe(0);
    expect(r.escalations).toBe(0);
    expect(r.provenance.pins).toEqual({});
  });

  it("rejects malformed input via valibot", async () => {
    const double = fn({
      intent: "double",
      examples: [{ input: { n: 1 }, output: { n: 2 } }],
      input: v.object({ n: v.number() }),
      output: v.object({ n: v.number() }),
      body: ({ n }) => ({ n: n * 2 }),
    });
    await expect(double({ n: "seven" } as unknown as { n: number })).rejects.toThrow();
  });

  it("threads a Partial<DispatchContext> through to the result", async () => {
    const triple = fn({
      intent: "triple",
      examples: [{ input: { n: 1 }, output: { n: 3 } }],
      input: v.object({ n: v.number() }),
      output: v.object({ n: v.number() }),
      body: ({ n }) => ({ n: n * 3 }),
    });
    const recorder = new TrajectoryRecorder({
      tenantId: "fn-test",
      question: "triple",
    });
    const r = await triple(
      { n: 5 },
      {
        tenant: "fn-test",
        mount: "stub-mount",
        functionName: "triple",
        trajectory: recorder,
      },
    );
    expect(r.provenance.tenant).toBe("fn-test");
    expect(r.provenance.mount).toBe("stub-mount");
    expect(r.provenance.functionName).toBe("triple");
    expect(r.provenance.trajectoryId).toBe(recorder.id);
  });
});

describe("fn() with llm body", () => {
  let stub: StubDispatcher;
  let prior: BodyDispatcher | null;

  beforeEach(() => {
    stub = new StubDispatcher();
    setBodyDispatcher(stub);
    prior = null;
  });

  afterEach(() => {
    if (prior) setBodyDispatcher(prior);
  });

  it("dispatches llm bodies through the registered dispatcher", async () => {
    stub.responses.push({ reversed: "olleh" });
    const reverse = fn({
      intent: "reverse a string",
      examples: [{ input: { text: "ab" }, output: { reversed: "ba" } }],
      input: v.object({ text: v.string() }),
      output: v.object({ reversed: v.string() }),
      body: llm({
        prompt: "Reverse the input.",
        model: "anthropic/claude-haiku-4-5",
      }),
    });
    const r = await reverse({ text: "hello" });
    expect(r.value).toEqual({ reversed: "olleh" });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.kind).toBe("llm");
    expect(r.mode).toBe("llm-backed");
    expect(r.cost.llmCalls).toBe(1);
    expect(r.cost.tier).toBe(3);
  });

  it("dispatches agent({skill}) bodies through the same dispatcher", async () => {
    stub.responses.push({ tone: "neutral", confidence: 0.5 });
    const score = fn({
      intent: "score a paragraph",
      examples: [
        { input: { text: "x" }, output: { tone: "neutral", confidence: 0 } },
      ],
      input: v.object({ text: v.string() }),
      output: v.object({
        tone: v.picklist(["optimistic", "neutral", "cautious", "defensive"]),
        confidence: v.number(),
      }),
      body: agent({
        skill: "score_paragraph",
        model: "anthropic/claude-haiku-4-5",
      }),
    });
    const r = await score({ text: "anything" });
    expect(r.value).toEqual({ tone: "neutral", confidence: 0.5 });
    expect(stub.calls[0]!.kind).toBe("agent");
    expect(r.mode).toBe("llm-backed");
  });

  it("propagates dispatcher errors", async () => {
    stub.responses = [];
    const broken = fn({
      intent: "broken",
      examples: [{ input: { x: 1 }, output: { x: 1 } }],
      input: v.object({ x: v.number() }),
      output: v.object({ x: v.number() }),
      body: llm({ prompt: "noop", model: "anthropic/claude-haiku-4-5" }),
    });
    await expect(broken({ x: 1 })).rejects.toThrow();
  });
});
