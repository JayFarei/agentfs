import { promises as fsp } from "node:fs";
import path from "node:path";

type ResultRecord = {
  trajectoryId?: string;
  phase?: "plan" | "execute";
  crystallisable?: boolean;
  exitCode?: number;
  mode?: string;
  callPrimitives?: string[];
};

type TrajectoryRecord = {
  id?: string;
  createdAt?: string;
  question?: string;
};

type Artifact = {
  trajectoryId: string;
  phase: "plan" | "execute";
  dir: string;
  createdAt: string;
  result: ResultRecord;
  source: string;
  stdout: string;
  stderr: string;
};

export async function renderSessionNarrative(args: {
  baseDir: string;
  sessionId: string;
}): Promise<string> {
  const artifacts = await loadArtifacts(args);
  const learnedInterfaceNames = await loadLearnedInterfaceNames(args.baseDir);
  const plans = artifacts.filter((a) => a.phase === "plan");
  const executes = artifacts.filter((a) => a.phase === "execute");
  const failed = artifacts.filter((a) => (a.result.exitCode ?? 0) !== 0);
  const learnedExecutes = executes.filter((a) =>
    (a.result.callPrimitives ?? []).some((p) =>
      isLearnedInterfacePrimitive(p, learnedInterfaceNames),
    ),
  );

  const lines: string[] = [];
  lines.push(`# datafetch session narrative`);
  lines.push("");
  lines.push(`session: ${args.sessionId}`);
  lines.push(`baseDir: ${args.baseDir}`);
  lines.push(
    `artifacts: ${plans.length} plan, ${executes.length} execute, ${failed.length} failed`,
  );
  if (executes.length > 1) {
    lines.push(
      `contract: violated one-execute boundary (${executes.length} execute artifacts)`,
    );
  } else if (executes.length === 1) {
    lines.push(`contract: one execute artifact`);
  } else {
    lines.push(`contract: no execute artifact`);
  }
  if (learnedExecutes.length > 0) {
    lines.push(
      `reuse: ${learnedExecutes.length} execute artifact(s) invoked learned interfaces`,
    );
  } else {
    lines.push(`reuse: no execute artifact invoked a learned interface`);
  }
  lines.push("");
  lines.push("## timeline");
  lines.push("");

  for (const artifact of artifacts) {
    lines.push(renderArtifact(artifact));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function loadLearnedInterfaceNames(baseDir: string): Promise<Set<string>> {
  const names = new Set<string>();
  const root = path.join(baseDir, "lib");
  let tenantDirs: import("node:fs").Dirent[];
  try {
    tenantDirs = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return names;
  }

  for (const tenantDir of tenantDirs) {
    if (!tenantDir.isDirectory()) continue;
    const dir = path.join(root, tenantDir.name);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const file = path.join(dir, entry.name);
      try {
        const content = await fsp.readFile(file, "utf8");
        if (/@shape-hash:\s*[0-9a-f]{8,}/.test(content)) {
          names.add(entry.name.slice(0, -3));
        }
      } catch {
        // Ignore unreadable files; diagnostics should stay best-effort.
      }
    }
  }
  return names;
}

function isLearnedInterfacePrimitive(
  primitive: string,
  learnedInterfaceNames: Set<string>,
): boolean {
  if (!primitive.startsWith("lib.")) return false;
  const name = primitive.slice("lib.".length);
  return learnedInterfaceNames.has(name) || name.startsWith("crystallise_");
}

async function loadArtifacts(args: {
  baseDir: string;
  sessionId: string;
}): Promise<Artifact[]> {
  const sessionDir = path.join(args.baseDir, "sessions", args.sessionId);
  const dirs = [
    ...(await listArtifactDirs(
      path.join(sessionDir, "plan", "attempts"),
      "plan",
    )),
    ...(await listArtifactDirs(path.join(sessionDir, "execute"), "execute")),
  ];
  const artifacts = await Promise.all(dirs.map(loadArtifact));
  return artifacts
    .filter((a): a is Artifact => a !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function listArtifactDirs(
  parent: string,
  phase: "plan" | "execute",
): Promise<Array<{ dir: string; phase: "plan" | "execute" }>> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(parent, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ dir: path.join(parent, entry.name), phase }));
}

async function loadArtifact(args: {
  dir: string;
  phase: "plan" | "execute";
}): Promise<Artifact | null> {
  const result = await readJson<ResultRecord>(path.join(args.dir, "result.json"));
  if (!result) return null;
  const trajectory = await readJson<TrajectoryRecord>(
    path.join(args.dir, "trajectory.json"),
  );
  const trajectoryId =
    result.trajectoryId ?? trajectory?.id ?? path.basename(args.dir);
  const sourceName = args.phase === "execute" ? "execute.ts" : "source.ts";
  return {
    trajectoryId,
    phase: args.phase,
    dir: args.dir,
    createdAt: trajectory?.createdAt ?? idTimestamp(trajectoryId),
    result,
    source: await readText(path.join(args.dir, sourceName)),
    stdout: await readText(path.join(args.dir, "stdout.txt")),
    stderr: await readText(path.join(args.dir, "stderr.txt")),
  };
}

function renderArtifact(artifact: Artifact): string {
  const calls = artifact.result.callPrimitives ?? [];
  const lines: string[] = [];
  const exit = artifact.result.exitCode ?? "?";
  const mode = artifact.result.mode ?? "?";
  lines.push(
    `### ${artifact.phase.toUpperCase()} ${artifact.trajectoryId} (${mode}, exit ${exit})`,
  );
  if (calls.length > 0) lines.push(`calls: ${calls.join(" -> ")}`);
  else lines.push(`calls: none recorded`);
  if (artifact.phase === "execute") {
    const eligible =
      artifact.result.crystallisable === false ? "not crystallisable" : "crystallisable";
    lines.push(`learning: ${eligible}`);
  }
  if (artifact.source.trim()) {
    lines.push("");
    lines.push("source:");
    lines.push(codeBlock(compact(artifact.source), "ts"));
  }
  if (artifact.stdout.trim()) {
    lines.push("");
    lines.push("stdout:");
    lines.push(codeBlock(snippet(artifact.stdout), "text"));
  }
  if (artifact.stderr.trim()) {
    lines.push("");
    lines.push("stderr:");
    lines.push(codeBlock(snippet(artifact.stderr), "text"));
  }
  return lines.join("\n");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return "";
    throw err;
  }
}

function idTimestamp(id: string): string {
  const match = id.match(/traj_(\d{14})_/);
  if (!match || !match[1]) return id;
  return match[1];
}

function compact(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function snippet(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 2400) return trimmed;
  return `${trimmed.slice(0, 2400)}\n... truncated ...`;
}

function codeBlock(body: string, lang: string): string {
  return ["```" + lang, body, "```"].join("\n");
}
