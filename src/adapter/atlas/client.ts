// Atlas client lifecycle, scoped to AtlasMountAdapter.
//
// Deliberately isolated from `src/datafetch/db/client.ts` (which Wave 5
// deletes). The adapter receives the URI explicitly via constructor; the
// `ATLAS_URI` env var is read here only as a convenience fallback for
// adapter-internal callers (e.g., the smoke test).
//
// Per design.md §10 (data gravity): substrate credentials live on the data
// plane and never leak to the agent client.

import { MongoClient, type Db } from "mongodb";

export type AtlasClientConfig = {
  uri: string;
  db: string;
};

export class AtlasClient {
  private readonly uri: string;
  private readonly dbName: string;
  private client: MongoClient | null = null;
  private connectPromise: Promise<MongoClient> | null = null;

  constructor(config: AtlasClientConfig) {
    if (!config.uri) {
      throw new Error(
        "AtlasClient requires a non-empty `uri`. Pass it via publishMount({source: atlasMount({uri, db})}).",
      );
    }
    if (!config.db) {
      throw new Error(
        "AtlasClient requires a non-empty `db`. Pass it via publishMount({source: atlasMount({uri, db})}).",
      );
    }
    this.uri = config.uri;
    this.dbName = config.db;
  }

  async connect(): Promise<MongoClient> {
    if (this.client) {
      return this.client;
    }
    if (!this.connectPromise) {
      const client = new MongoClient(this.uri);
      this.connectPromise = client.connect().then((c) => {
        this.client = c;
        return c;
      });
    }
    return this.connectPromise;
  }

  async db(): Promise<Db> {
    const client = await this.connect();
    return client.db(this.dbName);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connectPromise = null;
    }
  }

  get databaseName(): string {
    return this.dbName;
  }
}

// Convenience for adapter-internal callers (smoke test, ad-hoc scripts) that
// want to read ATLAS_URI / ATLAS_DB_NAME from the env without going through
// the publishMount facade. The adapter's own constructor still takes the URI
// explicitly; this helper is separate so production code paths are explicit.
export function atlasClientFromEnv(): AtlasClient {
  const uri = process.env.ATLAS_URI ?? process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "ATLAS_URI (or MONGODB_URI) is not set. Required for AtlasClient when reading from env.",
    );
  }
  const db =
    process.env.ATLAS_DB_NAME ?? process.env.MONGODB_DB_NAME ?? "finqa";
  return new AtlasClient({ uri, db });
}
