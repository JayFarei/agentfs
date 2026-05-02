import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OutlookScorerAgentSpec } from "../datafetch/db/finqa_outlook.js";
import { atlasfsHome } from "../trajectory/recorder.js";

export type StoredAgentSpec = OutlookScorerAgentSpec;

export class LocalAgentStore {
  constructor(private readonly baseDir = atlasfsHome()) {}

  private tenantDir(tenantId: string): string {
    return path.join(this.baseDir, "agents", tenantId);
  }

  async save(tenantId: string, spec: StoredAgentSpec): Promise<{ jsonPath: string }> {
    const dir = this.tenantDir(tenantId);
    await mkdir(dir, { recursive: true });
    const jsonPath = path.join(dir, `${spec.agentName}.json`);
    await writeFile(jsonPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    return { jsonPath };
  }

  async list(tenantId: string): Promise<StoredAgentSpec[]> {
    const dir = this.tenantDir(tenantId);
    try {
      const entries = await readdir(dir);
      return Promise.all(
        entries
          .filter((entry) => entry.endsWith(".json"))
          .map(async (entry) => JSON.parse(await readFile(path.join(dir, entry), "utf8")) as StoredAgentSpec)
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async findByCapability(
    tenantId: string,
    capability: StoredAgentSpec["capability"]
  ): Promise<StoredAgentSpec | null> {
    const agents = await this.list(tenantId);
    return agents.find((agent) => agent.capability === capability) ?? null;
  }

  async findByName(tenantId: string, agentName: string): Promise<StoredAgentSpec | null> {
    const agents = await this.list(tenantId);
    return agents.find((agent) => agent.agentName === agentName) ?? null;
  }
}
