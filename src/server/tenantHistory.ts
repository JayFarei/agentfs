import { promises as fsp } from "node:fs";
import path from "node:path";

export type TenantSnippetHistoryArgs = {
  baseDir: string;
  tenantId: string;
  sessionId: string;
  mountIds: string[];
  request: {
    phase?: string;
    sourcePath?: string;
    source: string;
  };
  response: Record<string, unknown>;
  trajectory?: unknown;
};

export async function recordTenantSnippetHistory(
  args: TenantSnippetHistoryArgs,
): Promise<void> {
  const phase = args.request.phase ?? "snippet";
  const tenantRoot = path.join(args.baseDir, "tenants", args.tenantId);
  await fsp.mkdir(tenantRoot, { recursive: true });

  const event = {
    version: 1,
    kind: `snippet.${phase}`,
    createdAt: new Date().toISOString(),
    tenantId: args.tenantId,
    sessionId: args.sessionId,
    mountIds: args.mountIds,
    phase,
    sourcePath: args.request.sourcePath ?? null,
    trajectoryId: args.response["trajectoryId"] ?? null,
    answerStatus: answerStatus(args.response["answer"]),
    validationAccepted: validationAccepted(args.response["validation"]),
  };
  await fsp.appendFile(
    path.join(tenantRoot, "events.jsonl"),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );

  if (phase !== "commit") return;
  const commitDir = await nextCommitDir(
    path.join(tenantRoot, "episodes", args.sessionId, "commits"),
  );
  await fsp.mkdir(commitDir, { recursive: true });
  await fsp.writeFile(path.join(commitDir, "source.ts"), args.request.source, "utf8");
  await writeJson(path.join(commitDir, "response.json"), args.response);
  await writeJson(path.join(commitDir, "answer.json"), args.response["answer"] ?? null);
  await writeJson(
    path.join(commitDir, "validation.json"),
    args.response["validation"] ?? null,
  );
  if (args.trajectory !== undefined) {
    await writeJson(path.join(commitDir, "trajectory.json"), args.trajectory);
  }
  await fsp.mkdir(path.join(tenantRoot, "refs"), { recursive: true });
  await writeJson(path.join(tenantRoot, "refs", "latest.json"), {
    ...event,
    commit: path.basename(commitDir),
    commitPath: path.relative(tenantRoot, commitDir),
  });
}

async function nextCommitDir(root: string): Promise<string> {
  await fsp.mkdir(root, { recursive: true });
  let max = 0;
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const n = Number(entry.name);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return path.join(root, String(max + 1).padStart(3, "0"));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function answerStatus(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const status = (value as Record<string, unknown>)["status"];
  return typeof status === "string" ? status : null;
}

function validationAccepted(value: unknown): boolean | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const accepted = (value as Record<string, unknown>)["accepted"];
  return typeof accepted === "boolean" ? accepted : null;
}
