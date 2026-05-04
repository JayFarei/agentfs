// Body factories and the discriminated body type.
//
// Three shapes per `kb/prd/design.md` §6.2:
//   - Pure TS:  `{ kind: "pure", fn: (input) => output }`
//   - LLM:      `{ kind: "llm",   prompt, model, output? }`
//   - Agent:    `{ kind: "agent", skill, model }`
//
// The `output` schema on llm bodies is optional here at the body level; the
// outer fn({...}) factory always carries an output schema, so the body's
// schema is mostly for inline-llm dispatchers that want the body to be
// self-describing.

import type { GenericSchema } from "valibot";

export type PureTSBody<I, O> = {
  kind: "pure";
  fn: (input: I) => O | Promise<O>;
};

export type LlmBody<O> = {
  kind: "llm";
  prompt: string;
  model: string;
  // Optional. When present, the dispatcher SHOULD validate the LLM output
  // against this schema before returning. The outer fn({...}) factory's output
  // schema is the canonical contract for callers.
  output?: GenericSchema<O>;
};

export type AgentBody<O> = {
  kind: "agent";
  skill: string;
  model: string;
  // Phantom / structural marker so TS infers `O` from the surrounding fn({...})
  // factory. Not used at runtime.
  __outputBrand?: (o: O) => void;
};

export type Body<I, O> = PureTSBody<I, O> | LlmBody<O> | AgentBody<O>;

// --- Constructors -----------------------------------------------------------

// `llm({...})` body factory. Inline prompt; runtime dispatch via Flue session.
export function llm<O>(args: {
  prompt: string;
  model: string;
  output?: GenericSchema<O>;
}): LlmBody<O> {
  const body: LlmBody<O> = {
    kind: "llm",
    prompt: args.prompt,
    model: args.model,
  };
  if (args.output !== undefined) {
    body.output = args.output;
  }
  return body;
}

// `agent({...})` body factory. References a markdown sidecar at /lib/skills/<name>.md.
export function agent<O = unknown>(args: {
  skill: string;
  model: string;
}): AgentBody<O> {
  return {
    kind: "agent",
    skill: args.skill,
    model: args.model,
  };
}

// --- Body normalisation -----------------------------------------------------

// A "raw" body the user might pass to `fn({...})`: either a discriminated body
// object, or a bare function (which is sugar for `{ kind: "pure", fn }`).
export type RawBody<I, O> = Body<I, O> | ((input: I) => O | Promise<O>);

export function isPureFn<I, O>(b: RawBody<I, O>): b is (input: I) => O | Promise<O> {
  return typeof b === "function";
}

// Normalise a RawBody into a Body. Bare functions become PureTSBody.
export function normaliseBody<I, O>(b: RawBody<I, O>): Body<I, O> {
  if (isPureFn(b)) {
    return { kind: "pure", fn: b };
  }
  return b;
}
