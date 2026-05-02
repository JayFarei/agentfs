import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import { FixtureTaskAgentRuntime } from "../../src/datafetch/db/finqa_agent.js";
import { FixtureObserverRuntime } from "../../src/datafetch/db/finqa_observe.js";
import { FixtureOutlookAgentRuntime } from "../../src/datafetch/db/finqa_outlook.js";
import { loadLocalDemoCases, type RunQueryResult, type RunnerBackend } from "../../src/runner.js";
import { readTrajectory, type PrimitiveCallRecord, type TrajectoryRecord } from "../../src/trajectory/recorder.js";

export const testTenantId = "financial-analyst";

export type EvolutionHarness = {
  baseDir: string;
  tenantId: typeof testTenantId;
  backend: RunnerBackend;
  observerRuntime: FixtureObserverRuntime;
  taskAgentRuntime: FixtureTaskAgentRuntime;
  outlookAgentRuntime: FixtureOutlookAgentRuntime;
};

export type ArtifactSnapshot = {
  trajectories: string[];
  drafts: string[];
  reviewEvents: string[];
  procedures: string[];
  agents: string[];
  all: string[];
};

type ArtifactCategory = Exclude<keyof ArtifactSnapshot, "all">;

export async function createEvolutionHarness(prefix = "atlasfs-evolution-"): Promise<EvolutionHarness> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const cases = await loadLocalDemoCases();
  return {
    baseDir,
    tenantId: testTenantId,
    backend: { kind: "local", cases },
    observerRuntime: new FixtureObserverRuntime(),
    taskAgentRuntime: new FixtureTaskAgentRuntime(),
    outlookAgentRuntime: new FixtureOutlookAgentRuntime()
  };
}

export async function artifactSnapshot(
  baseDir: string,
  tenantId = testTenantId
): Promise<ArtifactSnapshot> {
  return {
    trajectories: await listRelativeFiles(path.join(baseDir, "trajectories")),
    drafts: await listRelativeFiles(path.join(baseDir, "drafts")),
    reviewEvents: await listRelativeFiles(path.join(baseDir, "review-events")),
    procedures: await listRelativeFiles(path.join(baseDir, "procedures", tenantId)),
    agents: await listRelativeFiles(path.join(baseDir, "agents", tenantId)),
    all: await listRelativeFiles(baseDir)
  };
}

export async function expectCleanEvolutionHome(baseDir: string, tenantId = testTenantId): Promise<void> {
  const snapshot = await artifactSnapshot(baseDir, tenantId);
  expect(snapshot.all).toEqual([]);
}

export function addedFiles(
  before: ArtifactSnapshot,
  after: ArtifactSnapshot,
  category: ArtifactCategory
): string[] {
  const previous = new Set(before[category]);
  return after[category].filter((file) => !previous.has(file));
}

export function removedFiles(
  before: ArtifactSnapshot,
  after: ArtifactSnapshot,
  category: ArtifactCategory
): string[] {
  const current = new Set(after[category]);
  return before[category].filter((file) => !current.has(file));
}

export function expectOnlyArtifactDelta(
  before: ArtifactSnapshot,
  after: ArtifactSnapshot,
  expected: Partial<Record<ArtifactCategory, number>>
): void {
  const categories: ArtifactCategory[] = ["trajectories", "drafts", "reviewEvents", "procedures", "agents"];
  for (const category of categories) {
    expect(addedFiles(before, after, category), category).toHaveLength(expected[category] ?? 0);
    expect(removedFiles(before, after, category), `${category} removals`).toEqual([]);
  }
}

export function callNames(source: RunQueryResult | TrajectoryRecord | unknown[]): string[] {
  const calls = Array.isArray(source) ? source : source.calls;
  return calls.map((call) => (call as PrimitiveCallRecord).primitive);
}

export async function readTrajectoryForRun(
  baseDir: string,
  result: RunQueryResult
): Promise<TrajectoryRecord> {
  if (!result.trajectoryId) {
    throw new Error("Expected run result to include a trajectory id");
  }
  const trajectory = await readTrajectory(result.trajectoryId, baseDir);
  expect(callNames(trajectory)).toEqual(callNames(result));
  return trajectory;
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function readProcedureJson<T>(
  baseDir: string,
  tenantId: string,
  procedureName: string
): Promise<T> {
  return readJson<T>(path.join(baseDir, "procedures", tenantId, `${procedureName}.json`));
}

export async function readProcedureSource(baseDir: string, tenantId: string, procedureName: string): Promise<string> {
  return readFile(path.join(baseDir, "procedures", tenantId, `${procedureName}.ts`), "utf8");
}

export async function readAgentJson<T>(baseDir: string, tenantId: string, agentName: string): Promise<T> {
  return readJson<T>(path.join(baseDir, "agents", tenantId, `${agentName}.json`));
}

export async function readReviewEvents<T>(baseDir: string, draftId: string): Promise<T[]> {
  const content = await readFile(path.join(baseDir, "review-events", `${draftId}.jsonl`), "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function listRelativeFiles(dir: string, prefix = ""): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const relativePath = path.join(prefix, entry.name);
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listRelativeFiles(fullPath, relativePath)));
      } else if (entry.isFile() || (await isFile(fullPath))) {
        files.push(relativePath);
      }
    }
    return files.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
