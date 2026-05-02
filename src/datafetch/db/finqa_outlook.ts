import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FinqaCase } from "../../finqa/types.js";
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
  createOutlookScorerAgentSpec(args: {
    question: string;
    filing: FinqaCase;
    units: DocumentUnit[];
  }): Promise<OutlookScorerAgentSpec>;
  scoreUnit(args: {
    spec: OutlookScorerAgentSpec;
    unit: DocumentUnit;
    target: string;
    lens: "competitive_outlook";
  }): Promise<OutlookScore>;
};

export class FixtureOutlookAgentRuntime implements OutlookAgentRuntime {
  async createOutlookScorerAgentSpec(): Promise<OutlookScorerAgentSpec> {
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
      observer: "fixture"
    };
  }

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
  async createOutlookScorerAgentSpec(args: {
    question: string;
    filing: FinqaCase;
    units: DocumentUnit[];
  }): Promise<OutlookScorerAgentSpec> {
    const result = await runFlueJson("finqa-outlook-agent-factory", args);
    return normalizeOutlookScorerAgentSpec(result);
  }

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
  async createOutlookScorerAgentSpec(
    args: { question: string; filing: FinqaCase; units: DocumentUnit[] },
    runtime: OutlookAgentRuntime = createOutlookAgentRuntime()
  ): Promise<OutlookScorerAgentSpec> {
    return runtime.createOutlookScorerAgentSpec(args);
  },

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
      "--env",
      ".env"
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

function normalizeOutlookScorerAgentSpec(value: unknown): OutlookScorerAgentSpec {
  const spec = value as Partial<OutlookScorerAgentSpec>;
  if (!spec.agentName || !spec.description || !spec.prompt) {
    throw new Error(`Invalid outlook scorer agent spec: ${JSON.stringify(value)}`);
  }
  return {
    agentName: spec.agentName,
    description: spec.description,
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
    prompt: spec.prompt,
    observer: spec.observer ?? "flue"
  };
}

function normalizeOutlookScore(value: unknown, unit: DocumentUnit): OutlookScore {
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
