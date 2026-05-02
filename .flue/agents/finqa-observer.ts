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

Return a function that uses filing.table.rows and returns { answer, roundedAnswer, label, evidence }.
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
