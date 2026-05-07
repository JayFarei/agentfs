import { promises as fsp } from "node:fs";
import path from "node:path";

import { defaultBaseDir } from "../paths.js";

import { jsonRequest, resolveServerUrl } from "./httpClient.js";
import { writeActiveSession, type SessionRecord } from "./session.js";
import type { Flags } from "./types.js";
import {
  DEFAULT_DATAFETCHIGNORE,
  ensureDatafetchIgnore,
  writeWorkspaceSnapshot,
} from "./workspaceSnapshot.js";

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
  clientCallPrimitives?: string[];
  nestedCallPrimitives?: string[];
  nestedCalls?: Array<{
    primitive: string;
    parent: string;
    root: string;
    depth: number;
  }>;
  nestedByRoot?: Array<{ root: string; count: number }>;
  phase?: string;
  crystallisable?: boolean;
  artifactDir?: string;
  answer?: unknown;
  validation?: unknown;
};

type WorkspaceHead = {
  version: 1;
  commit: string;
  trajectoryId?: string;
  intent: string;
  committedIntent?: unknown;
  tenantId: string;
  dataset: string;
  source: string;
  updatedAt: string;
  answerPath: string;
  validationPath: string;
  lineagePath: string;
  replayTestPath: string;
  workspaceSnapshotPath: string;
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
  await fsp.mkdir(path.join(root, "result", "commits"), { recursive: true });
  await fsp.mkdir(path.join(root, "result", "tests"), { recursive: true });
  await fsp.mkdir(path.join(config.baseDir, "lib", config.tenantId), {
    recursive: true,
  });

  await fsp.writeFile(
    path.join(root, ".datafetch", "workspace.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  await ensureDatafetchIgnore(root);
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
    "# lib\n\nTenant-local learned interfaces appear here.\n",
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
    "- `lib/` is the tenant learned-interface surface.",
    "- `scripts/scratch.ts` is for exploratory code.",
    "- `scripts/answer.ts` is the visible intent program to commit.",
    "- `tmp/runs/N/` contains notebook-style outputs from `datafetch run`.",
    "- `result/` contains the final committed answer from `datafetch commit`.",
    "- `result/commits/N/` is append-only commit history for this intent worktree.",
    "- `result/HEAD.json` points at the current accepted commit that supersedes earlier attempts.",
    "- `result/tests/replay.json` is the replay test generated from the current HEAD.",
    "",
    "Intent discipline:",
    "- Treat this folder's `Intent:` line as the worktree purpose.",
    "- If exploration produces a narrower useful sub-intent, keep it in `scripts/answer.ts` and mark the committed answer with `intent: { name, description, parent, relation }`.",
    "- Use `relation: \"same\"` when the answer directly satisfies the worktree intent, `\"derived\"` or `\"sibling\"` for useful sub-trajectories inside it, and `\"drifted\"` or `\"unrelated\"` when the worktree purpose changed.",
    "- Do not silently change the worktree purpose by answering a different question without that `intent` marker.",
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
    sourcePath,
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
  sourcePath?: string;
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

  const resultDir = path.join(args.root, "result");
  const commitsRoot = path.join(resultDir, "commits");
  const commitDir = await nextRunDir(commitsRoot);
  const commitId = path.basename(commitDir);
  const sourceLabel =
    args.sourcePath === undefined
      ? "<inline>"
      : path.relative(args.root, args.sourcePath);
  await writeCommitSnapshot({
    root: args.root,
    dir: commitDir,
    commitId,
    sourceLabel,
    source: args.source,
    response: args.response,
  });

  // Keep result/* as the easy-to-read current view for the client agent,
  // while result/commits/* keeps the append-only worktree history.
  await writeCommitSnapshot({
    root: args.root,
    dir: resultDir,
    commitId,
    sourceLabel,
    source: args.source,
    response: args.response,
  });

  if (validationAccepted(args.response.validation)) {
    const workspace = await readWorkspaceConfig(args.root);
    const committedIntent = answerIntent(args.response.answer);
    const head: WorkspaceHead = {
      version: 1,
      commit: commitId,
      trajectoryId: args.response.trajectoryId,
      intent: workspace.intent,
      ...(committedIntent !== undefined ? { committedIntent } : {}),
      tenantId: workspace.tenantId,
      dataset: workspace.dataset,
      source: sourceLabel,
      updatedAt: new Date().toISOString(),
      answerPath: "answer.json",
      validationPath: "validation.json",
      lineagePath: "lineage.json",
      replayTestPath: path.join("tests", "replay.json"),
      workspaceSnapshotPath: path.join("workspace", "manifest.json"),
    };
    await fsp.writeFile(
      path.join(resultDir, "HEAD.json"),
      `${JSON.stringify(head, null, 2)}\n`,
      "utf8",
    );
  }
}

async function writeCommitSnapshot(args: {
  root: string;
  dir: string;
  commitId: string;
  sourceLabel: string;
  source: string;
  response: SnippetResponse;
}): Promise<void> {
  const { root, dir, commitId, sourceLabel, source, response } = args;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "source.ts"), source, "utf8");
  await fsp.writeFile(
    path.join(dir, "answer.json"),
    `${JSON.stringify(response.answer ?? null, null, 2)}\n`,
    "utf8",
  );
  await fsp.writeFile(
    path.join(dir, "validation.json"),
    `${JSON.stringify(response.validation ?? null, null, 2)}\n`,
    "utf8",
  );
  await fsp.writeFile(path.join(dir, "answer.md"), renderAnswerMarkdown(response), "utf8");
  await copyLineage(response, path.join(dir, "lineage.json"));
  const replay = await buildReplayTest({
    root,
    commitId,
    source: sourceLabel,
    response,
  });
  const testsDir = path.join(dir, "tests");
  await fsp.mkdir(testsDir, { recursive: true });
  await fsp.writeFile(
    path.join(testsDir, "replay.json"),
    `${JSON.stringify(replay, null, 2)}\n`,
    "utf8",
  );
  await writeWorkspaceSnapshot({
    root,
    targetDir: path.join(dir, "workspace"),
  });
}

async function copyLineage(
  response: SnippetResponse,
  target: string,
): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
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

async function buildReplayTest(args: {
  root: string;
  commitId: string;
  source: string;
  response: SnippetResponse;
}): Promise<Record<string, unknown>> {
  const workspace = await readWorkspaceConfig(args.root);
  const answer = normalizeObject(args.response.answer);
  const validation = normalizeObject(args.response.validation);
  const committedIntent = answerIntent(args.response.answer);
  return {
    version: 1,
    kind: "workspace-head-replay",
    commit: args.commitId,
    trajectoryId: args.response.trajectoryId,
    tenantId: workspace.tenantId,
    dataset: workspace.dataset,
    intent: workspace.intent,
    ...(committedIntent !== undefined ? { committedIntent } : {}),
    source: args.source,
    expected: {
      status: typeof answer?.["status"] === "string" ? answer["status"] : null,
      ...(committedIntent !== undefined ? { intent: committedIntent } : {}),
      ...(Object.prototype.hasOwnProperty.call(answer ?? {}, "value")
        ? { value: answer?.["value"] }
        : {}),
      ...(typeof answer?.["unit"] === "string" ? { unit: answer["unit"] } : {}),
      evidencePresent: evidencePresent(answer?.["evidence"]),
      derivationPresent: answer?.["derivation"] !== undefined,
      coverage: answer?.["coverage"] ?? null,
      missing: answer?.["missing"] ?? null,
    },
    validation: {
      accepted: validation?.["accepted"] === true,
      learnable: validation?.["learnable"] === true,
      blockers: Array.isArray(validation?.["blockers"])
        ? validation?.["blockers"]
        : [],
    },
    lineage: {
      phase: args.response.phase,
      calls: args.response.callPrimitives ?? [],
      clientCalls: args.response.clientCallPrimitives ?? [],
      nestedCalls: args.response.nestedCalls ?? [],
      nestedByRoot: args.response.nestedByRoot ?? [],
      requiresDb: (args.response.callPrimitives ?? []).some((p) =>
        p.startsWith("db."),
      ),
      requiresLib: (args.response.callPrimitives ?? []).some((p) =>
        p.startsWith("lib."),
      ),
      clientRequiresDb: (args.response.clientCallPrimitives ?? []).some((p) =>
        p.startsWith("db."),
      ),
      clientRequiresLib: (args.response.clientCallPrimitives ?? []).some((p) =>
        p.startsWith("lib."),
      ),
    },
  };
}

function validationAccepted(value: unknown): boolean {
  return normalizeObject(value)?.["accepted"] === true;
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function evidencePresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function answerIntent(value: unknown): unknown | undefined {
  const answer = normalizeObject(value);
  if (!answer || answer["intent"] === undefined) return undefined;
  return answer["intent"];
}

async function readWorkspaceConfig(root: string): Promise<WorkspaceConfig> {
  const raw = await fsp.readFile(
    path.join(root, ".datafetch", "workspace.json"),
    "utf8",
  );
  return JSON.parse(raw) as WorkspaceConfig;
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

// Re-exported for tests and for keeping the workspace template colocated with
// the rest of the mounted-folder materialisation contract.
export { DEFAULT_DATAFETCHIGNORE };

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
