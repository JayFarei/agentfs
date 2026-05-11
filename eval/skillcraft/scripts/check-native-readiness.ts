import { promises as fsp } from "node:fs";
import path from "node:path";

interface Args {
  skillcraftDir: string;
  allowMissingTaskDocs: boolean;
  provider: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    skillcraftDir: path.resolve("eval/skillcraft/vendor/skillcraft"),
    allowMissingTaskDocs: process.env.SKILLCRAFT_ALLOW_MISSING_TASK_DOCS === "1",
    provider: process.env.TOOLATHLON_PROVIDER ?? "openrouter",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--skillcraft-dir") args.skillcraftDir = path.resolve(argv[++index]);
    else if (arg.startsWith("--skillcraft-dir=")) args.skillcraftDir = path.resolve(arg.slice("--skillcraft-dir=".length));
    else if (arg === "--provider") args.provider = argv[++index] ?? args.provider;
    else if (arg.startsWith("--provider=")) args.provider = arg.slice("--provider=".length);
    else if (arg === "--allow-missing-task-docs") args.allowMissingTaskDocs = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scaledRoot = path.join(args.skillcraftDir, "tasks", "scaled_tasks");
  const taskConfigs = await findFiles(scaledRoot, "task_config.json");
  const evaluators = await findFiles(scaledRoot, "main.py", (filePath) => filePath.includes(`${path.sep}evaluation${path.sep}`));
  const taskDocs = await findFiles(scaledRoot, "task.md", (filePath) => filePath.includes(`${path.sep}docs${path.sep}`));
  const envFile = await exists(path.join(args.skillcraftDir, ".env"));
  const providerReadiness = await checkProviderReadiness(args);

  console.log(`[preflight] SkillCraft dir: ${args.skillcraftDir}`);
  console.log(`[preflight] provider: ${args.provider}`);
  console.log(`[preflight] task_config.json: ${taskConfigs.length}`);
  console.log(`[preflight] evaluation/main.py: ${evaluators.length}`);
  console.log(`[preflight] docs/task.md: ${taskDocs.length}`);
  console.log(`[preflight] .env present: ${envFile ? "yes" : "no"}`);

  const failures: string[] = [];
  if (taskConfigs.length !== 126) failures.push(`expected 126 task configs, found ${taskConfigs.length}`);
  if (evaluators.length !== 126) failures.push(`expected 126 evaluators, found ${evaluators.length}`);
  if (taskDocs.length !== 126 && !args.allowMissingTaskDocs) {
    failures.push(
      `expected 126 task prompt docs, found ${taskDocs.length}; set SKILLCRAFT_ALLOW_MISSING_TASK_DOCS=1 only for diagnostic runs`,
    );
  }
  if (!envFile) {
    console.warn("[preflight] WARN: .env is missing; native SkillCraft may still run if provider env vars are exported.");
  }
  if (!providerReadiness.ok) failures.push(providerReadiness.reason);
  if (failures.length) {
    for (const failure of failures) console.error(`[preflight] FAIL: ${failure}`);
    process.exit(1);
  }
  console.log("[preflight] native SkillCraft readiness passed");
}

async function checkProviderReadiness(args: Args): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (process.env.SKILLCRAFT_SKIP_PROVIDER_CHECK === "1") return { ok: true };
  if (args.provider === "openrouter") {
    const configPath = path.join(args.skillcraftDir, "configs", "global_configs.py");
    let source = "";
    try {
      source = await fsp.readFile(configPath, "utf8");
    } catch {
      return { ok: false, reason: `provider openrouter requires ${configPath}` };
    }
    const match = /openrouter_key\s*=\s*["']([^"']*)["']/.exec(source);
    const key = match?.[1]?.trim() ?? "";
    if (!key || key === "xxx" || key === "fake-key") {
      return {
        ok: false,
        reason: "provider openrouter is not configured: set configs/global_configs.py openrouter_key or rerun with --provider unified",
      };
    }
  }
  if (args.provider === "unified") {
    if (!process.env.TOOLATHLON_OPENAI_BASE_URL) {
      return {
        ok: false,
        reason: "provider unified requires TOOLATHLON_OPENAI_BASE_URL",
      };
    }
  }
  return { ok: true };
}

async function findFiles(root: string, basename: string, predicate: (filePath: string) => boolean = () => true): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.name === basename && predicate(next)) found.push(next);
    }
  }
  await walk(root);
  return found;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
