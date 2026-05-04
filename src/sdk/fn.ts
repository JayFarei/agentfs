// The `fn({...})` factory.
//
// One factory; three body shapes (pure, llm, agent). The returned callable
// validates input, dispatches the body, validates output, and returns a
// Result<O>. The callable also carries a `.spec` sidecar for introspection
// (used by `man`, `apropos`, the observer, and the bootstrap `.d.ts`
// regenerator).
//
// Per design.md §6.1 + personas.md §2 + decisions.md D-011.

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
export type Fn<I, O> = ((input: I) => Promise<Result<O>>) & {
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
// In production this is replaced by the snippet runtime, which threads its
// own context through.
function defaultDispatchContext(functionName?: string): DispatchContext {
  return {
    tenant: "anonymous",
    mount: "unknown",
    cost: costZero(),
    functionName,
  };
}

// Mode the runtime should report for a body dispatch, given the body kind.
// The fn() factory uses this when the snippet runtime didn't override it.
function defaultModeForBody<I, O>(body: Body<I, O>): ResultMode {
  switch (body.kind) {
    case "pure":
      return "interpreted";
    case "llm":
    case "agent":
      return "llm-backed";
  }
}

function defaultTier<I, O>(body: Body<I, O>): Cost["tier"] {
  switch (body.kind) {
    case "pure":
      return 2;
    case "llm":
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

  const callable = async (input: I): Promise<Result<O>> => {
    // 1) Validate input.
    const inResult = await safeParseAsync(spec.input, input);
    if (!inResult.success) {
      throw new SchemaValidationError("input", inResult.issues);
    }
    const validInput = inResult.output as I;

    // 2) Dispatch body.
    const ctx = defaultDispatchContext();
    const startedMs = Date.now();
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
    const elapsedMs = Date.now() - startedMs;

    // 3) Validate output.
    const outResult = await safeParseAsync(spec.output, raw);
    if (!outResult.success) {
      throw new SchemaValidationError("output", outResult.issues);
    }
    const validOutput = outResult.output as O;

    // 4) Build Result envelope. The dispatcher may have charged costs into
    //    ctx.cost; if not, we fold elapsed wall-clock into ms.cold for the
    //    novel path or ms.hot for the warm path. The fn() factory itself
    //    cannot tell hot vs cold; default to cold for non-pure, hot for pure.
    const cost: Cost = {
      tier: ctx.cost.tier !== 0 ? ctx.cost.tier : defaultTier(spec.body),
      tokens: { ...ctx.cost.tokens },
      ms: { ...ctx.cost.ms },
      llmCalls: ctx.cost.llmCalls,
    };
    if (cost.ms.hot === 0 && cost.ms.cold === 0) {
      if (spec.body.kind === "pure") {
        cost.ms.hot = elapsedMs;
      } else {
        cost.ms.cold = elapsedMs;
      }
    }

    return makeResult<O>({
      value: validOutput,
      mode: defaultModeForBody(spec.body),
      cost,
      provenance: {
        tenant: ctx.tenant,
        mount: ctx.mount,
        trajectoryId: ctx.trajectory?.id ?? "no-trajectory",
        functionName: ctx.functionName,
        pins: ctx.pins,
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
