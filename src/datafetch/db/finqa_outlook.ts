import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DocumentUnit } from "./document_units.js";

const execFileAsync = promisify(execFile);

export type OutlookPolarity = "negative" | "neutral" | "positive" | "mixed";

export type OutlookScorerAgentSpec = {
  agentName: string;
  description: string;
  capability: "negative_outlook_reference_scoring";
  inputSchema: {
    unitText: "string";
    target: "string";
    lens: "competitive_outlook";
  };
  outputSchema: {
    isReference: "boolean";
    polarity: OutlookPolarity[];
    severity: "0|1|2|3";
    rationale: "string";
    evidence: "string";
  };
  prompt: string;
  observer: "fixture" | "flue";
};

export type OutlookScore = {
  unitId: string;
  unitText: string;
  isReference: boolean;
  polarity: OutlookPolarity;
  severity: 0 | 1 | 2 | 3;
  rationale: string;
  evidence: string;
};

export type OutlookAgentRuntime = {
  scoreUnit(args: {
    spec: OutlookScorerAgentSpec;
    unit: DocumentUnit;
    target: string;
    lens: "competitive_outlook";
  }): Promise<OutlookScore>;
};

export class FixtureOutlookAgentRuntime implements OutlookAgentRuntime {
  async scoreUnit(args: {
    unit: DocumentUnit;
  }): Promise<OutlookScore> {
    const text = args.unit.text.toLowerCase();
    const negativeSignals = [
      "competition",
      "compete",
      "competitors",
      "competitive networks",
      "emerging players",
      "directly",
      "substantial and intense",
      "leading positions",
      "local regulation"
    ].filter((signal) => text.includes(signal));
    const positiveSignals = ["largest retail electronic payments network", "largest operators"].filter((signal) =>
      text.includes(signal)
    );
    const isReference = negativeSignals.length > 0;
    const severity = Math.min(3, negativeSignals.length >= 3 ? 3 : negativeSignals.length >= 2 ? 2 : negativeSignals.length) as
      | 0
      | 1
      | 2
      | 3;
    return {
      unitId: args.unit.id,
      unitText: args.unit.text,
      isReference,
      polarity: isReference ? "negative" : positiveSignals.length > 0 ? "positive" : "neutral",
      severity,
      rationale: isReference
        ? `Contains competitive-outlook signal(s): ${negativeSignals.join(", ")}.`
        : "No negative competitive-outlook signal found.",
      evidence: isReference ? args.unit.text : ""
    };
  }
}

export class FlueOutlookAgentRuntime implements OutlookAgentRuntime {
  async scoreUnit(args: {
    spec: OutlookScorerAgentSpec;
    unit: DocumentUnit;
    target: string;
    lens: "competitive_outlook";
  }): Promise<OutlookScore> {
    const result = await runFlueJson("finqa-outlook-scorer", args);
    return normalizeOutlookScore(result, args.unit);
  }
}

export function createOutlookAgentRuntime(kind = process.env.ATLASFS_OUTLOOK_AGENT ?? "fixture"): OutlookAgentRuntime {
  if (kind === "flue") {
    return new FlueOutlookAgentRuntime();
  }
  return new FixtureOutlookAgentRuntime();
}

export const finqa_outlook = {
  async scoreUnits(
    args: {
      spec: OutlookScorerAgentSpec;
      units: DocumentUnit[];
      target: string;
      lens: "competitive_outlook";
    },
    runtime: OutlookAgentRuntime = createOutlookAgentRuntime(args.spec.observer)
  ): Promise<OutlookScore[]> {
    return Promise.all(
      args.units.map((unit) =>
        runtime.scoreUnit({
          spec: args.spec,
          unit,
          target: args.target,
          lens: args.lens
        })
      )
    );
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
  return parseFlueJson(stdout, agent);
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

function normalizeOutlookScore(value: unknown, unit: DocumentUnit): OutlookScore {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { text?: unknown }).text === "string"
  ) {
    return normalizeOutlookScore(
      JSON.parse(extractJsonText((value as { text: string }).text, "finqa-outlook-scorer")),
      unit
    );
  }
  const score = value as Partial<OutlookScore>;
  const severity = typeof score.severity === "number" ? Math.max(0, Math.min(3, Math.round(score.severity))) : 0;
  const polarity = score.polarity && ["negative", "neutral", "positive", "mixed"].includes(score.polarity)
    ? score.polarity
    : "neutral";
  return {
    unitId: unit.id,
    unitText: unit.text,
    isReference: Boolean(score.isReference),
    polarity,
    severity: severity as 0 | 1 | 2 | 3,
    rationale: typeof score.rationale === "string" ? score.rationale : "",
    evidence: typeof score.evidence === "string" ? score.evidence : ""
  };
}
