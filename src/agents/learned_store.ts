import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { atlasfsHome } from "../trajectory/recorder.js";

/**
 * A typed Flue-backed agent the observer minted at runtime for an off-script
 * question. Stored alongside `LocalAgentStore`'s outlook specs but with a
 * `learned-` filename prefix so the legacy outlook flow never sees these.
 *
 * The shape is deliberately kept simple — capability is a free string here,
 * unlike `OutlookScorerAgentSpec.capability` which is the literal type
 * `"negative_outlook_reference_scoring"`.
 */
export type LearnedAgentSpec = {
  agentName: string;
  capability: string;
  description: string;
  prompt: string;
  inputSchema: unknown;
  outputSchema: unknown;
  observer: "fixture" | "anthropic" | "flue";
  createdAt: string;
};

function fileSafe(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class LocalLearnedAgentStore {
  constructor(private readonly baseDir = atlasfsHome()) {}

  private tenantDir(tenantId: string): string {
    return path.join(this.baseDir, "agents", tenantId);
  }

  async save(tenantId: string, spec: LearnedAgentSpec): Promise<{ jsonPath: string }> {
    const dir = this.tenantDir(tenantId);
    await mkdir(dir, { recursive: true });
    const jsonPath = path.join(dir, `learned-${fileSafe(spec.agentName)}.json`);
    await writeFile(jsonPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    return { jsonPath };
  }

  async list(tenantId: string): Promise<LearnedAgentSpec[]> {
    const dir = this.tenantDir(tenantId);
    try {
      const entries = await readdir(dir);
      return Promise.all(
        entries
          .filter((entry) => entry.startsWith("learned-") && entry.endsWith(".json"))
          .map(async (entry) =>
            JSON.parse(await readFile(path.join(dir, entry), "utf8")) as LearnedAgentSpec
          )
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async findByName(tenantId: string, name: string): Promise<LearnedAgentSpec | null> {
    const all = await this.list(tenantId);
    return all.find((a) => a.agentName === name) ?? null;
  }

  async findByCapability(tenantId: string, capability: string): Promise<LearnedAgentSpec | null> {
    const all = await this.list(tenantId);
    return all.find((a) => a.capability === capability) ?? null;
  }
}
