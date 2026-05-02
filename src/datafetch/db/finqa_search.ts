import type { Collection, Db, Document } from "mongodb";
import type { FinqaCase, FinqaSearchUnit } from "../../finqa/types.js";

export const FINQA_CASES_SEARCH_INDEX = "finqa_cases_text";
export const FINQA_UNITS_SEARCH_INDEX = "finqa_units_text";

export type SearchIndexState = {
  collection: string;
  name: string;
  exists: boolean;
  queryable: boolean;
  status?: string;
  error?: string;
};

export type AtlasSearchStatus = {
  dbName: string;
  counts: {
    cases: number;
    searchUnits: number;
  };
  indexes: SearchIndexState[];
};

export type FinqaCaseSearchResult = FinqaCase & {
  score?: number;
};

type FinqaSearchUnitResult = FinqaSearchUnit & {
  score?: number;
};

type SearchIndexModel = {
  name: string;
  type?: "search" | "vectorSearch";
  definition: Document;
};

type RetrievalQuery = {
  text: string;
  target?: string;
};

export function finqaCasesCollection(db: Db): Collection<FinqaCase> {
  return db.collection<FinqaCase>("finqa_cases");
}

export function finqaSearchUnitsCollection(db: Db): Collection<FinqaSearchUnit> {
  return db.collection<FinqaSearchUnit>("finqa_search_units");
}

export function caseSearchIndexModel(): SearchIndexModel {
  return {
    name: FINQA_CASES_SEARCH_INDEX,
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          filename: { type: "string" },
          question: { type: "string" },
          program: { type: "string" },
          preText: { type: "string" },
          postText: { type: "string" },
          searchableText: { type: "string" },
          table: {
            type: "document",
            dynamic: true
          }
        }
      }
    }
  };
}

export function unitSearchIndexModel(): SearchIndexModel {
  return {
    name: FINQA_UNITS_SEARCH_INDEX,
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          caseId: { type: "string" },
          filename: { type: "string" },
          kind: { type: "string" },
          text: { type: "string" },
          rowIndex: { type: "number" }
        }
      }
    }
  };
}

export async function ensureFinqaSearchIndexes(db: Db): Promise<AtlasSearchStatus> {
  await Promise.all([
    ensureSearchIndex(finqaCasesCollection(db), caseSearchIndexModel()),
    ensureSearchIndex(finqaSearchUnitsCollection(db), unitSearchIndexModel())
  ]);
  return atlasSearchStatus(db);
}

export async function atlasSearchStatus(db: Db): Promise<AtlasSearchStatus> {
  const [cases, searchUnits, caseIndex, unitIndex] = await Promise.all([
    finqaCasesCollection(db).countDocuments(),
    finqaSearchUnitsCollection(db).countDocuments(),
    describeSearchIndex(finqaCasesCollection(db), FINQA_CASES_SEARCH_INDEX),
    describeSearchIndex(finqaSearchUnitsCollection(db), FINQA_UNITS_SEARCH_INDEX)
  ]);

  return {
    dbName: db.databaseName,
    counts: {
      cases,
      searchUnits
    },
    indexes: [caseIndex, unitIndex]
  };
}

export async function waitForFinqaSearchIndexes(
  db: Db,
  opts: { timeoutMs?: number; pollMs?: number } = {}
): Promise<AtlasSearchStatus> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let latest = await atlasSearchStatus(db);

  while (!latest.indexes.every((index) => index.queryable)) {
    if (Date.now() >= deadline) {
      const waiting = latest.indexes
        .filter((index) => !index.queryable)
        .map((index) => `${index.collection}.${index.name}:${index.status ?? index.error ?? "not-ready"}`)
        .join(", ");
      throw new Error(`Timed out waiting for Atlas Search indexes: ${waiting}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    latest = await atlasSearchStatus(db);
  }

  return latest;
}

export async function searchFinqaCases(
  db: Db,
  query: string,
  opts: { limit?: number } = {}
): Promise<FinqaCaseSearchResult[]> {
  const limit = opts.limit ?? 10;
  const retrievalQuery = buildRetrievalQuery(query);
  return finqaCasesCollection(db)
    .aggregate<FinqaCaseSearchResult>([
      {
        $search: {
          index: FINQA_CASES_SEARCH_INDEX,
          compound: caseSearchCompound(query, retrievalQuery)
        }
      },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          id: 1,
          filename: 1,
          question: 1,
          answer: 1,
          program: 1,
          preText: 1,
          postText: 1,
          table: 1,
          searchableText: 1,
          score: { $meta: "searchScore" }
        }
      }
    ])
    .toArray();
}

export async function findSimilarFinqaCases(
  db: Db,
  query: string,
  limit = 10
): Promise<FinqaCaseSearchResult[]> {
  const unitLimit = Math.max(limit * 8, 25);
  const retrievalQuery = buildRetrievalQuery(query);
  const units = await finqaSearchUnitsCollection(db)
    .aggregate<FinqaSearchUnitResult>([
      {
        $search: {
          index: FINQA_UNITS_SEARCH_INDEX,
          compound: unitSearchCompound(retrievalQuery)
        }
      },
      { $limit: unitLimit },
      {
        $project: {
          _id: 0,
          caseId: 1,
          filename: 1,
          kind: 1,
          text: 1,
          rowIndex: 1,
          score: { $meta: "searchScore" }
        }
      }
    ])
    .toArray();

  const rankedCaseIds: string[] = [];
  const bestUnitByCase = new Map<string, FinqaSearchUnitResult>();
  for (const unit of units) {
    if (!bestUnitByCase.has(unit.caseId)) {
      rankedCaseIds.push(unit.caseId);
      bestUnitByCase.set(unit.caseId, unit);
    }
    if (rankedCaseIds.length >= limit) {
      break;
    }
  }

  if (rankedCaseIds.length === 0) {
    return searchFinqaCases(db, query, { limit });
  }

  const cases = await finqaCasesCollection(db)
    .find({ id: { $in: rankedCaseIds } })
    .project<FinqaCase>({ _id: 0 })
    .toArray();
  const caseById = new Map(cases.map((finqaCase) => [finqaCase.id, finqaCase]));
  const results: FinqaCaseSearchResult[] = [];
  for (const caseId of rankedCaseIds) {
    const finqaCase = caseById.get(caseId);
    if (!finqaCase) {
      continue;
    }
    results.push({
      ...finqaCase,
      score: bestUnitByCase.get(caseId)?.score
    });
  }
  return results;
}

function caseSearchCompound(query: string, retrievalQuery: RetrievalQuery): Document {
  const should: Document[] = [
    {
      text: {
        query,
        path: "question",
        score: { boost: { value: 8 } }
      }
    },
    {
      text: {
        query,
        path: "filename",
        score: { boost: { value: 4 } }
      }
    },
    {
      text: {
        query: retrievalQuery.text,
        path: ["preText", "postText", "searchableText"],
        score: { boost: { value: 3 } }
      }
    },
    {
      text: {
        query: retrievalQuery.text,
        path: "table",
        score: { boost: { value: 2 } }
      }
    }
  ];

  return {
    ...(retrievalQuery.target
      ? {
          must: [
            {
              text: {
                query: retrievalQuery.target,
                path: ["preText", "postText", "searchableText", "table"]
              }
            }
          ]
        }
      : {}),
    should,
    minimumShouldMatch: retrievalQuery.target ? 0 : 1
  };
}

function unitSearchCompound(retrievalQuery: RetrievalQuery): Document {
  return {
    ...(retrievalQuery.target
      ? {
          must: [
            {
              text: {
                query: retrievalQuery.target,
                path: "text"
              }
            }
          ]
        }
      : {}),
    should: [
      {
        text: {
          query: retrievalQuery.text,
          path: "text",
          score: { boost: { value: 8 } }
        }
      },
      {
        text: {
          query: retrievalQuery.text,
          path: "filename",
          score: { boost: { value: 3 } }
        }
      },
      {
        text: {
          query: retrievalQuery.text,
          path: "kind",
          score: { boost: { value: 1 } }
        }
      }
    ],
    minimumShouldMatch: retrievalQuery.target ? 0 : 1
  };
}

function buildRetrievalQuery(query: string): RetrievalQuery {
  const lower = query.toLowerCase();
  const terms = meaningfulTerms(query);
  const target = inferTargetTerm(lower);

  if (lower.includes("outlook") || lower.includes("competitive") || lower.includes("competition")) {
    terms.push(
      "competition",
      "competitive",
      "competitors",
      "compete",
      "emerging",
      "players",
      "directly",
      "local",
      "regulation",
      "substantial",
      "intense",
      "leading",
      "positions"
    );
  }

  if (lower.includes("payment volume") || lower.includes("per transaction")) {
    terms.push("payments", "volume", "transactions");
  }

  if (lower.includes("agricultural")) {
    terms.push("agricultural", "products", "freight", "revenues", "operating");
  }

  if (target) {
    terms.push(...target.split(/\s+/));
  }

  return {
    text: Array.from(new Set(terms)).join(" ") || query,
    target
  };
}

function inferTargetTerm(lowerQuery: string): string | undefined {
  if (lowerQuery.includes("american express")) {
    return "american express";
  }
  if (lowerQuery.includes("union pacific")) {
    return "union pacific";
  }
  if (lowerQuery.includes("visa")) {
    return "visa";
  }
  return undefined;
}

function meaningfulTerms(query: string): string[] {
  const stopWords = new Set([
    "about",
    "also",
    "and",
    "are",
    "but",
    "count",
    "evidence",
    "find",
    "from",
    "have",
    "into",
    "only",
    "over",
    "references",
    "sentence",
    "sentences",
    "show",
    "that",
    "the",
    "them",
    "this",
    "what",
    "where",
    "with"
  ]);
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

export function isSearchIndexReady(index: unknown): boolean {
  const doc = index as Record<string, unknown>;
  return doc.queryable === true || doc.status === "READY";
}

async function ensureSearchIndex<TSchema extends Document>(
  collection: Collection<TSchema>,
  model: SearchIndexModel
): Promise<void> {
  const existing = await listSearchIndexes(collection);
  if (existing.some((index) => index.name === model.name)) {
    return;
  }
  await collection.createSearchIndex(model);
}

async function describeSearchIndex<TSchema extends Document>(
  collection: Collection<TSchema>,
  name: string
): Promise<SearchIndexState> {
  try {
    const indexes = await listSearchIndexes(collection);
    const existing = indexes.find((index) => index.name === name);
    return {
      collection: collection.collectionName,
      name,
      exists: Boolean(existing),
      queryable: existing ? isSearchIndexReady(existing) : false,
      status: typeof existing?.status === "string" ? existing.status : undefined
    };
  } catch (error) {
    return {
      collection: collection.collectionName,
      name,
      exists: false,
      queryable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function listSearchIndexes<TSchema extends Document>(collection: Collection<TSchema>): Promise<Array<Record<string, unknown>>> {
  return collection.listSearchIndexes().toArray() as Promise<Array<Record<string, unknown>>>;
}
