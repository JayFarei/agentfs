import { execFileSync } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";

interface Args {
  skillcraftDir: string;
  outDir: string;
}

interface TaskIndexEntry {
  taskKey: string;
  family: string;
  level: string;
  taskName: string;
  difficulty: string | null;
  estimatedApiCalls: number | null;
  subtaskCount: number | null;
  callsPerSubtask: number | null;
  neededMcpServers: string[];
  neededLocalTools: string[];
  toolsUsed: string[];
  hasInitialWorkspace: boolean;
  hasGroundtruthWorkspace: boolean;
  hasTaskDoc: boolean;
  hasEvaluator: boolean;
  expectedOutputFiles: string[];
  taskConfigPath: string;
  evaluatorPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    skillcraftDir: path.resolve("eval/skillcraft/vendor/skillcraft"),
    outDir: path.resolve("eval/skillcraft/manifests"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--skillcraft-dir") args.skillcraftDir = path.resolve(argv[++index]);
    else if (arg.startsWith("--skillcraft-dir=")) args.skillcraftDir = path.resolve(arg.slice("--skillcraft-dir=".length));
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++index]);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(arg.slice("--out-dir=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await fsp.readFile(filePath, "utf8")) as Record<string, any>;
}

function rel(root: string, filePath: string | null): string | null {
  return filePath ? path.relative(root, filePath) : null;
}

function outputFilesFromEvaluator(source: string): string[] {
  const files = new Set<string>();
  const patterns = [
    /os\.path\.join\(\s*workspace\s*,\s*["']([^"']+)["']\s*\)/g,
    /result_file\s*=\s*["']([^"']+\.json)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]?.endsWith(".json")) files.add(match[1]);
    }
  }
  return [...files].sort();
}

function gitValue(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scaledRoot = path.join(args.skillcraftDir, "tasks", "scaled_tasks");
  if (!(await exists(scaledRoot))) {
    throw new Error(`SkillCraft scaled task root not found: ${scaledRoot}`);
  }
  await fsp.mkdir(args.outDir, { recursive: true });

  const families = (await fsp.readdir(scaledRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const tasks: TaskIndexEntry[] = [];
  const localToolCounts = new Map<string, number>();
  const mcpCounts = new Map<string, number>();
  const declaredToolCounts = new Map<string, number>();

  for (const family of families) {
    const familyDir = path.join(scaledRoot, family);
    const levels = (await fsp.readdir(familyDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const level of levels) {
      const taskDir = path.join(familyDir, level);
      const taskConfigPath = path.join(taskDir, "task_config.json");
      if (!(await exists(taskConfigPath))) continue;
      const config = await readJson(taskConfigPath);
      const evaluatorPath = path.join(taskDir, "evaluation", "main.py");
      const hasEvaluator = await exists(evaluatorPath);
      const evaluatorSource = hasEvaluator ? await fsp.readFile(evaluatorPath, "utf8") : "";
      const neededLocalTools = Array.isArray(config.needed_local_tools) ? config.needed_local_tools : [];
      const neededMcpServers = Array.isArray(config.needed_mcp_servers) ? config.needed_mcp_servers : [];
      const toolsUsed = Array.isArray(config.meta?.tools_used) ? config.meta.tools_used : [];
      for (const tool of neededLocalTools) localToolCounts.set(tool, (localToolCounts.get(tool) ?? 0) + 1);
      for (const server of neededMcpServers) mcpCounts.set(server, (mcpCounts.get(server) ?? 0) + 1);
      for (const tool of toolsUsed) declaredToolCounts.set(tool, (declaredToolCounts.get(tool) ?? 0) + 1);
      tasks.push({
        taskKey: `scaled_tasks/${family}/${level}`,
        family,
        level,
        taskName: String(config.task_name ?? `${family}-${level}`),
        difficulty: config.meta?.difficulty ?? null,
        estimatedApiCalls: numberOrNull(config.meta?.estimated_api_calls),
        subtaskCount: numberOrNull(config.meta?.subtask_count),
        callsPerSubtask: numberOrNull(config.meta?.calls_per_subtask),
        neededMcpServers,
        neededLocalTools,
        toolsUsed,
        hasInitialWorkspace: await exists(path.join(taskDir, "initial_workspace")),
        hasGroundtruthWorkspace: await exists(path.join(taskDir, "groundtruth_workspace")),
        hasTaskDoc: await exists(path.join(taskDir, "docs", "task.md")),
        hasEvaluator,
        expectedOutputFiles: outputFilesFromEvaluator(evaluatorSource),
        taskConfigPath: rel(args.skillcraftDir, taskConfigPath) ?? "",
        evaluatorPath: rel(args.skillcraftDir, hasEvaluator ? evaluatorPath : null),
      });
    }
  }

  const familyCounts = countBy(tasks, (task) => task.family);
  const levelCounts = countBy(tasks, (task) => task.level);
  const missingDocs = tasks.filter((task) => !task.hasTaskDoc).map((task) => task.taskKey);
  const missingEvaluators = tasks.filter((task) => !task.hasEvaluator).map((task) => task.taskKey);

  const lock = {
    repo: gitValue(args.skillcraftDir, ["remote", "get-url", "origin"]) ?? "unknown",
    commit: gitValue(args.skillcraftDir, ["rev-parse", "HEAD"]),
    branch: gitValue(args.skillcraftDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    generatedAt: new Date().toISOString(),
    skillcraftDir: args.skillcraftDir,
    taskCount: tasks.length,
    familyCount: Object.keys(familyCounts).length,
    evaluatorCount: tasks.filter((task) => task.hasEvaluator).length,
    taskDocCount: tasks.filter((task) => task.hasTaskDoc).length,
    warnings: [
      ...(missingDocs.length ? [`${missingDocs.length} task docs are missing under docs/task.md`] : []),
      ...(missingEvaluators.length ? [`${missingEvaluators.length} evaluator scripts are missing`] : []),
    ],
  };
  const toolIndex = {
    generatedAt: lock.generatedAt,
    neededLocalTools: sortedCounts(localToolCounts),
    neededMcpServers: sortedCounts(mcpCounts),
    declaredToolsUsed: sortedCounts(declaredToolCounts),
  };
  const taskIndex = {
    generatedAt: lock.generatedAt,
    summary: {
      tasks: tasks.length,
      families: Object.keys(familyCounts).length,
      familyCounts,
      levelCounts,
      missingTaskDocs: missingDocs.length,
      missingEvaluators: missingEvaluators.length,
    },
    tasks,
  };

  await fsp.writeFile(path.join(args.outDir, "skillcraft-upstream.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  await fsp.writeFile(path.join(args.outDir, "task-index.json"), `${JSON.stringify(taskIndex, null, 2)}\n`);
  await fsp.writeFile(path.join(args.outDir, "tool-index.json"), `${JSON.stringify(toolIndex, null, 2)}\n`);

  console.log(`Indexed ${tasks.length} SkillCraft tasks across ${Object.keys(familyCounts).length} families.`);
  if (lock.warnings.length) {
    for (const warning of lock.warnings) console.warn(`WARN: ${warning}`);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sortedCounts(map: Map<string, number>): Array<{ name: string; count: number }> {
  return [...map.entries()]
    .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || leftName.localeCompare(rightName))
    .map(([name, count]) => ({ name, count }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
