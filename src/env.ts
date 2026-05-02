import { existsSync } from "node:fs";
import path from "node:path";

let loaded = false;

export function loadProjectEnv(file = path.join(process.cwd(), ".env")): void {
  if (loaded || process.env.ATLASFS_SKIP_ENV_FILE === "1") {
    return;
  }
  loaded = true;

  if (!existsSync(file) || typeof process.loadEnvFile !== "function") {
    return;
  }

  process.loadEnvFile(file);
}
