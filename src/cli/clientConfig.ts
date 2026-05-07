import { promises as fsp } from "node:fs";
import fs from "node:fs";
import path from "node:path";

import { defaultBaseDir } from "../paths.js";

export type ClientConfig = {
  version: 1;
  serverUrl: string;
  tenantId: string;
  serverBaseDir?: string;
  attachedAt: string;
};

export function clientConfigPath(baseDir: string = defaultBaseDir()): string {
  return path.join(baseDir, "client.json");
}

export function readClientConfigSync(
  baseDir: string = defaultBaseDir(),
): ClientConfig | null {
  try {
    const raw = fs.readFileSync(clientConfigPath(baseDir), "utf8");
    const parsed = JSON.parse(raw) as ClientConfig;
    if (!parsed.serverUrl || !parsed.tenantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeClientConfig(
  config: Omit<ClientConfig, "version" | "attachedAt">,
  baseDir: string = defaultBaseDir(),
): Promise<ClientConfig> {
  const record: ClientConfig = {
    version: 1,
    ...config,
    attachedAt: new Date().toISOString(),
  };
  await fsp.mkdir(baseDir, { recursive: true });
  await fsp.writeFile(
    clientConfigPath(baseDir),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  return record;
}

export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
