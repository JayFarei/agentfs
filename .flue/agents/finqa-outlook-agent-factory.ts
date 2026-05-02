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

  return session.prompt(
    `You are the AtlasFS observer. Create a reusable typed agent interface, not a one-off answer.

Design posture:
- Prefer a small, composable agent in the spirit of the Unix philosophy.
- The agent should score one short document unit at a time.
- The agent must be reusable across sentences, headings, quotes, and other future unit extractors.
- Do not specialize the interface to one exact sentence.

User question:
${loadedPayload.question}

Candidate unit examples:
${JSON.stringify((loadedPayload.units ?? []).slice(0, 8), null, 2)}

Return the typed agent interface for scoring negative competitive-outlook references about a target company.`,
    {
      result: v.object({
        agentName: v.string(),
        description: v.string(),
        prompt: v.string()
      })
    }
  );
}
