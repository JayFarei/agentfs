import { describe, expect, it } from "vitest";
import { endorseTrajectory, runQuery } from "../src/runner.js";
import {
  artifactSnapshot,
  callNames,
  createEvolutionHarness,
  expectCleanEvolutionHome,
  expectOnlyArtifactDelta,
  readProcedureJson,
  readProcedureSource,
  readTrajectoryForRun
} from "./helpers/evolution.js";

describe("task-specific sentiment agent crystallization", () => {
  it("saves a generated typed task-agent interface and replays through it", async () => {
    const harness = await createEvolutionHarness("atlasfs-sentiment-evolution-");
    await expectCleanEvolutionHome(harness.baseDir, harness.tenantId);
    const question = "what is the sentiment of Visa's competitive positioning in this document?";
    const beforeQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);

    const first = await runQuery({
      question,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir,
      taskAgentRuntime: harness.taskAgentRuntime
    });

    expect(first.mode).toBe("novel");
    expect(first.answer).toBe("positive");
    expect(callNames(first)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_agent.documentText",
      "finqa_agent.createSentimentAgentSpec",
      "finqa_agent.runSentimentAgent"
    ]);
    const afterQuery = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeQuery, afterQuery, { trajectories: 1 });
    const trajectory = await readTrajectoryForRun(harness.baseDir, first);
    expect(trajectory).toMatchObject({
      question,
      result: {
        sentiment: "positive",
        confidence: 0.86
      }
    });

    const endorsed = await endorseTrajectory({
      trajectoryIdOrPath: first.trajectoryId!,
      baseDir: harness.baseDir
    });
    const afterEndorse = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterQuery, afterEndorse, { procedures: 2 });
    expect(endorsed.jsonPath).toContain("document_sentiment.json");

    const procedureJson = await readProcedureJson<{
      name: string;
      sourceTrajectoryId: string;
      matcher: { intent: string; examples: string[] };
      params: { filename: string };
      implementation: { kind: string; agentName: string; observer: string; prompt: string };
    }>(harness.baseDir, harness.tenantId, "document_sentiment");
    expect(procedureJson).toMatchObject({
      name: "document_sentiment",
      sourceTrajectoryId: first.trajectoryId,
      matcher: {
        intent: "document_sentiment",
        examples: [question]
      },
      params: {
        filename: "V/2012/page_28.pdf"
      },
      implementation: {
        kind: "task_agent",
        agentName: "competitivePositioningSentimentAgent",
        observer: "fixture"
      }
    });

    const source = await readProcedureSource(harness.baseDir, harness.tenantId, "document_sentiment");
    expect(source).toContain("task_agent");
    expect(source).toContain("competitivePositioningSentimentAgent");

    const replay = await runQuery({
      question,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir,
      taskAgentRuntime: harness.taskAgentRuntime
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("document_sentiment");
    expect(replay.answer).toBe("positive");
    expect(callNames(replay)).toEqual(["procedures.document_sentiment"]);
    const afterReplay = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterEndorse, afterReplay, {});
  });
});
