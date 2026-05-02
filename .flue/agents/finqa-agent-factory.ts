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
    `You are the AtlasFS observer. A user query needs a task-specific LLM step, not deterministic code.

Create a typed task-agent interface for the intermediary step.

User question:
${loadedPayload.question}

Document excerpt:
${String(loadedPayload.documentText ?? "").slice(0, 4000)}

Return the agent interface only. The interface should be specific to sentiment/tone extraction over the provided financial document excerpt.`,
    {
      result: v.object({
        agentName: v.string(),
        description: v.string(),
        prompt: v.string()
      })
    }
  );
}
