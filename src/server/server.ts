import { serve } from "@hono/node-server";
import { closeAtlasClient } from "../datafetch/db/client.js";
import { loadProjectEnv } from "../env.js";
import { app } from "./routes.js";

loadProjectEnv();

const port = Number(process.env.PORT ?? 5174);
const server = serve({ fetch: app.fetch, port });
console.log(`atlasfs api · http://localhost:${port}`);

const shutdown = async () => {
  await closeAtlasClient();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
