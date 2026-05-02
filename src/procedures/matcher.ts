import type { ProcedureMatch, StoredProcedure } from "./types.js";

const knownCompanies = ["american express", "jcb", "visa inc", "mastercard", "discover", "diners club"];

export function isAveragePaymentVolumeIntent(question: string): boolean {
  const q = question.toLowerCase();
  return q.includes("average") && q.includes("payment volume") && q.includes("transaction") && !isLargestAveragePaymentVolumeIntent(question);
}

export function isLargestAveragePaymentVolumeIntent(question: string): boolean {
  const q = question.toLowerCase();
  return (
    (q.includes("highest") || q.includes("largest") || q.includes("biggest") || q.includes("maximum")) &&
    q.includes("average") &&
    q.includes("payment volume") &&
    q.includes("transaction")
  );
}

export function isDocumentSentimentIntent(question: string): boolean {
  const q = question.toLowerCase();
  return (
    (q.includes("sentiment") || q.includes("tone") || q.includes("positioning")) &&
    (q.includes("document") || q.includes("excerpt") || q.includes("visa") || q.includes("competitive"))
  );
}

export function isRevenueShareIntent(question: string): boolean {
  const q = question.toLowerCase();
  const asksForShare =
    q.includes("portion") || q.includes("percentage") || q.includes("percent") || q.includes("share");
  const mentionsRevenue = q.includes("revenue") || q.includes("revenues");
  const mentionsSegment =
    q.includes("agricultural") ||
    q.includes("agriculture") ||
    q.includes("coal") ||
    q.includes("chemical") ||
    q.includes("automotive") ||
    q.includes("intermodal") ||
    q.includes("industrial");
  return asksForShare && mentionsRevenue && mentionsSegment;
}

export function isTableMathIntent(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(range|change|difference)\b/.test(q) ||
    ((q.includes("percentage") || q.includes("percent") || q.includes("portion") || q.includes("share")) &&
      /\b20\d{2}\b/.test(q))
  );
}

export function isNegativeOutlookTitleOrQuoteIntent(question: string): boolean {
  const q = question.toLowerCase();
  return (
    isNegativeOutlookReferencesIntent(question) &&
    (q.includes("title") || q.includes("heading") || q.includes("quote") || q.includes("quoted"))
  );
}

export function isNegativeOutlookReferencesIntent(question: string): boolean {
  const q = question.toLowerCase();
  return (
    q.includes("negative") &&
    (q.includes("outlook") || q.includes("competitive") || q.includes("competition")) &&
    (q.includes("reference") || q.includes("references") || q.includes("evidence")) &&
    q.includes("visa")
  );
}

export function extractCompany(question: string): string | null {
  const q = question.toLowerCase();
  for (const company of knownCompanies) {
    if (q.includes(company)) {
      return company === "visa inc" ? "visa inc. ( 1 )" : company;
    }
  }

  const match = q.match(/for\s+([a-z][a-z0-9 .&-]+?)(?:\?|$)/);
  return match?.[1]?.trim() ?? null;
}

function isUnsupportedStatIntent(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(std\s*dev|stddev|standard deviation|variance|median|mean of)\b/.test(q);
}

function fingerprintQuestion(question: string, filename: string): string {
  const norm = question
    .toLowerCase()
    .replace(/\b(20\d{2}|in millions?|in thousands?|in billions?)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  let h = 0x811c9dc5;
  const input = `${norm}|${filename}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function matchProcedure(question: string, procedures: StoredProcedure[]): ProcedureMatch | null {
  // Statistical questions (stddev/variance/median/mean of) divert to the
  // planner *before* table_math could mis-claim them. Replay also goes via
  // the fingerprint matcher below.
  const isStat = isUnsupportedStatIntent(question);

  const intent = isStat
    ? "planned_chain"
    : isLargestAveragePaymentVolumeIntent(question)
      ? "largest_average_payment_volume_per_transaction"
    : isNegativeOutlookTitleOrQuoteIntent(question)
      ? "negative_outlook_title_or_quote_references"
    : isNegativeOutlookReferencesIntent(question)
      ? "negative_outlook_references"
    : isDocumentSentimentIntent(question)
      ? "document_sentiment"
    : isRevenueShareIntent(question)
      ? "revenue_share"
    : isTableMathIntent(question)
      ? "table_math"
    : isAveragePaymentVolumeIntent(question)
      ? "average_payment_volume_per_transaction"
      : null;

  // Planned-chain matcher: fingerprint the normalised question + filename.
  // If a saved planned_chain has the same fingerprint, replay it.
  if (intent === "planned_chain") {
    for (const candidate of procedures) {
      if (candidate.implementation.kind !== "planned_chain") continue;
      const fp = candidate.matcher.questionFingerprint;
      if (!fp) continue;
      if (fingerprintQuestion(question, candidate.params.filename) === fp) {
        return { procedure: candidate, company: "__all__" };
      }
    }
    return null;
  }

  if (!intent) {
    return null;
  }

  const procedure = procedures.find((candidate) => candidate.matcher.intent === intent);
  const company = intent === "average_payment_volume_per_transaction" ? extractCompany(question) : "__all__";
  if (!procedure || !company) {
    return null;
  }

  return { procedure, company };
}
