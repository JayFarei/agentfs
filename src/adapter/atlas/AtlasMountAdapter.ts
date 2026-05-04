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
//   - collection<T>() returns a CollectionHandle with the four-method contract.
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

  return {
    async findExact(filter: Partial<T>, limit?: number): Promise<T[]> {
      const db = await getDb();
      const coll = db.collection<Document>(name);
      const cap = limit ?? 10;
      // Cast: Partial<T> against Document is structurally a Filter for
      // the collection. Driver typings allow it through Document.
      const docs = await coll
        .find(filter as Document)
        .project({ _id: 0 })
        .limit(cap)
        .toArray();
      return docs as T[];
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

      if (indexName && hasAnyPath) {
        const docs = await runCompoundSearch<Document>(coll, {
          query,
          paths,
          limit,
          indexName,
        });
        return docs as T[];
      }

      // No Atlas Search index OR no descriptor yet: fallback to a
      // client-side regex-OR ranked by token overlap.
      const textFields = textFieldsFromDescriptor(descriptor);
      const docs = await fallbackTextSearch<Document>(coll, {
        query,
        limit,
        textFields,
      });
      return docs as T[];
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
