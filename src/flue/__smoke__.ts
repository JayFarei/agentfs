// Proof-of-life smoke test for the in-process Flue dispatcher.
//
// Run with:  pnpm tsx src/flue/__smoke__.ts
//
// Gates on `ANTHROPIC_API_KEY` (or `ANTHROPIC_KEY`); when the key isn't
// set the test prints a manual-run notice and exits 0 — that way `pnpm
// typecheck` style automation in CI doesn't fail when the key isn't
// available.

import * as v from "valibot";

import { fn } from "../sdk/fn.js";
import { llm } from "../sdk/body.js";

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

  const result = await reverse(
    { text: "hello" },
    { tenant: "smoke-tenant", mount: "smoke-mount" },
  );

  // Assertions
  const checks: { label: string; ok: boolean }[] = [
    { label: "mode === 'llm-backed'", ok: result.mode === "llm-backed" },
    { label: "cost.llmCalls === 1", ok: result.cost.llmCalls === 1 },
    { label: "cost.tier === 3", ok: result.cost.tier === 3 },
    {
      label: "value.reversed is a non-empty string",
      ok:
        typeof result.value.reversed === "string" &&
        result.value.reversed.length > 0,
    },
  ];

  console.log("Result envelope:");
  console.log(JSON.stringify(result, null, 2));
  console.log("");
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
