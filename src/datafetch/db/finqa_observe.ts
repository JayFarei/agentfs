import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import type { FinqaCase } from "../../finqa/types.js";
import type { DocumentUnit } from "./document_units.js";
import type { OutlookScorerAgentSpec } from "./finqa_outlook.js";

const execFileAsync = promisify(execFile);

export type CodifyTableFunctionArgs = {
  question: string;
  filing: FinqaCase;
  context?: unknown;
};

export type CodifiedTableFunction = {
  functionName: string;
  source: string;
  description: string;
  observer: "fixture" | "anthropic" | "flue";
};

export type CreateAgentPrimitiveArgs = {
  question: string;
  filing: FinqaCase;
  units: DocumentUnit[];
  capability: "negative_outlook_reference_scoring";
};

export type ObserverRuntime = {
  createAgentPrimitive(args: CreateAgentPrimitiveArgs): Promise<OutlookScorerAgentSpec>;
  codifyTableFunction(args: CodifyTableFunctionArgs): Promise<CodifiedTableFunction>;
  /**
   * Plan an off-script question into an ordered ExecutionPlan, identifying any
   * primitives that need to be minted before execution. Optional — runtimes
   * that don't implement this throw a clear "not yet wired" error.
   */
  planTrajectory?(args: import("../../planner/types.js").PlanTrajectoryArgs):
    Promise<import("../../planner/types.js").PlanTrajectoryResult>;
  /**
   * Codify a deterministic TS function for a missing primitive identified by
   * the planner. The function body must declare a function whose name matches
   * the suffix of `name` after the last `.`.
   */
  codifyFunction?(args: CodifyFunctionArgs): Promise<CodifiedFunction>;
};

export type CodifyFunctionArgs = {
  name: string;          // e.g. "stats.stddev"
  signature: string;     // e.g. "stddev(values: number[]): number"
  description: string;
  exampleInput?: unknown;
  exampleOutput?: unknown;
};

export type CodifiedFunction = {
  name: string;
  source: string;
  description: string;
  observer: "fixture" | "anthropic" | "flue";
};

export type ObserverResult = {
  answer: number | string;
  roundedAnswer?: number;
  label: string;
  evidence: unknown[];
};

export class FixtureObserverRuntime implements ObserverRuntime {
  async createAgentPrimitive(): Promise<OutlookScorerAgentSpec> {
    return fixtureNegativeOutlookAgentSpec("fixture");
  }

  async planTrajectory(
    args: import("../../planner/types.js").PlanTrajectoryArgs
  ): Promise<import("../../planner/types.js").PlanTrajectoryResult> {
    return fixturePlanTrajectory(args);
  }

  async codifyFunction(args: CodifyFunctionArgs): Promise<CodifiedFunction> {
    return fixtureCodifyFunction(args);
  }

  async codifyTableFunction(args: CodifyTableFunctionArgs): Promise<CodifiedTableFunction> {
    if (isRevenueShareCodification(args.question)) {
      return fixtureRevenueShareFunction(args.question);
    }
    if (isNegativeOutlookGlueCodification(args.question)) {
      return fixtureNegativeOutlookGlueFunction(args.question);
    }

    return {
      functionName: "largestAveragePaymentVolumePerTransaction",
      description:
        "Find the row with the highest payments_volume_billions / total_transactions_billions ratio.",
      observer: "fixture",
      source: `function largestAveragePaymentVolumePerTransaction(filing) {
  let best = null;
  const isPaymentVolume = (cell) => cell.columnKey.includes("payment") && cell.columnKey.includes("volume");
  const isTransactions = (cell) => cell.columnKey.includes("transaction");
  for (const row of filing.table.rows) {
    const numerator = row.cells.find(isPaymentVolume);
    const denominator = row.cells.find(isTransactions);
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

function isNegativeOutlookGlueCodification(question: string): boolean {
  const q = question.toLowerCase();
  return q.includes("procedure derivation request") && q.includes("negative outlook") && q.includes("scoredunits");
}

function fixtureNegativeOutlookGlueFunction(question: string): CodifiedTableFunction {
  const unitKind = reviewedValue(question, "unitKind") ?? "sentence";
  const functionName = unitKind === "title_or_quote" ? "selectNegativeOutlookTitleReferences" : "selectNegativeOutlookReferences";
  const label =
    unitKind === "title_or_quote"
      ? "negative competitive outlook title or quote references"
      : "negative competitive outlook sentence references";
  return {
    functionName,
    description: `Select and count ${label} from reusable scorer output.`,
    observer: "fixture",
    source: `function ${functionName}(input) {
  const scoredUnits = Array.isArray(input.scoredUnits) ? input.scoredUnits : [];
  const matches = scoredUnits
    .filter((score) => score && score.isReference && score.polarity === "negative")
    .sort((a, b) => (b.severity || 0) - (a.severity || 0));
  return {
    answer: matches.length + " " + ${JSON.stringify(label)},
    roundedAnswer: matches.length,
    label: ${JSON.stringify(label)},
    evidence: matches.map((score) => ({
      unitId: score.unitId,
      unitText: score.unitText,
      severity: score.severity,
      rationale: score.rationale,
      evidence: score.evidence
    }))
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

  async createAgentPrimitive(args: CreateAgentPrimitiveArgs): Promise<OutlookScorerAgentSpec> {
    const message = await this.client.messages.create({
      model: this.opts.model ?? process.env.ATLASFS_OBSERVER_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 900,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: agentPrimitivePrompt(args)
        }
      ]
    });

    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim();
    return normalizeAgentPrimitiveJson(text, "flue");
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
  async createAgentPrimitive(args: CreateAgentPrimitiveArgs): Promise<OutlookScorerAgentSpec> {
    const result = await runFlueJsonAgent("finqa-outlook-agent-factory", args);
    return normalizeAgentPrimitiveJson(JSON.stringify(result), "flue");
  }

  async codifyTableFunction(args: CodifyTableFunctionArgs): Promise<CodifiedTableFunction> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "atlasfs-flue-observer-"));
    const payloadFile = path.join(tempDir, "payload.json");
    const outputDir = path.join(
      process.cwd(),
      "node_modules",
      ".cache",
      "atlasfs-flue",
      `finqa-observer-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const envFile = path.join(process.cwd(), ".env");
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
        "--output",
        outputDir,
        "--env",
        envFile
      ],
      {
        cwd: process.cwd(),
        env,
        maxBuffer: 1024 * 1024 * 10
      }
    );

    return normalizeObserverJson(JSON.stringify(parseFlueJson(stdout, "finqa-observer")), "flue");
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
  async createAgentPrimitive(
    args: CreateAgentPrimitiveArgs,
    runtime: ObserverRuntime = createObserverRuntime()
  ): Promise<OutlookScorerAgentSpec> {
    return runtime.createAgentPrimitive(args);
  },

  async codifyTableFunction(
    args: CodifyTableFunctionArgs,
    runtime: ObserverRuntime = createObserverRuntime()
  ): Promise<CodifiedTableFunction> {
    return runtime.codifyTableFunction(args);
  },

  executeCodifiedFunction(codified: CodifiedTableFunction, filing: FinqaCase | unknown): ObserverResult {
    const factory = new Function(
      "filing",
      `${codified.source}
return ${codified.functionName}(filing);`
    ) as (filing: unknown) => ObserverResult;
    return normalizeObserverResult(factory(filing));
  }
};

function observerPrompt(args: CodifyTableFunctionArgs): string {
  return `You are an observer agent in AtlasFS. Your job is to codify a reusable TypeScript function for an intermediate table-reasoning step.

Design posture:
- Prefer small, general, composable functions in the spirit of the Unix philosophy.
- Make each generated function do one clear job over typed inputs and outputs.
- Avoid overfitting to the exact wording of one query when a reusable primitive-shaped function can solve a family of related intents.
- Keep generated code free of hidden I/O, imports, global state, and persistence. Return structured artifacts; the host persists them.
- When specialized agents are involved, generate glue that composes their typed outputs instead of folding all reasoning into one opaque function.

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

Additional derivation context:
${JSON.stringify(args.context ?? null, null, 2)}

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

// ---- Off-script planner fixtures ----------------------------------------
//
// The MVP demo question is "what is the standard deviation of {row} revenue
// from {y0} to {y1}, in millions?" — when the planner sees a stddev/variance
// question, it returns a 6-step plan that locates each year's value via
// finqa_resolve.locateFigure and feeds them to a freshly minted stats.stddev.
//
// For a richer LLM-backed planner, the Anthropic / Flue runtimes would emit
// a similar plan structure but generated dynamically from the capabilities
// list and the question. The shape stays the same.

const STAT_PRIMITIVES: Record<string, { signature: string; description: string; source: string }> = {
  "stats.stddev": {
    signature: "stddev(values: number[]): number",
    description: "Population standard deviation of an array of numeric values.",
    source: `function stddev(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("stddev requires a non-empty numeric array");
  }
  const nums = values.map(Number).filter((v) => Number.isFinite(v));
  if (nums.length === 0) throw new Error("stddev: no finite numbers");
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}`
  },
  "stats.variance": {
    signature: "variance(values: number[]): number",
    description: "Population variance of an array of numeric values.",
    source: `function variance(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("variance requires a non-empty numeric array");
  }
  const nums = values.map(Number).filter((v) => Number.isFinite(v));
  if (nums.length === 0) throw new Error("variance: no finite numbers");
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  return nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
}`
  },
  "stats.median": {
    signature: "median(values: number[]): number",
    description: "Median of an array of numeric values.",
    source: `function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("median requires a non-empty numeric array");
  }
  const sorted = values.map(Number).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("median: no finite numbers");
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}`
  }
};

function pickStatPrimitive(question: string): string | null {
  const q = question.toLowerCase();
  if (/\bstd\s*dev|standard deviation|stddev\b/.test(q)) return "stats.stddev";
  if (/\bvariance\b/.test(q)) return "stats.variance";
  if (/\bmedian\b/.test(q)) return "stats.median";
  return null;
}

function extractRowLabel(question: string): string {
  // Map question keywords to actual row labels in the loaded FinQA filings.
  // The UNP freight-revenue table rows are: chemicals, coal, agricultural
  // products, automotive, intermodal, industrial products.
  const q = question.toLowerCase();
  const ROW_MAP: Array<[RegExp, string]> = [
    [/\bchemicals?\b/, "chemicals"],
    [/\bcoal\b/, "coal"],
    [/\bagricultural?\b|\bagriculture\b/, "agricultural products"],
    [/\bautomotive\b/, "automotive"],
    [/\bintermodal\b/, "intermodal"],
    [/\bindustrial\b/, "industrial products"],
  ];
  for (const [re, label] of ROW_MAP) {
    if (re.test(q)) return label;
  }
  // Fallback: first noun-like word before "revenue"
  const m = q.match(/(\w+)\s+revenue/);
  return m?.[1] ?? "chemicals";
}

function extractYears(question: string): string[] {
  const range = question.match(/\b(20\d{2})\s*(?:[-–]|to)\s*(20\d{2})\b/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const years: string[] = [];
    for (let y = lo; y <= hi; y += 1) years.push(String(y));
    return years;
  }
  const found = Array.from(new Set(question.match(/\b20\d{2}\b/g) ?? []));
  return found.length > 0 ? found : ["2014", "2015", "2016"];
}

function fixturePlanTrajectory(
  args: import("../../planner/types.js").PlanTrajectoryArgs
): import("../../planner/types.js").PlanTrajectoryResult {
  const stat = pickStatPrimitive(args.question);
  if (!stat) {
    throw new Error(
      `FixtureObserverRuntime.planTrajectory only supports stat questions (stddev/variance/median); got: ${args.question}`
    );
  }
  const rowLabel = extractRowLabel(args.question);
  const years = extractYears(args.question);

  const steps: import("../../planner/types.js").PlanStep[] = [
    {
      primitive: "finqa_cases.findSimilar",
      bindings: {
        query: { kind: "input", name: "question" },
        limit: { kind: "literal", value: 10 }
      },
      produces: "candidates"
    },
    {
      primitive: "finqa_resolve.pickFiling",
      bindings: {
        question: { kind: "input", name: "question" },
        candidates: { kind: "step", index: 0 }
      },
      produces: "filing"
    }
  ];

  // One locateFigure step per year
  for (const year of years) {
    steps.push({
      primitive: "finqa_resolve.locateFigure",
      bindings: {
        question: { kind: "input", name: "question" },
        filing: { kind: "step", index: 1 },
        rowLabel: { kind: "literal", value: rowLabel },
        columnHint: { kind: "literal", value: year }
      },
      produces: `${rowLabel}_${year}`
    });
  }

  // The final stat call: pack each locateFigure's `value` into an array
  const valueRefs: import("../../planner/types.js").JsonRef[] = years.map((_, i) => ({
    kind: "step",
    index: 2 + i,
    path: "value"
  }));
  steps.push({
    primitive: stat,
    bindings: {
      values: { kind: "array", items: valueRefs }
    },
    produces: stat.split(".").pop() ?? "result"
  });

  const plan: import("../../planner/types.js").ExecutionPlan = {
    steps,
    finalStepIndex: steps.length - 1,
    rationale:
      `${stat} of ${rowLabel} revenue across ${years.join(", ")}. ` +
      `Locate each year's value, then apply the stat primitive.`
  };

  return {
    plan,
    gaps: [
      {
        name: stat,
        kind: "function",
        signature: STAT_PRIMITIVES[stat].signature,
        description: STAT_PRIMITIVES[stat].description
      }
    ]
  };
}

function fixtureCodifyFunction(args: CodifyFunctionArgs): CodifiedFunction {
  const builtin = STAT_PRIMITIVES[args.name];
  if (builtin) {
    return {
      name: args.name,
      source: builtin.source,
      description: args.description || builtin.description,
      observer: "fixture"
    };
  }
  throw new Error(
    `FixtureObserverRuntime.codifyFunction has no canned implementation for "${args.name}". ` +
      `Add it to STAT_PRIMITIVES or use the anthropic/flue observer.`
  );
}

function fixtureNegativeOutlookAgentSpec(observer: "fixture" | "flue"): OutlookScorerAgentSpec {
  return {
    agentName: "negativeOutlookReferenceScorerAgent",
    description:
      "Scores a short document unit for negative competitive-outlook references about a target company.",
    capability: "negative_outlook_reference_scoring",
    inputSchema: {
      unitText: "string",
      target: "string",
      lens: "competitive_outlook"
    },
    outputSchema: {
      isReference: "boolean",
      polarity: ["negative", "neutral", "positive", "mixed"],
      severity: "0|1|2|3",
      rationale: "string",
      evidence: "string"
    },
    prompt:
      "Given one short document unit, decide whether it is a negative competitive-outlook reference about the target company. Prefer reusable criteria: competition, emerging entrants, direct competition, regulatory constraints, pressure, or adverse market dynamics.",
    observer
  };
}

function agentPrimitivePrompt(args: CreateAgentPrimitiveArgs): string {
  return `You are the AtlasFS observer. Create a reusable typed agent interface, not a one-off answer.

Design posture:
- Prefer a small, composable agent in the spirit of the Unix philosophy.
- The agent should score one short document unit at a time.
- The agent must be reusable across sentences, headings, quotes, and other future unit extractors.
- Do not specialize the interface to one exact sentence.
- The returned JSON must match the host interface exactly.
- Use agentName exactly: negativeOutlookReferenceScorerAgent.
- Keep prompt under 900 characters.
- Do not include markdown fences, examples, comments, or nested JSON inside prompt.
- The prompt must instruct the scorer to return exactly:
  { "isReference": boolean, "polarity": "negative"|"neutral"|"positive"|"mixed", "severity": 0|1|2|3, "rationale": string, "evidence": string }.

Capability:
${args.capability}

User question:
${args.question}

Candidate unit examples:
${JSON.stringify(args.units.slice(0, 5), null, 2)}

Return ONLY JSON with this schema:
{
  "agentName": "negativeOutlookReferenceScorerAgent",
  "description": "Scores one document unit for negative competitive-outlook references about a target company.",
  "prompt": "A short reusable scorer prompt matching the required output schema."
}`;
}

async function runFlueJsonAgent(agent: string, payloadData: unknown): Promise<unknown> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `atlasfs-${agent}-`));
  const payloadFile = path.join(tempDir, "payload.json");
  const outputDir = path.join(
    process.cwd(),
    "node_modules",
    ".cache",
    "atlasfs-flue",
    `${agent}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const envFile = path.join(process.cwd(), ".env");
  await writeFile(payloadFile, JSON.stringify(payloadData), "utf8");
  const payload = JSON.stringify({ payloadFile });
  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_KEY ?? ""
  };
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "exec",
      "flue",
      "run",
      agent,
      "--target",
      "node",
      "--id",
      `${agent}-${Date.now()}`,
      "--payload",
      payload,
      "--output",
      outputDir,
      "--env",
      envFile
    ],
    {
      cwd: process.cwd(),
      env,
      maxBuffer: 1024 * 1024 * 10
    }
  );
  return parseFlueJson(stdout, agent);
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

function normalizeAgentPrimitiveJson(text: string, observer: "fixture" | "flue"): OutlookScorerAgentSpec {
  const jsonText = extractJson(text);
  const parsed = JSON.parse(jsonText) as Partial<OutlookScorerAgentSpec>;
  if (!parsed.agentName || !parsed.description || !parsed.prompt) {
    throw new Error(`Observer returned incomplete agent primitive: ${jsonText}`);
  }
  return {
    agentName: parsed.agentName,
    description: parsed.description,
    capability: "negative_outlook_reference_scoring",
    inputSchema: {
      unitText: "string",
      target: "string",
      lens: "competitive_outlook"
    },
    outputSchema: {
      isReference: "boolean",
      polarity: ["negative", "neutral", "positive", "mixed"],
      severity: "0|1|2|3",
      rationale: "string",
      evidence: "string"
    },
    prompt: parsed.prompt,
    observer
  };
}

function extractJsonText(stdout: string, label: string): string {
  const resultBlocks = Array.from(stdout.matchAll(/---RESULT_START---\s*([\s\S]*?)---RESULT_END---/g));
  for (const match of resultBlocks.reverse()) {
    const candidate = stripFence(match[1] ?? "");
    if (isJson(candidate)) {
      return candidate;
    }
  }

  const fencedBlocks = Array.from(stdout.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  for (const match of fencedBlocks.reverse()) {
    const candidate = (match[1] ?? "").trim();
    if (isJson(candidate)) {
      return candidate;
    }
  }

  for (const candidate of jsonObjectCandidates(stdout).reverse()) {
    if (isJson(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not parse Flue JSON output for ${label}: ${stdout.slice(0, 1000)}`);
}

function parseFlueJson(stdout: string, label: string): unknown {
  const parsed = JSON.parse(extractJsonText(stdout, label)) as unknown;
  if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { text?: unknown }).text === "string"
  ) {
    return JSON.parse(extractJsonText((parsed as { text: string }).text, label));
  }
  return parsed;
}

function stripFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function jsonObjectCandidates(value: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
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
