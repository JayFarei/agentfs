import { promises as fsp } from "node:fs";
import path from "node:path";

export function telemetryEnabled(explicit?: boolean): boolean {
  if (explicit === true) return true;
  const raw = process.env["DATAFETCH_TELEMETRY"];
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function writeTelemetryEvent(args: {
  baseDir: string;
  event: Record<string, unknown>;
}): Promise<void> {
  const dir = path.join(args.baseDir, "telemetry");
  await fsp.mkdir(dir, { recursive: true });
  const enriched = {
    version: 1,
    createdAt: new Date().toISOString(),
    label: process.env["DATAFETCH_TELEMETRY_LABEL"] ?? null,
    searchMode: process.env["DATAFETCH_SEARCH_MODE"] ?? null,
    ...args.event,
  };
  await fsp.appendFile(
    path.join(dir, "events.jsonl"),
    `${JSON.stringify(enriched)}\n`,
    "utf8",
  );
}
