import { readFile } from "node:fs/promises";
import path from "node:path";
import { atlasfsHome } from "../trajectory/recorder.js";
import { readWorkspaceManifest } from "./runtime.js";

export type AtlasHydrationPlan = {
  dbName: string;
  collections: Array<{
    dataset: string;
    collection: string;
    sourceFile: string;
    targetCollection: string;
    documentCount: number;
  }>;
};

export async function planAtlasHydration(args: {
  baseDir?: string;
  dbName?: string;
} = {}): Promise<AtlasHydrationPlan> {
  const baseDir = args.baseDir ?? atlasfsHome();
  const manifest = await readWorkspaceManifest(baseDir);
  if (!manifest) {
    throw new Error(`No AtlasFS workspace found at ${baseDir}. Run atlasfs init first.`);
  }
  const collections = [];
  for (const dataset of manifest.datasets) {
    for (const collection of dataset.collections) {
      const sourceFile = path.join(baseDir, "data", dataset.id, `${collection}.jsonl`);
      collections.push({
        dataset: dataset.id,
        collection,
        sourceFile,
        targetCollection: collection,
        documentCount: await countJsonlRows(sourceFile)
      });
    }
  }
  return {
    dbName: args.dbName ?? process.env.ATLAS_DB_NAME ?? process.env.MONGODB_DB_NAME ?? "atlasfs_hackathon",
    collections
  };
}

async function countJsonlRows(file: string): Promise<number> {
  const text = await readFile(file, "utf8");
  return text.split("\n").filter(Boolean).length;
}
