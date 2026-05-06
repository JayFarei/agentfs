import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { closeAllMounts } from "../src/adapter/runtime.js";
import { locateRepoRoot } from "../src/paths.js";
import { createServer as createDatafetchServer } from "../src/server/server.js";

type CapturedBody = {
  sessionId?: string;
  source?: string;
  phase?: string;
  sourcePath?: string;
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "df-cli-phase-"));
  tempDirs.push(baseDir);
  await writeFile(path.join(baseDir, "active-session"), "sess_cli\n", "utf8");
  return baseDir;
}

async function withSnippetServer<T>(
  fn: (serverUrl: string, bodies: CapturedBody[]) => Promise<T>,
): Promise<T> {
  const bodies: CapturedBody[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as CapturedBody) : {};
      bodies.push(body);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          stdout: "",
          stderr: "",
          exitCode: 0,
          trajectoryId: `traj_${body.phase}`,
          phase: body.phase,
          crystallisable: body.phase === "execute" || body.phase === "commit",
          artifactDir: `/tmp/${body.phase}`,
          mode: body.phase === "execute" ? "novel" : "interpreted",
          callPrimitives: [],
          ...(body.phase === "commit"
            ? {
                answer: {
                  status: "answered",
                  value: 1,
                  evidence: [{ ref: "x" }],
                  derivation: { operation: "count" },
                },
                validation: { accepted: true, learnable: true, blockers: [] },
              }
            : {}),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP server address");
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}`, bodies);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function withDatafetchServer<T>(
  baseDir: string,
  fn: (serverUrl: string) => Promise<T>,
): Promise<T> {
  const { app } = await createDatafetchServer({ baseDir });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once("listening", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("expected TCP server address");
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await closeAllMounts();
  }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const repoRoot = await locateRepoRoot();
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn("node", [path.join(repoRoot, "bin", "datafetch.mjs"), ...args], {
      cwd: cwd ?? repoRoot,
      env,
    });
    child.stdout.on("data", (b: Buffer) => stdoutChunks.push(b));
    child.stderr.on("data", (b: Buffer) => stderrChunks.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code ?? -1,
      });
    });
  });
}

function parseEnvelope(stdout: string): Record<string, unknown> {
  const marker = "--- envelope ---\n";
  const idx = stdout.indexOf(marker);
  if (idx === -1) throw new Error(`missing envelope in stdout:\n${stdout}`);
  return JSON.parse(stdout.slice(idx + marker.length)) as Record<string, unknown>;
}

describe("datafetch plan/execute CLI", () => {
  it("sends explicit phase metadata through the snippets API", async () => {
    const baseDir = await makeBaseDir();
    await withSnippetServer(async (serverUrl, bodies) => {
      const env = {
        ...process.env,
        DATAFETCH_SESSION: "",
        DATAFETCH_HOME: baseDir,
      };

      const plan = await runCli(
        [
          "plan",
          "-e",
          "console.log('draft')",
          "--server",
          serverUrl,
          "--base-dir",
          baseDir,
        ],
        env,
      );
      expect(plan.exitCode).toBe(0);
      expect(plan.stdout).toContain('"phase": "plan"');

      const execute = await runCli(
        [
          "execute",
          "-e",
          "console.log('final')",
          "--server",
          serverUrl,
          "--base-dir",
          baseDir,
        ],
        env,
      );
      expect(execute.exitCode).toBe(0);
      expect(execute.stdout).toContain('"phase": "execute"');

      expect(bodies).toMatchObject([
        {
          sessionId: "sess_cli",
          source: "console.log('draft')",
          phase: "plan",
        },
        {
          sessionId: "sess_cli",
          source: "console.log('final')",
          phase: "execute",
        },
      ]);
    });
  }, 30_000);

  it("drives the intent workspace run/commit facade and writes workspace artifacts", async () => {
    const baseDir = await makeBaseDir();
    const workspace = await mkdtemp(path.join(os.tmpdir(), "df-intent-workspace-"));
    tempDirs.push(workspace);

    await withSnippetServer(async (serverUrl, bodies) => {
      await mkdir(path.join(workspace, ".datafetch"), { recursive: true });
      await mkdir(path.join(workspace, "scripts"), { recursive: true });
      await writeFile(
        path.join(workspace, ".datafetch", "workspace.json"),
        `${JSON.stringify(
          {
            version: 1,
            sessionId: "sess_workspace",
            tenantId: "tenant-a",
            mountIds: ["finqa"],
            dataset: "finqa",
            intent: "count rows",
            baseDir,
            serverUrl,
            createdAt: "2026-05-06T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await writeFile(
        path.join(workspace, "scripts", "scratch.ts"),
        "console.log('scratch')\n",
        "utf8",
      );
      await writeFile(
        path.join(workspace, "scripts", "answer.ts"),
        "return df.answer({ status: 'answered', value: 1, evidence: [{ ref: 'x' }], derivation: { operation: 'count' } })\n",
        "utf8",
      );

      const env = {
        ...process.env,
        DATAFETCH_SESSION: "",
        DATAFETCH_HOME: baseDir,
      };
      const run = await runCli(["run", "scripts/scratch.ts"], env, workspace);
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('"phase": "run"');
      await expect(
        readFile(path.join(workspace, "tmp", "runs", "001", "source.ts"), "utf8"),
      ).resolves.toContain("scratch");
      await expect(
        readFile(path.join(workspace, "tmp", "runs", "001", "result.json"), "utf8"),
      ).resolves.toContain('"phase": "run"');

      const commit = await runCli(["commit", "scripts/answer.ts"], env, workspace);
      expect(commit.exitCode).toBe(0);
      expect(commit.stdout).toContain('"phase": "commit"');
      await expect(
        readFile(path.join(workspace, "result", "answer.json"), "utf8"),
      ).resolves.toContain('"status": "answered"');
      await expect(
        readFile(path.join(workspace, "result", "validation.json"), "utf8"),
      ).resolves.toContain('"accepted": true');

      expect(bodies).toMatchObject([
        {
          sessionId: "sess_workspace",
          phase: "run",
        },
        {
          sessionId: "sess_workspace",
          phase: "commit",
        },
      ]);
      expect(bodies[0]?.sourcePath).toMatch(/scripts\/scratch\.ts$/);
      expect(bodies[1]?.sourcePath).toMatch(/scripts\/answer\.ts$/);
    });
  }, 30_000);

  it("creates real plan and execute artifacts through the server-backed CLI flow", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "df-cli-real-phase-"));
    tempDirs.push(baseDir);

    await withDatafetchServer(baseDir, async (serverUrl) => {
      const env = {
        ...process.env,
        DATAFETCH_SESSION: "",
        DATAFETCH_HOME: baseDir,
        ATLASFS_SKIP_ENV_FILE: "1",
      };

      const session = await runCli(
        [
          "session",
          "new",
          "--tenant",
          "tenant-a",
          "--server",
          serverUrl,
          "--base-dir",
          baseDir,
          "--json",
        ],
        env,
      );
      expect(session.exitCode).toBe(0);

      const plan = await runCli(
        [
          "plan",
          "-e",
          "console.log('draft path')",
          "--server",
          serverUrl,
          "--base-dir",
          baseDir,
        ],
        env,
      );
      expect(plan.exitCode).toBe(0);
      const planEnvelope = parseEnvelope(plan.stdout);
      expect(planEnvelope).toMatchObject({
        phase: "plan",
        crystallisable: false,
        exitCode: 0,
      });
      const planDir = String(planEnvelope["artifactDir"]);
      await expect(readFile(path.join(planDir, "source.ts"), "utf8")).resolves.toContain(
        "draft path",
      );
      await expect(readFile(path.join(planDir, "result.json"), "utf8")).resolves.toContain(
        '"crystallisable": false',
      );

      const execute = await runCli(
        [
          "execute",
          "-e",
          "console.log('committed path')",
          "--server",
          serverUrl,
          "--base-dir",
          baseDir,
        ],
        env,
      );
      expect(execute.exitCode).toBe(0);
      const executeEnvelope = parseEnvelope(execute.stdout);
      expect(executeEnvelope).toMatchObject({
        phase: "execute",
        crystallisable: true,
        exitCode: 0,
      });
      const executeDir = String(executeEnvelope["artifactDir"]);
      await expect(readFile(path.join(executeDir, "execute.ts"), "utf8")).resolves.toContain(
        "committed path",
      );
      await expect(readFile(path.join(executeDir, "result.json"), "utf8")).resolves.toContain(
        '"crystallisable": true',
      );
    });
  }, 30_000);
});
