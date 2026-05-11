import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { readTrajectory, type TrajectoryRecord } from "../sdk/index.js";
import { installSnippetRuntime } from "../snippet/install.js";

const FULL_SKILLCRAFT_DATAFETCH_ADAPTER_READY = false;
const LEVEL_ORDER = ["e1", "e2", "e3", "m1", "m2", "h1"] as const;
const LEARN_FROM_LEVELS = new Set<string>(["e1"]);
const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_REASONING_EFFORT = "low";

// Backend selector. Defaults to codex for backwards compatibility with
// existing run-info.json artefacts. Set DATAFETCH_AGENT=claude to route
// every episode through `claude --print --output-format json` instead.
// The agent's surface (workspace, prompt, scripts/answer.ts contract) is
// identical across backends; this only swaps the LLM driver.
type AgentBackend = "codex" | "claude";
function resolveAgentBackend(): AgentBackend {
  const raw = (process.env["DATAFETCH_AGENT"] ?? "codex").trim().toLowerCase();
  if (raw === "claude") return "claude";
  return "codex";
}

interface Args {
  skillcraftDir: string;
  outDir: string;
  task?: string;
  families: string[];
  levels: string[];
  limit?: number;
  dryRun: boolean;
  fixtureSmoke: boolean;
  live: boolean;
  model?: string;
  reasoningEffort?: string;
  timeoutMs: number;
  snippetTimeoutMs: number;
  libCacheDir?: string;
  noLibCache: boolean;
  resume: boolean;
}

interface SkillCraftTask {
  taskKey: string;
  family: string;
  level: string;
  taskDir: string;
  taskConfigPath: string;
  taskDocPath: string;
  agentPromptPath: string;
  evaluatorPath: string;
  initialWorkspacePath?: string;
  groundtruthWorkspacePath?: string;
  expectedOutputFiles: string[];
  taskConfig: Record<string, unknown>;
}

interface EvaluatorResult {
  exitCode: number;
  elapsedMs: number;
  stdout: string;
  stderr: string;
  scoreJson: Record<string, unknown> | null;
}

interface AdapterEpisode {
  taskKey: string;
  taskFamily: string;
  family: string;
  taskId: string;
  round: string;
  level: string;
  mode: "datafetch";
  officialPassed: boolean;
  officialStatus: string | null;
  officialScorePercent: number;
  officialScore: unknown;
  answerCorrect: boolean;
  answerStatus: string;
  totalTokens: number | null;
  effectiveTokens: number | null;
  elapsedMs: number;
  llmCalls: number;
  toolCalls: number;
  libFunctionsUsed: number;
  libFunctionsAvailable: number;
  libFunctionsCreated: number;
  reuseRate: number;
  regressionsPassed: null;
  artifactPath: string;
  bridgeStatus: "fixture-evaluator-smoke" | "live-agent-experimental";
  agentExitCode?: number;
  snippetExitCode?: number;
  agentFailureKind?: "model_usage_limit" | "agent_error";
  phase: "train" | "warm" | "hard" | "unknown";
  promotedToLibCache: boolean;
  agentInputTokens?: number;
  agentCachedInputTokens?: number;
  agentOutputTokens?: number;
  agentReasoningTokens?: number;
  agentElapsedMs?: number;
}

interface ToolDescriptor {
  name: string;
  description: string;
  params_json_schema: Record<string, unknown>;
}

interface ToolCatalogEntry {
  bundle: string;
  tools: ToolDescriptor[];
}

interface AgentRun {
  workspaceDir: string;
  prompt: string;
  stdout: string;
  stderr: string;
  finalMessage: string;
  elapsedMs: number;
  exitCode: number;
  usage: AgentUsage;
}

interface AgentUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  llmCalls: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    skillcraftDir: path.resolve("eval/skillcraft/vendor/skillcraft"),
    outDir: path.resolve("eval/skillcraft/results/datafetch", runStamp()),
    families: [],
    levels: [],
    dryRun: false,
    fixtureSmoke: false,
    live: false,
    timeoutMs: Number(process.env["DF_SKILLCRAFT_FULL_TIMEOUT_MS"] ?? 600_000),
    snippetTimeoutMs: Number(process.env["DF_SKILLCRAFT_SNIPPET_TIMEOUT_MS"] ?? 180_000),
    noLibCache: false,
    resume: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--skillcraft-dir") args.skillcraftDir = path.resolve(argv[++index]);
    else if (arg.startsWith("--skillcraft-dir=")) args.skillcraftDir = path.resolve(arg.slice("--skillcraft-dir=".length));
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++index]);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(arg.slice("--out-dir=".length));
    else if (arg === "--task") args.task = normalizeTaskKey(argv[++index]);
    else if (arg.startsWith("--task=")) args.task = normalizeTaskKey(arg.slice("--task=".length));
    else if (arg === "--families") args.families = csv(argv[++index]);
    else if (arg.startsWith("--families=")) args.families = csv(arg.slice("--families=".length));
    else if (arg === "--levels") args.levels = csv(argv[++index]);
    else if (arg.startsWith("--levels=")) args.levels = csv(arg.slice("--levels=".length));
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--fixture-smoke") args.fixtureSmoke = true;
    else if (arg === "--live") args.live = true;
    else if (arg === "--model") args.model = argv[++index];
    else if (arg.startsWith("--model=")) args.model = arg.slice("--model=".length);
    else if (arg === "--reasoning") args.reasoningEffort = argv[++index];
    else if (arg.startsWith("--reasoning=")) args.reasoningEffort = arg.slice("--reasoning=".length);
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (arg.startsWith("--timeout-ms=")) args.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else if (arg === "--snippet-timeout-ms") args.snippetTimeoutMs = Number(argv[++index]);
    else if (arg.startsWith("--snippet-timeout-ms=")) args.snippetTimeoutMs = Number(arg.slice("--snippet-timeout-ms=".length));
    else if (arg === "--lib-cache-dir") args.libCacheDir = path.resolve(argv[++index]);
    else if (arg.startsWith("--lib-cache-dir=")) args.libCacheDir = path.resolve(arg.slice("--lib-cache-dir=".length));
    else if (arg === "--no-lib-cache") args.noLibCache = true;
    else if (arg === "--resume") args.resume = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tasks = await selectTasks(args);
  await fsp.mkdir(args.outDir, { recursive: true });
  const libCacheDir = args.noLibCache
    ? undefined
    : args.libCacheDir ?? path.join(args.outDir, "lib-cache");
  if (libCacheDir) await fsp.mkdir(libCacheDir, { recursive: true });

  const agentBackend = resolveAgentBackend();
  const resolvedModel =
    agentBackend === "claude"
      ? resolveClaudeModel(args.model)
      : resolveCodexModel(args.model, "DF_SKILLCRAFT_FULL_MODEL");
  const resolvedEffort =
    agentBackend === "claude"
      ? resolveClaudeEffort(args.reasoningEffort)
      : resolveCodexReasoningEffort(args.reasoningEffort, "DF_SKILLCRAFT_FULL_REASONING_EFFORT");
  const runInfo = {
    generatedAt: new Date().toISOString(),
    adapterReady: FULL_SKILLCRAFT_DATAFETCH_ADAPTER_READY,
    skillcraftDir: args.skillcraftDir,
    outDir: args.outDir,
    libCacheDir: libCacheDir ?? null,
    selectedTasks: tasks.length,
    mode: args.live ? "live-agent-experimental" : args.fixtureSmoke ? "fixture-smoke" : args.dryRun ? "dry-run" : "not-implemented",
    agent: agentBackend,
    model: resolvedModel,
    reasoningEffort: resolvedEffort,
    snippetTimeoutMs: args.snippetTimeoutMs,
  };
  await fsp.writeFile(path.join(args.outDir, "run-info.json"), `${JSON.stringify(runInfo, null, 2)}\n`);
  await fsp.writeFile(
    path.join(args.outDir, "planned-tasks.json"),
    `${JSON.stringify(tasks.map(taskSummary), null, 2)}\n`,
  );

  if (args.dryRun) {
    console.log(`[datafetch-skillcraft] planned ${tasks.length} task(s); wrote ${args.outDir}`);
    return;
  }

  if (!args.fixtureSmoke && !args.live) {
    throw new Error(
      [
        "Full Datafetch SkillCraft agent/tool bridge is not implemented yet.",
        "Use --dry-run to inspect selected tasks or --fixture-smoke to verify fixture mirroring and official evaluator invocation.",
      ].join(" "),
    );
  }

  const episodesJsonlPath = path.join(args.outDir, "episodes.jsonl");
  const episodes = args.resume
    ? await readExistingEpisodes(episodesJsonlPath)
    : [];
  const completedTaskKeys = new Set(episodes.map((episode) => episode.taskKey));
  if (!args.resume) {
    await fsp.writeFile(episodesJsonlPath, "");
  }
  for (const task of tasks) {
    if (completedTaskKeys.has(task.taskKey)) continue;
    const episode = await runEpisodeSafely({
      task,
      args,
      libCacheDir,
    });
    episodes.push(episode);
    await fsp.appendFile(episodesJsonlPath, `${JSON.stringify(episode)}\n`);
    await writeResultsFile({
      file: path.join(args.outDir, "results.partial.json"),
      runInfo,
      episodes,
    });
  }
  await writeResultsFile({
    file: path.join(args.outDir, "results.json"),
    runInfo,
    episodes,
  });
  console.log(`[datafetch-skillcraft] wrote ${episodes.length} row(s) to ${args.outDir}`);
}

async function readExistingEpisodes(filePath: string): Promise<AdapterEpisode[]> {
  let raw = "";
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const episodes: AdapterEpisode[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      episodes.push(JSON.parse(trimmed) as AdapterEpisode);
    } catch (error) {
      throw new Error(
        `Cannot resume: invalid JSON in ${filePath} on line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return episodes;
}

async function runEpisodeSafely(input: {
  task: SkillCraftTask;
  args: Args;
  libCacheDir?: string;
}): Promise<AdapterEpisode> {
  try {
    return input.args.live
      ? await runLiveExperimental({
          task: input.task,
          skillcraftDir: input.args.skillcraftDir,
          outDir: input.args.outDir,
          model: input.args.model,
          reasoningEffort: input.args.reasoningEffort,
          timeoutMs: input.args.timeoutMs,
          snippetTimeoutMs: input.args.snippetTimeoutMs,
          libCacheDir: input.libCacheDir,
        })
      : await runFixtureSmoke({ task: input.task, skillcraftDir: input.args.skillcraftDir, outDir: input.args.outDir });
  } catch (error) {
    return writeHarnessErrorEpisode({
      task: input.task,
      outDir: input.args.outDir,
      error,
      bridgeStatus: input.args.live ? "live-agent-experimental" : "fixture-evaluator-smoke",
    });
  }
}

async function writeResultsFile(input: {
  file: string;
  runInfo: Record<string, unknown>;
  episodes: AdapterEpisode[];
}): Promise<void> {
  const results = {
    ...input.runInfo,
    sourceProtocol: "datafetch-skillcraft-adapter",
    adapterCapability: "fixture-importer+official-evaluator+tool-bridge+lib-cache",
    episodes: input.episodes,
  };
  await fsp.writeFile(input.file, `${JSON.stringify(results, null, 2)}\n`);
}

async function writeHarnessErrorEpisode(input: {
  task: SkillCraftTask;
  outDir: string;
  error: unknown;
  bridgeStatus: AdapterEpisode["bridgeStatus"];
}): Promise<AdapterEpisode> {
  const artifactDir = path.join(input.outDir, "episodes", input.task.family, input.task.level);
  await fsp.mkdir(artifactDir, { recursive: true });
  const message = input.error instanceof Error ? input.error.stack ?? input.error.message : String(input.error);
  await fsp.writeFile(path.join(artifactDir, "harness-error.txt"), `${message}\n`);
  return {
    taskKey: input.task.taskKey,
    taskFamily: input.task.family,
    family: input.task.family,
    taskId: `${input.task.family}-${input.task.level}`,
    round: input.task.level,
    level: input.task.level,
    mode: "datafetch",
    officialPassed: false,
    officialStatus: "harness_error",
    officialScorePercent: 0,
    officialScore: null,
    answerCorrect: false,
    answerStatus: "harness_error",
    totalTokens: null,
    effectiveTokens: null,
    elapsedMs: 0,
    llmCalls: 0,
    toolCalls: 0,
    libFunctionsUsed: 0,
    libFunctionsAvailable: 0,
    libFunctionsCreated: 0,
    reuseRate: 0,
    regressionsPassed: null,
    artifactPath: path.relative(process.cwd(), artifactDir),
    bridgeStatus: input.bridgeStatus,
    agentExitCode: 1,
    snippetExitCode: 1,
    phase: phaseForLevel(input.task.level),
    promotedToLibCache: false,
  };
}

async function selectTasks(args: Args): Promise<SkillCraftTask[]> {
  const allTasks = await discoverTasks(args.skillcraftDir);
  let selected = allTasks;
  if (args.task) selected = selected.filter((task) => task.taskKey === args.task);
  if (args.families.length) {
    const families = new Set(args.families);
    selected = selected.filter((task) => families.has(task.family));
  }
  if (args.levels.length) {
    const levels = new Set(args.levels);
    selected = selected.filter((task) => levels.has(task.level));
  }
  if (typeof args.limit === "number") selected = selected.slice(0, args.limit);
  if (!selected.length) throw new Error("no SkillCraft tasks matched the requested filters");
  return selected;
}

async function discoverTasks(skillcraftDir: string): Promise<SkillCraftTask[]> {
  const root = path.join(skillcraftDir, "tasks", "scaled_tasks");
  const families = await safeReaddir(root);
  const tasks: SkillCraftTask[] = [];
  for (const family of families) {
    const familyDir = path.join(root, family);
    if (!(await isDirectory(familyDir))) continue;
    const levels = await safeReaddir(familyDir);
    for (const level of levels) {
      const taskDir = path.join(familyDir, level);
      if (!(await isDirectory(taskDir))) continue;
      const taskConfigPath = path.join(taskDir, "task_config.json");
      const evaluatorPath = path.join(taskDir, "evaluation", "main.py");
      const taskDocPath = path.join(taskDir, "docs", "task.md");
      if (!(await exists(taskConfigPath)) || !(await exists(evaluatorPath)) || !(await exists(taskDocPath))) continue;
      const taskConfig = JSON.parse(await fsp.readFile(taskConfigPath, "utf8")) as Record<string, unknown>;
      const initialWorkspacePath = await optionalDir(path.join(taskDir, "initial_workspace"));
      const groundtruthWorkspacePath = await optionalDir(path.join(taskDir, "groundtruth_workspace"));
      tasks.push({
        taskKey: `scaled_tasks/${family}/${level}`,
        family,
        level,
        taskDir,
        taskConfigPath,
        taskDocPath,
        agentPromptPath: path.join(taskDir, "docs", "agent_system_prompt.md"),
        evaluatorPath,
        initialWorkspacePath,
        groundtruthWorkspacePath,
        expectedOutputFiles: await inferExpectedOutputFiles(evaluatorPath),
        taskConfig,
      });
    }
  }
  return tasks.sort(compareTasks);
}

async function runFixtureSmoke(input: {
  task: SkillCraftTask;
  skillcraftDir: string;
  outDir: string;
}): Promise<AdapterEpisode> {
  const artifactDir = path.join(input.outDir, "episodes", input.task.family, input.task.level);
  const workspace = path.join(artifactDir, "workspace");
  const groundtruth = input.task.groundtruthWorkspacePath ?? path.join(artifactDir, "groundtruth-empty");
  await fsp.rm(artifactDir, { recursive: true, force: true });
  await fsp.mkdir(workspace, { recursive: true });
  if (input.task.initialWorkspacePath) {
    await fsp.cp(input.task.initialWorkspacePath, workspace, { recursive: true, force: true });
  }
  if (!input.task.groundtruthWorkspacePath) await fsp.mkdir(groundtruth, { recursive: true });
  await fsp.writeFile(
    path.join(artifactDir, "adapter-status.md"),
    [
      "# Datafetch SkillCraft Adapter Status",
      "",
      "This smoke episode mirrors the official SkillCraft workspace and invokes the official evaluator.",
      "It does not run the Datafetch agent/tool bridge yet, so failure is expected unless an output file already exists.",
      "",
    ].join("\n"),
  );
  await fsp.writeFile(path.join(artifactDir, "task-summary.json"), `${JSON.stringify(taskSummary(input.task), null, 2)}\n`);

  const evaluator = await runEvaluator({
    skillcraftDir: input.skillcraftDir,
    evaluatorPath: input.task.evaluatorPath,
    workspace,
    groundtruth,
  });
  await fsp.writeFile(path.join(artifactDir, "evaluator-stdout.txt"), evaluator.stdout);
  await fsp.writeFile(path.join(artifactDir, "evaluator-stderr.txt"), evaluator.stderr);
  await fsp.writeFile(
    path.join(artifactDir, "evaluator-result.json"),
    `${JSON.stringify({ exitCode: evaluator.exitCode, elapsedMs: evaluator.elapsedMs, scoreJson: evaluator.scoreJson }, null, 2)}\n`,
  );

  const score = scoreObject(evaluator.scoreJson);
  const percent = numberOr(score?.percent, 0);
  const status = stringOrNull(evaluator.scoreJson?.status);
  const passed = Boolean(evaluator.scoreJson?.passed);
  return {
    taskKey: input.task.taskKey,
    taskFamily: input.task.family,
    family: input.task.family,
    taskId: `${input.task.family}-${input.task.level}`,
    round: input.task.level,
    level: input.task.level,
    mode: "datafetch",
    officialPassed: passed,
    officialStatus: status,
    officialScorePercent: percent,
    officialScore: score ?? null,
    answerCorrect: passed,
    answerStatus: passed ? "answered" : status ?? "unsupported",
    totalTokens: null,
    effectiveTokens: null,
    elapsedMs: Math.round(evaluator.elapsedMs),
    llmCalls: 0,
    toolCalls: 0,
    libFunctionsUsed: 0,
    libFunctionsAvailable: 0,
    libFunctionsCreated: 0,
    reuseRate: 0,
    regressionsPassed: null,
    artifactPath: path.relative(process.cwd(), artifactDir),
    bridgeStatus: "fixture-evaluator-smoke",
    phase: phaseForLevel(input.task.level),
    promotedToLibCache: false,
  };
}

async function runLiveExperimental(input: {
  task: SkillCraftTask;
  skillcraftDir: string;
  outDir: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs: number;
  snippetTimeoutMs: number;
  libCacheDir?: string;
}): Promise<AdapterEpisode> {
  const artifactDir = path.join(input.outDir, "episodes", input.task.family, input.task.level);
  const workspace = path.join(artifactDir, "workspace");
  const datafetchHome = path.join(artifactDir, "datafetch-home");
  const tenantId = "skillcraft-full";
  const groundtruth = input.task.groundtruthWorkspacePath ?? path.join(artifactDir, "groundtruth-empty");
  await fsp.rm(artifactDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(workspace, "scripts"), { recursive: true });
  await fsp.mkdir(path.join(datafetchHome, "lib", tenantId), { recursive: true });
  if (input.task.initialWorkspacePath) {
    await fsp.cp(input.task.initialWorkspacePath, workspace, { recursive: true, force: true });
  }
  if (!input.task.groundtruthWorkspacePath) await fsp.mkdir(groundtruth, { recursive: true });
  const availableLibFunctions = input.libCacheDir
    ? await hydrateFamilyLibCache({
        family: input.task.family,
        libCacheDir: input.libCacheDir,
        workspace,
        datafetchHome,
        tenantId,
      })
    : [];
  await prepareLiveWorkspace({
    task: input.task,
    skillcraftDir: input.skillcraftDir,
    workspace,
    artifactDir,
    availableLibFunctions,
  });
  const prompt = renderLivePrompt(input.task);
  const agentRun = await runAgent({
    workspaceDir: workspace,
    prompt,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    timeoutMs: input.timeoutMs,
  });
  await writeAgentArtifacts({ artifactDir, agentRun });

  const answerPath = path.join(workspace, "scripts", "answer.ts");
  let snippetExitCode = 1;
  let trajectory: TrajectoryRecord | undefined;
  if (await exists(answerPath)) {
    await syncLibExportAliases(path.join(workspace, "lib"));
    const rawSource = await fsp.readFile(answerPath, "utf8");
    const source = prepareAnswerSourceForRuntime(rawSource, workspace);
    await fsp.writeFile(path.join(artifactDir, "prepared-answer.ts"), source);
    await mirrorWorkspaceLibsToResolver({
      workspace,
      datafetchHome,
      tenantId,
    });
    const { snippetRuntime } = await installSnippetRuntime({
      baseDir: datafetchHome,
      skipSeedMirror: true,
    });
    const run = await snippetRuntime.run({
      source,
      sourcePath: answerPath,
      sessionCtx: {
        tenantId,
        mountIds: [],
        baseDir: datafetchHome,
        skillcraftToolBridge: {
          skillcraftDir: input.skillcraftDir,
          bundles: taskToolBundles(input.task),
          runnerPath: path.resolve("eval/skillcraft/scripts/invoke-skillcraft-tool.py"),
        },
        snippetTimeoutMs: input.snippetTimeoutMs,
      },
    });
    snippetExitCode = run.exitCode;
    await fsp.writeFile(path.join(artifactDir, "snippet-stdout.txt"), run.stdout);
    await fsp.writeFile(path.join(artifactDir, "snippet-stderr.txt"), run.stderr);
    await fsp.writeFile(path.join(artifactDir, "snippet-result.json"), `${JSON.stringify({
      exitCode: run.exitCode,
      trajectoryId: run.trajectoryId,
      cost: run.cost,
      answer: run.answer ?? null,
    }, null, 2)}\n`);
    if (run.trajectoryId) trajectory = await readTrajectory(run.trajectoryId, datafetchHome);
  } else {
    await fsp.writeFile(path.join(artifactDir, "snippet-stderr.txt"), "scripts/answer.ts was not written by the agent\n");
  }

  const evaluator = await runEvaluator({
    skillcraftDir: input.skillcraftDir,
    evaluatorPath: input.task.evaluatorPath,
    workspace,
    groundtruth,
  });
  await fsp.writeFile(path.join(artifactDir, "evaluator-stdout.txt"), evaluator.stdout);
  await fsp.writeFile(path.join(artifactDir, "evaluator-stderr.txt"), evaluator.stderr);
  await fsp.writeFile(
    path.join(artifactDir, "evaluator-result.json"),
    `${JSON.stringify({ exitCode: evaluator.exitCode, elapsedMs: evaluator.elapsedMs, scoreJson: evaluator.scoreJson }, null, 2)}\n`,
  );

  const score = scoreObject(evaluator.scoreJson);
  const percent = numberOr(score?.percent, 0);
  const agentFailureKind = classifyAgentFailure(agentRun);
  const status = agentFailureKind === "model_usage_limit"
    ? "infrastructure_error"
    : snippetExitCode === 0
      ? stringOrNull(evaluator.scoreJson?.status)
      : "runtime_error";
  const passed = snippetExitCode === 0 && Boolean(evaluator.scoreJson?.passed);
  const workspaceLibFunctions = await listLibFunctionNames(path.join(workspace, "lib"));
  const availableSet = new Set(availableLibFunctions);
  const createdLibFunctions = passed
    ? workspaceLibFunctions.filter((name) => !availableSet.has(name)).length
    : 0;
  const promotedToLibCache = Boolean(
    passed &&
    input.libCacheDir &&
    LEARN_FROM_LEVELS.has(input.task.level),
  );
  if (promotedToLibCache && input.libCacheDir) {
    await persistFamilyLibCache({
      family: input.task.family,
      libCacheDir: input.libCacheDir,
      workspace,
    });
  }
  const calls = trajectory?.calls ?? [];
  const toolCalls = calls.filter((call) => call.primitive.startsWith("tool.")).length;
  const libCalls = calls.filter((call) => call.primitive.startsWith("lib.")).length;
  const reuseDenominator = toolCalls + libCalls;
  await fsp.writeFile(path.join(artifactDir, "lib-status.json"), `${JSON.stringify({
    availableAtStart: availableLibFunctions,
    functionsAfterAgent: workspaceLibFunctions,
    committedNewFunctions: createdLibFunctions,
    libCalls,
    toolCalls,
    reuseRate: reuseDenominator === 0 ? 0 : libCalls / reuseDenominator,
  }, null, 2)}\n`);
  return {
    taskKey: input.task.taskKey,
    taskFamily: input.task.family,
    family: input.task.family,
    taskId: `${input.task.family}-${input.task.level}`,
    round: input.task.level,
    level: input.task.level,
    mode: "datafetch",
    officialPassed: passed,
    officialStatus: status,
    officialScorePercent: percent,
    officialScore: score ?? null,
    answerCorrect: passed,
    answerStatus: passed ? "answered" : status ?? "unsupported",
    totalTokens: agentRun.usage.inputTokens + agentRun.usage.outputTokens,
    effectiveTokens: Math.max(0, agentRun.usage.inputTokens - agentRun.usage.cachedInputTokens) + agentRun.usage.outputTokens,
    elapsedMs: Math.round(agentRun.elapsedMs + evaluator.elapsedMs),
    llmCalls: agentRun.usage.llmCalls,
    toolCalls,
    libFunctionsUsed: libCalls,
    libFunctionsAvailable: availableLibFunctions.length,
    libFunctionsCreated: createdLibFunctions,
    reuseRate: reuseDenominator === 0 ? 0 : libCalls / reuseDenominator,
    regressionsPassed: null,
    artifactPath: path.relative(process.cwd(), artifactDir),
    bridgeStatus: "live-agent-experimental",
    agentExitCode: agentRun.exitCode,
    snippetExitCode,
    agentFailureKind: agentFailureKind ?? undefined,
    phase: phaseForLevel(input.task.level),
    promotedToLibCache,
    agentInputTokens: agentRun.usage.inputTokens,
    agentCachedInputTokens: agentRun.usage.cachedInputTokens,
    agentOutputTokens: agentRun.usage.outputTokens,
    agentReasoningTokens: agentRun.usage.reasoningOutputTokens,
    agentElapsedMs: Math.round(agentRun.elapsedMs),
  };
}

function compareTasks(left: SkillCraftTask, right: SkillCraftTask): number {
  const familyCompare = left.family.localeCompare(right.family);
  if (familyCompare !== 0) return familyCompare;
  return levelRank(left.level) - levelRank(right.level);
}

function levelRank(level: string): number {
  const index = LEVEL_ORDER.indexOf(level as typeof LEVEL_ORDER[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function phaseForLevel(level: string): AdapterEpisode["phase"] {
  if (level === "e1") return "train";
  if (level === "h1") return "hard";
  if (["e2", "e3", "m1", "m2"].includes(level)) return "warm";
  return "unknown";
}

function prepareAnswerSourceForRuntime(source: string, workspace: string): string {
  let body = rewriteDirectLibImports(source);
  body = body.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, "");
  let appendedCall = "";
  let returnedInlineIife = false;
  const defaultInvocation = /^\s*export\s+default\s+(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?\s*$/m.exec(body);
  if (defaultInvocation?.[1]) {
    body = body.replace(/^\s*export\s+default\s+(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?\s*$/m, "");
    appendedCall = `\nreturn await ${defaultInvocation[1]}();\n`;
  }
  const defaultAsyncFunction = /\bexport\s+default\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(body);
  if (!appendedCall && defaultAsyncFunction?.[1]) {
    body = body.replace(/\bexport\s+default\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/, "async function $1(");
    appendedCall = `\nreturn await ${defaultAsyncFunction[1]}();\n`;
  }
  const defaultFunction = /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(body);
  if (!appendedCall && defaultFunction?.[1]) {
    body = body.replace(/\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/, "function $1(");
    appendedCall = `\nreturn await ${defaultFunction[1]}();\n`;
  }
  const defaultIdentifier = /^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(body);
  if (!appendedCall && defaultIdentifier?.[1]) {
    body = body.replace(/^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m, "");
    appendedCall = `\nreturn await ${defaultIdentifier[1]}();\n`;
  }
  body = stripNamedAnswerExports(body);
  const trailingNamedInvocation = /\n\s*(?:await\s+|void\s+)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?\s*$/.exec(body);
  if (!appendedCall && trailingNamedInvocation?.[1]) {
    const name = trailingNamedInvocation[1];
    const hasCallable =
      new RegExp(`\\b(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`).test(body) ||
      new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=`).test(body);
    if (hasCallable && typeof trailingNamedInvocation.index === "number") {
      body = body.slice(0, trailingNamedInvocation.index);
      appendedCall = `\nreturn await ${name}();\n`;
    }
  }
  const trailingNamedCatchInvocation = /\n\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/.exec(body);
  if (!appendedCall && trailingNamedCatchInvocation?.[1]) {
    const name = trailingNamedCatchInvocation[1];
    const hasCallable =
      new RegExp(`\\b(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`).test(body) ||
      new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=`).test(body);
    if (hasCallable && typeof trailingNamedCatchInvocation.index === "number") {
      body = body.slice(0, trailingNamedCatchInvocation.index);
      appendedCall = `\nreturn await ${name}();\n`;
    }
  }
  const trailingNamedThenCatchInvocation = /\n\s*([A-Za-z_$][\w$]*)\s*\(\s*\)\.then\s*\([\s\S]*?\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/.exec(body);
  if (!appendedCall && trailingNamedThenCatchInvocation?.[1]) {
    const name = trailingNamedThenCatchInvocation[1];
    const hasCallable =
      new RegExp(`\\b(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`).test(body) ||
      new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=`).test(body);
    if (hasCallable && typeof trailingNamedThenCatchInvocation.index === "number") {
      body = body.slice(0, trailingNamedThenCatchInvocation.index);
      appendedCall = `\nreturn await ${name}();\n`;
    }
  }
  const namedAsyncIifeWithCatch = /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/m.exec(body);
  if (
    !appendedCall &&
      namedAsyncIifeWithCatch?.[1] &&
      /\}\s*\)\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/.test(body)
  ) {
    body = body.replace(
      /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/m,
      "async function $1(",
    );
    body = body.replace(/\}\s*\)\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/, "}\n");
    appendedCall = `\nreturn await ${namedAsyncIifeWithCatch[1]}();\n`;
  }
  if (
    !appendedCall &&
    /^\s*;?\s*(?:void\s+)?\(\s*async\s*\(\s*\)\s*=>\s*\{/m.test(body) &&
    /\}\s*\)\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/.test(body)
  ) {
    body = body.replace(
      /^\s*;?\s*(?:void\s+)?\(\s*async\s*\(\s*\)\s*=>\s*\{/m,
      "return await (async () => {",
    );
    body = body.replace(/\}\s*\)\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/, "})();\n");
    returnedInlineIife = true;
  }
  if (
    !appendedCall &&
    /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s*\(/m.test(body) &&
    /\}\s*\)\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/.test(body)
  ) {
    body = body.replace(
      /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s*\(/m,
      "return await (async function(",
    );
    body = body.replace(/\}\s*\)\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/, "})();\n");
    returnedInlineIife = true;
  }
  if (
    !appendedCall &&
    /^\s*;?\s*(?:void\s+)?\(\s*async\s*\(\s*\)\s*=>\s*\{/m.test(body) &&
    /\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(body)
  ) {
    body = body.replace(
      /^\s*;?\s*(?:void\s+)?\(\s*async\s*\(\s*\)\s*=>\s*\{/m,
      "return await (async () => {",
    );
    returnedInlineIife = true;
  }
  if (
    !appendedCall &&
    !returnedInlineIife &&
    /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s*\(/m.test(body) &&
    /\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(body)
  ) {
    body = body.replace(
      /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s*\(/m,
      "return await (async function(",
    );
    returnedInlineIife = true;
  }
  const namedAsyncIife = /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/m.exec(body);
  if (
    !appendedCall &&
    !returnedInlineIife &&
    namedAsyncIife?.[1] &&
    /\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(body)
  ) {
    body = body.replace(
      /^\s*;?\s*(?:void\s+)?\(\s*async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/m,
      "async function $1(",
    );
    body = body.replace(/\}\s*\)\s*\(\s*\)\s*;?\s*$/, "}\n");
    appendedCall = `\nreturn await ${namedAsyncIife[1]}();\n`;
  }
  const mainInvocation = /^\s*(?:void\s+)?main\s*\(\s*\)\s*;?\s*$/m;
  if (mainInvocation.test(body)) {
    body = body.replace(mainInvocation, "");
    if (!appendedCall && /\b(?:async\s+)?function\s+main\s*\(/.test(body)) {
      appendedCall = "\nreturn await main();\n";
    }
  }
  const mainCatchInvocation = /^\s*(?:void\s+)?main\s*\(\s*\)\.catch\s*\([\s\S]*?\)\s*;?\s*$/m;
  if (mainCatchInvocation.test(body)) {
    body = body.replace(mainCatchInvocation, "");
    if (!appendedCall && /\b(?:async\s+)?function\s+main\s*\(/.test(body)) {
      appendedCall = "\nreturn await main();\n";
    }
  }
  const lines = body.split("\n");
  const imports: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      imports.push(line);
      index += 1;
      continue;
    }
    if (!trimmed.startsWith("import ")) break;
    imports.push(line);
    index += 1;
    while (index < lines.length && !(lines[index - 1] ?? "").trimEnd().endsWith(";")) {
      imports.push(lines[index] ?? "");
      index += 1;
    }
  }
  return [
    ...imports,
    `process.chdir(${JSON.stringify(workspace)});`,
    lines.slice(index).join("\n"),
    appendedCall,
  ].join("\n");
}

function stripNamedAnswerExports(source: string): string {
  return source
    .replace(/^\s*export\s+(type|interface)\s+/gm, "$1 ")
    .replace(/^\s*export\s+((?:async\s+)?function\s+)/gm, "$1")
    .replace(/^\s*export\s+(const|let|var|class)\s+/gm, "$1 ");
}

function rewriteDirectLibImports(source: string): string {
  const importedNames = new Set<string>();
  let rewritten = source.replace(
    /^\s*import\s+\{\s*([^}]+)\s*\}\s+from\s+["']\.\.\/lib\/[^"']+["'];?\s*$/gm,
    (_match, names: string) => {
      for (const rawName of names.split(",")) {
        const [name] = rawName.trim().split(/\s+as\s+/);
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) importedNames.add(name);
      }
      return "";
    },
  );
  rewritten = rewritten.replace(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+["']\.\.\/lib\/[^"']+["'];?\s*$/gm,
    (_match, name: string) => {
      importedNames.add(name);
      return "";
    },
  );
  for (const name of importedNames) {
    rewritten = rewritten.replace(
      new RegExp(`(?<![A-Za-z0-9_$.])${escapeRegExp(name)}\\s*\\(`, "g"),
      `df.lib.${name}(`,
    );
  }
  return rewritten;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function prepareLiveWorkspace(input: {
  task: SkillCraftTask;
  skillcraftDir: string;
  workspace: string;
  artifactDir: string;
  availableLibFunctions: string[];
}): Promise<void> {
  const toolCatalog = await collectToolCatalog(input.task, input.skillcraftDir);
  await fsp.copyFile(input.task.taskDocPath, path.join(input.workspace, "task.md"));
  if (await exists(input.task.agentPromptPath)) {
    await fsp.copyFile(input.task.agentPromptPath, path.join(input.workspace, "agent_system_prompt.md"));
  }
  await fsp.copyFile(input.task.taskConfigPath, path.join(input.workspace, "task_config.json"));
  await fsp.writeFile(
    path.join(input.workspace, "tool_manifest.json"),
    `${JSON.stringify(toolCatalog, null, 2)}\n`,
  );
  await fsp.writeFile(
    path.join(input.workspace, "df.d.ts"),
    renderLiveDfDts(toolCatalog, input.availableLibFunctions),
  );
  await fsp.writeFile(path.join(input.workspace, "AGENTS.md"), renderLiveAgentInstructions(input.task, toolCatalog));
  await writeLibAuthoringGuide({
    workspace: input.workspace,
    task: input.task,
    availableLibFunctions: input.availableLibFunctions,
    toolCatalog,
  });
  await fsp.writeFile(path.join(input.workspace, "scripts", "answer.ts"), renderAnswerScaffold(input.task));
  await fsp.writeFile(path.join(input.artifactDir, "task-summary.json"), `${JSON.stringify(taskSummary(input.task), null, 2)}\n`);
}

function renderLiveDfDts(
  toolCatalog: ToolCatalogEntry[],
  availableLibFunctions: string[],
): string {
  const bundleBlocks: string[] = [];
  for (const entry of toolCatalog) {
    const fields = entry.tools.map((tool) => {
      const inputType = schemaToTs(tool.params_json_schema);
      return `    ${JSON.stringify(tool.name)}(input: ${inputType}): Promise<any>;`;
    }).join("\n");
    bundleBlocks.push(`  ${entry.bundle}: {\n    [name: string]: (input: any) => Promise<any>;\n${fields}\n  };`);
  }
  const libResultType = "{ value: any; cost?: any; provenance?: any; escalations?: number }";
  const libFields = availableLibFunctions
    .map((name) => `    ${JSON.stringify(name)}(input: any): Promise<${libResultType}>;`)
    .join("\n");
  return `
declare const df: {
  tool: {
${bundleBlocks.join("\n")}
  };
  lib: {
    [name: string]: (input: any) => Promise<${libResultType}>;
${libFields}
  };
  answer(input: {
    status: "answered" | "partial" | "unsupported";
    value?: unknown;
    evidence?: unknown[];
    derivation?: unknown[];
    reason?: string;
  }): unknown;
};
`.trimStart();
}

function renderLiveAgentInstructions(task: SkillCraftTask, toolCatalog: ToolCatalogEntry[]): string {
  const exactToolNames = flattenToolCatalogNames(toolCatalog);
  const bundleNames = toolCatalog.map((entry) => entry.bundle);
  return [
    "# Datafetch x SkillCraft Workspace",
    "",
    "Write `scripts/answer.ts`. You may also write reusable learned interfaces under `lib/*.ts`.",
    "Use the official task prompt in `task.md`, the exact tool list in `tool_manifest.json`, and the available tool types in `df.d.ts`.",
    "Call official SkillCraft tools through `df.tool.<bundle>[\"local-tool_name\"]({ ... })`.",
    `Available tool bundle(s): ${bundleNames.join(", ") || "none"}.`,
    `Available exact tool names: ${exactToolNames.join(", ") || "none"}.`,
    "Use only the exact available tool names above. Do not infer, invent, or abbreviate endpoint names from `task_config.json` metadata.",
    "Before making raw `df.tool` calls, inspect `lib/` and prefer `df.lib.<name>(...)` when a helper fits the task.",
    "If the task repeats the same tool workflow across multiple entities, implement that workflow as a Datafetch `fn({...})` in `lib/<name>.ts` and call it through `df.lib.<name>(...)` from `scripts/answer.ts`.",
    "For reusable helpers, prefer accepting tool names and an argument object as input rather than hard-coding one level's exact endpoints.",
    "Keep helper schemas permissive enough for the exact caller shape you use in `scripts/answer.ts`; for nested entity objects, prefer `v.unknown()` or a loose object over a brittle field set.",
    "If `scripts/answer.ts` calls `df.lib.someHelper({ city: { name } })`, the helper input schema must accept `city.name`; do not require a different field like `city_name` unless the caller passes it.",
    "Keep `scripts/answer.ts` as an executable script. Do not export from it; the harness calls the script and records its `df.answer(...)` return value.",
    "Write the required output JSON file directly in this workspace using Node `fs/promises`.",
    "Do not call `claim_done`; the harness runs the official evaluator after your script exits.",
    "Finish with `return df.answer({ status: \"answered\", value, evidence, derivation })`.",
    `Expected output file(s): ${task.expectedOutputFiles.join(", ") || "see task.md/evaluator"}.`,
    "",
  ].join("\n");
}

function renderAnswerScaffold(task: SkillCraftTask): string {
  return [
    "import { writeFile } from \"node:fs/promises\";",
    "",
    "// Read task.md and df.d.ts, call df.tool.*, write the official output JSON file,",
    "// or call a reusable df.lib.* helper from lib/ when one fits the task,",
    "// then return df.answer(...).",
    `// Expected output file(s): ${task.expectedOutputFiles.join(", ") || "see task.md/evaluator"}`,
    "",
  ].join("\n");
}

async function hydrateFamilyLibCache(input: {
  family: string;
  libCacheDir: string;
  workspace: string;
  datafetchHome: string;
  tenantId: string;
}): Promise<string[]> {
  const familyCacheDir = path.join(input.libCacheDir, input.family);
  const workspaceLibDir = path.join(input.workspace, "lib");
  const resolverLibDir = path.join(input.datafetchHome, "lib", input.tenantId);
  await fsp.mkdir(workspaceLibDir, { recursive: true });
  await fsp.mkdir(resolverLibDir, { recursive: true });
  if (await isDirectory(familyCacheDir)) {
    await copyTsFiles(familyCacheDir, workspaceLibDir);
    await copyTsFiles(familyCacheDir, resolverLibDir, { markLearned: true });
  }
  return listLibFunctionNames(workspaceLibDir);
}

async function mirrorWorkspaceLibsToResolver(input: {
  workspace: string;
  datafetchHome: string;
  tenantId: string;
}): Promise<void> {
  const workspaceLibDir = path.join(input.workspace, "lib");
  const resolverLibDir = path.join(input.datafetchHome, "lib", input.tenantId);
  await fsp.rm(resolverLibDir, { recursive: true, force: true });
  await fsp.mkdir(resolverLibDir, { recursive: true });
  if (await isDirectory(workspaceLibDir)) {
    await copyTsFiles(workspaceLibDir, resolverLibDir, { markLearned: true });
  }
}

async function persistFamilyLibCache(input: {
  family: string;
  libCacheDir: string;
  workspace: string;
}): Promise<void> {
  const workspaceLibDir = path.join(input.workspace, "lib");
  if (!(await isDirectory(workspaceLibDir))) return;
  const names = await listLibFunctionNames(workspaceLibDir);
  if (names.length === 0) return;
  const familyCacheDir = path.join(input.libCacheDir, input.family);
  await fsp.mkdir(familyCacheDir, { recursive: true });
  await copyTsFiles(workspaceLibDir, familyCacheDir, { markLearned: true });
}

async function copyTsFiles(
  srcDir: string,
  dstDir: string,
  opts: { markLearned?: boolean } = {},
): Promise<void> {
  await fsp.mkdir(dstDir, { recursive: true });
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const source = await fsp.readFile(path.join(srcDir, entry.name), "utf8");
    await fsp.writeFile(
      path.join(dstDir, entry.name),
      opts.markLearned ? withLearnedMarker(source) : source,
      "utf8",
    );
  }
}

function withLearnedMarker(source: string): string {
  if (/@shape-hash:\s*[0-9a-f]{8,}/.test(source)) return source;
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const suffix = source.endsWith("\n") ? "" : "\n";
  return `${source}${suffix}// @shape-hash: ${hash}\n`;
}

async function listLibFunctionNames(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name.slice(0, -3))
    .sort();
}

async function syncLibExportAliases(dir: string): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const sourcePath = path.join(dir, entry.name);
    const source = await fsp.readFile(sourcePath, "utf8");
    const exportedName = exportedFnName(source);
    if (!exportedName) continue;
    const expectedName = `${exportedName}.ts`;
    if (expectedName === entry.name) continue;
    const aliasPath = path.join(dir, expectedName);
    if (await exists(aliasPath)) continue;
    await fsp.copyFile(sourcePath, aliasPath);
  }
}

function exportedFnName(source: string): string | null {
  const match = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*fn\s*\(/.exec(source);
  return match?.[1] ?? null;
}

async function writeLibAuthoringGuide(input: {
  workspace: string;
  task: SkillCraftTask;
  availableLibFunctions: string[];
  toolCatalog: ToolCatalogEntry[];
}): Promise<void> {
  const libDir = path.join(input.workspace, "lib");
  await fsp.mkdir(libDir, { recursive: true });
  const bundles = input.toolCatalog.map((entry) => entry.bundle);
  const firstBundle = bundles[0] ?? "bundle_name";
  const tools = flattenToolCatalogNames(input.toolCatalog);
  const guide = [
    "# Learned Interfaces",
    "",
    "Existing helpers in this family:",
    input.availableLibFunctions.length
      ? input.availableLibFunctions.map((name) => `- df.lib.${name}(input)`).join("\n")
      : "- none yet",
    "",
    "New helpers should be TypeScript files in this directory. The file name must match the exported function name.",
    "Use `fn({...})` so the Datafetch runtime records a `df.lib.*` call and can reuse the helper in later tasks.",
    `Available exact tool names for this task: ${tools.join(", ") || "see tool_manifest.json"}.`,
    "Use only these exact names when calling `df.tool`; metadata in `task_config.json` can mention higher-level tool concepts that are not callable endpoints.",
    "Prefer generic inputs like `{ arg, toolNames }` when that still lets the caller shape the output for the current task.",
    "Make the `input` schema match the exact object your answer script passes. If the helper accepts nested, family-specific inputs, use `v.unknown()` or a broad object schema rather than rejecting valid caller data.",
    "",
    "Minimal pattern:",
    "```ts",
    "// @shape-hash: 00000000",
    "import { fn } from \"@datafetch/sdk\";",
    "import * as v from \"valibot\";",
    "",
    "export const helperName = fn({",
    "  intent: \"Reusable SkillCraft family workflow.\",",
    "  examples: [],",
    "  input: v.object({",
    "    arg: v.unknown(),",
    "    toolNames: v.array(v.string()),",
    "  }),",
    "  output: v.unknown(),",
    "  async body(input) {",
    `    const tools = (globalThis as any).df.tool.${firstBundle};`,
    "    const outputs: Record<string, unknown> = {};",
    "    for (const toolName of input.toolNames) {",
    "      const localName = toolName.startsWith(\"local-\") ? toolName : `local-${toolName}`;",
    "      outputs[toolName] = await tools[localName](input.arg);",
    "    }",
    "    return outputs;",
    "  },",
    "});",
    "```",
    "",
  ].join("\n");
  await fsp.writeFile(path.join(libDir, "README.md"), guide);
}

function renderLivePrompt(task: SkillCraftTask): string {
  return [
    "You are solving one official SkillCraft task inside a Datafetch workspace.",
    "",
    `Task: ${task.taskKey}`,
    "",
    "Read task.md, AGENTS.md, df.d.ts, and any initial workspace files.",
    "Edit scripts/answer.ts so it completes the task.",
    "Use existing df.lib helpers when they fit. If no helper exists and the task has repeated entity-level tool calls, create one under lib/ and call it from scripts/answer.ts.",
    "When creating or updating a helper, make it parameterized over the task's tool names where practical so later levels in this family can reuse it.",
    "Use df.tool calls for the official local tools. Use bracket notation for hyphenated tool names.",
    // Defensive-coding guardrails. Most runtime failures in prior eval runs came from accessing",
    // nested fields on tool responses that turned out to be undefined (e.g. resp.foo.bar where",
    // resp.foo is undefined). The agent's snippet then crashes before writing the output,",
    // costing the whole task. Each of these is a one-line code change that materially helps:",
    "Tool responses can be missing fields or be shaped differently than you expect. Always guard nested property access with optional chaining (`resp?.foo?.bar`) or an explicit `if (resp && resp.foo)` check. If a field is missing, write a sensible default (empty string, 0, empty array) to the output file rather than throwing.",
    "Wrap the body of main() in a try/catch. On error, write a best-effort partial result to the expected output JSON file (using whatever data you have collected so far, with empty defaults for the missing pieces) before letting the error propagate. A partial output usually scores some credit; a thrown error scores zero.",
    "The evaluator will run scripts/answer.ts after you finish; do not execute a long benchmark yourself.",
    "Do not write prose as the answer. The file content is the deliverable.",
  ].join("\n");
}

async function listSkillcraftTools(input: {
  skillcraftDir: string;
  bundle: string;
}): Promise<ToolDescriptor[]> {
  const runnerPath = path.resolve("eval/skillcraft/scripts/invoke-skillcraft-tool.py");
  const proc = await spawnProcess(process.env["SKILLCRAFT_TOOL_PYTHON"] ?? "python3", [
    runnerPath,
    "--skillcraft-dir",
    input.skillcraftDir,
    "--bundle",
    input.bundle,
    "--list",
  ], process.cwd());
  if (proc.exitCode !== 0) {
    throw new Error(`failed to list SkillCraft tools for ${input.bundle}: ${proc.stderr || proc.stdout}`);
  }
  const payload = JSON.parse(proc.stdout) as { tools?: ToolDescriptor[] };
  return payload.tools ?? [];
}

async function collectToolCatalog(
  task: SkillCraftTask,
  skillcraftDir: string,
): Promise<ToolCatalogEntry[]> {
  const catalog: ToolCatalogEntry[] = [];
  for (const bundle of taskToolBundles(task)) {
    catalog.push({
      bundle,
      tools: await listSkillcraftTools({ skillcraftDir, bundle }),
    });
  }
  return catalog;
}

function flattenToolCatalogNames(toolCatalog: ToolCatalogEntry[]): string[] {
  return toolCatalog.flatMap((entry) => entry.tools.map((tool) => tool.name));
}

function taskToolBundles(task: SkillCraftTask): string[] {
  const local = Array.isArray(task.taskConfig.needed_local_tools) ? task.taskConfig.needed_local_tools : [];
  return local
    .filter((tool): tool is string => typeof tool === "string")
    .filter((tool) => !["claim_done", "skill_cache", "direct_exec"].includes(tool));
}

function schemaToTs(schema: Record<string, unknown>): string {
  const props = schema.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const fields = Object.entries(props).map(([name, prop]) => {
    const optional = required.has(name) ? "" : "?";
    return `${JSON.stringify(name)}${optional}: ${jsonSchemaType(prop)}`;
  });
  return fields.length ? `{ ${fields.join("; ")} }` : "Record<string, unknown>";
}

function jsonSchemaType(prop: Record<string, unknown>): string {
  if (prop.type === "number" || prop.type === "integer") return "number";
  if (prop.type === "boolean") return "boolean";
  if (prop.type === "array") return "unknown[]";
  if (prop.type === "object") return "Record<string, unknown>";
  return "string";
}

// --- Agent dispatcher -------------------------------------------------------
//
// Routes the eval's per-episode agent invocation to whichever backend
// is configured (`DATAFETCH_AGENT=codex|claude`). The caller pipes the
// same args through either path; the dispatcher hides the binary
// differences. Output normalises to a single AgentRun shape, so the
// eval's downstream `writeAgentArtifacts`, `classifyAgentFailure`, and
// AdapterEpisode population is agent-agnostic.
async function runAgent(args: {
  workspaceDir: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs: number;
}): Promise<AgentRun> {
  const backend = resolveAgentBackend();
  if (backend === "claude") return runClaudeAgent(args);
  return runCodexAgent(args);
}

async function runCodexAgent(args: {
  workspaceDir: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs: number;
}): Promise<AgentRun> {
  const model = resolveCodexModel(args.model, "DF_SKILLCRAFT_FULL_MODEL");
  const reasoningEffort = resolveCodexReasoningEffort(args.reasoningEffort, "DF_SKILLCRAFT_FULL_REASONING_EFFORT");
  const lastMessagePath = path.join(args.workspaceDir, ".codex-last-message.txt");
  const started = performance.now();
  const run = await spawnProcess("codex", [
    "--model",
    model,
    "--sandbox",
    "danger-full-access",
    "--ask-for-approval",
    "never",
    "--cd",
    args.workspaceDir,
    "-c",
    `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--json",
    "-o",
    lastMessagePath,
    "--skip-git-repo-check",
    "--",
    args.prompt,
  ], args.workspaceDir, args.timeoutMs);
  let finalMessage = "";
  try {
    finalMessage = await fsp.readFile(lastMessagePath, "utf8");
  } catch {
    finalMessage = "";
  }
  return {
    workspaceDir: args.workspaceDir,
    prompt: args.prompt,
    stdout: run.stdout,
    stderr: run.stderr,
    finalMessage,
    elapsedMs: performance.now() - started,
    exitCode: run.exitCode,
    usage: parseCodexUsage(run.stdout),
  };
}

// Claude agent runner. Drop-in parity with runCodexAgent: same input
// args, same AgentRun output shape. Invokes the Claude Code CLI in
// `--print` (non-interactive) mode with structured JSON output so we
// can parse tokens/turns/cost into AgentUsage.
//
// Permission posture: `--dangerously-skip-permissions` is the Claude
// equivalent of codex's `--sandbox danger-full-access` + `--ask-for-
// approval never`. The eval workspace is a hermetic /tmp directory
// the agent fully owns; outside-of-eval workflows must NOT inherit
// this posture.
async function runClaudeAgent(args: {
  workspaceDir: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs: number;
}): Promise<AgentRun> {
  const model = resolveClaudeModel(args.model);
  const effort = resolveClaudeEffort(args.reasoningEffort);
  const started = performance.now();
  const cliArgs = [
    "--print",
    "--output-format", "json",
    "--model", model,
    "--effort", effort,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    args.prompt,
  ];
  const run = await spawnProcess("claude", cliArgs, args.workspaceDir, args.timeoutMs);

  // Default to empty / zeroed; we overwrite from parsed JSON below
  // when the run produced a valid result envelope.
  let finalMessage = "";
  const usage: AgentUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    llmCalls: 0,
  };

  try {
    const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    const result = parsed["result"];
    if (typeof result === "string") {
      finalMessage = result;
    } else if (result !== undefined) {
      finalMessage = JSON.stringify(result);
    }
    const rawUsage = parsed["usage"];
    if (rawUsage && typeof rawUsage === "object") {
      const u = rawUsage as Record<string, unknown>;
      usage.inputTokens = numberField(u, "input_tokens");
      usage.cachedInputTokens =
        numberField(u, "cache_read_input_tokens") +
        numberField(u, "cache_creation_input_tokens");
      usage.outputTokens = numberField(u, "output_tokens");
    }
    usage.llmCalls = numberField(parsed, "num_turns");
  } catch {
    // Non-JSON output (auth failure, unauthenticated, internal error,
    // truncation by timeout, …). Fall back to the raw stdout as the
    // best-effort final message; the eval will record exit code and
    // stderr for diagnosis.
    finalMessage = run.stdout.trim();
  }

  return {
    workspaceDir: args.workspaceDir,
    prompt: args.prompt,
    stdout: run.stdout,
    stderr: run.stderr,
    finalMessage,
    elapsedMs: performance.now() - started,
    exitCode: run.exitCode,
    usage,
  };
}

function resolveClaudeModel(explicit: string | undefined): string {
  return (
    explicit ??
    process.env["DF_SKILLCRAFT_CLAUDE_MODEL"] ??
    process.env["DF_SKILLCRAFT_FULL_MODEL"] ??
    process.env["DF_TEST_MODEL"] ??
    DEFAULT_CLAUDE_MODEL
  );
}

function resolveClaudeEffort(explicit: string | undefined): string {
  return (
    explicit ??
    process.env["DF_SKILLCRAFT_CLAUDE_EFFORT"] ??
    process.env["DF_SKILLCRAFT_FULL_REASONING_EFFORT"] ??
    process.env["DF_TEST_REASONING_EFFORT"] ??
    DEFAULT_REASONING_EFFORT
  );
}

function resolveCodexModel(explicit: string | undefined, envName: string): string {
  return explicit ?? process.env[envName] ?? process.env["DF_TEST_MODEL"] ?? DEFAULT_CODEX_MODEL;
}

function resolveCodexReasoningEffort(explicit: string | undefined, envName: string): string {
  return explicit ?? process.env[envName] ?? process.env["DF_TEST_REASONING_EFFORT"] ?? DEFAULT_REASONING_EFFORT;
}

function classifyAgentFailure(agentRun: AgentRun): AdapterEpisode["agentFailureKind"] | null {
  if (agentRun.exitCode === 0) return null;
  const text = `${agentRun.stderr}\n${agentRun.stdout}\n${agentRun.finalMessage}`;
  if (/usage limit|hit your usage limit/i.test(text)) return "model_usage_limit";
  return "agent_error";
}

async function writeAgentArtifacts(input: {
  artifactDir: string;
  agentRun: AgentRun;
}): Promise<void> {
  const agentDir = path.join(input.artifactDir, "agent");
  await fsp.mkdir(agentDir, { recursive: true });
  await fsp.writeFile(path.join(agentDir, "prompt.txt"), input.agentRun.prompt);
  await fsp.writeFile(path.join(agentDir, "events.jsonl"), input.agentRun.stdout);
  await fsp.writeFile(path.join(agentDir, "stderr.txt"), input.agentRun.stderr);
  await fsp.writeFile(path.join(agentDir, "final-message.txt"), input.agentRun.finalMessage);
  await fsp.writeFile(path.join(agentDir, "usage.json"), `${JSON.stringify({
    elapsedMs: Math.round(input.agentRun.elapsedMs),
    exitCode: input.agentRun.exitCode,
    usage: input.agentRun.usage,
  }, null, 2)}\n`);
}

async function runEvaluator(input: {
  skillcraftDir: string;
  evaluatorPath: string;
  workspace: string;
  groundtruth: string;
}): Promise<EvaluatorResult> {
  const started = performance.now();
  const relEvaluator = path.relative(input.skillcraftDir, input.evaluatorPath);
  const evaluatorPython = process.env["SKILLCRAFT_EVAL_PYTHON"] ?? "python3";
  const result = await spawnProcess(evaluatorPython, [
    relEvaluator,
    "--agent_workspace",
    input.workspace,
    "--groundtruth_workspace",
    input.groundtruth,
  ], input.skillcraftDir);
  return {
    ...result,
    elapsedMs: performance.now() - started,
    scoreJson: parseScoreJson(result.stdout),
  };
}

function spawnProcess(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, 2_000).unref();
        }, timeoutMs)
      : undefined;
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: `${Buffer.concat(stderr).toString("utf8")}${String(error)}`, exitCode: 1 });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: timedOut ? `${stderrText}\n[timed out after ${timeoutMs}ms signal=${signal ?? ""}]\n` : stderrText,
        exitCode: typeof code === "number" ? code : 1,
      });
    });
  });
}

function parseCodexUsage(stdout: string): AgentUsage {
  const usage: AgentUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    llmCalls: 0,
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (record["type"] !== "turn.completed") continue;
    const rawUsage = record["usage"];
    if (!rawUsage || typeof rawUsage !== "object") continue;
    const u = rawUsage as Record<string, unknown>;
    usage.inputTokens += numberField(u, "input_tokens");
    usage.cachedInputTokens += numberField(u, "cached_input_tokens");
    usage.outputTokens += numberField(u, "output_tokens");
    usage.reasoningOutputTokens += numberField(u, "reasoning_output_tokens");
    usage.llmCalls += 1;
  }
  return usage;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseScoreJson(stdout: string): Record<string, unknown> | null {
  const match = /=== SCORE_JSON_START ===\s*([\s\S]*?)\s*=== SCORE_JSON_END ===/.exec(stdout);
  if (!match) return null;
  try {
    return JSON.parse(match[1] ?? "") as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function inferExpectedOutputFiles(evaluatorPath: string): Promise<string[]> {
  const source = await fsp.readFile(evaluatorPath, "utf8");
  const files = new Set<string>();
  for (const pattern of [
    /os\.path\.join\(\s*workspace\s*,\s*["']([^"']+\.json)["']\s*\)/g,
    /result_file\s*=\s*["']([^"']+\.json)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) files.add(match[1]);
    }
  }
  return [...files].sort();
}

function taskSummary(task: SkillCraftTask): Record<string, unknown> {
  const meta = typeof task.taskConfig.meta === "object" && task.taskConfig.meta ? task.taskConfig.meta as Record<string, unknown> : {};
  return {
    taskKey: task.taskKey,
    family: task.family,
    level: task.level,
    taskName: task.taskConfig.task_name ?? `${task.family}-${task.level}`,
    difficulty: meta.difficulty ?? null,
    subtaskCount: meta.subtask_count ?? null,
    callsPerSubtask: meta.calls_per_subtask ?? null,
    toolsUsed: Array.isArray(meta.tools_used) ? meta.tools_used : [],
    neededLocalTools: Array.isArray(task.taskConfig.needed_local_tools) ? task.taskConfig.needed_local_tools : [],
    neededMcpServers: Array.isArray(task.taskConfig.needed_mcp_servers) ? task.taskConfig.needed_mcp_servers : [],
    hasInitialWorkspace: Boolean(task.initialWorkspacePath),
    hasGroundtruthWorkspace: Boolean(task.groundtruthWorkspacePath),
    expectedOutputFiles: task.expectedOutputFiles,
  };
}

function normalizeTaskKey(value: string): string {
  const task = value.replace(/^tasks\//, "").replace(/^\/+/, "");
  return task.startsWith("scaled_tasks/") ? task : `scaled_tasks/${task}`;
}

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function runStamp(): string {
  return `run_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_")}`;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function optionalDir(dir: string): Promise<string | undefined> {
  return (await isDirectory(dir)) ? dir : undefined;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function scoreObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const score = (value as Record<string, unknown>).score;
  return score && typeof score === "object" ? score as Record<string, unknown> : null;
}

function numberOr(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
