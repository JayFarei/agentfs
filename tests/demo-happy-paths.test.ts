import { describe, expect, it } from "vitest";
import { runQuery } from "../src/runner.js";
import {
  artifactSnapshot,
  callNames,
  createEvolutionHarness,
  expectCleanEvolutionHome,
  expectOnlyArtifactDelta,
  readAgentJson,
  readProcedureJson,
  readProcedureSource
} from "./helpers/evolution.js";

describe("demo happy paths from blank tenants", () => {
  it("path A: generic table math crystallizes into a reusable typed procedure", async () => {
    const harness = await createEvolutionHarness("atlasfs-demo-table-math-");
    await expectCleanEvolutionHome(harness.baseDir, harness.tenantId);

    const firstQuery = "what is the mathematical range for chemical revenue from 2014-2016, in millions?";
    const beforeFirst = await artifactSnapshot(harness.baseDir, harness.tenantId);
    const firstIntent = await runQuery({
      question: firstQuery,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });

    expect(firstIntent.mode).toBe("novel");
    expect(firstIntent.procedureName).toBe("table_math");
    expect(firstIntent.roundedAnswer).toBe(190);
    expect(callNames(firstIntent)).toEqual([
      "finqa_cases.findSimilar",
      "finqa_resolve.pickFiling",
      "finqa_table_math.inferPlan",
      "finqa_table_math.execute",
      "procedure_store.save"
    ]);
    const afterFirst = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeFirst, afterFirst, { trajectories: 1, procedures: 2 });

    const procedure = await readProcedureJson<{
      name: string;
      matcher: { intent: string; examples: string[] };
      params: { filename: string; operation: string; rowLabel: string; years: string[] };
      implementation: { kind: string; primitive: string };
    }>(harness.baseDir, harness.tenantId, "table_math");
    expect(procedure).toMatchObject({
      name: "table_math",
      matcher: {
        intent: "table_math",
        examples: [firstQuery]
      },
      params: {
        filename: "UNP/2016/page_52.pdf",
        operation: "range",
        rowLabel: "chemicals",
        years: ["2014", "2015", "2016"]
      },
      implementation: {
        kind: "table_math",
        primitive: "finqa_table_math"
      }
    });
    await expect(readProcedureSource(harness.baseDir, harness.tenantId, "table_math")).resolves.toContain(
      "finqa_table_math.execute"
    );

    const similarQuery = "what is the mathematical range for coal revenue from 2014-2016, in millions?";
    const replay = await runQuery({
      question: similarQuery,
      tenantId: harness.tenantId,
      backend: harness.backend,
      baseDir: harness.baseDir
    });

    expect(replay.mode).toBe("procedure");
    expect(replay.procedureName).toBe("table_math");
    expect(replay.roundedAnswer).toBe(1687);
    expect(callNames(replay)).toEqual(["procedures.table_math"]);
    const afterReplay = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(afterFirst, afterReplay, {});
  });

  it("path B: an observer-created agent primitive is reused by a second generated procedure", async () => {
    const harness = await createEvolutionHarness("atlasfs-demo-agentic-");
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
      "finqa_observe.createAgentPrimitive",
      "agent_store.save",
      "finqa_outlook.scoreUnits",
      "finqa_observe.codifyTableFunction",
      "finqa_observe.executeCodifiedFunction",
      "procedure_store.save"
    ]);
    const afterSentence = await artifactSnapshot(harness.baseDir, harness.tenantId);
    expectOnlyArtifactDelta(beforeSentence, afterSentence, { trajectories: 1, procedures: 2, agents: 1 });

    const storedAgent = await readAgentJson<{ agentName: string; capability: string }>(
      harness.baseDir,
      harness.tenantId,
      "negativeOutlookReferenceScorerAgent"
    );
    expect(storedAgent).toMatchObject({
      agentName: "negativeOutlookReferenceScorerAgent",
      capability: "negative_outlook_reference_scoring"
    });

    const titleQuery = "Find the negative competitive outlook references about Visa, but only from titles or quotes.";
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
    expect(callNames(titleIntent)).not.toContain("finqa_observe.createAgentPrimitive");

    const titleProcedure = await readProcedureJson<{
      implementation: { kind: string; agentName: string };
      params: { unitKind: string };
    }>(harness.baseDir, harness.tenantId, "negative_outlook_title_or_quote_references");
    expect(titleProcedure).toMatchObject({
      implementation: {
        kind: "agentic_ts_function",
        agentName: "negativeOutlookReferenceScorerAgent"
      },
      params: {
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
    expect(callNames(replay)).toEqual(["procedures.negative_outlook_title_or_quote_references"]);
  });
});
