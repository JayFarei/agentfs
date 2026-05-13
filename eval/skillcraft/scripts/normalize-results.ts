import { promises as fsp } from "node:fs";
import path from "node:path";

type Arm = "skillcraft-base" | "skillcraft-skill" | "skillcraft-static-reuse" | "datafetch-learned";

interface Args {
  nativeRun?: string;
  datafetchRun?: string;
  out: string;
}

interface NormalizedRow {
  taskKey: string;
  canonicalTaskKey: string;
  family: string;
  level: string;
  phase: "train" | "warm" | "hard" | "unknown";
  arm: Arm;
  officialPassed: boolean;
  passedGe70: boolean;
  statusPassGe90: boolean;
  officialStatus: string | null;
  officialScorePercent: number;
  scorerSource: "official-evaluator" | "answer-fallback";
  runtimeStatus: string | null;
  bridgeStatus: string | null;
  adapterReady: boolean | null;
  tokens: number | null;
  effectiveTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  llmRequests: number | null;
  toolCalls: number | null;
  skillSaveCalls: number | null;
  skillExecuteCalls: number | null;
  learnedInterfaceCalls: number | null;
  learnedInterfacesAvailable: number | null;
  learnedInterfacesCreated: number | null;
  reuseRate: number | null;
  regressionsPassed: boolean | null;
  promotedToLibCache: boolean | null;
  artifactPath: string | null;
  sourceProtocol: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    out: path.resolve("eval/skillcraft/results/normalized-results.jsonl"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--native-run") args.nativeRun = path.resolve(argv[++index]);
    else if (arg.startsWith("--native-run=")) args.nativeRun = path.resolve(arg.slice("--native-run=".length));
    else if (arg === "--datafetch-run") args.datafetchRun = path.resolve(argv[++index]);
    else if (arg.startsWith("--datafetch-run=")) args.datafetchRun = path.resolve(arg.slice("--datafetch-run=".length));
    else if (arg === "--out") args.out = path.resolve(argv[++index]);
    else if (arg.startsWith("--out=")) args.out = path.resolve(arg.slice("--out=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows: NormalizedRow[] = [];
  if (args.nativeRun) rows.push(...await normalizeNativeRun(args.nativeRun));
  if (args.datafetchRun) rows.push(...await normalizeDatafetchRun(args.datafetchRun));
  if (!rows.length) {
    throw new Error("no rows normalized; pass --native-run and/or --datafetch-run");
  }
  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  console.log(`Wrote ${rows.length} normalized rows to ${args.out}`);
}

async function normalizeNativeRun(runDir: string): Promise<NormalizedRow[]> {
  const files = await findFiles(runDir, /^test_results_.*\.json$/);
  const rows: NormalizedRow[] = [];
  for (const file of files) {
    const payload = JSON.parse(await fsp.readFile(file, "utf8"));
    const results = Array.isArray(payload.results) ? payload.results : [];
    for (const entry of results) {
      const task = String(entry.task ?? "");
      const parsed = parseTaskKey(task);
      if (!parsed) continue;
      rows.push(...nativeModeRows(entry, parsed, file));
    }
  }
  return rows;
}

function nativeModeRows(entry: any, parsed: { taskKey: string; family: string; level: string }, sourceFile: string): NormalizedRow[] {
  const modes: Array<[Arm, string]> = [
    ["skillcraft-base", "base_mode"],
    ["skillcraft-skill", "skill_mode"],
  ];
  const rows: NormalizedRow[] = [];
  for (const [arm, key] of modes) {
    if (!entry[key]) continue;
    rows.push(fromNativeMode(parsed, arm, entry[key], sourceFile));
  }
  if (entry.static_reuse_mode) {
    rows.push(fromNativeMode(parsed, "skillcraft-static-reuse", entry.static_reuse_mode, sourceFile));
  }
  return rows;
}

function fromNativeMode(parsed: { taskKey: string; family: string; level: string }, arm: Arm, mode: any, sourceFile: string): NormalizedRow {
  const stats = mode.key_stats ?? {};
  const cost = mode.agent_cost ?? {};
  const officialStatus = stringOrNull(mode.eval_status);
  const score = numberOr(mode.eval_score_percent, mode.eval_score?.percent, 0);
  const officialPassed = Boolean(mode.eval_pass ?? mode.success);
  return {
    ...parsed,
    canonicalTaskKey: parsed.taskKey,
    phase: phaseForLevel(parsed.level),
    arm,
    officialPassed,
    passedGe70: officialPassed,
    statusPassGe90: officialStatus === "pass" || score >= 90,
    officialStatus,
    officialScorePercent: score,
    scorerSource: typeof mode.eval_score_percent === "number" || mode.eval_score ? "official-evaluator" : "answer-fallback",
    runtimeStatus: null,
    bridgeStatus: null,
    adapterReady: null,
    tokens: numberOrNull(stats.total_tokens),
    effectiveTokens: numberOrNull(stats.total_tokens),
    inputTokens: numberOrNull(stats.input_tokens),
    outputTokens: numberOrNull(stats.output_tokens),
    costUsd: numberOrNull(cost.total_cost),
    latencyMs: null,
    llmRequests: numberOrNull(stats.agent_llm_requests),
    toolCalls: numberOrNull(stats.tool_calls),
    skillSaveCalls: numberOrNull(mode.save_skill_calls),
    skillExecuteCalls: numberOrNull(mode.execute_skill_calls),
    learnedInterfaceCalls: null,
    learnedInterfacesAvailable: null,
    learnedInterfacesCreated: null,
    reuseRate: null,
    regressionsPassed: null,
    promotedToLibCache: null,
    artifactPath: stringOrNull(mode.agent_workspace) ?? sourceFile,
    sourceProtocol: "native-skillcraft",
  };
}

async function normalizeDatafetchRun(runDir: string): Promise<NormalizedRow[]> {
  const resultFile = await firstExisting([
    path.join(runDir, "results.json"),
    path.join(runDir, "results.partial.json"),
  ]);
  const payload = resultFile
    ? JSON.parse(await fsp.readFile(resultFile, "utf8"))
    : { episodes: await readEpisodesJsonl(path.join(runDir, "episodes.jsonl")) };
  const episodes = Array.isArray(payload.episodes) ? payload.episodes : [];
  const sourceProtocol = typeof payload.sourceProtocol === "string"
    ? payload.sourceProtocol
    : "datafetch-episodes";
  return episodes
    .filter((episode: any) => episode.mode === "datafetch")
    .map((episode: any) => {
      const taskKey = typeof episode.taskKey === "string"
        ? episode.taskKey
        : `datafetch/${episode.taskFamily}/${episode.round}/${episode.taskId}`;
      const parsed = parseTaskKey(taskKey);
      const canonicalTaskKey = parsed?.taskKey ?? taskKey;
      const level = String(episode.level ?? episode.round);
      const score = numberOr(episode.officialScorePercent, episode.officialScore?.percent, episode.answerCorrect ? 100 : 0);
      const officialStatus = episode.officialStatus ?? episode.answerStatus ?? null;
      // Goal-3 iter14 normalizer fix: the "agent-exit + 0 llm-calls + 0
      // tokens" heuristic that flagged rows as infrastructure_error
      // over-triggers when the snippet ran cleanly and the official
      // evaluator scored the output. Specifically: the agent can timeout
      // (agentExitCode=143 SIGTERM) AFTER writing a valid scripts/answer.ts
      // whose run produced a real output file; the evaluator then scores
      // the file fairly. Demoting those rows to infrastructure_error
      // cost the iter14 full-126 ~15pp of measured pass rate. Treat the
      // agent exit as an infrastructure failure only when the snippet
      // ALSO failed or the evaluator rejected the output.
      const evalAcceptedOutput =
        numberOrNull(episode.snippetExitCode) === 0 &&
        (Boolean(episode.officialPassed) ||
          (numberOrNull(episode.officialScorePercent) ?? 0) >= 70);
      const infrastructureFailure =
        episode.agentFailureKind === "model_usage_limit" ||
        officialStatus === "infrastructure_error" ||
        (
          !evalAcceptedOutput &&
          numberOrNull(episode.agentExitCode) !== null &&
          episode.agentExitCode !== 0 &&
          numberOrNull(episode.llmCalls) === 0 &&
          numberOrNull(episode.totalTokens) === 0
        );
      const runtimeStatus = infrastructureFailure
        ? "infrastructure_error"
        : numberOrNull(episode.snippetExitCode) !== null && episode.snippetExitCode !== 0
          ? "runtime_error"
          : null;
      const officialPassed = runtimeStatus === null && Boolean(episode.officialPassed ?? episode.answerCorrect);
      return {
        taskKey,
        canonicalTaskKey,
        family: String(episode.family ?? episode.taskFamily),
        level,
        phase: episode.phase ?? phaseForLevel(level),
        arm: "datafetch-learned" as Arm,
        officialPassed,
        passedGe70: officialPassed,
        statusPassGe90: runtimeStatus === null && (officialStatus === "pass" || score >= 90),
        officialStatus,
        officialScorePercent: score,
        scorerSource: typeof episode.officialScorePercent === "number" || episode.officialScore ? "official-evaluator" : "answer-fallback",
        runtimeStatus,
        bridgeStatus: episode.bridgeStatus ?? null,
        adapterReady: typeof payload.adapterReady === "boolean" ? payload.adapterReady : null,
        tokens: numberOrNull(episode.totalTokens),
        effectiveTokens: numberOrNull(episode.effectiveTokens),
        inputTokens: numberOrNull(episode.agentInputTokens),
        outputTokens: numberOrNull(episode.agentOutputTokens),
        costUsd: null,
        latencyMs: numberOrNull(episode.elapsedMs),
        llmRequests: numberOrNull(episode.llmCalls),
        toolCalls: numberOrNull(episode.toolCalls),
        skillSaveCalls: null,
        skillExecuteCalls: null,
        learnedInterfaceCalls: numberOrNull(episode.libFunctionsUsed),
        learnedInterfacesAvailable: numberOrNull(episode.libFunctionsAvailable),
        learnedInterfacesCreated: numberOrNull(episode.libFunctionsCreated),
        reuseRate: numberOrNull(episode.reuseRate),
        regressionsPassed: episode.regressionsPassed ?? null,
        promotedToLibCache: typeof episode.promotedToLibCache === "boolean" ? episode.promotedToLibCache : null,
        artifactPath: episode.artifactPath ?? resultFile ?? runDir,
        sourceProtocol,
      };
    });
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const filePath of paths) {
    try {
      await fsp.access(filePath);
      return filePath;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function readEpisodesJsonl(filePath: string): Promise<unknown[]> {
  const text = await fsp.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function parseTaskKey(task: string): { taskKey: string; family: string; level: string } | null {
  const parts = task.split("/");
  const offset = parts[0] === "tasks" ? 1 : 0;
  if (parts[offset] !== "scaled_tasks" || !parts[offset + 1] || !parts[offset + 2]) return null;
  return {
    taskKey: `scaled_tasks/${parts[offset + 1]}/${parts[offset + 2]}`,
    family: parts[offset + 1],
    level: parts[offset + 2],
  };
}

function phaseForLevel(level: string): NormalizedRow["phase"] {
  if (level === "e1") return "train";
  if (level === "h1") return "hard";
  if (["e2", "e3", "m1", "m2"].includes(level)) return "warm";
  return "unknown";
}

async function findFiles(root: string, pattern: RegExp): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (pattern.test(entry.name)) found.push(next);
    }
  }
  await walk(root);
  return found.sort();
}

function numberOr(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
