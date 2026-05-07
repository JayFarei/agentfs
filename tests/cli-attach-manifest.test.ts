import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { locateRepoRoot } from "../src/paths.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("datafetch attach and manifest client flow", () => {
  it("persists server/tenant attachment and lists initialized datasets from the manifest", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "df-attach-"));
    tempDirs.push(baseDir);

    await withManifestServer(baseDir, async (serverUrl) => {
      const env = {
        ...process.env,
        DATAFETCH_HOME: baseDir,
        DATAFETCH_SERVER_URL: "",
        DATAFETCH_TENANT: "",
      };

      const attach = await runCli(
        ["attach", serverUrl, "--tenant", "tenant-a"],
        env,
      );
      expect(attach.exitCode).toBe(0);
      expect(attach.stdout).toContain("attached");

      const client = JSON.parse(
        await readFile(path.join(baseDir, "client.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(client).toMatchObject({
        serverUrl,
        tenantId: "tenant-a",
        serverBaseDir: baseDir,
      });

      const list = await runCli(["list", "--json"], env);
      expect(list.exitCode).toBe(0);
      const listed = JSON.parse(list.stdout) as {
        datasets: Array<{ id: string; status: string }>;
      };
      expect(listed.datasets).toEqual([
        { id: "opentraces-devtime", status: "ready" },
      ]);
    });
  });
});

async function withManifestServer<T>(
  baseDir: string,
  fn: (serverUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/health") {
      res.end(JSON.stringify({ ok: true, baseDir }));
      return;
    }
    if (req.url === "/v1/manifest") {
      res.end(
        JSON.stringify({
          version: 1,
          datasets: [{ id: "opentraces-devtime", status: "ready" }],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP fake manifest server address");
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const repoRoot = await locateRepoRoot();
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn("node", [path.join(repoRoot, "bin", "datafetch.mjs"), ...args], {
      cwd: repoRoot,
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
