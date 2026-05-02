import type { Db } from "mongodb";
import { getAtlasDb } from "../datafetch/db/client.js";
import {
  atlasSearchStatus,
  ensureFinqaSearchIndexes,
  waitForFinqaSearchIndexes,
  type AtlasSearchStatus
} from "../datafetch/db/finqa_search.js";

export async function setupAtlasSearch(options: {
  wait?: boolean;
  timeoutMs?: number;
} = {}): Promise<AtlasSearchStatus> {
  const db = await getAtlasDb();
  return setupAtlasSearchInDb(db, options);
}

export async function setupAtlasSearchInDb(
  db: Db,
  options: { wait?: boolean; timeoutMs?: number } = {}
): Promise<AtlasSearchStatus> {
  await ensureFinqaSearchIndexes(db);
  if (options.wait ?? true) {
    return waitForFinqaSearchIndexes(db, { timeoutMs: options.timeoutMs });
  }
  return atlasSearchStatus(db);
}

export async function getAtlasSearchStatus(): Promise<AtlasSearchStatus> {
  const db = await getAtlasDb();
  return atlasSearchStatus(db);
}
