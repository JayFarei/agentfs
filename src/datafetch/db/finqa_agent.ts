import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FinqaCase } from "../../finqa/types.js";

const execFileAsync = promisify(execFile);

export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed";

export type SentimentAgentSpec = {
  agentName: string;
  description: string;
  inputSchema: {
    documentText: "string";
    question: "string";
  };
  outputSchema: {
    sentiment: SentimentLabel[];
    confidence: "number";
    rationale: "string";
    evidence: "string[]";
  };
  prompt: string;
  observer: "fixture" | "flue";
};

export type SentimentResult = {
  sentiment: SentimentLabel;
  confidence: number;
  rationale: string;
  evidence: string[];
};

export type TaskAgentRuntime = {
  createSentimentAgentSpec(args: {
    question: string;
    filing: FinqaCase;
    documentText: string;
  }): Promise<SentimentAgentSpec>;
  runSentimentAgent(args: {
    spec: SentimentAgentSpec;
    question: string;
    documentText: string;
  }): Promise<SentimentResult>;
};

export class FixtureTaskAgentRuntime implements TaskAgentRuntime {
  async createSentimentAgentSpec(): Promise<SentimentAgentSpec> {
    return {
      agentName: "competitivePositioningSentimentAgent",
      description:
        "Classify the sentiment/tone of a financial document excerpt about competitive positioning.",
      inputSchema: {
        documentText: "string",
        question: "string"
      },
      outputSchema: {
        sentiment: ["positive", "neutral", "negative", "mixed"],
        confidence: "number",
        rationale: "string",
        evidence: "string[]"
      },
      prompt:
        "Read the document excerpt and classify the sentiment or tone of the company's competitive positioning. Return concise evidence quotes.",
      observer: "fixture"
    };
  }

  async runSentimentAgent(args: { documentText: string }): Promise<SentimentResult> {
    const text = args.documentText.toLowerCase();
    const positiveEvidence = [
      "visa is the largest retail electronic payments network in the world",
      "largest operators of open-loop and closed-loop retail electronic payments networks"
    ].filter((needle) => text.includes(needle));
    return {
      sentiment: positiveEvidence.length ? "positive" : "neutral",
      confidence: positiveEvidence.length ? 0.86 : 0.55,
      rationale:
        positiveEvidence.length > 0
          ? "The excerpt frames Visa as the largest global payments network and compares it favorably against competitors."
          : "The excerpt is mostly descriptive and does not contain strong sentiment signals.",
      evidence: positiveEvidence
    };
  }
}

export class FlueCliTaskAgentRuntime implements TaskAgentRuntime {
  async createSentimentAgentSpec(args: {
    question: string;
    filing: FinqaCase;
    documentText: string;
  }): Promise<SentimentAgentSpec> {
    const result = await runFlueJson("finqa-agent-factory", args);
    return normalizeSentimentAgentSpec(result);
  }

  async runSentimentAgent(args: {
    spec: SentimentAgentSpec;
    question: string;
    documentText: string;
  }): Promise<SentimentResult> {
    const result = await runFlueJson("finqa-task-agent", args);
    return normalizeSentimentResult(result);
  }
}

export function createTaskAgentRuntime(kind = process.env.ATLASFS_TASK_AGENT ?? "fixture"): TaskAgentRuntime {
  if (kind === "flue") {
    return new FlueCliTaskAgentRuntime();
  }
  return new FixtureTaskAgentRuntime();
}

export const finqa_agent = {
  documentText(filing: FinqaCase): string {
    return [...filing.preText, ...filing.postText].join("\n");
  },

  async createSentimentAgentSpec(
    args: { question: string; filing: FinqaCase; documentText?: string },
    runtime: TaskAgentRuntime = createTaskAgentRuntime()
  ): Promise<SentimentAgentSpec> {
    return runtime.createSentimentAgentSpec({
      question: args.question,
      filing: args.filing,
      documentText: args.documentText ?? this.documentText(args.filing)
    });
  },

  async runSentimentAgent(
    args: { spec: SentimentAgentSpec; question: string; documentText: string },
    runtime: TaskAgentRuntime = createTaskAgentRuntime()
  ): Promise<SentimentResult> {
    return runtime.runSentimentAgent(args);
  }
};

async function runFlueJson(agent: string, payloadData: unknown): Promise<unknown> {
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
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  if (first === -1 || last === -1) {
    throw new Error(`Could not parse Flue JSON output for ${agent}: ${stdout.slice(0, 1000)}`);
  }
  return JSON.parse(stdout.slice(first, last + 1));
}

function normalizeSentimentAgentSpec(value: unknown): SentimentAgentSpec {
  const spec = value as Partial<SentimentAgentSpec>;
  if (!spec.agentName || !spec.description || !spec.prompt) {
    throw new Error(`Invalid sentiment agent spec: ${JSON.stringify(value)}`);
  }
  return {
    agentName: spec.agentName,
    description: spec.description,
    inputSchema: {
      documentText: "string",
      question: "string"
    },
    outputSchema: {
      sentiment: ["positive", "neutral", "negative", "mixed"],
      confidence: "number",
      rationale: "string",
      evidence: "string[]"
    },
    prompt: spec.prompt,
    observer: spec.observer ?? "flue"
  };
}

function normalizeSentimentResult(value: unknown): SentimentResult {
  const result = value as Partial<SentimentResult>;
  if (
    !result.sentiment ||
    !["positive", "neutral", "negative", "mixed"].includes(result.sentiment) ||
    typeof result.confidence !== "number" ||
    typeof result.rationale !== "string"
  ) {
    throw new Error(`Invalid sentiment result: ${JSON.stringify(value)}`);
  }
  return {
    sentiment: result.sentiment,
    confidence: Math.max(0, Math.min(1, result.confidence)),
    rationale: result.rationale,
    evidence: Array.isArray(result.evidence) ? result.evidence.map(String) : []
  };
}
