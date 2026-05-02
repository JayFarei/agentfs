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
  const unit = loadedPayload.unit ?? {};

  return session.prompt(
    `${spec.prompt ?? "Score one short document unit for negative competitive-outlook references."}

Target company: ${loadedPayload.target ?? "Visa"}
Lens: ${loadedPayload.lens ?? "competitive_outlook"}

Document unit:
${unit.text ?? ""}

Return a strict typed score. A negative reference should identify competitive pressure, emerging entrants, direct competition, regulatory disadvantage, adverse market pressure, or similar outlook risk.`,
    {
      result: v.object({
        isReference: v.boolean(),
        polarity: v.picklist(["negative", "neutral", "positive", "mixed"]),
        severity: v.number(),
        rationale: v.string(),
        evidence: v.string()
      })
    }
  );
}
