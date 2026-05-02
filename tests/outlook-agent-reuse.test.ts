import { describe, expect, it } from "vitest";
import { runQuery } from "../src/runner.js";
import {
  addedFiles,
  artifactSnapshot,
  callNames,
  createEvolutionHarness,
  expectCleanEvolutionHome,
  expectOnlyArtifactDelta,
  readAgentJson,
  readProcedureJson,
  readTrajectoryForRun
} from "./helpers/evolution.js";

describe("negative outlook scorer reuse", () => {
  it("creates a reusable scorer agent once and reuses it with different generated glue", async () => {
    const harness = await createEvolutionHarness("atlasfs-outlook-evolution-");
    await expectCleanEvolutionHome(harness.baseDir, harness.tenantId);
    const sentenceQuery =
      "Find the negative competitive outlook references about Visa, count them, and show evidence sentences.";
    const beforeSentence = await artifactSnapshot(harness.baseDir, harness.tenantId);

    const sentenceIntent = await runQuery({
      question: sentenceQuery,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir,
      observerRuntime: harness.observerRuntime,
      outlookAgentRuntime: harness.outlookAgentRuntime
    });

    expect(sentenceIntent.mode).toBe("novel");
    expect(sentenceIntent.procedureName).toBe("negative_outlook_references");
    expect(sentenceIntent.answer).toBe("4 negative competitive outlook sentence references");
    expect(callNames(sentenceIntent)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "document_units.sentences",
      "agent_store.findReusable",
      "finqa_outlook.createOutlookScorerAgentSpec",
      "agent_store.save",
      "finqa_outlook.scoreUnits",
      "finqa_observe.codifyTableFunction",
      "finqa_observe.executeCodifiedFunction",
      "procedure_store.save"
    ]);
    const afterSentence = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeSentence, afterSentence, { trajectories: 1, procedures: 2, agents: 1 });
    expect(addedFiles(beforeSentence, afterSentence, "agents")).toEqual([
      "negativeOutlookReferenceScorerAgent.json"
    ]);
    const sentenceTrajectory = await readTrajectoryForRun(harness.baseDir, sentenceIntent);
    expect(sentenceTrajectory).toMatchObject({
      question: sentenceQuery,
      result: {
        answer: "4 negative competitive outlook sentence references",
        roundedAnswer: 4
      }
    });

    const storedAgent = await readAgentJson<{
      agentName: string;
      capability: string;
      inputSchema: { unitText: string; target: string; lens: string };
      outputSchema: { isReference: string; polarity: string[]; severity: string };
      observer: string;
    }>(harness.baseDir, harness.tenantId, "negativeOutlookReferenceScorerAgent");
    expect(storedAgent).toMatchObject({
      agentName: "negativeOutlookReferenceScorerAgent",
      capability: "negative_outlook_reference_scoring",
      inputSchema: {
        unitText: "string",
        target: "string",
        lens: "competitive_outlook"
      },
      outputSchema: {
        isReference: "boolean",
        severity: "0|1|2|3"
      },
      observer: "fixture"
    });
    const sentenceProcedure = await readProcedureJson<{
      name: string;
      sourceTrajectoryId: string;
      matcher: { intent: string; examples: string[] };
      implementation: { kind: string; agentName: string; functionName: string; observer: string };
      params: { filename: string; target: string; lens: string; unitKind: string };
    }>(harness.baseDir, harness.tenantId, "negative_outlook_references");
    expect(sentenceProcedure).toMatchObject({
      name: "negative_outlook_references",
      sourceTrajectoryId: sentenceIntent.trajectoryId,
      matcher: {
        intent: "negative_outlook_references",
        examples: [sentenceQuery]
      },
      implementation: {
        kind: "agentic_ts_function",
        agentName: "negativeOutlookReferenceScorerAgent",
        functionName: "selectNegativeOutlookReferences",
        observer: "fixture"
      },
      params: {
        filename: "V/2012/page_28.pdf",
        target: "Visa",
        lens: "competitive_outlook",
        unitKind: "sentence"
      }
    });

    const titleQuery = "Find the negative competitive outlook references about Visa, but only from titles or quotes.";
    const beforeTitle = await artifactSnapshot(harness.baseDir, harness.tenantId);
    const titleIntent = await runQuery({
      question: titleQuery,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir,
      observerRuntime: harness.observerRuntime,
      outlookAgentRuntime: harness.outlookAgentRuntime
    });

    expect(titleIntent.mode).toBe("novel");
    expect(titleIntent.procedureName).toBe("negative_outlook_title_or_quote_references");
    expect(titleIntent.answer).toBe("1 negative competitive outlook title or quote references");
    expect(callNames(titleIntent)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "document_units.titleOrQuoteUnits",
      "agent_store.findReusable",
      "finqa_outlook.scoreUnits",
      "finqa_observe.codifyTableFunction",
      "finqa_observe.executeCodifiedFunction",
      "procedure_store.save"
    ]);
    expect(callNames(titleIntent)).not.toContain("finqa_outlook.createOutlookScorerAgentSpec");
    expect(callNames(titleIntent)).not.toContain("agent_store.save");
    const afterTitle = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeTitle, afterTitle, { trajectories: 1, procedures: 2 });
    expect(afterTitle.agents).toEqual(afterSentence.agents);
    const titleTrajectory = await readTrajectoryForRun(harness.baseDir, titleIntent);
    const reuseCall = titleTrajectory.calls.find((call) => call.primitive === "agent_store.findReusable");
    expect(reuseCall?.output).toMatchObject({
      agentName: "negativeOutlookReferenceScorerAgent",
      capability: "negative_outlook_reference_scoring"
    });

    const titleProcedure = await readProcedureJson<{
      name: string;
      sourceTrajectoryId: string;
      matcher: { intent: string; examples: string[] };
      implementation: { kind: string; agentName: string; functionName: string; observer: string };
      params: { filename: string; target: string; lens: string; unitKind: string };
    }>(harness.baseDir, harness.tenantId, "negative_outlook_title_or_quote_references");
    expect(titleProcedure).toMatchObject({
      name: "negative_outlook_title_or_quote_references",
      sourceTrajectoryId: titleIntent.trajectoryId,
      matcher: {
        intent: "negative_outlook_title_or_quote_references",
        examples: [titleQuery]
      },
      implementation: {
        kind: "agentic_ts_function",
        agentName: "negativeOutlookReferenceScorerAgent",
        functionName: "selectNegativeOutlookTitleReferences",
        observer: "fixture"
      },
      params: {
        filename: "V/2012/page_28.pdf",
        target: "Visa",
        lens: "competitive_outlook",
        unitKind: "title_or_quote"
      }
    });

    const replay = await runQuery({
      question: titleQuery,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir,
      outlookAgentRuntime: harness.outlookAgentRuntime
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("negative_outlook_title_or_quote_references");
    expect(callNames(replay)).toEqual(["procedures.negative_outlook_title_or_quote_references"]);
    expect(replay.calls[0]).toMatchObject({
      primitive: "procedures.negative_outlook_title_or_quote_references",
      input: {
        agentName: "negativeOutlookReferenceScorerAgent",
        unitKind: "title_or_quote"
      }
    });
    const afterReplay = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterTitle, afterReplay, {});
  });
});
