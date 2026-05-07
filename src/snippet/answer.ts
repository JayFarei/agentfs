export type AnswerStatus = "answered" | "partial" | "unsupported";

export type AnswerIntentRelation =
  | "same"
  | "derived"
  | "sibling"
  | "drifted"
  | "unrelated";

export type AnswerIntent = {
  name?: string;
  description?: string;
  parent?: string;
  relation?: AnswerIntentRelation;
};

export type AnswerInput = {
  intent?: AnswerIntent;
  status: AnswerStatus;
  value?: unknown;
  unit?: string;
  evidence?: unknown;
  coverage?: unknown;
  derivation?: unknown;
  missing?: unknown;
  reason?: string;
};

export type AnswerEnvelope = AnswerInput & {
  createdAt: string;
};

export type AnswerValidation = {
  accepted: boolean;
  learnable: boolean;
  checks: {
    structuredAnswer: boolean;
    statusAllowed: boolean;
    valuePresent: boolean;
    evidencePresent: boolean;
    derivationVisible: boolean;
    unsupportedHasReason: boolean;
    lineagePresent: boolean;
    noDefaultZeroFallback: boolean;
    hiddenManipulationDetected: boolean;
  };
  blockers: string[];
};

const ANSWER_ENVELOPE_SYMBOL = Symbol.for("datafetch.answer");

export function makeAnswerEnvelope(input: AnswerInput): AnswerEnvelope {
  const envelope: AnswerEnvelope = {
    ...input,
    createdAt: new Date().toISOString(),
  };
  Object.defineProperty(envelope, ANSWER_ENVELOPE_SYMBOL, {
    value: true,
    enumerable: false,
  });
  return envelope;
}

export function isAnswerEnvelope(value: unknown): value is AnswerEnvelope {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<PropertyKey, unknown>;
  return record[ANSWER_ENVELOPE_SYMBOL] === true;
}

export function validateAnswerEnvelope(args: {
  value: unknown;
  lineageCallCount: number;
}): AnswerValidation {
  const structuredAnswer = isAnswerEnvelope(args.value);
  const answer: AnswerEnvelope | null = structuredAnswer
    ? (args.value as AnswerEnvelope)
    : null;
  const statusAllowed =
    answer !== null &&
    (answer.status === "answered" ||
      answer.status === "partial" ||
      answer.status === "unsupported");
  const valuePresent =
    answer?.status !== "answered" ||
    (answer.value !== undefined && answer.value !== null);
  const evidencePresent =
    answer === null
      ? false
      : answer.evidence !== undefined &&
        (!Array.isArray(answer.evidence) || answer.evidence.length > 0);
  const derivationVisible =
    answer?.status === "unsupported" || answer?.derivation !== undefined;
  const unsupportedHasReason =
    answer?.status !== "unsupported" ||
    Boolean(answer.reason) ||
    answer.missing !== undefined;
  const lineagePresent = args.lineageCallCount > 0;
  const noDefaultZeroFallback =
    answer?.status !== "answered" ||
    answer.value !== 0 ||
    answer.derivation !== undefined;
  const hiddenManipulationDetected = false;

  const checks = {
    structuredAnswer,
    statusAllowed,
    valuePresent,
    evidencePresent,
    derivationVisible,
    unsupportedHasReason,
    lineagePresent,
    noDefaultZeroFallback,
    hiddenManipulationDetected,
  };

  const blockers: string[] = [];
  if (!structuredAnswer) blockers.push("script did not return df.answer(...)");
  if (structuredAnswer && !statusAllowed) {
    blockers.push("answer status must be answered, partial, or unsupported");
  }
  if (structuredAnswer && !valuePresent) {
    blockers.push("answered status requires a non-null value");
  }
  if (structuredAnswer && !evidencePresent) {
    blockers.push("answer must include evidence");
  }
  if (structuredAnswer && !derivationVisible) {
    blockers.push("answered or partial status requires visible derivation");
  }
  if (structuredAnswer && !unsupportedHasReason) {
    blockers.push("unsupported status requires a reason or missing field");
  }
  if (structuredAnswer && !lineagePresent) {
    blockers.push("answer must be derived from recorded df.* calls");
  }
  if (structuredAnswer && !noDefaultZeroFallback) {
    blockers.push("answered value 0 requires visible derivation");
  }
  if (hiddenManipulationDetected) {
    blockers.push("hidden manipulation detected");
  }

  const accepted = blockers.length === 0;
  return {
    accepted,
    learnable: accepted,
    checks,
    blockers,
  };
}
