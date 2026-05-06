import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  InMemoryMountRuntimeRegistry,
  makeMountRuntime,
  setMountRuntimeRegistry,
} from "../src/adapter/runtime.js";
import type { CollectionHandle, MountAdapter } from "../src/sdk/index.js";
import { DiskSnippetRuntime } from "../src/snippet/runtime.js";
import { readTrajectory } from "../src/trajectory/recorder.js";

async function tempBaseDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

describe("DiskSnippetRuntime phase artifacts", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
    setMountRuntimeRegistry(new InMemoryMountRuntimeRegistry());
  });

  it("records a plan run as a non-crystallisable session artifact", async () => {
    const baseDir = await tempBaseDir("df-runtime-plan-");
    dirs.push(baseDir);

    const runtime = new DiskSnippetRuntime();
    const result = await runtime.run({
      source: 'console.log("draft plan")',
      phase: "plan",
      sourcePath: "/workspace/plan/attempt.ts",
      sessionCtx: {
        sessionId: "sess_plan",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.phase).toBe("plan");
    expect(result.crystallisable).toBe(false);
    expect(result.artifactDir).toContain(
      path.join("sessions", "sess_plan", "plan", "attempts"),
    );

    const trajectory = await readTrajectory(result.trajectoryId!, baseDir);
    expect(trajectory.phase).toBe("plan");
    expect(trajectory.crystallisable).toBe(false);
    expect(trajectory.sourcePath).toBe("/workspace/plan/attempt.ts");
    expect(trajectory.artifactDir).toBe(result.artifactDir);

    const artifactDir = result.artifactDir!;
    await expect(readFile(path.join(artifactDir, "source.ts"), "utf8")).resolves.toContain(
      'console.log("draft plan")',
    );
    await expect(readFile(path.join(artifactDir, "stdout.txt"), "utf8")).resolves.toBe(
      "draft plan\n",
    );
    await expect(readFile(path.join(artifactDir, "stderr.txt"), "utf8")).resolves.toBe(
      "",
    );
    const artifactResult = await readJson<{
      trajectoryId: string;
      phase: string;
      crystallisable: boolean;
      exitCode: number;
    }>(path.join(artifactDir, "result.json"));
    expect(artifactResult).toMatchObject({
      trajectoryId: result.trajectoryId,
      phase: "plan",
      crystallisable: false,
      exitCode: 0,
    });
    await expect(readFile(path.join(artifactDir, "trajectory.json"), "utf8")).resolves.toContain(
      '"phase": "plan"',
    );
  });

  it("records an execute run as a crystallisable committed artifact", async () => {
    const baseDir = await tempBaseDir("df-runtime-execute-");
    dirs.push(baseDir);

    const runtime = new DiskSnippetRuntime();
    const result = await runtime.run({
      source: 'console.log("final answer")',
      phase: "execute",
      sourcePath: "/workspace/execute/final.ts",
      sessionCtx: {
        sessionId: "sess_execute",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.phase).toBe("execute");
    expect(result.crystallisable).toBe(true);
    expect(result.artifactDir).toBe(
      path.join(baseDir, "sessions", "sess_execute", "execute", result.trajectoryId!),
    );

    const trajectory = await readTrajectory(result.trajectoryId!, baseDir);
    expect(trajectory.phase).toBe("execute");
    expect(trajectory.crystallisable).toBe(true);
    expect(trajectory.sourcePath).toBe("/workspace/execute/final.ts");
    expect(trajectory.artifactDir).toBe(result.artifactDir);

    const artifactDir = result.artifactDir!;
    await expect(readFile(path.join(artifactDir, "execute.ts"), "utf8")).resolves.toContain(
      'console.log("final answer")',
    );
    await expect(readFile(path.join(artifactDir, "stdout.txt"), "utf8")).resolves.toBe(
      "final answer\n",
    );
    const artifactResult = await readJson<{
      trajectoryId: string;
      phase: string;
      crystallisable: boolean;
      exitCode: number;
    }>(path.join(artifactDir, "result.json"));
    expect(artifactResult).toMatchObject({
      trajectoryId: result.trajectoryId,
      phase: "execute",
      crystallisable: true,
      exitCode: 0,
    });
  });

  it("bounds plan retrieval calls while leaving execute retrieval unrestricted", async () => {
    const baseDir = await tempBaseDir("df-runtime-plan-limit-");
    dirs.push(baseDir);
    const seenLimits: Array<number | undefined> = [];

    const adapter: MountAdapter & { close: () => Promise<void> } = {
      id: "limit-adapter",
      capabilities: () => ({ vector: false, lex: true, stream: false, compile: false }),
      probe: async () => ({ collections: [] }),
      sample: async () => [],
      collection: <T>(): CollectionHandle<T> => ({
        findExact: async (_filter, limit) => {
          seenLimits.push(limit);
          return rows(limit) as T[];
        },
        search: async (_query, opts) => {
          seenLimits.push(opts?.limit);
          return rows(opts?.limit) as T[];
        },
        findSimilar: async (_query, limit) => {
          seenLimits.push(limit);
          return rows(limit) as T[];
        },
        hybrid: async (_query, opts) => {
          seenLimits.push(opts?.limit);
          return rows(opts?.limit) as T[];
        },
      }),
      close: async () => {},
    };
    const reg = new InMemoryMountRuntimeRegistry();
    setMountRuntimeRegistry(reg);
    reg.register(
      "finqa",
      makeMountRuntime({
        mountId: "finqa",
        adapter,
        identMap: [{ ident: "cases", name: "cases" }],
      }),
    );

    const runtime = new DiskSnippetRuntime();
    const result = await runtime.run({
      source: [
        'const rows = await df.db.cases.findSimilar("revenue query", 50);',
        "console.log(rows.length);",
      ].join("\n"),
      phase: "plan",
      sessionCtx: {
        sessionId: "sess_plan_limit",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("10\n");
    expect(seenLimits).toEqual([10]);
    const trajectory = await readTrajectory(result.trajectoryId!, baseDir);
    expect(trajectory.calls[0]?.input).toMatchObject({ limit: 10 });

    const executeResult = await runtime.run({
      source: [
        'const rows = await df.db.cases.findSimilar("revenue query", 50);',
        "console.log(rows.length);",
      ].join("\n"),
      phase: "execute",
      sessionCtx: {
        sessionId: "sess_execute_limit",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(executeResult.exitCode).toBe(0);
    expect(executeResult.stdout).toBe("50\n");
    expect(seenLimits).toEqual([10, 50]);
    const executeTrajectory = await readTrajectory(executeResult.trajectoryId!, baseDir);
    expect(executeTrajectory.calls[0]?.input).toMatchObject({ limit: 50 });
  });
});

function rows(limit: number | undefined): Array<{ id: number }> {
  return Array.from({ length: limit ?? 0 }, (_v, id) => ({ id }));
}
