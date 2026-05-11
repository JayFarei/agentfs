import { describe, expect, it, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  InMemoryMountRuntimeRegistry,
  makeMountRuntime,
  setMountRuntimeRegistry,
} from "../src/adapter/runtime.js";
import {
  setLibraryResolver,
  type CollectionHandle,
  type MountAdapter,
} from "../src/sdk/index.js";
import { DiskLibraryResolver } from "../src/snippet/library.js";
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
    setLibraryResolver(null);
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

  it("auto-invokes top-level main() when declared but not called", async () => {
    const baseDir = await tempBaseDir("df-runtime-autoinvoke-");
    dirs.push(baseDir);

    const runtime = new DiskSnippetRuntime();
    const result = await runtime.run({
      source: [
        'async function main() {',
        '  console.log("inside main");',
        '}',
      ].join("\n"),
      phase: "execute",
      sourcePath: "/workspace/auto/final.ts",
      sessionCtx: {
        sessionId: "sess_autoinvoke",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(0);
    const artifactDir = result.artifactDir!;
    const stdout = await readFile(path.join(artifactDir, "stdout.txt"), "utf8");
    expect(stdout).toBe("inside main\n");
    const stderr = await readFile(path.join(artifactDir, "stderr.txt"), "utf8");
    expect(stderr).toContain("auto-invoking main()");
  });

  it("does not double-invoke main() when the script already calls it", async () => {
    const baseDir = await tempBaseDir("df-runtime-noautoinvoke-");
    dirs.push(baseDir);

    const runtime = new DiskSnippetRuntime();
    const result = await runtime.run({
      source: [
        'let count = 0;',
        'async function main() {',
        '  count += 1;',
        '  console.log("count=" + count);',
        '}',
        'await main();',
      ].join("\n"),
      phase: "execute",
      sourcePath: "/workspace/auto/final.ts",
      sessionCtx: {
        sessionId: "sess_no_double",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(0);
    const artifactDir = result.artifactDir!;
    const stdout = await readFile(path.join(artifactDir, "stdout.txt"), "utf8");
    expect(stdout).toBe("count=1\n");
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

  it("rejects commit runs that do not return df.answer", async () => {
    const baseDir = await tempBaseDir("df-runtime-commit-reject-");
    dirs.push(baseDir);

    const runtime = new DiskSnippetRuntime();
    const result = await runtime.run({
      source: 'console.log("plain output")',
      phase: "commit",
      sessionCtx: {
        sessionId: "sess_commit_reject",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.phase).toBe("commit");
    expect(result.crystallisable).toBe(false);
    expect(result.validation).toMatchObject({
      accepted: false,
      blockers: ["script did not return df.answer(...)"],
    });
    const artifactDir = result.artifactDir!;
    await expect(readFile(path.join(artifactDir, "validation.json"), "utf8")).resolves.toContain(
      "script did not return df.answer",
    );
    await expect(readFile(path.join(artifactDir, "answer.json"), "utf8")).resolves.toBe(
      "null\n",
    );
  });

  it("accepts commit runs that return df.answer with lineage and relative helpers", async () => {
    const baseDir = await tempBaseDir("df-runtime-commit-accept-");
    dirs.push(baseDir);
    const scriptsDir = path.join(baseDir, "workspace", "scripts");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(
      path.join(scriptsDir, "helpers.ts"),
      "export function evidenceRef(id: string) { return { ref: id }; }\n",
      "utf8",
    );

    const adapter: MountAdapter & { close: () => Promise<void> } = {
      id: "commit-adapter",
      capabilities: () => ({ vector: false, lex: true, stream: false, compile: false }),
      probe: async () => ({ collections: [] }),
      sample: async () => [],
      collection: <T>(): CollectionHandle<T> => ({
        findExact: async () => [],
        search: async () => [{ id: "case-1" }] as T[],
        findSimilar: async () => [],
        hybrid: async () => [],
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

    const source = [
      'import { evidenceRef } from "./helpers.ts";',
      'const rows = await df.db.cases.search("revenue", { limit: 1 });',
      "return df.answer({",
      '  status: "answered",',
      "  value: rows.length,",
      "  evidence: [evidenceRef(rows[0].id)],",
      "  coverage: { rows: rows.length },",
      '  derivation: { operation: "count", values: [rows.length] },',
      "});",
    ].join("\n");

    const runtime = new DiskSnippetRuntime();
    const result = await runtime.run({
      source,
      phase: "commit",
      sourcePath: path.join(scriptsDir, "answer.ts"),
      sessionCtx: {
        sessionId: "sess_commit_accept",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.phase).toBe("commit");
    expect(result.crystallisable).toBe(true);
    expect(result.validation).toMatchObject({ accepted: true, learnable: true });
    expect(result.answer).toMatchObject({
      status: "answered",
      value: 1,
      evidence: [{ ref: "case-1" }],
    });
    const artifactDir = result.artifactDir!;
    await expect(readFile(path.join(artifactDir, "commit.ts"), "utf8")).resolves.toContain(
      'import { evidenceRef } from "./helpers.ts";',
    );
    await expect(readFile(path.join(artifactDir, "answer.json"), "utf8")).resolves.toContain(
      '"value": 1',
    );
    await expect(readFile(path.join(artifactDir, "lineage.json"), "utf8")).resolves.toContain(
      "db.cases.search",
    );
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

  it("records nested implementation work separately from the outer lib call", async () => {
    const baseDir = await tempBaseDir("df-runtime-call-scope-");
    dirs.push(baseDir);
    const libDir = path.join(baseDir, "lib", "tenant-a");
    await mkdir(libDir, { recursive: true });
    await writeFile(
      path.join(libDir, "inner.ts"),
      [
        'import { fn } from "@datafetch/sdk";',
        'import * as v from "valibot";',
        "",
        "export const inner = fn({",
        '  intent: "inner helper",',
        "  examples: [{ input: {}, output: { ok: true } }],",
        "  input: v.object({}),",
        "  output: v.unknown(),",
        "  body: async () => ({ ok: true }),",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(libDir, "outer.ts"),
      [
        'import { fn } from "@datafetch/sdk";',
        'import * as v from "valibot";',
        "",
        "declare const df: any;",
        "",
        "export const outer = fn({",
        '  intent: "outer learned interface",',
        "  examples: [{ input: {}, output: { count: 1 } }],",
        "  input: v.object({}),",
        "  output: v.unknown(),",
        "  body: async () => {",
        '    const rows = await df.db.cases.search("revenue", { limit: 1 });',
        "    const inner = await df.lib.inner({});",
        "    return { count: rows.length, inner: inner.value };",
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    setLibraryResolver(new DiskLibraryResolver({ baseDir }));

    const adapter: MountAdapter & { close: () => Promise<void> } = {
      id: "scope-adapter",
      capabilities: () => ({ vector: false, lex: true, stream: false, compile: false }),
      probe: async () => ({ collections: [] }),
      sample: async () => [],
      collection: <T>(): CollectionHandle<T> => ({
        findExact: async () => [],
        search: async () => [{ id: "case-1" }] as T[],
        findSimilar: async () => [],
        hybrid: async () => [],
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
      source: "const out = await df.lib.outer({}); console.log(JSON.stringify(out.value));",
      phase: "commit",
      sessionCtx: {
        sessionId: "sess_call_scope",
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });

    expect(result.exitCode).toBe(1);
    const trajectory = await readTrajectory(result.trajectoryId!, baseDir);
    expect(trajectory.calls.map((call) => call.primitive)).toEqual([
      "db.cases.search",
      "lib.inner",
      "lib.outer",
    ]);
    expect(trajectory.calls[0]?.scope).toMatchObject({
      depth: 1,
      parentPrimitive: "lib.outer",
      rootPrimitive: "lib.outer",
      callPath: ["lib.outer"],
    });
    expect(trajectory.calls[1]?.scope).toMatchObject({
      depth: 1,
      parentPrimitive: "lib.outer",
      rootPrimitive: "lib.outer",
      callPath: ["lib.outer"],
    });
    expect(trajectory.calls[2]?.scope).toBeUndefined();
  });
});

function rows(limit: number | undefined): Array<{ id: number }> {
  return Array.from({ length: limit ?? 0 }, (_v, id) => ({ id }));
}
