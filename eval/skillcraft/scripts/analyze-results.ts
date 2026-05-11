import { promises as fsp } from "node:fs";
import path from "node:path";

interface Args {
  input: string;
  out: string;
}

interface Row {
  taskKey: string;
  canonicalTaskKey?: string;
  family: string;
  level: string;
  phase?: string;
  arm: string;
  officialPassed: boolean;
  passedGe70?: boolean;
  statusPassGe90?: boolean;
  officialScorePercent: number;
  scorerSource?: string;
  runtimeStatus?: string | null;
  tokens?: number | null;
  effectiveTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  toolCalls?: number | null;
  learnedInterfaceCalls?: number | null;
  learnedInterfacesAvailable?: number | null;
  learnedInterfacesCreated?: number | null;
  reuseRate?: number | null;
  promotedToLibCache?: boolean | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: path.resolve("eval/skillcraft/results/normalized-results.jsonl"),
    out: path.resolve("eval/skillcraft/reports/analysis.json"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--input") args.input = path.resolve(argv[++index]);
    else if (arg.startsWith("--input=")) args.input = path.resolve(arg.slice("--input=".length));
    else if (arg === "--out") args.out = path.resolve(argv[++index]);
    else if (arg.startsWith("--out=")) args.out = path.resolve(arg.slice("--out=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = (await fsp.readFile(args.input, "utf8"))
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row);
  const analysis = {
    generatedAt: new Date().toISOString(),
    input: args.input,
    rowCount: rows.length,
    arms: aggregateArms(rows),
    levels: aggregateBy(rows, "level"),
    phases: aggregateBy(rows, "phase"),
    families: aggregateBy(rows, "family"),
    coverage: coverage(rows),
    pairedContrasts: [
      pairedContrast(rows, "datafetch-learned", "skillcraft-base"),
      pairedContrast(rows, "datafetch-learned", "skillcraft-skill"),
    ],
  };
  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, JSON.stringify(analysis, null, 2) + "\n");
  console.log(`Wrote analysis to ${args.out}`);
}

function aggregateArms(rows: Row[]) {
  return aggregateBy(rows, "arm");
}

function aggregateBy(rows: Row[], key: "arm" | "family" | "level" | "phase") {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = String(row[key] ?? "unknown");
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, group]) => [
    name,
    {
      count: group.length,
      passRate: mean(group.map((row) => row.officialPassed ? 1 : 0)),
      statusPassRateGe90: mean(group.map((row) => row.statusPassGe90 ? 1 : 0)),
      avgScore: mean(group.map((row) => row.officialScorePercent)),
      avgTokens: meanDefined(group.map((row) => row.tokens)),
      avgEffectiveTokens: meanDefined(group.map((row) => row.effectiveTokens)),
      avgCostUsd: meanDefined(group.map((row) => row.costUsd)),
      avgLatencyMs: meanDefined(group.map((row) => row.latencyMs)),
      avgToolCalls: meanDefined(group.map((row) => row.toolCalls)),
      avgLearnedInterfaceCalls: meanDefined(group.map((row) => row.learnedInterfaceCalls)),
      avgLearnedInterfacesAvailable: meanDefined(group.map((row) => row.learnedInterfacesAvailable)),
      avgLearnedInterfacesCreated: meanDefined(group.map((row) => row.learnedInterfacesCreated)),
      avgReuseRate: meanDefined(group.map((row) => row.reuseRate)),
      passCount: group.filter((row) => row.officialPassed).length,
      runtimeErrorCount: group.filter((row) => row.runtimeStatus === "runtime_error").length,
      infrastructureErrorCount: group.filter((row) => row.runtimeStatus === "infrastructure_error").length,
      phaseBreakdown: phaseBreakdown(group),
      runtimeErrorRate: mean(group.map((row) => row.runtimeStatus === "runtime_error" ? 1 : 0)),
      infrastructureErrorRate: mean(group.map((row) => row.runtimeStatus === "infrastructure_error" ? 1 : 0)),
      officialEvaluatorCoverage: mean(group.map((row) => row.scorerSource === "official-evaluator" ? 1 : 0)),
    },
  ]));
}

function phaseBreakdown(rows: Row[]) {
  const phases = ["train", "warm", "hard", "unknown"];
  return Object.fromEntries(phases.map((phase) => {
    const group = rows.filter((row) => (row.phase ?? "unknown") === phase);
    return [phase, {
      count: group.length,
      passed: group.filter((row) => row.officialPassed).length,
      passRate: group.length ? mean(group.map((row) => row.officialPassed ? 1 : 0)) : null,
      avgScore: group.length ? mean(group.map((row) => row.officialScorePercent)) : null,
      runtimeErrors: group.filter((row) => row.runtimeStatus === "runtime_error").length,
      infrastructureErrors: group.filter((row) => row.runtimeStatus === "infrastructure_error").length,
    }];
  }));
}

function pairedContrast(rows: Row[], treatmentArm: string, controlArm: string) {
  const byTask = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.canonicalTaskKey ?? row.taskKey;
    byTask.set(key, [...(byTask.get(key) ?? []), row]);
  }
  const pairs = [...byTask.entries()].flatMap(([taskKey, taskRows]) => {
    const treatment = taskRows.find((row) => row.arm === treatmentArm);
    const control = taskRows.find((row) => row.arm === controlArm);
    return treatment && control ? [{ taskKey, treatment, control }] : [];
  });
  if (pairs.length === 0) {
    return {
      treatmentArm,
      controlArm,
      pairedTasks: 0,
      passRateDelta: null,
      passDiscordance: {
        treatmentOnlyPasses: 0,
        controlOnlyPasses: 0,
      },
      scoreDelta: {
        mean: null,
        ci95: null,
      },
      effectiveTokenRatio: ratioSummary([]),
      latencyRatio: ratioSummary([]),
      toolCallRatio: ratioSummary([]),
    };
  }
  const scoreDeltas = pairs.map((pair) => pair.treatment.officialScorePercent - pair.control.officialScorePercent);
  const passDiscordance = {
    treatmentOnlyPasses: pairs.filter((pair) => pair.treatment.officialPassed && !pair.control.officialPassed).length,
    controlOnlyPasses: pairs.filter((pair) => !pair.treatment.officialPassed && pair.control.officialPassed).length,
  };
  return {
    treatmentArm,
    controlArm,
    pairedTasks: pairs.length,
    passRateDelta: mean(pairs.map((pair) => (pair.treatment.officialPassed ? 1 : 0) - (pair.control.officialPassed ? 1 : 0))),
      passDiscordance,
      scoreDelta: {
        mean: mean(scoreDeltas),
        ci95: bootstrapCi(scoreDeltas),
      },
    effectiveTokenRatio: ratioSummary(pairs.map((pair) => [pair.treatment.effectiveTokens, pair.control.effectiveTokens])),
    latencyRatio: ratioSummary(pairs.map((pair) => [pair.treatment.latencyMs, pair.control.latencyMs])),
    toolCallRatio: ratioSummary(pairs.map((pair) => [pair.treatment.toolCalls, pair.control.toolCalls])),
  };
}

function coverage(rows: Row[]) {
  const arms = [...new Set(rows.map((row) => row.arm))].sort();
  const byArm = Object.fromEntries(arms.map((arm) => {
    const armRows = rows.filter((row) => row.arm === arm);
    return [arm, {
      rows: armRows.length,
      tasks: new Set(armRows.map((row) => row.canonicalTaskKey ?? row.taskKey)).size,
      officialScoredRows: armRows.filter((row) => row.scorerSource === "official-evaluator").length,
      runtimeErrorRows: armRows.filter((row) => row.runtimeStatus === "runtime_error").length,
    }];
  }));
  return {
    arms,
    byArm,
    pairedTaskCounts: {
      "datafetch-learned_vs_skillcraft-base": pairedCount(rows, "datafetch-learned", "skillcraft-base"),
      "datafetch-learned_vs_skillcraft-skill": pairedCount(rows, "datafetch-learned", "skillcraft-skill"),
    },
  };
}

function pairedCount(rows: Row[], leftArm: string, rightArm: string): number {
  const byTask = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = row.canonicalTaskKey ?? row.taskKey;
    if (!byTask.has(key)) byTask.set(key, new Set());
    byTask.get(key)?.add(row.arm);
  }
  return [...byTask.values()].filter((arms) => arms.has(leftArm) && arms.has(rightArm)).length;
}

function ratioSummary(values: Array<[number | null | undefined, number | null | undefined]>) {
  const ratios = values
    .filter(([treatment, control]) => typeof treatment === "number" && typeof control === "number" && control > 0)
    .map(([treatment, control]) => (treatment as number) / (control as number));
  return {
    count: ratios.length,
    mean: ratios.length ? mean(ratios) : null,
    ci95: bootstrapCi(ratios),
  };
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanDefined(values: Array<number | null | undefined>): number | null {
  const defined = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return defined.length ? mean(defined) : null;
}

function bootstrapCi(values: number[], reps = 2000): [number, number] | null {
  if (!values.length) return null;
  const samples: number[] = [];
  let seed = 123456789;
  for (let rep = 0; rep < reps; rep += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      total += values[seed % values.length];
    }
    samples.push(total / values.length);
  }
  samples.sort((left, right) => left - right);
  return [samples[Math.floor(samples.length * 0.025)], samples[Math.floor(samples.length * 0.975)]];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
