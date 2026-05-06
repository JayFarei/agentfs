import { promises as fsp } from "node:fs";
import path from "node:path";

import type { TrajectoryRecord } from "../sdk/index.js";

export type WorkspaceHeadDecision =
  | { kind: "not-workspace" }
  | {
      kind: "head";
      workspaceRoot: string;
      commit: string;
      allowOverwrite: true;
    }
  | { kind: "stale"; reason: string };

export type ResolveWorkspaceHeadOpts = {
  timeoutMs?: number;
  pollMs?: number;
};

type HeadFile = {
  commit?: unknown;
  trajectoryId?: unknown;
};

export async function resolveWorkspaceHeadForTrajectory(
  trajectory: TrajectoryRecord,
  opts: ResolveWorkspaceHeadOpts = {},
): Promise<WorkspaceHeadDecision> {
  if (trajectory.phase !== "commit" || !trajectory.sourcePath) {
    return { kind: "not-workspace" };
  }

  const workspaceRoot = await findWorkspaceRoot(path.dirname(trajectory.sourcePath));
  if (!workspaceRoot) return { kind: "not-workspace" };

  const timeoutMs = opts.timeoutMs ?? 2_000;
  const pollMs = opts.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastReason = "workspace HEAD.json was not written";

  while (true) {
    const head = await readHead(path.join(workspaceRoot, "result", "HEAD.json"));
    if (head) {
      const headTrajectory = typeof head.trajectoryId === "string" ? head.trajectoryId : "";
      const commit = typeof head.commit === "string" ? head.commit : "";
      if (headTrajectory === trajectory.id) {
        return {
          kind: "head",
          workspaceRoot,
          commit,
          allowOverwrite: true,
        };
      }
      lastReason = `workspace HEAD is ${headTrajectory || "<missing>"}; trajectory is ${trajectory.id}`;
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  }

  return { kind: "stale", reason: lastReason };
}

async function findWorkspaceRoot(start: string): Promise<string | null> {
  let dir = path.resolve(start);
  while (true) {
    try {
      const st = await fsp.stat(path.join(dir, ".datafetch", "workspace.json"));
      if (st.isFile()) return dir;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function readHead(file: string): Promise<HeadFile | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as HeadFile;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
