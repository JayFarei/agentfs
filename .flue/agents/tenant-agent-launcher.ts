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
  const mode = loadedPayload.launcher?.mode ?? "sentiment";
  const agent = await init({ model: "anthropic/claude-sonnet-4-6" });
  const session = await agent.session();
  const spec = loadedPayload.spec ?? {};

  if (mode === "outlook-score") {
    const unit = loadedPayload.unit ?? {};
    return session.prompt(
      `${spec.prompt ?? "Score one short document unit for negative competitive-outlook references."}

Target company: ${loadedPayload.target ?? "Visa"}
Lens: ${loadedPayload.lens ?? "competitive_outlook"}

Document unit:
${unit.text ?? ""}

Return a strict typed score. A negative reference should identify competitive pressure, emerging entrants, direct competition, regulatory disadvantage, adverse market pressure, or similar outlook risk.

When complete, output exactly one JSON object between ---RESULT_START--- and ---RESULT_END---.
Do not use markdown fences.

Return JSON matching this schema:
{
  "isReference": true | false,
  "polarity": "negative" | "neutral" | "positive" | "mixed",
  "severity": 0 | 1 | 2 | 3,
  "rationale": "one short sentence",
  "evidence": "exact supporting text, or empty string"
}

Use severity 0 when isReference is false. Use polarity "negative" when isReference is true for this lens.`
    );
  }

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
