import type { Collection, Db, Document, Filter, OptionalUnlessRequiredId } from "mongodb";
import { MongoServerError } from "mongodb";
import { getAtlasDb } from "../datafetch/db/client.js";
import { buildSearchUnits, normalizeFinqaCase } from "../finqa/normalize.js";
import { loadRawFinqaDataset, type LoadFinqaDatasetOptions } from "../finqa/loadDataset.js";

export const finqaDatasets = ["dev", "private_test", "test", "train"] as const;
const writeBatchSize = 1_000;

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

export async function loadAllFinqaToAtlas(options: { reset?: boolean } = {}): Promise<{
  cases: number;
  searchUnits: number;
  dbName: string;
  collectionCounts: {
    cases: number;
    searchUnits: number;
  };
}> {
  const db = await getAtlasDb();
  const casesById = new Map<string, ReturnType<typeof normalizeFinqaCase>>();

  for (const dataset of finqaDatasets) {
    const rawRecords = await loadRawFinqaDataset({ dataset });
    for (const record of rawRecords) {
      const normalized = normalizeFinqaCase(record);
      casesById.set(normalized.id, normalized);
    }
  }

  const cases = Array.from(casesById.values());
  const searchUnits = dedupeSearchUnits(cases.flatMap(buildSearchUnits));
  await writeFinqaDocuments(db, cases, searchUnits, { reset: Boolean(options.reset) });

  return {
    cases: cases.length,
    searchUnits: searchUnits.length,
    dbName: db.databaseName,
    collectionCounts: {
      cases: await db.collection("finqa_cases").countDocuments(),
      searchUnits: await db.collection("finqa_search_units").countDocuments()
    }
  };
}

export async function loadFinqaIntoDb(
  db: Db,
  options: LoadFinqaToAtlasOptions = {}
): Promise<{ cases: number; searchUnits: number; dbName: string }> {
  const rawRecords = await loadRawFinqaDataset(options);
  const cases = rawRecords.map(normalizeFinqaCase);
  const searchUnits = dedupeSearchUnits(cases.flatMap(buildSearchUnits));

  await writeFinqaDocuments(db, cases, searchUnits, { reset: Boolean(options.reset) });

  return {
    cases: cases.length,
    searchUnits: searchUnits.length,
    dbName: db.databaseName
  };
}

async function writeFinqaDocuments(
  db: Db,
  cases: ReturnType<typeof normalizeFinqaCase>[],
  searchUnits: ReturnType<typeof buildSearchUnits>,
  opts: { reset: boolean }
): Promise<void> {
  if (opts.reset) {
    await resetFinqaCollections(db);
  }

  const caseCollection = db.collection<ReturnType<typeof normalizeFinqaCase>>("finqa_cases");
  const searchCollection = db.collection<ReturnType<typeof buildSearchUnits>[number]>("finqa_search_units");

  if (opts.reset) {
    await insertManyInBatches(caseCollection, cases);
    await insertManyInBatches(searchCollection, searchUnits);
  } else {
    await upsertCasesInBatches(caseCollection, cases);
    await upsertSearchUnitsInBatches(searchCollection, searchUnits);
  }

  await ensureFinqaMongoIndexes(caseCollection, searchCollection);
}

async function resetFinqaCollections(db: Db): Promise<void> {
  await Promise.all([dropIfExists(db.collection("finqa_cases")), dropIfExists(db.collection("finqa_search_units"))]);
}

async function dropIfExists(collection: Collection): Promise<void> {
  try {
    await collection.drop();
  } catch (error) {
    if (error instanceof MongoServerError && (error.code === 26 || error.codeName === "NamespaceNotFound")) {
      return;
    }
    throw error;
  }
}

async function ensureFinqaMongoIndexes(
  caseCollection: Collection<ReturnType<typeof normalizeFinqaCase>>,
  searchCollection: Collection<ReturnType<typeof buildSearchUnits>[number]>
): Promise<void> {
  await Promise.all([
    caseCollection.createIndex({ id: 1 }, { unique: true }),
    caseCollection.createIndex({ filename: 1 }),
    caseCollection.createIndex({ searchableText: "text", question: "text", filename: "text" }),
    searchCollection.createIndex({ caseId: 1 }),
    searchCollection.createIndex({ text: "text", filename: "text" })
  ]);
}

async function insertManyInBatches<T extends Document>(collection: Collection<T>, docs: T[]): Promise<void> {
  for (let index = 0; index < docs.length; index += writeBatchSize) {
    await collection.insertMany(docs.slice(index, index + writeBatchSize) as OptionalUnlessRequiredId<T>[], {
      ordered: false
    });
  }
}

async function upsertCasesInBatches(
  collection: Collection<ReturnType<typeof normalizeFinqaCase>>,
  docs: ReturnType<typeof normalizeFinqaCase>[]
): Promise<void> {
  for (let index = 0; index < docs.length; index += writeBatchSize) {
    const batch = docs.slice(index, index + writeBatchSize);
    await collection.bulkWrite(
      batch.map((doc) => ({
        replaceOne: {
          filter: { id: doc.id },
          replacement: doc,
          upsert: true
        }
      })),
      { ordered: false }
    );
  }
}

async function upsertSearchUnitsInBatches(
  collection: Collection<ReturnType<typeof buildSearchUnits>[number]>,
  docs: ReturnType<typeof buildSearchUnits>
): Promise<void> {
  for (let index = 0; index < docs.length; index += writeBatchSize) {
    const batch = docs.slice(index, index + writeBatchSize);
    await collection.bulkWrite(
      batch.map((doc) => {
        const filter: Filter<ReturnType<typeof buildSearchUnits>[number]> = {
          caseId: doc.caseId,
          kind: doc.kind,
          text: doc.text,
          ...(doc.rowIndex === undefined ? { rowIndex: { $exists: false } } : { rowIndex: doc.rowIndex })
        };
        return {
          replaceOne: {
            filter,
            replacement: doc,
            upsert: true
          }
        };
      }),
      { ordered: false }
    );
  }
}

function dedupeSearchUnits(searchUnits: ReturnType<typeof buildSearchUnits>): ReturnType<typeof buildSearchUnits> {
  const searchUnitsByKey = new Map<string, ReturnType<typeof buildSearchUnits>[number]>();
  for (const unit of searchUnits) {
    searchUnitsByKey.set(searchUnitKey(unit), unit);
  }
  return Array.from(searchUnitsByKey.values());
}

function searchUnitKey(unit: ReturnType<typeof buildSearchUnits>[number]): string {
  return [unit.caseId, unit.kind, unit.rowIndex ?? "", unit.text].join("\u0000");
}
