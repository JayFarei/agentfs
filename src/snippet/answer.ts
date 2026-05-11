export type AnswerStatus = "answered" | "partial" | "unsupported";

// Soft warning attached to the answer envelope when the recursive
// value scan finds too many placeholder strings ("Unknown", "None",
// "null", "N/A", "") or zero numeric fields. Mirrors the
// LOW_QUALITY_VALUES heuristic SkillCraft uses; doesn't block the
// answer (the evaluator still scores it), just surfaces a signal the
// agent can see on rehearsal runs through `pnpm datafetch:run`.
export type AnswerQualityWarning = {
  code: "low_quality_output";
  message: string;
  totalFields: number;
  placeholderFields: number;
  zeroNumericFields: number;
  examples: string[];
};

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
  qualityWarnings?: AnswerQualityWarning[];
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

// Strings that almost always indicate the agent's extraction logic
// missed the field rather than the field genuinely being absent. Ported
// from SkillCraft's `LOW_QUALITY_VALUES`. Treats the empty string as a
// placeholder too — a real string answer should never be "".
const PLACEHOLDER_STRINGS = new Set([
  "Unknown", "unknown", "UNKNOWN",
  "None", "none", "NONE",
  "null", "NULL",
  "N/A", "n/a", "NA",
  "",
]);

type QualityScan = {
  totalFields: number;
  placeholderFields: number;
  zeroNumericFields: number;
  examples: string[];
};

function scanQuality(
  value: unknown,
  path: string,
  scan: QualityScan,
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth) return;
  if (value === null) {
    scan.totalFields += 1;
    scan.placeholderFields += 1;
    if (scan.examples.length < 5) scan.examples.push(`${path}=null`);
    return;
  }
  if (typeof value === "string") {
    scan.totalFields += 1;
    if (PLACEHOLDER_STRINGS.has(value)) {
      scan.placeholderFields += 1;
      if (scan.examples.length < 5) scan.examples.push(`${path}=${JSON.stringify(value)}`);
    }
    return;
  }
  if (typeof value === "number") {
    scan.totalFields += 1;
    if (value === 0 && Number.isFinite(value)) {
      scan.zeroNumericFields += 1;
      if (scan.examples.length < 5) scan.examples.push(`${path}=0`);
    }
    return;
  }
  if (typeof value === "boolean") {
    scan.totalFields += 1;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      scan.totalFields += 1;
      scan.placeholderFields += 1;
      if (scan.examples.length < 5) scan.examples.push(`${path}=[]`);
      return;
    }
    for (let i = 0; i < value.length; i += 1) {
      scanQuality(value[i], `${path}[${i}]`, scan, depth + 1, maxDepth);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      scanQuality(child, path ? `${path}.${key}` : key, scan, depth + 1, maxDepth);
    }
    return;
  }
  // undefined / function / symbol / etc — count as a field but don't classify
  scan.totalFields += 1;
}

function checkAnswerQuality(value: unknown): AnswerQualityWarning[] {
  if (value === undefined) return [];
  const scan: QualityScan = {
    totalFields: 0,
    placeholderFields: 0,
    zeroNumericFields: 0,
    examples: [],
  };
  scanQuality(value, "value", scan, 0, 6);
  if (scan.totalFields === 0) return [];
  const problematic = scan.placeholderFields + scan.zeroNumericFields;
  const ratio = problematic / scan.totalFields;
  // Two trip conditions, matching the SkillCraft heuristic:
  //   1. Over half the fields are problematic.
  //   2. Almost every field is a placeholder string (extraction
  //      clearly missed; even one good value isn't enough to disprove).
  const tripsRatio = ratio > 0.5;
  const tripsAlmostAllPlaceholders =
    scan.totalFields > 2 && scan.placeholderFields >= scan.totalFields - 1;
  if (!tripsRatio && !tripsAlmostAllPlaceholders) return [];
  return [
    {
      code: "low_quality_output",
      message:
        `Output has ${scan.placeholderFields} placeholder field(s) ` +
        `(Unknown / None / null / N/A / "") and ${scan.zeroNumericFields} ` +
        `zero numeric field(s) out of ${scan.totalFields} total. The agent's ` +
        `extraction logic likely didn't match the actual data shape — ` +
        `probe the tool response with \`pnpm datafetch:run\` and fix before committing.`,
      totalFields: scan.totalFields,
      placeholderFields: scan.placeholderFields,
      zeroNumericFields: scan.zeroNumericFields,
      examples: scan.examples,
    },
  ];
}

export function makeAnswerEnvelope(input: AnswerInput): AnswerEnvelope {
  const qualityWarnings = checkAnswerQuality(input.value);
  const envelope: AnswerEnvelope = {
    ...input,
    createdAt: new Date().toISOString(),
    ...(qualityWarnings.length > 0 ? { qualityWarnings } : {}),
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
