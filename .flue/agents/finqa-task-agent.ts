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

  const agent = await init({ model: "anthropic/claude-sonnet-4-6" });
  const session = await agent.session();
  const spec = loadedPayload.spec ?? {};

  return session.prompt(
    `${spec.prompt ?? "Classify the sentiment/tone of the document excerpt."}

Question:
${loadedPayload.question}

Document excerpt:
${String(loadedPayload.documentText ?? "").slice(0, 5000)}

Return the typed result with concise evidence quotes from the excerpt.`,
    {
      result: v.object({
        sentiment: v.picklist(["positive", "neutral", "negative", "mixed"]),
        confidence: v.number(),
        rationale: v.string(),
        evidence: v.array(v.string())
      })
    }
  );
}
