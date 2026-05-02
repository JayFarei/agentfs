import type { Db } from "mongodb";
import { getAtlasDb } from "../datafetch/db/client.js";
import { buildSearchUnits, normalizeFinqaCase } from "../finqa/normalize.js";
import { loadRawFinqaDataset, type LoadFinqaDatasetOptions } from "../finqa/loadDataset.js";

export type LoadFinqaToAtlasOptions = LoadFinqaDatasetOptions & {
  reset?: boolean;
};

export async function loadFinqaToAtlas(options: LoadFinqaToAtlasOptions = {}): Promise<{
  cases: number;
  searchUnits: number;
  dbName: string;
}> {
  const db = await getAtlasDb();
  return loadFinqaIntoDb(db, options);
}

export async function loadFinqaIntoDb(
  db: Db,
  options: LoadFinqaToAtlasOptions = {}
): Promise<{ cases: number; searchUnits: number; dbName: string }> {
  const rawRecords = await loadRawFinqaDataset(options);
  const cases = rawRecords.map(normalizeFinqaCase);
  const searchUnits = cases.flatMap(buildSearchUnits);

  const caseCollection = db.collection("finqa_cases");
  const searchCollection = db.collection("finqa_search_units");

  if (options.reset) {
    await Promise.all([caseCollection.deleteMany({}), searchCollection.deleteMany({})]);
  }

  if (cases.length > 0) {
    await caseCollection.bulkWrite(
      cases.map((doc) => ({
        replaceOne: {
          filter: { id: doc.id },
          replacement: doc,
          upsert: true
        }
      })),
      { ordered: false }
    );
  }

  if (searchUnits.length > 0) {
    await searchCollection.bulkWrite(
      searchUnits.map((doc) => ({
        replaceOne: {
          filter: {
            caseId: doc.caseId,
            kind: doc.kind,
            rowIndex: doc.rowIndex ?? null,
            text: doc.text
          },
          replacement: doc,
          upsert: true
        }
      })),
      { ordered: false }
    );
  }

  await Promise.all([
    caseCollection.createIndex({ id: 1 }, { unique: true }),
    caseCollection.createIndex({ filename: 1 }),
    caseCollection.createIndex({ searchableText: "text", question: "text", filename: "text" }),
    searchCollection.createIndex({ caseId: 1 }),
    searchCollection.createIndex({ text: "text", filename: "text" })
  ]);

  return {
    cases: cases.length,
    searchUnits: searchUnits.length,
    dbName: db.databaseName
  };
}
