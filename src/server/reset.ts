import { rm, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { atlasfsHome } from "../trajectory/recorder.js";
import type { ResetResponse, TenantId } from "./types.js";
import type { TrajectoryRecord } from "../trajectory/recorder.js";

async function rmDirCount(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir);
    count = entries.filter((e) => e.endsWith(".json")).length;
    await rm(dir, { recursive: true, force: true });
  } catch {
    // not present
  }
  return count;
}

async function deleteJsonsMatching(
  dir: string,
  predicate: (rec: { tenantId?: string }, file: string) => boolean
): Promise<number> {
  let count = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const file = path.join(dir, entry);
    try {
      const rec = JSON.parse(await readFile(file, "utf8")) as { tenantId?: string };
      if (predicate(rec, file)) {
        await unlink(file);
        count += 1;
      }
    } catch {
      // skip malformed
    }
  }
  return count;
}

export async function resetTenant(tenantId: TenantId): Promise<ResetResponse> {
  const baseDir = atlasfsHome();

  const procedures = await rmDirCount(path.join(baseDir, "procedures", tenantId));
  const agents = await rmDirCount(path.join(baseDir, "agents", tenantId));
  const trajectories = await deleteJsonsMatching(
    path.join(baseDir, "trajectories"),
    (rec) => rec.tenantId === tenantId
  );
  const drafts = await deleteJsonsMatching(
    path.join(baseDir, "drafts"),
    (rec) => rec.tenantId === tenantId
  );

  return {
    tenant: tenantId,
    removed: { procedures, trajectories, agents, drafts }
  };
}
