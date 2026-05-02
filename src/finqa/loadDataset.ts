import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFinqaRecord } from "./types.js";

export type LoadFinqaDatasetOptions = {
  dataset?: "dev" | "train" | "test" | "private_test";
  limit?: number;
  filename?: string;
  rootDir?: string;
};

export async function loadRawFinqaDataset(options: LoadFinqaDatasetOptions = {}): Promise<RawFinqaRecord[]> {
  const dataset = options.dataset ?? "dev";
  const rootDir = options.rootDir ?? process.cwd();
  const datasetPath = path.join(rootDir, "data", "FinQA", "FinQA-main", "dataset", `${dataset}.json`);
  const raw = JSON.parse(await readFile(datasetPath, "utf8")) as RawFinqaRecord[];
  const filtered = options.filename ? raw.filter((record) => record.filename === options.filename) : raw;
  return typeof options.limit === "number" ? filtered.slice(0, options.limit) : filtered;
}
