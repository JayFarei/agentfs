// Body factories and the discriminated body type.
//
// Two shapes:
//   - Pure TS:  `{ kind: "pure", fn: (input) => output }`
//   - Agentic:  `{ kind: "agent", prompt | skill, model, output? }`
//
// The `output` schema on agent bodies is optional here at the body level; the
// outer fn({...}) factory always carries an output schema, so the body's
// schema is mostly for inline-prompt dispatchers that want the body to be
// self-describing.

import type { GenericSchema } from "valibot";

export type PureTSBody<I, O> = {
  kind: "pure";
  fn: (input: I) => O | Promise<O>;
};

export type AgentPromptBody<O> = {
  kind: "agent";
  prompt: string;
  skill?: never;
  model: string;
  output?: GenericSchema<O>;
};

export type AgentSkillBody<O> = {
  kind: "agent";
  skill: string;
  prompt?: never;
  model: string;
  output?: GenericSchema<O>;
};

export type AgentBody<O> = (AgentPromptBody<O> | AgentSkillBody<O>) & {
  // Phantom / structural marker so TS infers `O` from the surrounding fn({...})
  // factory. Not used at runtime.
  __outputBrand?: (o: O) => void;
};

// Backward-compatible type name for old imports. `llm({...})` now returns the
// same inline-prompt agent body as `agent({prompt, ...})`.
export type LlmBody<O> = AgentPromptBody<O>;

export type Body<I, O> = PureTSBody<I, O> | AgentBody<O>;

// --- Constructors -----------------------------------------------------------

export function agent<O>(args: {
  prompt: string;
  skill?: never;
  model: string;
  output?: GenericSchema<O>;
}): AgentBody<O>;
export function agent<O = unknown>(args: {
  skill: string;
  prompt?: never;
  model: string;
  output?: GenericSchema<O>;
}): AgentBody<O>;
export function agent<O = unknown>(args: {
  prompt?: string;
  skill?: string;
  model: string;
  output?: GenericSchema<O>;
}): AgentBody<O> {
  const hasPrompt = typeof args.prompt === "string" && args.prompt.trim() !== "";
  const hasSkill = typeof args.skill === "string" && args.skill.trim() !== "";
  if (hasPrompt === hasSkill) {
    throw new TypeError(
      "agent({...}) requires exactly one of `prompt` or `skill`.",
    );
  }
  if (hasPrompt) {
    const body: AgentPromptBody<O> = {
      kind: "agent",
      prompt: args.prompt!,
      model: args.model,
    };
    if (args.output !== undefined) body.output = args.output;
    return body;
  }
  const body: AgentSkillBody<O> = {
    kind: "agent",
    skill: args.skill!,
    model: args.model,
  };
  if (args.output !== undefined) body.output = args.output;
  return body;
}

// Deprecated compatibility alias. New code should use
// `agent({prompt, model, output})` so there is only one probabilistic body
// concept in the authoring surface.
export function llm<O>(args: {
  prompt: string;
  model: string;
  output?: GenericSchema<O>;
}): LlmBody<O> {
  return agent(args) as LlmBody<O>;
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
