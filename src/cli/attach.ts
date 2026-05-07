import { defaultBaseDir } from "../paths.js";

import { jsonRequest } from "./httpClient.js";
import { stripTrailingSlash, writeClientConfig } from "./clientConfig.js";
import type { Flags } from "./types.js";

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function cmdAttach(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const serverUrl = positionals[0];
  if (!serverUrl) throw new Error("attach: <server-url> is required");
  const normalizedUrl = stripTrailingSlash(serverUrl);
  const tenantId =
    flagString(flags, "tenant") ?? process.env["DATAFETCH_TENANT"] ?? "local";
  const health = await jsonRequest<{ ok?: boolean; baseDir?: string }>({
    method: "GET",
    path: "/health",
    serverUrl: normalizedUrl,
  });
  if (health.ok !== true) {
    throw new Error(`attach: server health check failed at ${normalizedUrl}`);
  }
  const config = await writeClientConfig(
    {
      serverUrl: normalizedUrl,
      tenantId,
      ...(typeof health.baseDir === "string" ? { serverBaseDir: health.baseDir } : {}),
    },
    defaultBaseDir(),
  );
  process.stdout.write(
    `attached tenant ${config.tenantId} to ${config.serverUrl}\n`,
  );
}
