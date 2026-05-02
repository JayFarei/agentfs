import { MongoClient, type Db } from "mongodb";
import { loadProjectEnv } from "../../env.js";

let cachedClient: MongoClient | undefined;

export function getAtlasDbName(): string {
  return process.env.ATLAS_DB_NAME ?? process.env.MONGODB_DB_NAME ?? "atlasfs_hackathon";
}

export async function getAtlasDb(): Promise<Db> {
  loadProjectEnv();
  const uri = process.env.MONGODB_URI ?? process.env.ATLAS_URI;
  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI or ATLAS_URI. Set it to the connection string for gabriele.farei@gmail.com's Sandbox Project before loading or running against Atlas."
    );
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }
  return cachedClient.db(getAtlasDbName());
}

export async function closeAtlasClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = undefined;
  }
}
