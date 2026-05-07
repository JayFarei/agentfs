import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { closeAllMounts } from "../src/adapter/runtime.js";
import { createServer } from "../src/server/server.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await closeAllMounts();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("tenant history", () => {
  it("records committed snippet events under the tenant namespace", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "df-tenant-history-"));
    tempDirs.push(baseDir);
    const { app } = await createServer({ baseDir });

    const sessionRes = await app.request("/v1/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant-a", mountIds: [] }),
    });
    expect(sessionRes.status).toBe(200);
    const session = (await sessionRes.json()) as { sessionId: string };

    const snippetRes = await app.request("/v1/snippets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        phase: "commit",
        sourcePath: "/workspace/scripts/answer.ts",
        source: [
          "return df.answer({",
          '  status: "answered",',
          '  value: "ok",',
          '  evidence: [{ ref: "manual:test" }],',
          '  derivation: { operation: "constant" }',
          "});",
        ].join("\n"),
      }),
    });
    expect(snippetRes.status).toBe(200);

    const events = await readFile(
      path.join(baseDir, "tenants", "tenant-a", "events.jsonl"),
      "utf8",
    );
    const lines = events.trim().split("\n").map((line) => JSON.parse(line) as {
      kind: string;
      tenantId: string;
      phase: string;
      sessionId: string;
    });
    expect(lines).toContainEqual(
      expect.objectContaining({
        kind: "snippet.commit",
        tenantId: "tenant-a",
        phase: "commit",
        sessionId: session.sessionId,
      }),
    );

    const latest = JSON.parse(
      await readFile(
        path.join(baseDir, "tenants", "tenant-a", "refs", "latest.json"),
        "utf8",
      ),
    ) as { sessionId: string; phase: string; answerStatus: string };
    expect(latest).toMatchObject({
      sessionId: session.sessionId,
      phase: "commit",
      answerStatus: "answered",
    });
    await expect(
      readFile(
        path.join(
          baseDir,
          "tenants",
          "tenant-a",
          "episodes",
          session.sessionId,
          "commits",
          "001",
          "source.ts",
        ),
        "utf8",
      ),
    ).resolves.toContain("df.answer");
  });
});
