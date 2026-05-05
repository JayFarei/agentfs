// Regression test for the multi-tenant observer routing bug.
//
// Before the fix, `createServer()` pinned the observer to a single tenantId
// at boot (defaulting to "demo-tenant"). When a session for any other
// tenant ran a snippet, the trajectory's tenantId mismatched the observer's
// pinned id and the gate filtered the trajectory as a "tenant mismatch"
// skip — silently dropping all crystallisation for non-default tenants.
//
// The fix: omit tenantId at install time. The Observer's gate then accepts
// trajectories for any tenant (`this.tenantId === null` → skip the check)
// and the worker writes to lib/<trajectory.tenantId>/. This test proves
// both branches.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TrajectoryRecord } from "../src/sdk/index.js";
import { Observer } from "../src/observer/worker.js";

function buildCrystallisableTrajectory(tenantId: string): TrajectoryRecord {
  return {
    id: "traj_multi_tenant",
    tenantId,
    question: "test",
    mode: "novel",
    createdAt: new Date().toISOString(),
    calls: [
      {
        index: 0,
        primitive: "db.cases.findSimilar",
        input: { query: "test", limit: 5 },
        output: [
          { filename: "X/2020/page_1.pdf", question: "q", searchableText: "y" },
        ],
        startedAt: new Date().toISOString(),
        durationMs: 0,
      },
      {
        index: 1,
        primitive: "lib.pickFiling",
        input: {
          question: "test",
          candidates: [{ filename: "X/2020/page_1.pdf" }],
        },
        output: { filename: "X/2020/page_1.pdf" },
        startedAt: new Date().toISOString(),
        durationMs: 0,
      },
    ],
  };
}

async function writeTrajectory(
  baseDir: string,
  trajectory: TrajectoryRecord,
): Promise<void> {
  const dir = path.join(baseDir, "trajectories");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${trajectory.id}.json`),
    JSON.stringify(trajectory, null, 2),
    "utf8",
  );
}

describe("observer multi-tenant routing", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-obs-mt-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("rejects a trajectory whose tenant doesn't match the observer's pinned tenant", async () => {
    const observer = new Observer({ baseDir, tenantId: "demo-tenant" });
    await writeTrajectory(baseDir, buildCrystallisableTrajectory("alice"));
    const result = await observer.observe("traj_multi_tenant");
    expect(result.kind).toBe("skipped");
    if (result.kind === "skipped") {
      expect(result.reason).toContain("tenant");
      expect(result.reason).toContain("alice");
      expect(result.reason).toContain("demo-tenant");
    }
  });

  it("accepts a trajectory for any tenant when no tenantId is pinned at install", async () => {
    // Construct the observer without a tenantId — same code path
    // createServer() now takes when DATAFETCH_TENANT is unset.
    const observer = new Observer({ baseDir });
    await writeTrajectory(baseDir, buildCrystallisableTrajectory("alice"));
    const result = await observer.observe("traj_multi_tenant");
    // Must NOT skip on tenant mismatch. It will skip downstream (no
    // LibraryResolver registered in this isolated test), but that's a
    // different gate — we only care that the tenant filter passed.
    if (result.kind === "skipped") {
      expect(result.reason).not.toContain("tenant");
      expect(result.reason).not.toContain("alice");
    } else {
      expect(result.kind).toBe("crystallised");
    }
  });
});
