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
  answer: number;
  roundedAnswer: number;
  label: string;
  evidence: unknown[];
};

export class FixtureObserverRuntime implements ObserverRuntime {
  async codifyTableFunction(): Promise<CodifiedTableFunction> {
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
- Return { answer: number, roundedAnswer: number, label: string, evidence: unknown[] }.
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
    typeof result.answer !== "number" ||
    typeof result.roundedAnswer !== "number" ||
    typeof result.label !== "string"
  ) {
    throw new Error(`Observer function returned invalid result: ${JSON.stringify(result)}`);
  }

  return {
    ...result,
    evidence: Array.isArray(result.evidence) ? result.evidence : [result.evidence]
  };
}
