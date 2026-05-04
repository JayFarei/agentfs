// Proof-of-life smoke test for the in-process Flue dispatcher.
//
// Run with:  pnpm tsx src/flue/__smoke__.ts
//
// Two end-to-end calls:
//   1. `body: llm({...})` — round-trip through the inline-prompt path.
//   2. `body: agent({skill})` — round-trip through the skill-markdown
//      path, including disk skill resolution at
//      `<baseDir>/lib/__seed__/skills/<name>.md`.
//
// Gates on `ANTHROPIC_API_KEY` (or `ANTHROPIC_KEY`); when the key isn't
// set the test prints a manual-run notice and exits 0 — that way `pnpm
// typecheck` style automation in CI doesn't fail when the key isn't
// available.

import { promises as fsp } from "node:fs";
import path from "node:path";

import * as v from "valibot";

import { fn } from "../sdk/fn.js";
import { llm, agent } from "../sdk/body.js";

import { installFlueDispatcher } from "./install.js";

async function main(): Promise<void> {
  const haveKey = Boolean(
    process.env["ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_KEY"],
  );
  if (!haveKey) {
    console.warn(
      "[smoke] ANTHROPIC_API_KEY not set; skipping live LLM call.\n" +
        "        Set the key in your environment to run this end-to-end.",
    );
    return;
  }

  const installation = await installFlueDispatcher({});
  const checks: { label: string; ok: boolean }[] = [];

  // ---- Test 1: body: llm({...}) -------------------------------------------
  console.log("== Test 1: body: llm({...}) ==");
  const reverse = fn({
    intent: "Reverse a short string.",
    examples: [
      { input: { text: "hi" }, output: { reversed: "ih" } },
    ],
    input: v.object({ text: v.string() }),
    output: v.object({ reversed: v.string() }),
    body: llm({
      prompt:
        "Reverse the input string. Read the JSON input below; return an " +
        "object shaped {\"reversed\": \"...\"}.",
      model: "anthropic/claude-haiku-4-5",
      output: v.object({ reversed: v.string() }),
    }),
  });

  const llmResult = await reverse(
    { text: "hello" },
    { tenant: "smoke-tenant", mount: "smoke-mount" },
  );

  console.log("Result envelope (llm):");
  console.log(JSON.stringify(llmResult, null, 2));
  console.log("");

  checks.push(
    { label: "[llm] mode === 'llm-backed'", ok: llmResult.mode === "llm-backed" },
    { label: "[llm] cost.llmCalls === 1", ok: llmResult.cost.llmCalls === 1 },
    { label: "[llm] cost.tier === 3", ok: llmResult.cost.tier === 3 },
    {
      label: "[llm] value.reversed is a non-empty string",
      ok:
        typeof llmResult.value.reversed === "string" &&
        llmResult.value.reversed.length > 0,
    },
  );

  // ---- Test 2: body: agent({skill}) ---------------------------------------
  // Write a tiny test skill into the seed bundle so the disk loader picks
  // it up. The skill returns a structured object that the fn() factory
  // validates against `spec.output`.
  console.log("== Test 2: body: agent({skill}) ==");
  const skillName = "smoke_classify_color";
  const skillPath = path.join(
    installation.baseDir,
    "lib",
    "__seed__",
    "skills",
    `${skillName}.md`,
  );
  await fsp.mkdir(path.dirname(skillPath), { recursive: true });
  await fsp.writeFile(
    skillPath,
    [
      "---",
      `name: ${skillName}`,
      `input: "Object with { word: string }."`,
      `output: "{ category: 'warm'|'cool'|'neutral', confidence: number }"`,
      `model: anthropic/claude-haiku-4-5`,
      "---",
      "",
      "Classify the input word as a colour temperature.",
      "",
      "Read the JSON input below. The `word` is a colour name (e.g. 'red',",
      "'blue', 'beige'). Categorise it as `warm` (red/orange/yellow),",
      "`cool` (blue/green/violet), or `neutral` (grey/beige/white/black).",
      "Return a confidence between 0 and 1.",
      "",
      "Return ONLY a JSON object matching:",
      "{ \"category\": \"warm\"|\"cool\"|\"neutral\", \"confidence\": <0..1> }",
      "",
    ].join("\n"),
    "utf8",
  );

  const classify = fn({
    intent: "Classify a colour word as warm / cool / neutral.",
    examples: [
      {
        input: { word: "red" },
        output: { category: "warm" as const, confidence: 0.95 },
      },
    ],
    input: v.object({ word: v.string() }),
    output: v.object({
      category: v.picklist(["warm", "cool", "neutral"]),
      confidence: v.number(),
    }),
    body: agent({
      skill: skillName,
      model: "anthropic/claude-haiku-4-5",
    }),
  });

  const agentResult = await classify(
    { word: "blue" },
    { tenant: "smoke-tenant", mount: "smoke-mount" },
  );

  console.log("Result envelope (agent):");
  console.log(JSON.stringify(agentResult, null, 2));
  console.log("");

  checks.push(
    {
      label: "[agent] mode === 'llm-backed'",
      ok: agentResult.mode === "llm-backed",
    },
    {
      label: "[agent] cost.llmCalls === 1",
      ok: agentResult.cost.llmCalls === 1,
    },
    { label: "[agent] cost.tier === 3", ok: agentResult.cost.tier === 3 },
    {
      label: "[agent] value.category in {warm, cool, neutral}",
      ok: ["warm", "cool", "neutral"].includes(agentResult.value.category),
    },
    {
      label: "[agent] value.confidence is a number",
      ok: typeof agentResult.value.confidence === "number",
    },
  );

  // ---- Report -------------------------------------------------------------
  console.log("Assertions:");
  let failed = 0;
  for (const c of checks) {
    const flag = c.ok ? "PASS" : "FAIL";
    console.log(`  [${flag}] ${c.label}`);
    if (!c.ok) failed += 1;
  }

  await installation.pool.closeAll();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[smoke] crashed:", err);
  process.exit(1);
});
