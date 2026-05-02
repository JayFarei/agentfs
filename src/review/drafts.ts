import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FinqaCase } from "../finqa/types.js";
import type {
  FinqaCasesPrimitive,
  RevenueShareArgs,
  RevenueShareResult
} from "../datafetch/db/finqa_cases.js";
import { finqa_observe, type ObserverRuntime } from "../datafetch/db/finqa_observe.js";
import type { TrajectoryRecord } from "../trajectory/recorder.js";
import { atlasfsHome } from "../trajectory/recorder.js";
import { buildRevenueShareProcedure, LocalProcedureStore } from "../procedures/store.js";

export type DraftStatus = "awaiting_review" | "awaiting_commit" | "committed" | "refused";

export type RevenueShareRequirement = {
  segment: string;
  denominator: string;
  years: string[];
  includeChange: boolean;
  assumptions: string[];
  userSpecifications: string[];
};

export type ProcedureDraft = {
  id: string;
  trajectoryId: string;
  tenantId: string;
  question: string;
  intent: "revenue_share";
  filename: string;
  status: DraftStatus;
  requirements: RevenueShareRequirement;
  result: RevenueShareResult;
  createdAt: string;
  updatedAt: string;
  committedProcedureName?: string;
};

export type ReviewAction = "confirm" | "specify" | "yes" | "refuse";

export type ReviewEvent = {
  id: string;
  draftId: string;
  trajectoryId: string;
  action: ReviewAction;
  message?: string;
  createdAt: string;
};

export type ReviewResult = {
  draft: ProcedureDraft;
  event: ReviewEvent;
  procedure?: {
    jsonPath: string;
    tsPath: string;
  };
};

function eventId(now = new Date()): string {
  return `rev_${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`;
}

function draftPath(baseDir: string, draftId: string): string {
  return path.join(baseDir, "drafts", `${draftId}.json`);
}

function reviewEventPath(baseDir: string, draftId: string): string {
  return path.join(baseDir, "review-events", `${draftId}.jsonl`);
}

async function saveDraft(draft: ProcedureDraft, baseDir = atlasfsHome()): Promise<void> {
  const dir = path.join(baseDir, "drafts");
  await mkdir(dir, { recursive: true });
  await writeFile(draftPath(baseDir, draft.id), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
}

async function appendReviewEvent(event: ReviewEvent, baseDir = atlasfsHome()): Promise<void> {
  const dir = path.join(baseDir, "review-events");
  await mkdir(dir, { recursive: true });
  await appendFile(reviewEventPath(baseDir, event.draftId), `${JSON.stringify(event)}\n`, "utf8");
}

function parseYears(text: string): string[] {
  const q = text.toLowerCase();
  const range = q.match(/\b(20\d{2})\s*[-\u2013]\s*(20\d{2})\b/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const years: string[] = [];
    const step = start <= end ? 1 : -1;
    for (let year = start; step > 0 ? year <= end : year >= end; year += step) {
      years.push(String(year));
    }
    return years.reverse();
  }

  return Array.from(new Set(q.match(/\b20\d{2}\b/g) ?? []));
}

function defaultYear(filing: FinqaCase): string {
  const year = filing.table.headerKeys.find((key) => /^20\d{2}$/.test(key));
  if (!year) {
    throw new Error(`No year column found in ${filing.filename}`);
  }
  return year;
}

function inferSegment(text: string): string {
  const q = text.toLowerCase();
  if (q.includes("coal")) {
    return "coal";
  }
  if (q.includes("chemical")) {
    return "chemicals";
  }
  if (q.includes("automotive")) {
    return "automotive";
  }
  if (q.includes("intermodal")) {
    return "intermodal";
  }
  if (q.includes("industrial")) {
    return "industrial products";
  }
  return "agricultural products";
}

function inferDenominator(text: string): string | null {
  const q = text.toLowerCase();
  if (q.includes("freight")) {
    return "total freight revenues";
  }
  if (q.includes("operating")) {
    return "total operating revenues";
  }
  return null;
}

export function inferRevenueShareRequirement(question: string, filing: FinqaCase): RevenueShareRequirement {
  const years = parseYears(question);
  const denominator = inferDenominator(question);
  const assumptions: string[] = [];
  if (years.length === 0) {
    assumptions.push(`No year was specified, so the draft uses ${defaultYear(filing)}.`);
  }
  if (!denominator) {
    assumptions.push("Revenue denominator was ambiguous, so the draft uses total operating revenues.");
  }

  return {
    segment: inferSegment(question),
    denominator: denominator ?? "total operating revenues",
    years: years.length > 0 ? years : [defaultYear(filing)],
    includeChange: false,
    assumptions,
    userSpecifications: []
  };
}

function applySpecification(
  current: RevenueShareRequirement,
  message: string,
  filing: FinqaCase
): RevenueShareRequirement {
  const requestedYears = parseYears(message);
  const denominator = inferDenominator(message);
  const wantsComparison = /\b(compare|change|against|versus|vs\.?|difference)\b/i.test(message);
  const wantsAddition = /\b(also|include|against|compare|change)\b/i.test(message);
  const years =
    requestedYears.length === 0
      ? current.years
      : wantsAddition
        ? Array.from(new Set([...current.years, ...requestedYears]))
        : requestedYears;

  const availableYears = filing.table.headerKeys.filter((key) => /^20\d{2}$/.test(key));
  const orderedYears = availableYears.filter((year) => years.includes(year));
  if (orderedYears.length !== years.length) {
    throw new Error(`Specification references year(s) not present in ${filing.filename}: ${years.join(", ")}`);
  }

  return {
    segment: inferSegment(message) === "agricultural products" && !/agricultur/i.test(message) ? current.segment : inferSegment(message),
    denominator: denominator ?? current.denominator,
    years: orderedYears,
    includeChange: current.includeChange || wantsComparison,
    assumptions: current.assumptions,
    userSpecifications: [...current.userSpecifications, message]
  };
}

function toRevenueShareArgs(draft: ProcedureDraft): RevenueShareArgs {
  return {
    filename: draft.filename,
    segment: draft.requirements.segment,
    denominator: draft.requirements.denominator,
    years: draft.requirements.years,
    includeChange: draft.requirements.includeChange
  };
}

function reviewedCodificationQuestion(draft: ProcedureDraft): string {
  return `${draft.question}

Reviewed requirements:
segment: ${draft.requirements.segment}
denominator: ${draft.requirements.denominator}
years: ${draft.requirements.years.join(", ")}
includeChange: ${draft.requirements.includeChange}

Codify the final reviewed procedure. The generated function should not ask follow-up questions; it should encode the reviewed requirements above.`;
}

async function filingForDraft(draft: ProcedureDraft, finqaCases: FinqaCasesPrimitive): Promise<FinqaCase> {
  const [filing] = await finqaCases.findExact({ filename: draft.filename }, 1);
  if (!filing) {
    throw new Error(`No filing found for ${draft.filename}`);
  }
  return filing;
}

export async function createRevenueShareDraft(args: {
  trajectory: TrajectoryRecord;
  filing: FinqaCase;
  requirements: RevenueShareRequirement;
  result: RevenueShareResult;
  baseDir?: string;
}): Promise<ProcedureDraft> {
  const now = new Date().toISOString();
  const draft: ProcedureDraft = {
    id: args.trajectory.id,
    trajectoryId: args.trajectory.id,
    tenantId: args.trajectory.tenantId,
    question: args.trajectory.question,
    intent: "revenue_share",
    filename: args.filing.filename,
    status: "awaiting_review",
    requirements: args.requirements,
    result: args.result,
    createdAt: now,
    updatedAt: now
  };
  await saveDraft(draft, args.baseDir);
  return draft;
}

export async function readDraft(idOrPath: string, baseDir = atlasfsHome()): Promise<ProcedureDraft> {
  const file = idOrPath.endsWith(".json") ? idOrPath : draftPath(baseDir, idOrPath);
  return JSON.parse(await readFile(file, "utf8")) as ProcedureDraft;
}

export async function reviewRevenueShareDraft(args: {
  draftIdOrPath: string;
  action: ReviewAction;
  message?: string;
  baseDir?: string;
  finqaCases?: FinqaCasesPrimitive;
  observerRuntime?: ObserverRuntime;
}): Promise<ReviewResult> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const draft = await readDraft(args.draftIdOrPath, baseDir);
  const event: ReviewEvent = {
    id: eventId(),
    draftId: draft.id,
    trajectoryId: draft.trajectoryId,
    action: args.action,
    message: args.message,
    createdAt: new Date().toISOString()
  };

  if (draft.status === "refused" && args.action !== "refuse") {
    throw new Error(`Draft ${draft.id} was refused and cannot be committed or revised`);
  }
  if (draft.status === "committed" && args.action !== "yes") {
    throw new Error(`Draft ${draft.id} is already committed`);
  }

  if (args.action === "confirm") {
    draft.status = "awaiting_commit";
  } else if (args.action === "specify") {
    if (!args.message) {
      throw new Error("A specify review requires a guidance message");
    }
    if (!args.finqaCases) {
      throw new Error("A specify review requires a FinQA primitive so the revised draft can be re-run");
    }
    const filing = await filingForDraft(draft, args.finqaCases);
    draft.requirements = applySpecification(draft.requirements, args.message, filing);
    draft.result = await args.finqaCases.runRevenueShare(toRevenueShareArgs(draft));
    draft.status = "awaiting_commit";
  } else if (args.action === "yes") {
    if (draft.status === "refused") {
      throw new Error(`Draft ${draft.id} was refused and cannot be committed`);
    }
    if (!args.finqaCases || !args.observerRuntime) {
      throw new Error("Committing a review draft requires FinQA and observer runtimes so the final procedure can be codified");
    }
    const filing = await filingForDraft(draft, args.finqaCases);
    const codified = await finqa_observe.codifyTableFunction(
      {
        question: reviewedCodificationQuestion(draft),
        filing
      },
      args.observerRuntime
    );
    const codifiedResult = finqa_observe.executeCodifiedFunction(codified, filing);
    draft.result = {
      ...draft.result,
      answer: codifiedResult.answer,
      roundedAnswer: codifiedResult.roundedAnswer ?? draft.result.roundedAnswer,
      evidence: codifiedResult.evidence
    };
    const procedure = buildRevenueShareProcedure({
      tenantId: draft.tenantId,
      question: draft.question,
      sourceTrajectoryId: draft.trajectoryId,
      filename: draft.filename,
      segment: draft.requirements.segment,
      denominator: draft.requirements.denominator,
      years: draft.requirements.years,
      includeChange: draft.requirements.includeChange,
      codified
    });
    const saved = await new LocalProcedureStore(baseDir).save(procedure);
    draft.status = "committed";
    draft.committedProcedureName = procedure.name;
    draft.updatedAt = new Date().toISOString();
    await appendReviewEvent(event, baseDir);
    await saveDraft(draft, baseDir);
    return { draft, event, procedure: saved };
  } else if (args.action === "refuse") {
    draft.status = "refused";
  }

  draft.updatedAt = new Date().toISOString();
  await appendReviewEvent(event, baseDir);
  await saveDraft(draft, baseDir);
  return { draft, event };
}
