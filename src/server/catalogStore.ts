import { promises as fsp } from "node:fs";
import path from "node:path";

import { defaultBaseDir } from "../paths.js";
import type { MountSource } from "../adapter/publishMount.js";

export type CatalogSourceRecord = {
  id: string;
  title: string;
  adapter: "huggingface" | "atlas";
  uri: string;
  sourceUrl: string;
  mountId: string;
  source: MountSource;
  status: "ready" | "failed";
  addedAt: string;
  updatedAt: string;
  initializedAt?: string;
  target?: string;
  description?: string;
  license?: string;
  splits?: Array<{ config: string; split: string; rows?: number }>;
};

type CatalogState = {
  version: 1;
  sources: Record<string, CatalogSourceRecord>;
};

export class CatalogStore {
  private readonly file: string;

  constructor(opts: { baseDir?: string } = {}) {
    const baseDir = opts.baseDir ?? defaultBaseDir();
    this.file = path.join(baseDir, "catalog.json");
  }

  async upsert(record: CatalogSourceRecord): Promise<CatalogSourceRecord> {
    const state = await this.read();
    state.sources[record.id] = record;
    await this.write(state);
    return record;
  }

  async get(id: string): Promise<CatalogSourceRecord | null> {
    const state = await this.read();
    return state.sources[id] ?? null;
  }

  async list(): Promise<CatalogSourceRecord[]> {
    const state = await this.read();
    return Object.values(state.sources).sort((a, b) => a.id.localeCompare(b.id));
  }

  private async read(): Promise<CatalogState> {
    try {
      const raw = await fsp.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as CatalogState;
      return {
        version: 1,
        sources: parsed.sources ?? {},
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return { version: 1, sources: {} };
      throw err;
    }
  }

  private async write(state: CatalogState): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(this.file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}
