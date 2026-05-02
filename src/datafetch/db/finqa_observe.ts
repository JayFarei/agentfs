import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import type { FinqaCase } from "../../finqa/types.js";

const execFileAsync = promisify(execFile);

export type CodifyTableFunctionArgs = {
  question: string;
  filing: FinqaCase;
};

export type CodifiedTableFunction = {
  functionName: string;
  source: string;
  description: string;
  observer: "fixture" | "anthropic" | "flue";
};

export type ObserverRuntime = {
  codifyTableFunction(args: CodifyTableFunctionArgs): Promise<CodifiedTableFunction>;
};

export type ObserverResult = {
  answer: number | string;
  roundedAnswer?: number;
  label: string;
  evidence: unknown[];
};

export class FixtureObserverRuntime implements ObserverRuntime {
  async codifyTableFunction(args: CodifyTableFunctionArgs): Promise<CodifiedTableFunction> {
    if (isRevenueShareCodification(args.question)) {
      return fixtureRevenueShareFunction(args.question);
    }

    return {
      functionName: "largestAveragePaymentVolumePerTransaction",
      description:
        "Find the row with the highest payments_volume_billions / total_transactions_billions ratio.",
      observer: "fixture",
      source: `function largestAveragePaymentVolumePerTransaction(filing) {
  let best = null;
  for (const row of filing.table.rows) {
    const numerator = row.cells.find((cell) => cell.columnKey === "payments_volume_billions");
    const denominator = row.cells.find((cell) => cell.columnKey === "total_transactions_billions");
    if (!numerator || !denominator || numerator.value == null || denominator.value == null || denominator.value === 0) {
      continue;
    }
    const value = numerator.value / denominator.value;
    if (!best || value > best.answer) {
      best = {
        answer: value,
        roundedAnswer: Math.round(value * 100) / 100,
        label: row.label,
        evidence: [{
          rowLabel: row.label,
          numerator,
          denominator,
          formula: "payments_volume_billions / total_transactions_billions"
        }]
      };
    }
  }
  if (!best) {
    throw new Error("No payment-volume-per-transaction figures found");
  }
  return best;
}`
    };
  }
}

function isRevenueShareCodification(question: string): boolean {
  const q = question.toLowerCase();
  return q.includes("reviewed requirements") && q.includes("revenue") && q.includes("segment:");
}

function reviewedValue(question: string, key: string): string | null {
  const match = question.match(new RegExp(`${key}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function fixtureRevenueShareFunction(question: string): CodifiedTableFunction {
  const segment = reviewedValue(question, "segment") ?? "agricultural products";
  const denominator = reviewedValue(question, "denominator") ?? "total operating revenues";
  const years = (reviewedValue(question, "years") ?? "2016")
    .split(",")
    .map((year) => year.trim())
    .filter(Boolean);
  const includeChange = (reviewedValue(question, "includeChange") ?? "false").toLowerCase() === "true";

  return {
    functionName: "reviewedRevenueShare",
    description: `Compute ${segment} as a percentage of ${denominator} for ${years.join(", ")}.`,
    observer: "fixture",
    source: `function reviewedRevenueShare(filing) {
  const segment = ${JSON.stringify(segment)};
  const denominator = ${JSON.stringify(denominator)};
  const years = ${JSON.stringify(years)};
  const includeChange = ${JSON.stringify(includeChange)};
  const normalize = (value) => String(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  const aliases = {
    agriculture: "agricultural_products",
    agricultural: "agricultural_products",
    operating_revenue: "total_operating_revenues",
    operating_revenues: "total_operating_revenues",
    total_operating_revenue: "total_operating_revenues",
    freight_revenue: "total_freight_revenues",
    freight_revenues: "total_freight_revenues",
    total_freight_revenue: "total_freight_revenues"
  };
  const keyFor = (value) => aliases[normalize(value)] || normalize(value);
  const findRow = (label) => {
    const key = keyFor(label);
    const row = filing.table.rows.find((candidate) => candidate.labelKey === key);
    if (!row) {
      throw new Error("No row found for " + label);
    }
    return row;
  };
  const round2 = (value) => Math.round(value * 100) / 100;
  const formatPercent = (value) => round2(value).toFixed(2) + "%";
  const formatPoints = (value) => (round2(value) >= 0 ? "+" : "") + round2(value).toFixed(2) + " pp";
  const segmentRow = findRow(segment);
  const denominatorRow = findRow(denominator);
  const rows = years.map((year) => {
    const yearKey = normalize(year);
    const numerator = segmentRow.cells.find((cell) => cell.columnKey === yearKey);
    const denominatorCell = denominatorRow.cells.find((cell) => cell.columnKey === yearKey);
    if (!numerator || numerator.value == null || !denominatorCell || denominatorCell.value == null || denominatorCell.value === 0) {
      throw new Error("Missing values for " + year);
    }
    const percentage = numerator.value / denominatorCell.value * 100;
    return {
      year,
      numerator: numerator.value,
      denominator: denominatorCell.value,
      percentage,
      roundedPercentage: round2(percentage)
    };
  });
  const change = includeChange && rows.length >= 2 ? rows[0].percentage - rows[1].percentage : null;
  const answer = rows.length === 1 && change == null
    ? rows[0].percentage
    : rows.map((row) => row.year + ": " + formatPercent(row.percentage)).join("; ") + (change == null ? "" : "; change: " + formatPoints(change));
  return {
    answer,
    roundedAnswer: rows[0] ? rows[0].roundedPercentage : undefined,
    label: segment + " / " + denominator,
    evidence: [{
      filename: filing.filename,
      segment,
      denominator,
      years: rows,
      includeChange
    }]
  };
}`
  };
}

export class AnthropicObserverRuntime implements ObserverRuntime {
  private readonly client: Anthropic;

  constructor(
    private readonly opts: {
      apiKey?: string;
      model?: string;
    } = {}
  ) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_KEY;
    if (!apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY or ANTHROPIC_KEY for Anthropic observer runtime");
    }
    this.client = new Anthropic({ apiKey });
  }

  async codifyTableFunction(args: CodifyTableFunctionArgs): Promise<CodifiedTableFunction> {
    const message = await this.client.messages.create({
      model: this.opts.model ?? process.env.ATLASFS_OBSERVER_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 1600,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: observerPrompt(args)
        }
      ]
    });

    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim();
    return normalizeObserverJson(text, "anthropic");
  }
}

export class FlueCliObserverRuntime implements ObserverRuntime {
  async codifyTableFunction(args: CodifyTableFunctionArgs): Promise<CodifiedTableFunction> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-flue-observer-"));
    const payloadFile = path.join(tempDir, "payload.json");
    await writeFile(payloadFile, JSON.stringify(args), "utf8");

    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_KEY ?? ""
    };
    const payload = JSON.stringify({ payloadFile });
    const { stdout } = await execFileAsync(
      "pnpm",
      [
        "exec",
        "flue",
        "run",
        "finqa-observer",
        "--target",
        "node",
        "--id",
        `observer-${Date.now()}`,
        "--payload",
        payload,
        "--env",
        ".env"
      ],
      {
        cwd: process.cwd(),
        env,
        maxBuffer: 1024 * 1024 * 10
      }
    );

    const firstBrace = stdout.indexOf("{");
    const lastBrace = stdout.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error(`Could not parse Flue observer output: ${stdout.slice(0, 500)}`);
    }
    return normalizeObserverJson(stdout.slice(firstBrace, lastBrace + 1), "flue");
  }
}

export function createObserverRuntime(kind = process.env.ATLASFS_OBSERVER ?? "fixture"): ObserverRuntime {
  if (kind === "anthropic") {
    return new AnthropicObserverRuntime();
  }
  if (kind === "flue") {
    return new FlueCliObserverRuntime();
  }
  return new FixtureObserverRuntime();
}

export const finqa_observe = {
  async codifyTableFunction(
    args: CodifyTableFunctionArgs,
    runtime: ObserverRuntime = createObserverRuntime()
  ): Promise<CodifiedTableFunction> {
    return runtime.codifyTableFunction(args);
  },

  executeCodifiedFunction(codified: CodifiedTableFunction, filing: FinqaCase): ObserverResult {
    const factory = new Function(
      "filing",
      `${codified.source}
return ${codified.functionName}(filing);`
    ) as (filing: FinqaCase) => ObserverResult;
    return normalizeObserverResult(factory(filing));
  }
};

function observerPrompt(args: CodifyTableFunctionArgs): string {
  return `You are an observer agent in AtlasFS. Your job is to codify a reusable TypeScript function for an intermediate table-reasoning step.

Question:
${args.question}

Normalized filing table shape:
${JSON.stringify(
  {
    filename: args.filing.filename,
    headers: args.filing.table.headers,
    rowSample: args.filing.table.rows.slice(0, 8)
  },
  null,
  2
)}

Return ONLY JSON with this schema:
{
  "functionName": "camelCaseName",
  "description": "one sentence",
  "source": "function camelCaseName(filing) { ... }"
}

Rules:
- The source must be plain JavaScript/TypeScript compatible with new Function.
- Do not import packages.
- Use filing.table.rows and each row's cells.
- Return { answer: number | string, roundedAnswer?: number, label: string, evidence: unknown[] }.
- roundedAnswer must be a number when present. Omit it for a narrative/string answer if no single numeric answer applies.
- If reviewed requirements are present, encode those exact requirements in the generated function.
- When a reviewed denominator names a table row, use that row directly by labelKey; do not reconstruct it from other rows unless the row is absent.
- For this question, infer the needed formula from the words, then codify it.`;
}

function normalizeObserverJson(text: string, observer: "anthropic" | "flue"): CodifiedTableFunction {
  const jsonText = extractJson(text);
  const parsed = JSON.parse(jsonText) as Partial<CodifiedTableFunction>;
  if (!parsed.functionName || !parsed.source || !parsed.description) {
    throw new Error(`Observer returned incomplete codified function: ${jsonText}`);
  }
  return {
    functionName: parsed.functionName,
    source: parsed.source,
    description: parsed.description,
    observer
  };
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1) {
    throw new Error(`No JSON object found in observer response: ${text.slice(0, 500)}`);
  }
  return text.slice(first, last + 1);
}

function normalizeObserverResult(result: ObserverResult): ObserverResult {
  if (
    !result ||
    (typeof result.answer !== "number" && typeof result.answer !== "string") ||
    typeof result.label !== "string"
  ) {
    throw new Error(`Observer function returned invalid result: ${JSON.stringify(result)}`);
  }

  return {
    ...result,
    roundedAnswer:
      typeof result.roundedAnswer === "number"
        ? result.roundedAnswer
        : typeof result.answer === "number"
          ? Math.round(result.answer * 100) / 100
          : undefined,
    evidence: Array.isArray(result.evidence) ? result.evidence : [result.evidence]
  };
}
