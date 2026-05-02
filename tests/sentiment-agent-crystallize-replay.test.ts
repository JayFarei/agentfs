import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FixtureTaskAgentRuntime } from "../src/datafetch/db/finqa_agent.js";
import { endorseTrajectory, loadLocalDemoCases, runQuery } from "../src/runner.js";

describe("task-specific sentiment agent crystallization", () => {
  it("saves a generated typed task-agent interface and replays through it", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-sentiment-test-"));
    const cases = await loadLocalDemoCases();
    const backend = { kind: "local" as const, cases };
    const question = "what is the sentiment of Visa's competitive positioning in this document?";

    const first = await runQuery({
      question,
      tenantId: "financial-analyst",
      backend,
      baseDir,
      taskAgentRuntime: new FixtureTaskAgentRuntime()
    });

    expect(first.mode).toBe("novel");
    expect(first.answer).toBe("positive");
    expect(first.calls.map((call) => (call as { primitive: string }).primitive)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_agent.documentText",
      "finqa_agent.createSentimentAgentSpec",
      "finqa_agent.runSentimentAgent"
    ]);

    const endorsed = await endorseTrajectory({
      trajectoryIdOrPath: first.trajectoryId!,
      baseDir
    });
    const source = await readFile(endorsed.tsPath, "utf8");
    expect(source).toContain("task_agent");
    expect(source).toContain("competitivePositioningSentimentAgent");

    const replay = await runQuery({
      question,
      tenantId: "financial-analyst",
      backend,
      baseDir,
      taskAgentRuntime: new FixtureTaskAgentRuntime()
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("document_sentiment");
    expect(replay.answer).toBe("positive");
    expect(replay.calls).toHaveLength(1);
  });
});
