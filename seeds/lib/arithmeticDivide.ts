// arithmeticDivide — divide two numbers with a guard for zero denominators.
//
// Ported from the prototype's `src/datafetch/db/arithmetic.ts:divide`. Pure
// TS body; no LLM dispatch, no substrate calls. The fn() factory's output
// schema validates the result before the snippet runtime returns it.

import * as v from "valibot";

import { fn } from "../../src/sdk/index.js";

const InputSchema = v.object({
  numerator: v.number(),
  denominator: v.number(),
});
const OutputSchema = v.object({
  quotient: v.number(),
});

type Input = {
  numerator: number;
  denominator: number;
};
type Output = {
  quotient: number;
};

export const arithmeticDivide = fn<Input, Output>({
  intent:
    "divide one number by another, with an explicit error on zero denominator",
  examples: [
    {
      input: { numerator: 100, denominator: 4 },
      output: { quotient: 25 },
    },
  ],
  input: InputSchema,
  output: OutputSchema,
  body: ({ numerator, denominator }) => {
    if (denominator === 0) {
      throw new Error("arithmeticDivide: cannot divide by zero");
    }
    return { quotient: numerator / denominator };
  },
});
