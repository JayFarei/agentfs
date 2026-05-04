// AtlasMountAdapter — concrete MountAdapter for MongoDB Atlas.
//
// Per `kb/prd/design.md` §9.1 and `kb/prd/decisions.md` D-002:
//   - Adapter knows the *substrate* (MongoDB, Atlas Search).
//   - Adapter knows nothing about specific datasets.
//   - The bootstrap layer (sample → infer → emit) discovers shape generically.
//
// MVP scope:
//   - capabilities() returns {vector: false, lex: true, stream: true, compile: true}.
//     vector=false because we don't ship Voyage / $rankFusion in MVP (deferred).
//     compile=true is declarative: Atlas can run aggregation pipelines, but
//     `runCompiled()` itself is unimplemented in MVP and throws.
//   - probe() lists collections, counts rows, detects existing search indexes.
//   - sample() uses $sample (note: Atlas $sample is NOT seedable; documented).
//     `_id` is stripped at sample time so the inference doesn't classify
//     Mongo's ObjectId as an `id` role on top of the dataset's own id field.
//   - collection<T>() returns a CollectionHandle with the four-method contract.
//
// `_id` projection rule (per Wave 2 review):
//   `findExact` / `search` strip `_id` by default. For collections whose
//   inferred descriptor has NO field with `role: "id"`, the handle preserves
//   `_id` and emits it as `_mongoId` (a stringified ObjectId) so downstream
//   snippets can still address rows. The decision is made per-call from
//   the descriptor cached on the adapter; bare-collection calls before
//   bootstrap stay strip-by-default. FinQA collections all carry an `id`
//   field so the live corpus is unaffected.
//
//   - runCompiled / watch / ensureIndex are declared for contract stability and
//     throw "not implemented in MVP — adapter capability deferred" per scope.

import type { Collection, Db, Document } from "mongodb";

import type {
  MountAdapter,
  MountInventory,
  CollectionInventoryEntry,
  CollectionHandle,
  SourceCapabilities,
  SampleOpts,
  CompiledPlan,
  IndexHint,
  SchemaChangeEvent,
  MountDescriptor,
} from "../../sdk/index.js";

import { AtlasClient } from "./client.js";
import {
  detectSearchIndex,
  fallbackTextSearch,
  pickSearchPathsFromDescriptor,
  runCompoundSearch,
  type SearchPaths,
} from "./search.js";

export type AtlasMountAdapterConfig = {
  uri: string;
  db: string;
  // The mount id is the mount-level handle the bootstrap pipeline writes
  // under (`<baseDir>/mounts/<mountId>/`). Stored on the adapter for
  // logging / event emission only — the adapter itself doesn't write files.
  mountId: string;
};

export class AtlasMountAdapter implements MountAdapter {
  // The adapter id is `"atlas"` per design.md §9.1's example. The
  // mount-level identifier is `mountId` (e.g., "finqa-2024") and lives on
  // the instance, separate from the adapter family id.
  readonly id = "atlas" as const;
  readonly mountId: string;

  private readonly client: AtlasClient;

  // Cached descriptors per collection. Populated by `setDescriptor` from
  // the bootstrap pipeline so the search compound query can pick paths
  // from inferred field roles. Empty before bootstrap completes.
  private readonly descriptors = new Map<string, MountDescriptor>();
  private readonly searchIndexes = new Map<string, string>();

  constructor(config: AtlasMountAdapterConfig) {
    this.client = new AtlasClient({ uri: config.uri, db: config.db });
    this.mountId = config.mountId;
  }

  // --- MountAdapter contract ------------------------------------------------

  capabilities(): SourceCapabilities {
    return {
      vector: false, // MVP scope: Voyage / $rankFusion deferred.
      lex: true, // Atlas Search drives `search`; client-side fallback otherwise.
      stream: true, // Atlas change streams supported (watch() unimpl in MVP).
      compile: true, // Atlas can run native pipelines (runCompiled() unimpl in MVP).
    };
  }

  async probe(): Promise<MountInventory> {
    const db = await this.client.db();
    const list = await db.listCollections({}, { nameOnly: false }).toArray();

    const collections: CollectionInventoryEntry[] = [];
    for (const meta of list) {
      // Skip system collections (Atlas itself, schema metadata).
      if (typeof meta.name !== "string") continue;
      if (meta.name.startsWith("system.")) continue;

      const coll = db.collection<Document>(meta.name);
      const rows = await coll.estimatedDocumentCount();
      const indexName = await detectSearchIndex(coll);
      if (indexName) this.searchIndexes.set(meta.name, indexName);

      collections.push({
        name: meta.name,
        rows,
        ...(indexName ? { indexes: [indexName] } : {}),
      });
    }

    return { collections };
  }

  async sample(collection: string, opts: SampleOpts): Promise<unknown[]> {
    const db = await this.client.db();
    const coll = db.collection<Document>(collection);
    const size = Math.max(1, opts.size);
    // NOTE: Atlas / MongoDB $sample is NOT seedable. The `opts.seed` field
    // is accepted on the SampleOpts contract for adapter parity but ignored
    // here. Bootstrap fingerprinting therefore uses the *inferred shape* as
    // the deterministic anchor, not the sample contents.
    const docs = await coll
      .aggregate<Document>([
        { $sample: { size } },
        { $project: { _id: 0 } },
      ])
      .toArray();
    return docs;
  }

  collection<T>(name: string): CollectionHandle<T> {
    return makeCollectionHandle<T>({
      adapter: this,
      name,
      getDb: () => this.client.db(),
      getDescriptor: () => this.descriptors.get(name) ?? null,
      getSearchIndex: () => this.searchIndexes.get(name) ?? null,
    });
  }

  // Optional methods. Declared on the interface so the contract is stable
  // when later phases land compiled / drift / index work; throw in MVP.

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async runCompiled(
    _plan: CompiledPlan,
    _params: Record<string, unknown>,
  ): Promise<unknown> {
    throw new Error(
      "AtlasMountAdapter.runCompiled: not implemented in MVP — adapter capability deferred",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  watch(_collection: string): AsyncIterable<SchemaChangeEvent> {
    throw new Error(
      "AtlasMountAdapter.watch: not implemented in MVP — adapter capability deferred",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async ensureIndex(_collection: string, _hint: IndexHint): Promise<void> {
    throw new Error(
      "AtlasMountAdapter.ensureIndex: not implemented in MVP — adapter capability deferred",
    );
  }

  // --- Adapter-internal helpers (used by bootstrap pipeline) ----------------

  /**
   * Wired by the bootstrap pipeline once `_descriptor.json` is synthesised.
   * Lets `collection<T>().search` pick paths by field role instead of
   * dynamic-field fallback.
   */
  setDescriptor(name: string, descriptor: MountDescriptor): void {
    this.descriptors.set(name, descriptor);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

// --- CollectionHandle factory ------------------------------------------------

type HandleArgs = {
  adapter: AtlasMountAdapter;
  name: string;
  getDb: () => Promise<Db>;
  getDescriptor: () => MountDescriptor | null;
  getSearchIndex: () => string | null;
};

function makeCollectionHandle<T>(args: HandleArgs): CollectionHandle<T> {
  const { name, getDb, getDescriptor, getSearchIndex } = args;

  const textFieldsFromDescriptor = (descriptor: MountDescriptor | null): string[] => {
    if (!descriptor) return [];
    const out: string[] = [];
    for (const [field, f] of Object.entries(descriptor.fields)) {
      if (f.role === "text") out.push(field);
    }
    return out;
  };

  // Whether to preserve `_id` and emit it as `_mongoId` on returned rows.
  // Triggered when the inferred descriptor has NO field with `role: "id"`.
  // If the descriptor isn't known yet (pre-bootstrap), we strip by default
  // (legacy behaviour; cheaper round-trip and matches FinQA shape).
  const shouldPreserveId = (descriptor: MountDescriptor | null): boolean => {
    if (!descriptor) return false;
    for (const f of Object.values(descriptor.fields)) {
      if (f.role === "id") return false;
    }
    return true;
  };

  // Stringify the Mongo ObjectId on `_id` into `_mongoId`. Drops the raw
  // `_id` so the returned shape stays plain JSON.
  const renameMongoId = (doc: Document): Document => {
    const raw = doc._id;
    if (raw === undefined || raw === null) return doc;
    const stringified = stringifyId(raw);
    const out: Document = { ...doc, _mongoId: stringified };
    delete out._id;
    return out;
  };

  const postProcess = (docs: Document[], descriptor: MountDescriptor | null): Document[] => {
    if (shouldPreserveId(descriptor)) {
      return docs.map(renameMongoId);
    }
    // Default: `_id` was already stripped at the projection stage; nothing
    // to do. Defensive `delete` in case an upstream branch slipped one through.
    return docs.map((d) => {
      if ("_id" in d) {
        const out = { ...d };
        delete out._id;
        return out;
      }
      return d;
    });
  };

  return {
    async findExact(filter: Partial<T>, limit?: number): Promise<T[]> {
      const db = await getDb();
      const coll = db.collection<Document>(name);
      const cap = limit ?? 10;
      const descriptor = getDescriptor();
      const preserve = shouldPreserveId(descriptor);
      // Project `_id` only when we want to preserve it for the rename step.
      const projection = preserve ? {} : { _id: 0 };
      const docs = await coll
        .find(filter as Document)
        .project(projection)
        .limit(cap)
        .toArray();
      return postProcess(docs, descriptor) as T[];
    },

    async search(query: string, opts?: { limit?: number }): Promise<T[]> {
      const db = await getDb();
      const coll = db.collection<Document>(name);
      const limit = opts?.limit ?? 10;
      const indexName = getSearchIndex();
      const descriptor = getDescriptor();
      const paths: SearchPaths = pickSearchPathsFromDescriptor(descriptor);

      const hasAnyPath =
        paths.title.length +
          paths.id.length +
          paths.body.length +
          paths.table.length >
        0;

      const preserve = shouldPreserveId(descriptor);

      if (indexName && hasAnyPath) {
        const docs = await runCompoundSearch<Document>(coll, {
          query,
          paths,
          limit,
          indexName,
          preserveId: preserve,
        });
        return postProcess(docs, descriptor) as T[];
      }

      // No Atlas Search index OR no descriptor yet: fallback to a
      // client-side regex-OR ranked by token overlap.
      const textFields = textFieldsFromDescriptor(descriptor);
      const docs = await fallbackTextSearch<Document>(coll, {
        query,
        limit,
        textFields,
        preserveId: preserve,
      });
      return postProcess(docs, descriptor) as T[];
    },

    async findSimilar(query: string, limit?: number): Promise<T[]> {
      // MVP: findSimilar delegates to search per scope boundary. Vector
      // recall (Voyage embeddings + $rankFusion) is deferred.
      return this.search(query, { limit: limit ?? 10 });
    },

    async hybrid(query: string, opts?: { limit?: number }): Promise<T[]> {
      // MVP: hybrid delegates to search per scope boundary.
      return this.search(query, { limit: opts?.limit ?? 10 });
    },
  };
}

// Stringify a Mongo `_id`. Handles ObjectId (via `.toString()`), string,
// number, and falls back to JSON for anything exotic. Kept tiny so we
// don't pull `bson` typings into the public surface.
function stringifyId(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "object") {
    const obj = raw as { toString?: () => string };
    if (typeof obj.toString === "function") {
      const s = obj.toString();
      // Default Object.prototype.toString returns "[object Object]" — fall
      // through to JSON when toString didn't get overridden.
      if (s !== "[object Object]") return s;
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return "[unstringifiable]";
    }
  }
  return String(raw);
}
