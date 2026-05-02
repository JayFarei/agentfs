import { readFile } from "node:fs/promises";
import type { FlueContext } from "@flue/sdk/client";

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
- The returned JSON must match the host interface exactly.
- Use agentName exactly: negativeOutlookReferenceScorerAgent.
- Keep prompt under 900 characters.
- Do not include markdown fences, examples, comments, or nested JSON inside prompt.
- The prompt must instruct the scorer to return exactly:
  { "isReference": boolean, "polarity": "negative"|"neutral"|"positive"|"mixed", "severity": 0|1|2|3, "rationale": string, "evidence": string }.

User question:
${loadedPayload.question}

Candidate unit examples:
${JSON.stringify((loadedPayload.units ?? []).slice(0, 5), null, 2)}

When complete, output exactly one JSON object between ---RESULT_START--- and ---RESULT_END---.
Do not use markdown fences.

Return this JSON object:
{
  "agentName": "negativeOutlookReferenceScorerAgent",
  "description": "Scores one document unit for negative competitive-outlook references about a target company.",
  "prompt": "A short reusable scorer prompt matching the required output schema."
}`
  );
}
