import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import { Observer } from "../src/observer/worker.js";
import { resolveWorkspaceHeadForTrajectory } from "../src/observer/workspaceHead.js";

const tempDirs: string[] = [];
const ISO = new Date().toISOString();

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function trajectory(sourcePath?: string): TrajectoryRecord {
  return {
    id: "traj_current",
    tenantId: "acme",
    question: "count rows",
    mode: "novel",
    calls: [],
    createdAt: ISO,
    phase: "commit",
    crystallisable: true,
    sourcePath,
    answerValidation: { accepted: true },
  };
}

function crystallisableTrajectory(sourcePath: string): TrajectoryRecord {
  return {
    ...trajectory(sourcePath),
    calls: [
      {
        index: 0,
        primitive: "db.cases.findSimilar",
        input: { query: "count rows", limit: 5 },
        output: [{ id: "case-1", text: "count rows" }],
        startedAt: ISO,
        durationMs: 0,
      },
      {
        index: 1,
        primitive: "lib.pickFiling",
        input: { candidates: [{ id: "case-1" }] },
        output: { id: "case-1" },
        startedAt: ISO,
        durationMs: 0,
      },
    ],
  };
}

async function workspaceWithHead(headTrajectoryId: string): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "df-workspace-head-"));
  tempDirs.push(workspace);
  await mkdir(path.join(workspace, ".datafetch"), { recursive: true });
  await mkdir(path.join(workspace, "scripts"), { recursive: true });
  await mkdir(path.join(workspace, "result"), { recursive: true });
  await writeFile(
    path.join(workspace, ".datafetch", "workspace.json"),
    JSON.stringify({ version: 1, sessionId: "sess", tenantId: "acme" }),
    "utf8",
  );
  await writeFile(
    path.join(workspace, "result", "HEAD.json"),
    `${JSON.stringify({ version: 1, commit: "002", trajectoryId: headTrajectoryId })}\n`,
    "utf8",
  );
  return workspace;
}

describe("resolveWorkspaceHeadForTrajectory", () => {
  it("treats non-workspace trajectories as legacy observer input", async () => {
    await expect(
      resolveWorkspaceHeadForTrajectory(trajectory(undefined), { timeoutMs: 0 }),
    ).resolves.toEqual({ kind: "not-workspace" });
  });

  it("accepts the trajectory currently pointed to by workspace HEAD", async () => {
    const workspace = await workspaceWithHead("traj_current");
    await expect(
      resolveWorkspaceHeadForTrajectory(trajectory(path.join(workspace, "scripts", "answer.ts")), {
        timeoutMs: 0,
      }),
    ).resolves.toMatchObject({
      kind: "head",
      workspaceRoot: workspace,
      commit: "002",
      allowOverwrite: true,
    });
  });

  it("rejects a superseded commit when workspace HEAD points elsewhere", async () => {
    const workspace = await workspaceWithHead("traj_newer");
    const out = await resolveWorkspaceHeadForTrajectory(
      trajectory(path.join(workspace, "scripts", "answer.ts")),
      { timeoutMs: 0 },
    );
    expect(out.kind).toBe("stale");
    if (out.kind === "stale") {
      expect(out.reason).toContain("workspace HEAD is traj_newer");
    }
  });

  it("makes the observer skip workspace commits that are no longer HEAD", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "df-observer-head-"));
    tempDirs.push(baseDir);
    const workspace = await workspaceWithHead("traj_newer");
    const stale = crystallisableTrajectory(path.join(workspace, "scripts", "answer.ts"));
    await mkdir(path.join(baseDir, "trajectories"), { recursive: true });
    await writeFile(
      path.join(baseDir, "trajectories", `${stale.id}.json`),
      `${JSON.stringify(stale, null, 2)}\n`,
      "utf8",
    );

    const observer = new Observer({
      baseDir,
      workspaceHeadTimeoutMs: 0,
    });
    await expect(observer.observe(stale.id)).resolves.toMatchObject({
      kind: "skipped",
      reason: expect.stringContaining("workspace HEAD is traj_newer"),
    });
  });
});
