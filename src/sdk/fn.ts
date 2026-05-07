// The `fn({...})` factory.
//
// One factory; two body shapes (pure TypeScript or agent-backed). The returned callable
// validates input, dispatches the body, validates output, and returns a
// Result<O>. The callable also carries a `.spec` sidecar for introspection
// (used by `man`, `apropos`, the observer, and the bootstrap `.d.ts`
// regenerator).
//
// Per design.md §6.1 + personas.md §2 + decisions.md D-011.

import { performance } from "node:perf_hooks";

import type { GenericSchema } from "valibot";
import { safeParseAsync } from "valibot";

import { normaliseBody, type Body, type RawBody } from "./body.js";
import {
  costZero,
  makeResult,
  type Cost,
  type Result,
  type ResultMode,
} from "./result.js";
import { getBodyDispatcher, type DispatchContext } from "./runtime.js";

// --- Public types -----------------------------------------------------------

export type FnExample<I, O> = {
  input: I;
  output: O;
};

// The shape the user passes to `fn({...})`. Body may be a "raw" body
// (a bare function is sugar for a pure-TS body); the factory normalises
// it to a discriminated `Body<I,O>` before storing it on `.spec`.
export type FnInit<I, O> = {
  intent: string;
  examples: FnExample<I, O>[];
  input: GenericSchema<I>;
  output: GenericSchema<O>;
  body: RawBody<I, O>;
};

// The normalised, post-construction spec carried by every Fn.
export type FnSpec<I, O> = {
  intent: string;
  examples: FnExample<I, O>[];
  input: GenericSchema<I>;
  output: GenericSchema<O>;
  body: Body<I, O>;
};

// A Fn is a typed callable plus an introspection sidecar.
//
// The optional second argument is a `Partial<DispatchContext>` the snippet
// runtime threads through every nested call so that tenant / mount /
// trajectory / functionName / pins flow into the Result envelope and any
// nested body dispatch shares the same cost accumulator. Direct one-off
// calls outside a snippet may omit it; the factory falls back to safe
// defaults.
export type Fn<I, O> = ((
  input: I,
  ctx?: Partial<DispatchContext>,
) => Promise<Result<O>>) & {
  spec: FnSpec<I, O>;
  name?: string;
};

// --- Errors -----------------------------------------------------------------

export class SchemaValidationError extends Error {
  constructor(
    readonly phase: "input" | "output",
    readonly issues: unknown,
    message?: string,
  ) {
    super(message ?? `Schema validation failed during ${phase}`);
    this.name = "SchemaValidationError";
  }
}

export class NoBodyDispatcherError extends Error {
  constructor(kind: string) {
    super(
      `No BodyDispatcher registered. Body kind "${kind}" requires a runtime ` +
        `dispatcher. Call setBodyDispatcher(...) at process boot before invoking ` +
        `non-pure functions.`,
    );
    this.name = "NoBodyDispatcherError";
  }
}

// --- Factory ----------------------------------------------------------------

// Default dispatch context for direct one-off calls outside any snippet.
// In production the snippet runtime passes a fully populated context as
// the optional second arg to the callable; the merge below combines the
// two.
function defaultDispatchContext(): DispatchContext {
  return {
    tenant: "anonymous",
    mount: "unknown",
    cost: costZero(),
  };
}

// Merge a partial DispatchContext onto a base. The cost accumulator from
// the partial wins when present (the snippet runtime owns the snippet-wide
// accumulator); otherwise the base's fresh accumulator is used. All other
// fields use simple "partial overrides base".
function mergeDispatchContext(
  base: DispatchContext,
  partial?: Partial<DispatchContext>,
): DispatchContext {
  if (!partial) return base;
  const merged: DispatchContext = {
    tenant: partial.tenant ?? base.tenant,
    mount: partial.mount ?? base.mount,
    cost: partial.cost ?? base.cost,
    trajectory: partial.trajectory ?? base.trajectory,
    functionName: partial.functionName ?? base.functionName,
    pins: partial.pins ?? base.pins,
    callStack: partial.callStack ?? base.callStack,
  };
  return merged;
}

// Mode the runtime should report for a body dispatch, given the body kind.
// The fn() factory uses this when the snippet runtime didn't override it.
function defaultModeForBody<I, O>(body: Body<I, O>): ResultMode {
  switch (body.kind) {
    case "pure":
      return "interpreted";
    case "agent":
      return "llm-backed";
  }
}

function defaultTier<I, O>(body: Body<I, O>): Cost["tier"] {
  switch (body.kind) {
    case "pure":
      return 2;
    case "agent":
      return 3;
  }
}

export function fn<I, O>(init: FnInit<I, O>): Fn<I, O> {
  if (!init.intent || typeof init.intent !== "string") {
    throw new TypeError("fn({...}): `intent` must be a non-empty string");
  }
  if (!Array.isArray(init.examples)) {
    throw new TypeError("fn({...}): `examples` must be an array");
  }
  if (init.input === undefined || init.output === undefined) {
    throw new TypeError("fn({...}): `input` and `output` schemas are required");
  }
  if (init.body === undefined) {
    throw new TypeError("fn({...}): `body` is required");
  }

  const spec: FnSpec<I, O> = {
    intent: init.intent,
    examples: init.examples,
    input: init.input,
    output: init.output,
    body: normaliseBody(init.body),
  };

  const callable = async (
    input: I,
    ctxOverride?: Partial<DispatchContext>,
  ): Promise<Result<O>> => {
    // 1) Validate input.
    const inResult = await safeParseAsync(spec.input, input);
    if (!inResult.success) {
      throw new SchemaValidationError("input", inResult.issues);
    }
    const validInput = inResult.output as I;

    // 2) Build the dispatch context. The snippet runtime passes a partial
    //    ctx with tenant / mount / trajectory / functionName / cost; ad-hoc
    //    callers omit it and get safe defaults.
    const ctx = mergeDispatchContext(defaultDispatchContext(), ctxOverride);
    const ctxHadCost = ctxOverride?.cost !== undefined;

    // 3) Dispatch body. Use performance.now() so sub-ms pure-TS bodies
    //    surface in cost.ms.{hot,cold} (Date.now() collapses to 0).
    const startedMs = performance.now();
    let raw: O;
    if (spec.body.kind === "pure") {
      raw = await spec.body.fn(validInput);
    } else {
      const dispatcher = getBodyDispatcher();
      if (dispatcher === null) {
        throw new NoBodyDispatcherError(spec.body.kind);
      }
      raw = await dispatcher.dispatch<I, O>(spec.body, validInput, ctx);
    }
    const elapsedMs = performance.now() - startedMs;

    // 4) Validate output.
    const outResult = await safeParseAsync(spec.output, raw);
    if (!outResult.success) {
      throw new SchemaValidationError("output", outResult.issues);
    }
    const validOutput = outResult.output as O;

    // 5) Build the per-call Cost block.
    //
    //    - If the caller injected its own cost accumulator (snippet runtime),
    //      we surface that accumulator as-is in this Result envelope; the
    //      caller is the one consuming the totals after the snippet ends.
    //    - Otherwise we synthesise a fresh Cost: tier comes from the body
    //      kind (max-observed contract; the dispatcher may have raised it),
    //      ms.{hot,cold} fall back to wall-clock when the dispatcher didn't
    //      charge them, and tokens / llmCalls reflect whatever the dispatcher
    //      added to the ephemeral accumulator.
    const baseTier = defaultTier(spec.body);
    const cost: Cost = {
      tier: (Math.max(ctx.cost.tier, baseTier) as Cost["tier"]),
      tokens: { ...ctx.cost.tokens },
      ms: { ...ctx.cost.ms },
      llmCalls: ctx.cost.llmCalls,
    };
    if (!ctxHadCost && cost.ms.hot === 0 && cost.ms.cold === 0) {
      if (spec.body.kind === "pure") {
        cost.ms.hot = elapsedMs;
      } else {
        cost.ms.cold = elapsedMs;
      }
    }

    // 6) Build the Result envelope. `pins` is always present (defaults to
    //    `{}` per the personas.md §2 contract).
    return makeResult<O>({
      value: validOutput,
      mode: defaultModeForBody(spec.body),
      cost,
      provenance: {
        tenant: ctx.tenant,
        mount: ctx.mount,
        trajectoryId: ctx.trajectory?.id ?? "no-trajectory",
        functionName: ctx.functionName,
        pins: ctx.pins ?? {},
      },
      escalations: 0,
    });
  };

  // Attach the introspection sidecar.
  const fnObj = callable as Fn<I, O>;
  Object.defineProperty(fnObj, "spec", {
    value: spec,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  return fnObj;
}
