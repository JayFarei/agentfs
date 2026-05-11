import { promises as fsp } from "node:fs";
import path from "node:path";

interface Args {
  analysis: string;
  taskIndex: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    analysis: path.resolve("eval/skillcraft/reports/analysis.json"),
    taskIndex: path.resolve("eval/skillcraft/manifests/task-index.json"),
    out: path.resolve("eval/skillcraft/reports/final-report.md"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--analysis") args.analysis = path.resolve(argv[++index]);
    else if (arg.startsWith("--analysis=")) args.analysis = path.resolve(arg.slice("--analysis=".length));
    else if (arg === "--task-index") args.taskIndex = path.resolve(argv[++index]);
    else if (arg.startsWith("--task-index=")) args.taskIndex = path.resolve(arg.slice("--task-index=".length));
    else if (arg === "--out") args.out = path.resolve(argv[++index]);
    else if (arg.startsWith("--out=")) args.out = path.resolve(arg.slice("--out=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const analysis = JSON.parse(await fsp.readFile(args.analysis, "utf8"));
  const taskIndex = JSON.parse(await fsp.readFile(args.taskIndex, "utf8"));
  const report = renderReport(analysis, taskIndex);
  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, report);
  console.log(`Wrote report to ${args.out}`);
}

function renderReport(analysis: any, taskIndex: any): string {
  const armRows = Object.entries(analysis.arms ?? {}).map(([arm, stats]: [string, any]) => [
    arm,
    String(stats.count),
    pct(stats.passRate),
    pct(stats.statusPassRateGe90),
    fixed(stats.avgScore),
    int(stats.avgEffectiveTokens),
    fixed(stats.avgCostUsd),
    int(stats.avgLatencyMs),
    fixed(stats.avgToolCalls),
    fixed(stats.avgReuseRate),
    pct(stats.runtimeErrorRate),
    pct(stats.infrastructureErrorRate),
  ]);
  const phaseRows = Object.entries(analysis.phases ?? {}).map(([phase, stats]: [string, any]) => [
    phase,
    String(stats.count),
    pct(stats.passRate),
    fixed(stats.avgScore),
    int(stats.avgEffectiveTokens),
    fixed(stats.avgReuseRate),
    fixed(stats.avgLearnedInterfacesAvailable),
    fixed(stats.avgLearnedInterfaceCalls),
    pct(stats.runtimeErrorRate),
    pct(stats.infrastructureErrorRate),
  ]);
  const familyRows = Object.entries(analysis.families ?? {}).map(([family, stats]: [string, any]) => [
    family,
    `${stats.passCount ?? Math.round((stats.passRate ?? 0) * (stats.count ?? 0))}/${stats.count ?? 0}`,
    pct(stats.statusPassRateGe90),
    fixed(stats.avgScore),
    phaseCell(stats.phaseBreakdown?.train),
    phaseCell(stats.phaseBreakdown?.warm),
    phaseCell(stats.phaseBreakdown?.hard),
    fixed(stats.avgReuseRate),
    `${stats.runtimeErrorCount ?? Math.round((stats.runtimeErrorRate ?? 0) * (stats.count ?? 0))}`,
    `${stats.infrastructureErrorCount ?? Math.round((stats.infrastructureErrorRate ?? 0) * (stats.count ?? 0))}`,
  ]);
  const contrastRows = (analysis.pairedContrasts ?? []).map((contrast: any) => [
    `${contrast.treatmentArm} vs ${contrast.controlArm}`,
    String(contrast.pairedTasks),
    signedPct(contrast.passRateDelta),
    ci(contrast.scoreDelta?.mean, contrast.scoreDelta?.ci95),
    ratio(contrast.effectiveTokenRatio),
    ratio(contrast.latencyRatio),
    ratio(contrast.toolCallRatio),
  ]);
  return [
    "# Datafetch x SkillCraft Full Evaluation Report",
    "",
    `Generated: ${analysis.generatedAt}`,
    "",
    "## Task Surface",
    "",
    `- Indexed tasks: ${taskIndex.summary?.tasks ?? "unknown"}`,
    `- Families: ${taskIndex.summary?.families ?? "unknown"}`,
    `- Missing task docs: ${taskIndex.summary?.missingTaskDocs ?? "unknown"}`,
    `- Missing evaluators: ${taskIndex.summary?.missingEvaluators ?? "unknown"}`,
    "",
    "## Arm Summary",
    "",
    table(["Arm", "Rows", "Pass >=70", "Status Pass >=90", "Avg Score", "Avg Effective Tokens", "Avg Cost", "Avg Latency", "Avg Tool Calls", "Avg Reuse", "Runtime Errors", "Infra Errors"], armRows),
    "",
    "## Phase Summary",
    "",
    table(["Phase", "Rows", "Pass >=70", "Avg Score", "Avg Effective Tokens", "Avg Reuse", "Avg Interfaces Available", "Avg Interface Calls", "Runtime Errors", "Infra Errors"], phaseRows),
    "",
    "## Family Summary",
    "",
    table(["Family", "Pass >=70", "Status Pass >=90", "Avg Score", "Train", "Warm", "Hard", "Avg Reuse", "Runtime Errors", "Infra Errors"], familyRows),
    "",
    "## Coverage",
    "",
    `- Datafetch vs SkillCraft base paired tasks: ${analysis.coverage?.pairedTaskCounts?.["datafetch-learned_vs_skillcraft-base"] ?? 0}`,
    `- Datafetch vs SkillCraft skill paired tasks: ${analysis.coverage?.pairedTaskCounts?.["datafetch-learned_vs_skillcraft-skill"] ?? 0}`,
    `- Official evaluator coverage: ${coverageLine(analysis.coverage)}`,
    `- Native paired comparison status: ${nativeStatus(analysis.coverage)}`,
    "",
    "## Paired Contrasts",
    "",
    table(["Contrast", "Pairs", "Pass Delta", "Score Delta 95% CI", "Effective Token Ratio", "Latency Ratio", "Tool Call Ratio"], contrastRows),
    "",
    "## Interpretation Rules",
    "",
    "- This is a pilot report unless every primary arm has the expected official SkillCraft task count and paired contrasts are non-zero.",
    "- `Pass >=70` follows SkillCraft's official `passed` threshold; `Status Pass >=90` follows the stricter status label.",
    "- Treat this report as significant only when paired task coverage is representative.",
    "- Datafetch wins only if correctness is non-inferior and efficiency improves on held-out warm/hard tasks.",
    "- Missing upstream task prompts or evaluator gaps must be resolved before using native SkillCraft results as final evidence.",
    "",
  ].join("\n");
}

function coverageLine(coverage: any): string {
  const byArm = coverage?.byArm ?? {};
  const parts = Object.entries(byArm).map(([arm, stats]: [string, any]) => {
    const rows = typeof stats.rows === "number" && stats.rows > 0 ? stats.rows : 0;
    const official = typeof stats.officialScoredRows === "number" ? stats.officialScoredRows : 0;
    return rows > 0 ? `${arm}: ${official}/${rows}` : `${arm}: 0/0`;
  });
  return parts.length ? parts.join(", ") : "unknown";
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function phaseCell(stats: any): string {
  if (!stats || !stats.count) return "0/0";
  return `${stats.passed}/${stats.count}`;
}

function nativeStatus(coverage: any): string {
  const basePairs = coverage?.pairedTaskCounts?.["datafetch-learned_vs_skillcraft-base"] ?? 0;
  const skillPairs = coverage?.pairedTaskCounts?.["datafetch-learned_vs_skillcraft-skill"] ?? 0;
  if (basePairs > 0 || skillPairs > 0) {
    return `paired rows present (base=${basePairs}, skill=${skillPairs})`;
  }
  return "blocked/not included; run native SkillCraft base+skill after provider preflight passes";
}

function pct(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "N/A";
}

function signedPct(value: number | null | undefined): string {
  return typeof value === "number" ? `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%` : "N/A";
}

function fixed(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "N/A";
}

function int(value: number | null | undefined): string {
  return typeof value === "number" ? String(Math.round(value)) : "N/A";
}

function ci(mean: number | null | undefined, bounds: [number, number] | null | undefined): string {
  if (typeof mean !== "number") return "N/A";
  if (!bounds) return fixed(mean);
  return `${fixed(mean)} [${fixed(bounds[0])}, ${fixed(bounds[1])}]`;
}

function ratio(summary: any): string {
  if (!summary || summary.count === 0 || typeof summary.mean !== "number") return "N/A";
  const bounds = summary.ci95;
  return bounds ? `${fixed(summary.mean)} [${fixed(bounds[0])}, ${fixed(bounds[1])}]` : fixed(summary.mean);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
