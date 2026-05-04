import type { FinqaCase, AnswerResult } from "./finqa/types.js";
import { normalizeFinqaCase } from "./finqa/normalize.js";
import { loadRawFinqaDataset } from "./finqa/loadDataset.js";
import { arithmetic } from "./datafetch/db/arithmetic.js";
import {
  createAtlasFinqaCasesPrimitive,
  createFinqaCasesPrimitive,
  type FinqaCasesPrimitive
} from "./datafetch/db/finqa_cases.js";
import { document_units, type DocumentUnitKind } from "./datafetch/db/document_units.js";
import {
  createObserverRuntime,
  finqa_observe,
  type ObserverRuntime
} from "./datafetch/db/finqa_observe.js";
import {
  createOutlookAgentRuntime,
  finqa_outlook,
  type OutlookAgentRuntime
} from "./datafetch/db/finqa_outlook.js";
import {
  createTaskAgentRuntime,
  finqa_agent,
  type SentimentLabel,
  type TaskAgentRuntime
} from "./datafetch/db/finqa_agent.js";
import { finqa_table_math } from "./datafetch/db/finqa_table_math.js";
import { finqa_resolve } from "./datafetch/db/finqa_resolve.js";
import {
  LocalProcedureStore,
  buildNegativeOutlookProcedure,
  buildProcedureFromTrajectory,
  buildTableMathProcedure
} from "./procedures/store.js";
import {
  extractCompany,
  isAveragePaymentVolumeIntent,
  isLargestAveragePaymentVolumeIntent,
  isDocumentSentimentIntent,
  isNegativeOutlookReferencesIntent,
  isNegativeOutlookTitleOrQuoteIntent,
  isRevenueShareIntent,
  isTableMathIntent,
  matchProcedure
} from "./procedures/matcher.js";
import { LocalAgentStore } from "./agents/store.js";
import { readTrajectory, TrajectoryRecorder, atlasfsHome } from "./trajectory/recorder.js";
import { runPlannedQuery } from "./planner/runner.js";
import {
  createRevenueShareDraft,
  inferRevenueShareRequirement,
  reviewRevenueShareDraft,
  type ReviewAction,
  type ReviewResult
} from "./review/drafts.js";

export type RunnerBackend =
  | {
      kind: "local";
      cases: FinqaCase[];
    }
  | {
      kind: "atlas";
    };

export type RunQueryResult = {
  mode: "novel" | "procedure";
  answer: number | string;
  roundedAnswer?: number;
  trajectoryId?: string;
  draftId?: string;
  procedureName?: string;
  calls: unknown[];
  evidence: unknown[];
  review?: {
    status: string;
    assumptions: string[];
    nextActions: string[];
  };
};

export async function loadLocalDemoCases(): Promise<FinqaCase[]> {
  const visa = await loadRawFinqaDataset({
    dataset: "dev",
    filename: "V/2008/page_17.pdf"
  });
  const revenueShare = await loadRawFinqaDataset({
    dataset: "private_test",
    filename: "UNP/2016/page_52.pdf"
  });
  const visaOutlook = await loadRawFinqaDataset({
    dataset: "train",
    filename: "V/2012/page_28.pdf"
  });
  return [...visa, ...revenueShare, ...visaOutlook].map(normalizeFinqaCase);
}

async function createPrimitive(backend: RunnerBackend): Promise<FinqaCasesPrimitive> {
  if (backend.kind === "local") {
    return createFinqaCasesPrimitive({ kind: "local", cases: backend.cases });
  }
  return createAtlasFinqaCasesPrimitive();
}

export async function runQuery(args: {
  question: string;
  tenantId?: string;
  backend?: RunnerBackend;
  baseDir?: string;
  observerRuntime?: ObserverRuntime;
  taskAgentRuntime?: TaskAgentRuntime;
  outlookAgentRuntime?: OutlookAgentRuntime;
}): Promise<RunQueryResult> {
  const tenantId = args.tenantId ?? "financial-analyst";
  const baseDir = args.baseDir ?? atlasfsHome();
  const backend = args.backend ?? { kind: "atlas" };
  const finqaCases = await createPrimitive(backend);
  const procedureStore = new LocalProcedureStore(baseDir);
  const procedures = await procedureStore.list(tenantId);
  const matched = matchProcedure(args.question, procedures);

  if (matched) {
    if (matched.procedure.implementation.kind === "planned_chain") {
      // Replay the saved plan via the executor. The chain's source-of-truth
      // is `implementation.plan`; the procedure file just bundles it with
      // the names of any learned primitives the plan references.
      const [filing] = await finqaCases.findExact({ filename: matched.procedure.params.filename }, 1);
      if (!filing) {
        throw new Error(`No filing found for ${matched.procedure.params.filename}`);
      }
      const candidates = [filing];
      const replayRecorder = new TrajectoryRecorder({ tenantId, question: args.question });
      const { runPlan } = await import("./planner/executor.js");
      const planRun = await runPlan(matched.procedure.implementation.plan, {
        tenantId,
        baseDir,
        recorder: replayRecorder,
        question: args.question,
        filing,
        finqaCases,
        candidates
      });
      const answer = planRun.finalOutput;
      const numericAnswer = typeof answer === "number" ? answer : Number(answer);
      const roundedAnswer = Number.isFinite(numericAnswer)
        ? Math.round(numericAnswer * 100) / 100
        : undefined;
      return {
        mode: "procedure",
        answer:
          typeof answer === "number" || typeof answer === "string" ? answer : String(answer),
        roundedAnswer,
        procedureName: matched.procedure.name,
        calls: [
          {
            primitive: `procedures.${matched.procedure.name}`,
            input: {
              filename: matched.procedure.params.filename,
              question: args.question,
              fingerprint: matched.procedure.implementation.questionFingerprint
            },
            output: { answer, roundedAnswer }
          }
        ],
        evidence: planRun.stepOutputs
      };
    }

    if (matched.procedure.implementation.kind === "table_math") {
      const [filing] = await finqaCases.findExact({ filename: matched.procedure.params.filename }, 1);
      if (!filing) {
        throw new Error(`No filing found for ${matched.procedure.params.filename}`);
      }
      const plan = finqa_table_math.inferPlan({ question: args.question, filing });
      const result = finqa_table_math.execute({ filing, plan });
      return {
        mode: "procedure",
        answer: result.answer,
        roundedAnswer: result.roundedAnswer,
        procedureName: matched.procedure.name,
        calls: [
          {
            primitive: `procedures.${matched.procedure.name}`,
            input: {
              filename: matched.procedure.params.filename,
              question: args.question,
              primitive: matched.procedure.implementation.primitive
            },
            output: result
          }
        ],
        evidence: result.evidence
      };
    }

    if (matched.procedure.implementation.kind === "agentic_ts_function") {
      const [filing] = await finqaCases.findExact({ filename: matched.procedure.params.filename }, 1);
      if (!filing) {
        throw new Error(`No filing found for ${matched.procedure.params.filename}`);
      }
      const agentStore = new LocalAgentStore(baseDir);
      const spec = await agentStore.findByName(tenantId, matched.procedure.implementation.agentName);
      if (!spec) {
        throw new Error(`No reusable agent found for ${matched.procedure.implementation.agentName}`);
      }
      const units =
        matched.procedure.params.unitKind === "title_or_quote"
          ? document_units.titleOrQuoteUnits(filing)
          : document_units.sentences(filing);
      const scoredUnits = await finqa_outlook.scoreUnits(
        {
          spec,
          units,
          target: matched.procedure.params.target ?? "Visa",
          lens: "competitive_outlook"
        },
        args.outlookAgentRuntime ?? createOutlookAgentRuntime(spec.observer)
      );
      const result = finqa_observe.executeCodifiedFunction(
        {
          functionName: matched.procedure.implementation.functionName,
          source: matched.procedure.implementation.source,
          description: matched.procedure.description,
          observer: matched.procedure.implementation.observer
        },
        { scoredUnits, units }
      );
      return {
        mode: "procedure",
        answer: result.answer,
        roundedAnswer: result.roundedAnswer,
        procedureName: matched.procedure.name,
        calls: [
          {
            primitive: `procedures.${matched.procedure.name}`,
            input: {
              filename: matched.procedure.params.filename,
              agentName: spec.agentName,
              unitKind: matched.procedure.params.unitKind
            },
            output: result
          }
        ],
        evidence: result.evidence
      };
    }

    if (matched.procedure.implementation.kind === "ts_function") {
      const [filing] = await finqaCases.findExact({ filename: matched.procedure.params.filename }, 1);
      if (!filing) {
        throw new Error(`No filing found for ${matched.procedure.params.filename}`);
      }
      const result = finqa_observe.executeCodifiedFunction(
        {
          functionName: matched.procedure.implementation.functionName,
          source: matched.procedure.implementation.source,
          description: matched.procedure.description,
          observer: matched.procedure.implementation.observer
        },
        filing
      );
      return {
        mode: "procedure",
        answer: result.answer,
        roundedAnswer: result.roundedAnswer,
        procedureName: matched.procedure.name,
        calls: [
          {
            primitive: `procedures.${matched.procedure.name}`,
            input: { filename: matched.procedure.params.filename },
            output: result
          }
        ],
        evidence: result.evidence
      };
    }

    if (matched.procedure.implementation.kind === "task_agent") {
      const [filing] = await finqaCases.findExact({ filename: matched.procedure.params.filename }, 1);
      if (!filing) {
        throw new Error(`No filing found for ${matched.procedure.params.filename}`);
      }
      const spec = {
        agentName: matched.procedure.implementation.agentName,
        description: matched.procedure.description,
        inputSchema: {
          documentText: "string" as const,
          question: "string" as const
        },
        outputSchema: {
          sentiment: ["positive", "neutral", "negative", "mixed"] as SentimentLabel[],
          confidence: "number" as const,
          rationale: "string" as const,
          evidence: "string[]" as const
        },
        prompt: matched.procedure.implementation.prompt,
        observer: matched.procedure.implementation.observer
      };
      const result = await finqa_agent.runSentimentAgent(
        {
          spec,
          question: args.question,
          documentText: finqa_agent.documentText(filing)
        },
        args.taskAgentRuntime ?? createTaskAgentRuntime(matched.procedure.implementation.observer)
      );
      return {
        mode: "procedure",
        answer: result.sentiment,
        procedureName: matched.procedure.name,
        calls: [
          {
            primitive: `procedures.${matched.procedure.name}`,
            input: { filename: matched.procedure.params.filename, agentName: spec.agentName },
            output: result
          }
        ],
        evidence: result.evidence
      };
    }

    const result = await finqaCases.runAveragePaymentVolumePerTransaction({
      filename: matched.procedure.params.filename,
      company: matched.company
    });
    return {
      mode: "procedure",
      answer: result.answer,
      roundedAnswer: result.roundedAnswer,
      procedureName: matched.procedure.name,
      calls: [
        {
          primitive: `procedures.${matched.procedure.name}`,
          input: { company: matched.company, filename: matched.procedure.params.filename },
          output: result
        }
      ],
      evidence: result.evidence
    };
  }

  if (isLargestAveragePaymentVolumeIntent(args.question)) {
    return runObserverDerivedQuery({
      question: args.question,
      tenantId,
      baseDir,
      finqaCases,
      observerRuntime: args.observerRuntime
    });
  }

  if (isNegativeOutlookReferencesIntent(args.question)) {
    return runNegativeOutlookQuery({
      question: args.question,
      tenantId,
      baseDir,
      finqaCases,
      unitKind: isNegativeOutlookTitleOrQuoteIntent(args.question) ? "title_or_quote" : "sentence",
      observerRuntime: args.observerRuntime,
      outlookAgentRuntime: args.outlookAgentRuntime
    });
  }

  if (isDocumentSentimentIntent(args.question)) {
    return runSentimentQuery({
      question: args.question,
      tenantId,
      baseDir,
      finqaCases,
      taskAgentRuntime: args.taskAgentRuntime
    });
  }

  if (isRevenueShareIntent(args.question)) {
    return runRevenueShareQuery({
      question: args.question,
      tenantId,
      baseDir,
      finqaCases
    });
  }

  // Off-script statistical questions divert to the planner before the
  // table_math predicate can mismatch them (table_math knows range/change/
  // share; std-dev / variance / median / mean-of need a minted primitive).
  if (isUnsupportedStatIntent(args.question)) {
    return runPlannedQuery({
      question: args.question,
      tenantId,
      baseDir,
      finqaCases,
      observerRuntime: args.observerRuntime
    });
  }

  if (isTableMathIntent(args.question)) {
    return runTableMathQuery({
      question: args.question,
      tenantId,
      baseDir,
      finqaCases
    });
  }

  if (isAveragePaymentVolumeIntent(args.question)) {
    return runAveragePaymentVolumeQuery({
      question: args.question,
      tenantId,
      baseDir,
      finqaCases
    });
  }

  // Genuinely unmatched questions: hand off to the off-script loop.
  return runPlannedQuery({
    question: args.question,
    tenantId,
    baseDir,
    finqaCases,
    observerRuntime: args.observerRuntime
  });
}

async function runAveragePaymentVolumeQuery(args: {
  question: string;
  tenantId: string;
  baseDir: string;
  finqaCases: FinqaCasesPrimitive;
}): Promise<RunQueryResult> {
  const recorder = new TrajectoryRecorder({ tenantId: args.tenantId, question: args.question });
  const candidates = await recorder.call("finqa_cases.findSimilar", { question: args.question, limit: 10 }, (input) =>
    args.finqaCases.findSimilar(input.question, input.limit)
  );
  const filing = await recorder.call("finqa_resolve.pickFiling", { question: args.question, candidates }, (input) =>
    finqa_resolve.pickFiling(input)
  );
  const numerator = await recorder.call(
    "finqa_resolve.locateFigure",
    { question: args.question, filing, role: "numerator" as const },
    (input) => finqa_resolve.locateFigure(input)
  );
  const denominator = await recorder.call(
    "finqa_resolve.locateFigure",
    { question: args.question, filing, role: "denominator" as const },
    (input) => finqa_resolve.locateFigure(input)
  );
  const quotient = await recorder.call(
    "arithmetic.divide",
    { numerator: numerator.value, denominator: denominator.value },
    (input) => arithmetic.divide(input.numerator, input.denominator)
  );
  const result: AnswerResult = {
    answer: quotient,
    roundedAnswer: arithmetic.round(quotient, 2),
    evidence: [numerator, denominator]
  };
  recorder.setResult(result);
  await recorder.save(args.baseDir);

  return {
    mode: "novel",
    answer: result.answer,
    roundedAnswer: result.roundedAnswer,
    trajectoryId: recorder.id,
    calls: recorder.snapshot.calls,
    evidence: result.evidence
  };
}

function isUnsupportedStatIntent(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(std\s*dev|stddev|standard deviation|variance|median|mean of)\b/.test(q);
}

async function runTableMathQuery(args: {
  question: string;
  tenantId: string;
  baseDir: string;
  finqaCases: FinqaCasesPrimitive;
}): Promise<RunQueryResult> {
  const recorder = new TrajectoryRecorder({ tenantId: args.tenantId, question: args.question });
  const candidates = await recorder.call("finqa_cases.findSimilar", { question: args.question, limit: 10 }, (input) =>
    args.finqaCases.findSimilar(input.question, input.limit)
  );
  const filing = await recorder.call("finqa_resolve.pickFiling", { question: args.question, candidates }, (input) =>
    finqa_resolve.pickFiling(input)
  );
  const plan = await recorder.call("finqa_table_math.inferPlan", { question: args.question, filename: filing.filename }, () =>
    finqa_table_math.inferPlan({ question: args.question, filing })
  );
  const result = await recorder.call("finqa_table_math.execute", { filename: filing.filename, plan }, (input) =>
    finqa_table_math.execute({ filing, plan: input.plan })
  );
  const procedure = buildTableMathProcedure({
    tenantId: args.tenantId,
    question: args.question,
    sourceTrajectoryId: recorder.id,
    filename: filing.filename,
    plan
  });
  await recorder.call("procedure_store.save", { procedureName: procedure.name, filename: filing.filename }, () =>
    new LocalProcedureStore(args.baseDir).save(procedure)
  );

  recorder.setResult({
    answer: result.answer,
    roundedAnswer: result.roundedAnswer,
    evidence: result.evidence
  });
  await recorder.save(args.baseDir);

  return {
    mode: "novel",
    answer: result.answer,
    roundedAnswer: result.roundedAnswer,
    trajectoryId: recorder.id,
    procedureName: procedure.name,
    calls: recorder.snapshot.calls,
    evidence: result.evidence
  };
}

async function runSentimentQuery(args: {
  question: string;
  tenantId: string;
  baseDir: string;
  finqaCases: FinqaCasesPrimitive;
  taskAgentRuntime?: TaskAgentRuntime;
}): Promise<RunQueryResult> {
  const recorder = new TrajectoryRecorder({ tenantId: args.tenantId, question: args.question });
  const candidates = await recorder.call("finqa_cases.findSimilar", { question: args.question, limit: 10 }, (input) =>
    args.finqaCases.findSimilar(input.question, input.limit)
  );
  const filing = await recorder.call("finqa_resolve.pickFiling", { question: args.question, candidates }, (input) =>
    finqa_resolve.pickFiling(input)
  );
  const documentText = await recorder.call("finqa_agent.documentText", { filing }, (input) =>
    finqa_agent.documentText(input.filing)
  );
  const spec = await recorder.call(
    "finqa_agent.createSentimentAgentSpec",
    { question: args.question, filing, documentText },
    (input) => finqa_agent.createSentimentAgentSpec(input, args.taskAgentRuntime ?? createTaskAgentRuntime())
  );
  const result = await recorder.call(
    "finqa_agent.runSentimentAgent",
    { spec, question: args.question, documentText },
    (input) => finqa_agent.runSentimentAgent(input, args.taskAgentRuntime ?? createTaskAgentRuntime(spec.observer))
  );

  recorder.setResult(result);
  await recorder.save(args.baseDir);

  return {
    mode: "novel",
    answer: result.sentiment,
    trajectoryId: recorder.id,
    calls: recorder.snapshot.calls,
    evidence: result.evidence
  };
}

export async function endorseTrajectory(args: {
  trajectoryIdOrPath: string;
  baseDir?: string;
}): Promise<{ jsonPath: string; tsPath: string }> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const trajectory = await readTrajectory(args.trajectoryIdOrPath, baseDir);
  const procedure = buildProcedureFromTrajectory(trajectory);
  return new LocalProcedureStore(baseDir).save(procedure);
}

export async function reviewDraft(args: {
  draftIdOrPath: string;
  action: ReviewAction;
  message?: string;
  backend?: RunnerBackend;
  baseDir?: string;
  observerRuntime?: ObserverRuntime;
}): Promise<ReviewResult> {
  const backend = args.backend ?? { kind: "atlas" };
  const finqaCases = args.action === "specify" || args.action === "yes" ? await createPrimitive(backend) : undefined;
  return reviewRevenueShareDraft({
    draftIdOrPath: args.draftIdOrPath,
    action: args.action,
    message: args.message,
    baseDir: args.baseDir,
    finqaCases,
    observerRuntime: args.observerRuntime ?? (args.action === "yes" ? createObserverRuntime() : undefined)
  });
}

export async function runLocalDemo(question: string): Promise<RunQueryResult> {
  const cases = await loadLocalDemoCases();
  return runQuery({ question, backend: { kind: "local", cases } });
}

export function expectedCompanyOrThrow(question: string): string {
  const company = extractCompany(question);
  if (!company) {
    throw new Error(`Could not extract company from question: ${question}`);
  }
  return company;
}

async function runObserverDerivedQuery(args: {
  question: string;
  tenantId: string;
  baseDir: string;
  finqaCases: FinqaCasesPrimitive;
  observerRuntime?: ObserverRuntime;
}): Promise<RunQueryResult> {
  const recorder = new TrajectoryRecorder({ tenantId: args.tenantId, question: args.question });
  const candidates = await recorder.call("finqa_cases.findSimilar", { question: args.question, limit: 10 }, (input) =>
    args.finqaCases.findSimilar(input.question, input.limit)
  );
  const filing = await recorder.call("finqa_resolve.pickFiling", { question: args.question, candidates }, (input) =>
    finqa_resolve.pickFiling(input)
  );
  const codified = await recorder.call(
    "finqa_observe.codifyTableFunction",
    { question: args.question, filing },
    (input) => finqa_observe.codifyTableFunction(input, args.observerRuntime ?? createObserverRuntime())
  );
  const result = await recorder.call(
    "finqa_observe.executeCodifiedFunction",
    { codified, filing },
    (input) => finqa_observe.executeCodifiedFunction(input.codified, input.filing)
  );

  recorder.setResult(result);
  await recorder.save(args.baseDir);

  return {
    mode: "novel",
    answer: result.answer,
    roundedAnswer: result.roundedAnswer,
    trajectoryId: recorder.id,
    calls: recorder.snapshot.calls,
    evidence: result.evidence
  };
}

async function runRevenueShareQuery(args: {
  question: string;
  tenantId: string;
  baseDir: string;
  finqaCases: FinqaCasesPrimitive;
}): Promise<RunQueryResult> {
  const recorder = new TrajectoryRecorder({ tenantId: args.tenantId, question: args.question });
  const candidates = await recorder.call("finqa_cases.findSimilar", { question: args.question, limit: 10 }, (input) =>
    args.finqaCases.findSimilar(input.question, input.limit)
  );
  const filing = await recorder.call("finqa_resolve.pickFiling", { question: args.question, candidates }, (input) =>
    finqa_resolve.pickFiling(input)
  );
  const requirements = inferRevenueShareRequirement(args.question, filing);
  const result = await recorder.call(
    "finqa_cases.runRevenueShare",
    {
      filename: filing.filename,
      segment: requirements.segment,
      denominator: requirements.denominator,
      years: requirements.years,
      includeChange: requirements.includeChange
    },
    (input) => args.finqaCases.runRevenueShare(input)
  );

  recorder.setResult(result);
  await recorder.save(args.baseDir);
  const draft = await createRevenueShareDraft({
    trajectory: recorder.snapshot,
    filing,
    requirements,
    result,
    baseDir: args.baseDir
  });

  return {
    mode: "novel",
    answer: result.answer,
    roundedAnswer: result.roundedAnswer,
    trajectoryId: recorder.id,
    draftId: draft.id,
    calls: recorder.snapshot.calls,
    evidence: result.evidence,
    review: {
      status: draft.status,
      assumptions: draft.requirements.assumptions,
      nextActions: ["confirm", "specify", "yes", "refuse"]
    }
  };
}

function negativeOutlookProcedureName(unitKind: DocumentUnitKind): "negative_outlook_references" | "negative_outlook_title_or_quote_references" {
  return unitKind === "title_or_quote" ? "negative_outlook_title_or_quote_references" : "negative_outlook_references";
}

function negativeOutlookCodificationQuestion(args: {
  question: string;
  unitKind: DocumentUnitKind;
  agentName: string;
}): string {
  return `${args.question}

Procedure derivation request:
intent: negative outlook references
unitKind: ${args.unitKind}
agentName: ${args.agentName}
input: { scoredUnits, units }

Generate only the deterministic glue function. It must consume scoredUnits produced by the reusable scorer agent, filter negative references, count them, and return structured evidence.`;
}

async function runNegativeOutlookQuery(args: {
  question: string;
  tenantId: string;
  baseDir: string;
  finqaCases: FinqaCasesPrimitive;
  unitKind: DocumentUnitKind;
  observerRuntime?: ObserverRuntime;
  outlookAgentRuntime?: OutlookAgentRuntime;
}): Promise<RunQueryResult> {
  const recorder = new TrajectoryRecorder({ tenantId: args.tenantId, question: args.question });
  const candidates = await recorder.call("finqa_cases.findSimilar", { question: args.question, limit: 10 }, (input) =>
    args.finqaCases.findSimilar(input.question, input.limit)
  );
  const filing = await recorder.call("finqa_resolve.pickFiling", { question: args.question, candidates }, (input) =>
    finqa_resolve.pickFiling(input)
  );
  const units = await recorder.call(
    args.unitKind === "title_or_quote" ? "document_units.titleOrQuoteUnits" : "document_units.sentences",
    { filename: filing.filename },
    () => (args.unitKind === "title_or_quote" ? document_units.titleOrQuoteUnits(filing) : document_units.sentences(filing))
  );

  const agentStore = new LocalAgentStore(args.baseDir);
  let spec = await recorder.call(
    "agent_store.findReusable",
    { capability: "negative_outlook_reference_scoring" as const },
    (input) => agentStore.findByCapability(args.tenantId, input.capability)
  );
  if (!spec) {
    spec = await recorder.call(
      "finqa_observe.createAgentPrimitive",
      { question: args.question, filename: filing.filename, unitCount: units.length },
      () =>
        finqa_observe.createAgentPrimitive(
          {
            question: args.question,
            filing,
            units,
            capability: "negative_outlook_reference_scoring"
          },
          args.observerRuntime ?? createObserverRuntime()
        )
    );
    const createdSpec = spec;
    await recorder.call("agent_store.save", { agentName: createdSpec.agentName }, () =>
      agentStore.save(args.tenantId, createdSpec)
    );
  }
  if (!spec) {
    throw new Error("No negative-outlook scorer agent is available");
  }

  const scoredUnits = await recorder.call(
    "finqa_outlook.scoreUnits",
    { agentName: spec.agentName, unitCount: units.length, target: "Visa", lens: "competitive_outlook" as const },
    (input) =>
      finqa_outlook.scoreUnits(
        {
          spec,
          units,
          target: input.target,
          lens: input.lens
        },
        args.outlookAgentRuntime ?? createOutlookAgentRuntime(spec.observer)
      )
  );
  const codified = await recorder.call(
    "finqa_observe.codifyTableFunction",
    { question: args.question, agentName: spec.agentName, unitKind: args.unitKind },
    () =>
      finqa_observe.codifyTableFunction(
        {
          question: negativeOutlookCodificationQuestion({
            question: args.question,
            unitKind: args.unitKind,
            agentName: spec.agentName
          }),
          filing,
          context: {
            reusableAgent: spec,
            unitKind: args.unitKind,
            inputShape: "{ scoredUnits: OutlookScore[], units: DocumentUnit[] }"
          }
        },
        args.observerRuntime ?? createObserverRuntime()
      )
  );
  const result = await recorder.call(
    "finqa_observe.executeCodifiedFunction",
    { functionName: codified.functionName, scoredUnitCount: scoredUnits.length },
    () => finqa_observe.executeCodifiedFunction(codified, { scoredUnits, units })
  );

  const procedureName = negativeOutlookProcedureName(args.unitKind);
  const procedure = buildNegativeOutlookProcedure({
    name: procedureName,
    intent: procedureName,
    tenantId: args.tenantId,
    question: args.question,
    sourceTrajectoryId: recorder.id,
    filename: filing.filename,
    target: "Visa",
    unitKind: args.unitKind,
    agentName: spec.agentName,
    codified
  });
  await recorder.call("procedure_store.save", { procedureName, agentName: spec.agentName }, () =>
    new LocalProcedureStore(args.baseDir).save(procedure)
  );

  recorder.setResult(result);
  await recorder.save(args.baseDir);

  return {
    mode: "novel",
    answer: result.answer,
    roundedAnswer: result.roundedAnswer,
    trajectoryId: recorder.id,
    procedureName,
    calls: recorder.snapshot.calls,
    evidence: result.evidence
  };
}
