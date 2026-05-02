import { readFile } from "node:fs/promises";
import type { FlueContext } from "@flue/sdk/client";
import * as v from "valibot";

export const triggers = {};

export default async function ({ init, payload, env }: FlueContext) {
  if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_KEY;
  }

  const typedPayload = payload as { payloadFile?: string };
  const loadedPayload = typedPayload.payloadFile
    ? JSON.parse(await readFile(typedPayload.payloadFile, "utf8"))
    : payload;

  const agent = await init({
    model: "anthropic/claude-sonnet-4-6"
  });
  const session = await agent.session();

  return session.prompt(
    `You are an observer agent in AtlasFS. Codify a reusable TypeScript function for this intermediate FinQA table-reasoning step.

Design posture:
- Prefer small, general, composable functions in the spirit of the Unix philosophy.
- Make each generated function do one clear job over typed inputs and outputs.
- Avoid overfitting to the exact wording of one query when a reusable primitive-shaped function can solve a family of related intents.
- Keep generated code free of hidden I/O, imports, global state, and persistence. Return structured artifacts; the host persists them.
- When specialized agents are involved, generate glue that composes their typed outputs instead of folding all reasoning into one opaque function.

Question:
${loadedPayload.question}

Normalized filing table:
${JSON.stringify(
  {
    filename: loadedPayload.filing?.filename,
    headers: loadedPayload.filing?.table?.headers,
    rowSample: loadedPayload.filing?.table?.rows?.slice?.(0, 8)
  },
  null,
  2
)}

Additional derivation context:
${JSON.stringify(loadedPayload.context ?? null, null, 2)}

Return a function that uses filing.table.rows and returns { answer, roundedAnswer, label, evidence }.
If the question contains reviewed requirements, encode those exact requirements in the generated function.
The answer may be a number for a single metric or a concise string for a multi-year comparison.
roundedAnswer must be a number when present; omit it for narrative/string answers if no single numeric answer applies.
When a reviewed denominator names a table row, use that row directly by labelKey; do not reconstruct it from other rows unless the row is absent.
For non-table glue, the generated function may accept a generic input object instead of a filing, but it must still return { answer, roundedAnswer, label, evidence }.
Do not import packages. The source must be compatible with new Function.`,
    {
      result: v.object({
        functionName: v.string(),
        description: v.string(),
        source: v.string()
      })
    }
  );
}
