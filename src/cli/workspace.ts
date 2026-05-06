import { promises as fsp } from "node:fs";
import path from "node:path";

import { defaultBaseDir } from "../paths.js";

import { jsonRequest, resolveServerUrl } from "./httpClient.js";
import { writeActiveSession, type SessionRecord } from "./session.js";
import type { Flags } from "./types.js";

type WorkspaceConfig = {
  version: 1;
  sessionId: string;
  tenantId: string;
  mountIds: string[];
  dataset: string;
  intent: string;
  baseDir: string;
  serverUrl: string;
  createdAt: string;
};

type SnippetResponse = {
  stdout: string;
  stderr: string;
  exitCode: number;
  trajectoryId?: string;
  cost?: unknown;
  mode?: string;
  functionName?: string;
  callPrimitives?: string[];
  phase?: string;
  crystallisable?: boolean;
  artifactDir?: string;
  answer?: unknown;
  validation?: unknown;
};

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function jsonFlag(flags: Flags): boolean {
  return flags["json"] === true;
}

function serverUrlFromFlags(flags: Flags): string {
  return resolveServerUrl(flagString(flags, "server")).baseUrl;
}

function baseDirFromFlags(flags: Flags): string {
  const flag = flagString(flags, "base-dir");
  return flag ? path.resolve(flag) : defaultBaseDir();
}

export async function cmdMount(
  _positionals: string[],
  flags: Flags,
): Promise<void> {
  const tenant = flagString(flags, "tenant");
  const dataset = flagString(flags, "dataset") ?? flagString(flags, "mount");
  const intent = flagString(flags, "intent");
  if (!tenant) throw new Error("mount: --tenant <id> is required");
  if (!dataset) throw new Error("mount: --dataset <id> is required");
  if (!intent) throw new Error("mount: --intent <text> is required");

  const baseDir = baseDirFromFlags(flags);
  const serverUrl = serverUrlFromFlags(flags);
  const workspacePath = path.resolve(
    flagString(flags, "path") ?? slugWorkspaceName(dataset, intent),
  );

  if (await pathExists(workspacePath)) {
    throw new Error(`mount: workspace already exists at ${workspacePath}`);
  }

  const record = await jsonRequest<SessionRecord>({
    method: "POST",
    path: "/v1/connect",
    serverUrl,
    body: { tenantId: tenant, mountIds: [dataset] },
  });
  await writeActiveSession(baseDir, record.sessionId);

  const config: WorkspaceConfig = {
    version: 1,
    sessionId: record.sessionId,
    tenantId: record.tenantId,
    mountIds: record.mountIds,
    dataset,
    intent,
    baseDir,
    serverUrl,
    createdAt: new Date().toISOString(),
  };

  await materialiseWorkspace({ root: workspacePath, config });

  if (jsonFlag(flags)) {
    process.stdout.write(
      `${JSON.stringify({ workspace: workspacePath, ...config })}\n`,
    );
    return;
  }
  process.stdout.write(`${workspacePath}\n`);
}

export async function cmdRun(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  await runWorkspaceSnippet({
    positionals,
    flags,
    phase: "run",
    defaultScript: path.join("scripts", "scratch.ts"),
  });
}

export async function cmdCommit(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  await runWorkspaceSnippet({
    positionals,
    flags,
    phase: "commit",
    defaultScript: path.join("scripts", "answer.ts"),
  });
}

async function materialiseWorkspace(args: {
  root: string;
  config: WorkspaceConfig;
}): Promise<void> {
  const { root, config } = args;
  await fsp.mkdir(path.join(root, ".datafetch"), { recursive: true });
  await fsp.mkdir(path.join(root, "scripts"), { recursive: true });
  await fsp.mkdir(path.join(root, "tmp", "runs"), { recursive: true });
  await fsp.mkdir(path.join(root, "result"), { recursive: true });
  await fsp.mkdir(path.join(config.baseDir, "lib", config.tenantId), {
    recursive: true,
  });

  await fsp.writeFile(
    path.join(root, ".datafetch", "workspace.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  await writeAgentMemory(root, config);
  await copyIfExists(
    path.join(config.baseDir, "df.d.ts"),
    path.join(root, "df.d.ts"),
    fallbackManifest(config),
  );
  await linkOrMakeDir(
    path.join(config.baseDir, "mounts", config.dataset),
    path.join(root, "db"),
    `# db\n\nDataset mount \`${config.dataset}\` has not been materialised on disk yet.\n`,
  );
  await linkOrMakeDir(
    path.join(config.baseDir, "lib", config.tenantId),
    path.join(root, "lib"),
    "# lib\n\nTenant-local learned functions appear here.\n",
  );
  await writeScriptTemplates(root, config);
}

async function writeAgentMemory(
  root: string,
  config: WorkspaceConfig,
): Promise<void> {
  const lines = [
    "# datafetch intent workspace",
    "",
    `Intent: ${config.intent}`,
    `Tenant: ${config.tenantId}`,
    `Dataset: ${config.dataset}`,
    "",
    "Use this folder like a small TypeScript worktree around the mounted dataset.",
    "",
    "Important paths:",
    "- `df.d.ts` is the typed executable surface.",
    "- `db/` is read-only dataset context, descriptors, samples, and stats.",
    "- `lib/` is the tenant learned-function surface.",
    "- `scripts/scratch.ts` is for exploratory code.",
    "- `scripts/answer.ts` is the visible intent program to commit.",
    "- `tmp/runs/N/` contains notebook-style outputs from `datafetch run`.",
    "- `result/` contains the final committed answer from `datafetch commit`.",
    "",
    "Workflow:",
    "1. Inspect `df.d.ts`, `db/`, `lib/`, `datafetch apropos`, and `datafetch man`.",
    "2. Use `datafetch run scripts/scratch.ts` to sample and test ideas.",
    "3. Put the repeatable answer logic in `scripts/answer.ts`.",
    "4. `scripts/answer.ts` must return `df.answer(...)` with status, evidence, coverage, and derivation.",
    "5. Run `datafetch commit scripts/answer.ts` and answer from `result/answer.json`.",
    "",
    "The system only learns from committed visible code that passes validation.",
    "",
  ];
  const agents = path.join(root, "AGENTS.md");
  await fsp.writeFile(agents, lines.join("\n"), "utf8");
  try {
    await fsp.symlink("AGENTS.md", path.join(root, "CLAUDE.md"));
  } catch {
    await fsp.writeFile(path.join(root, "CLAUDE.md"), lines.join("\n"), "utf8");
  }
}

async function writeScriptTemplates(
  root: string,
  config: WorkspaceConfig,
): Promise<void> {
  await fsp.writeFile(
    path.join(root, "scripts", "helpers.ts"),
    [
      "export function range(values: number[]) {",
      "  return Math.max(...values) - Math.min(...values);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(root, "scripts", "scratch.ts"),
    [
      `const candidates = await df.db.${defaultCollectionIdent(config)}.search(${JSON.stringify(config.intent)}, { limit: 10 });`,
      "console.log(JSON.stringify({ candidates: candidates.length }, null, 2));",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(root, "scripts", "answer.ts"),
    [
      "// Replace this with the visible, repeatable trajectory for the intent.",
      "// Commit will reject answers that do not return df.answer(...).",
      "return df.answer({",
      '  status: "unsupported",',
      "  evidence: [],",
      '  reason: "answer.ts has not been implemented yet",',
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function runWorkspaceSnippet(args: {
  positionals: string[];
  flags: Flags;
  phase: "run" | "commit";
  defaultScript: string;
}): Promise<void> {
  const workspace = await readWorkspace();
  const eFlag = flagString(args.flags, "e");
  let source: string;
  let sourcePath: string | undefined;
  if (eFlag !== undefined) {
    source = eFlag;
  } else {
    const requested = args.positionals[0] ?? args.defaultScript;
    sourcePath = path.resolve(workspace.root, requested);
    source = await fsp.readFile(sourcePath, "utf8");
  }

  const res = await jsonRequest<SnippetResponse>({
    method: "POST",
    path: "/v1/snippets",
    serverUrl: workspace.config.serverUrl,
    body: {
      sessionId: workspace.config.sessionId,
      source,
      phase: args.phase,
      ...(sourcePath !== undefined ? { sourcePath } : {}),
    },
  });

  await writeWorkspaceResult({
    root: workspace.root,
    phase: args.phase,
    source,
    response: res,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.stdout && !res.stdout.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write("--- envelope ---\n");
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  process.exitCode = res.exitCode;
}

async function writeWorkspaceResult(args: {
  root: string;
  phase: "run" | "commit";
  source: string;
  response: SnippetResponse;
}): Promise<void> {
  if (args.phase === "run") {
    const dir = await nextRunDir(path.join(args.root, "tmp", "runs"));
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "source.ts"), args.source, "utf8");
    await fsp.writeFile(
      path.join(dir, "result.json"),
      `${JSON.stringify(args.response, null, 2)}\n`,
      "utf8",
    );
    await fsp.writeFile(
      path.join(dir, "result.md"),
      renderRunMarkdown(args.response),
      "utf8",
    );
    await copyLineage(args.response, path.join(dir, "lineage.json"));
    return;
  }

  const dir = path.join(args.root, "result");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "source.ts"), args.source, "utf8");
  await fsp.writeFile(
    path.join(dir, "answer.json"),
    `${JSON.stringify(args.response.answer ?? null, null, 2)}\n`,
    "utf8",
  );
  await fsp.writeFile(
    path.join(dir, "validation.json"),
    `${JSON.stringify(args.response.validation ?? null, null, 2)}\n`,
    "utf8",
  );
  await fsp.writeFile(
    path.join(dir, "answer.md"),
    renderAnswerMarkdown(args.response),
    "utf8",
  );
  await copyLineage(args.response, path.join(dir, "lineage.json"));
}

async function copyLineage(
  response: SnippetResponse,
  target: string,
): Promise<void> {
  if (response.artifactDir) {
    try {
      await fsp.copyFile(path.join(response.artifactDir, "trajectory.json"), target);
      return;
    } catch {
      // Fall through to the compact response lineage.
    }
  }
  await fsp.writeFile(
    target,
    `${JSON.stringify(
      {
        trajectoryId: response.trajectoryId,
        phase: response.phase,
        callPrimitives: response.callPrimitives ?? [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function readWorkspace(): Promise<{
  root: string;
  config: WorkspaceConfig;
}> {
  let dir = process.cwd();
  while (true) {
    const file = path.join(dir, ".datafetch", "workspace.json");
    try {
      const raw = await fsp.readFile(file, "utf8");
      return {
        root: dir,
        config: JSON.parse(raw) as WorkspaceConfig,
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("no datafetch workspace found; run `datafetch mount ...` first");
}

async function nextRunDir(root: string): Promise<string> {
  await fsp.mkdir(root, { recursive: true });
  let max = 0;
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const n = Number(entry.name);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return path.join(root, String(max + 1).padStart(3, "0"));
}

function renderRunMarkdown(response: SnippetResponse): string {
  return [
    "# datafetch run",
    "",
    `exitCode: ${response.exitCode}`,
    `trajectoryId: ${response.trajectoryId ?? "none"}`,
    "",
    "```json",
    JSON.stringify(response, null, 2),
    "```",
    "",
  ].join("\n");
}

function renderAnswerMarkdown(response: SnippetResponse): string {
  const validation = response.validation as { accepted?: boolean; blockers?: string[] } | undefined;
  const lines = ["# datafetch committed answer", ""];
  if (validation) {
    lines.push(`accepted: ${validation.accepted === true ? "yes" : "no"}`);
    const blockers = validation.blockers ?? [];
    if (blockers.length > 0) {
      lines.push("");
      lines.push("blockers:");
      for (const blocker of blockers) lines.push(`- ${blocker}`);
    }
    lines.push("");
  }
  lines.push("```json");
  lines.push(JSON.stringify(response.answer ?? null, null, 2));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

async function copyIfExists(
  source: string,
  target: string,
  fallback: string,
): Promise<void> {
  try {
    await fsp.copyFile(source, target);
  } catch {
    await fsp.writeFile(target, fallback, "utf8");
  }
}

async function linkOrMakeDir(
  source: string,
  target: string,
  fallbackReadme: string,
): Promise<void> {
  if (await pathExists(source)) {
    try {
      await fsp.symlink(source, target, "dir");
      return;
    } catch {
      // Symlink may be unavailable on some filesystems; fall through.
    }
  }
  await fsp.mkdir(target, { recursive: true });
  await fsp.writeFile(path.join(target, "README.md"), fallbackReadme, "utf8");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

function slugWorkspaceName(dataset: string, intent: string): string {
  const stop = new Set(["what", "is", "the", "of", "a", "an", "between"]);
  const intentPart = intent
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !stop.has(token))
    .slice(0, 8)
    .join("-");
  return `${dataset}-${intentPart || "intent"}`;
}

function defaultCollectionIdent(config: WorkspaceConfig): string {
  if (config.dataset.toLowerCase().includes("finqa")) return "finqaCases";
  return "cases";
}

function fallbackManifest(config: WorkspaceConfig): string {
  return [
    "// datafetch manifest was not available when this workspace was mounted.",
    `// Tenant: ${config.tenantId}`,
    "declare const df: {",
    "  db: Record<string, unknown>;",
    "  lib: Record<string, (input: unknown) => Promise<unknown>>;",
    "  answer(input: unknown): unknown;",
    "};",
    "",
  ].join("\n");
}
