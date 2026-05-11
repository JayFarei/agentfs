import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

import { locateRepoRoot } from "../src/paths.js";

// Headline E2E: spawn `pnpm tsx src/cli.ts demo` and assert the cost
// panel + call-graph collapse panel render correctly. Forces the
// in-memory mount path via DATAFETCH_SKIP_ENV_FILE=1 so the test is
// hermetic (no Atlas, no LLM, no /tmp races with other test files).

async function runDemoCli(): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const repoRoot = await locateRepoRoot();
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(
      "pnpm",
      ["tsx", "src/cli.ts", "demo"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATAFETCH_SKIP_ENV_FILE: "1",
          // The demo is the canonical legacy learning-loop E2E: Q1
          // crystallises a learned interface, Q2 immediately reuses it
          // as df.lib.<name>. Force legacy mode so the new
          // hooks-candidate-only default does not block reuse.
          DATAFETCH_INTERFACE_MODE: "legacy",
        },
      },
    );
    child.stdout.on("data", (b: Buffer) => stdoutChunks.push(b));
    child.stderr.on("data", (b: Buffer) => stderrChunks.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code ?? -1,
      });
    });
  });
}

describe("demo CLI end-to-end (in-memory)", () => {
  it("runs Q1+Q2 and renders the cost panel + call-graph collapse", async () => {
    const { stdout, stderr, exitCode } = await runDemoCli();
    if (exitCode !== 0) {
      // Surface stderr in the assertion message so a CI failure shows it.
      throw new Error(
        `demo exited with ${exitCode}\nstderr:\n${stderr}\nstdout:\n${stdout}`,
      );
    }
    expect(exitCode).toBe(0);

    expect(stdout).toContain("[demo] mode=in-memory");

    expect(stdout).toContain("[Q1] candidates=2");
    expect(stdout).toContain("[Q1] picked=DOW/2018/page_22.pdf");
    expect(stdout).toMatch(/\[Q1\] answer=\{"value":700/);

    expect(stdout).toContain("observer learned rangeTableMetric");
    expect(stdout).toMatch(/discovery top=rangeTableMetric kind=tool score=/);
    expect(stdout).toContain("discovery invocation=df.lib.rangeTableMetric");

    expect(stdout).toContain("[Q2] mode=interpreted tier=2 llmCalls=0");
    expect(stdout).toContain("[Q2] function=rangeTableMetric");
    expect(stdout).toMatch(/\[Q2\] answer=\{"value":1000/);

    expect(stdout).toContain("=== Cost Panel");
    expect(stdout).toMatch(/function\s+executeTableMath\s+rangeTableMetric/);

    expect(stdout).toContain("=== Call-Graph");
    expect(stdout).toContain("Q1 — top-level chain (novel composition):");
    expect(stdout).toContain("1. db.cases.findSimilar");
    expect(stdout).toContain("2. lib.pickFiling");
    expect(stdout).toContain("3. lib.inferTableMathPlan");
    expect(stdout).toContain("4. lib.executeTableMath");

    expect(stdout).toContain("Q2 — top-level chain (interpreted replay):");
    expect(stdout).toContain("(internally invokes 3 sub-calls:)");
    expect(stdout).toContain("├── db.cases.findSimilar");
    expect(stdout).toContain("├── lib.inferTableMathPlan");
    expect(stdout).toContain("└── lib.executeTableMath");

    expect(stdout).toMatch(
      /Top-level surface: Q1 has 4 calls; Q2 has 1 call \(collapse: 3\)\./,
    );

    void path;
  }, 60_000);
});
