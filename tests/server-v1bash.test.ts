import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBashApp } from "../src/server/v1bash.js";
import { DiskMountReader, type MountReader } from "../src/bash/mountReader.js";
import { StubSnippetRuntime } from "../src/bash/snippetRuntime.js";

async function buildBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "v1bash-"));
  // Seed a minimal mount so DiskMountReader can serve /db/<mount>/.
  const mountId = "demo-mount";
  const mountDir = path.join(baseDir, "mounts", mountId);
  const collDir = path.join(mountDir, "rows");
  await mkdir(collDir, { recursive: true });
  await writeFile(
    path.join(mountDir, "rows.ts"),
    `// generated\nexport interface Row { id: string }\nexport const SCHEMA_VERSION = "sha256:test" as const;\nexport declare const rows: { findExact(filter: Partial<Row>, limit?: number): Promise<Row[]> };\n`,
    "utf8",
  );
  await writeFile(
    path.join(mountDir, "README.md"),
    "# demo-mount\n",
    "utf8",
  );
  await writeFile(
    path.join(collDir, "_descriptor.json"),
    JSON.stringify({ kind: "documents", cardinality: { rows: 0 }, fields: {}, affordances: ["findExact"], polymorphic_variants: null }),
    "utf8",
  );
  await writeFile(
    path.join(collDir, "_samples.json"),
    "[]",
    "utf8",
  );
  await writeFile(
    path.join(collDir, "_stats.json"),
    JSON.stringify({ rows: 0, presence: {}, cardinality: {} }),
    "utf8",
  );
  return baseDir;
}

describe("createBashApp", () => {
  let baseDir: string;
  let mountReader: MountReader;

  beforeEach(async () => {
    baseDir = await buildBaseDir();
    mountReader = new DiskMountReader({ baseDir });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  function postBash(app: ReturnType<typeof createBashApp>, body: unknown) {
    return app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("rejects invalid JSON with 400", async () => {
    const app = createBashApp({
      mountReader,
      snippetRuntime: new StubSnippetRuntime(),
      libraryResolver: null,
      baseDir,
    });
    const res = await postBash(app, "not-json{");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
  });

  it("rejects malformed body shape with 400 + issues array", async () => {
    const app = createBashApp({
      mountReader,
      snippetRuntime: new StubSnippetRuntime(),
      libraryResolver: null,
      baseDir,
    });
    const res = await postBash(app, { sessionId: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid_request");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("executes a bash command and returns stdout/stderr/exitCode", async () => {
    const app = createBashApp({
      mountReader,
      snippetRuntime: new StubSnippetRuntime(),
      libraryResolver: null,
      baseDir,
    });
    const res = await postBash(app, {
      sessionId: "sess-1",
      tenantId: "t",
      mountIds: ["demo-mount"],
      command: "ls /db",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    expect(typeof body.stdout).toBe("string");
    expect(typeof body.stderr).toBe("string");
    expect(typeof body.exitCode).toBe("number");
    expect(body.stdout).toContain("demo-mount");
  });

  it("seeds the VFS root with the server-maintained AGENTS.md when present", async () => {
    await writeFile(
      path.join(baseDir, "AGENTS.md"),
      "# Generated Workspace Memory\n\nvalidated plan\n",
      "utf8",
    );
    const app = createBashApp({
      mountReader,
      snippetRuntime: new StubSnippetRuntime(),
      libraryResolver: null,
      baseDir,
    });
    const res = await postBash(app, {
      sessionId: "sess-agents",
      tenantId: "t",
      mountIds: ["demo-mount"],
      command: "cat /AGENTS.md && cat /CLAUDE.md",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stdout: string };
    expect(body.stdout).toContain("Generated Workspace Memory");
    expect(body.stdout).toContain("validated plan");
  });

  it("reuses the cached session across calls with the same sessionId", async () => {
    const app = createBashApp({
      mountReader,
      snippetRuntime: new StubSnippetRuntime(),
      libraryResolver: null,
      baseDir,
    });
    const sessionId = "sess-reuse";
    const first = await postBash(app, {
      sessionId,
      tenantId: "t",
      mountIds: ["demo-mount"],
      command: 'echo "first"',
    });
    expect(first.status).toBe(200);
    const second = await postBash(app, {
      sessionId,
      tenantId: "t",
      mountIds: ["demo-mount"],
      command: 'echo "second"',
    });
    expect(second.status).toBe(200);
    const sb = (await second.json()) as { stdout: string };
    expect(sb.stdout).toContain("second");
  });
});
