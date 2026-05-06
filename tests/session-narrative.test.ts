import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renderSessionNarrative } from "../src/cli/sessionNarrative.js";

describe("renderSessionNarrative", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-narrative-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("renders plan and execute artifacts as a chronological narrative", async () => {
    const sessionId = "sess_test";
    await writeArtifact({
      baseDir,
      sessionId,
      phase: "plan",
      id: "traj_20260506120000_plan01",
      source: "const rows = await df.db.cases.search('revenue');",
      stdout: "plan ok\n",
      result: {
        trajectoryId: "traj_20260506120000_plan01",
        phase: "plan",
        exitCode: 0,
        mode: "novel",
        callPrimitives: ["db.cases.search"],
      },
    });
    await writeArtifact({
      baseDir,
      sessionId,
      phase: "execute",
      id: "traj_20260506120100_exec01",
      source: "console.log(await df.lib.rangeTableMetric({ query: 'q' }));",
      stdout: "{\"answer\":190}\n",
      result: {
        trajectoryId: "traj_20260506120100_exec01",
        phase: "execute",
        crystallisable: true,
        exitCode: 0,
        mode: "interpreted",
        callPrimitives: [
          "db.cases.search",
          "lib.rangeTableMetric",
        ],
      },
    });
    await writeLearnedInterface({ baseDir, tenantId: "acme", name: "rangeTableMetric" });

    const rendered = await renderSessionNarrative({ baseDir, sessionId });

    expect(rendered).toContain("artifacts: 1 plan, 1 execute, 0 failed");
    expect(rendered).toContain("contract: one execute artifact");
    expect(rendered).toContain(
      "reuse: 1 execute artifact(s) invoked learned interfaces",
    );
    expect(rendered).toContain("PLAN traj_20260506120000_plan01");
    expect(rendered).toContain("EXECUTE traj_20260506120100_exec01");
    expect(rendered).toContain("lib.rangeTableMetric");
    expect(rendered).toContain("{\"answer\":190}");
  });
});

async function writeArtifact(args: {
  baseDir: string;
  sessionId: string;
  phase: "plan" | "execute";
  id: string;
  source: string;
  stdout: string;
  result: unknown;
}): Promise<void> {
  const dir =
    args.phase === "plan"
      ? path.join(
          args.baseDir,
          "sessions",
          args.sessionId,
          "plan",
          "attempts",
          args.id,
        )
      : path.join(args.baseDir, "sessions", args.sessionId, "execute", args.id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "trajectory.json"),
    `${JSON.stringify({ id: args.id, createdAt: args.id }, null, 2)}\n`,
  );
  await writeFile(path.join(dir, "result.json"), `${JSON.stringify(args.result, null, 2)}\n`);
  await writeFile(
    path.join(dir, args.phase === "plan" ? "source.ts" : "execute.ts"),
    args.source,
  );
  await writeFile(path.join(dir, "stdout.txt"), args.stdout);
  await writeFile(path.join(dir, "stderr.txt"), "");
}

async function writeLearnedInterface(args: {
  baseDir: string;
  tenantId: string;
  name: string;
}): Promise<void> {
  const dir = path.join(args.baseDir, "lib", args.tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${args.name}.ts`),
    "/* ---\nname: rangeTableMetric\ndescription: |\n  test\ntrajectory: traj\nshape-hash: deadbeef\n--- */\n// @shape-hash: deadbeef\nexport const rangeTableMetric = () => null;\n",
  );
}
