import { HttpError, jsonRequest, resolveServerUrl } from "./httpClient.js";
import type { Flags } from "./types.js";

type CatalogSource = {
  id: string;
  title: string;
  adapter: string;
  uri: string;
  sourceUrl: string;
  mountId: string;
  status: string;
  splits?: Array<{ config: string; split: string; rows?: number }>;
};

type ManifestDataset = {
  id: string;
  title?: string;
  adapter?: string;
  status: string;
  target?: string;
  rows?: number | null;
  collections?: Array<{ ident: string; name: string; rows?: number }>;
};

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function jsonFlag(flags: Flags): boolean {
  return flags["json"] === true;
}

function serverUrlFromFlags(flags: Flags): string {
  return resolveServerUrl(flagString(flags, "server")).baseUrl;
}

export async function cmdAdd(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const url = positionals[0];
  if (!url) throw new Error("add: <url> is required");
  const id = flagString(flags, "id");
  const body = await jsonRequest<{ source: CatalogSource }>({
    method: "POST",
    path: "/v1/catalog/sources",
    serverUrl: serverUrlFromFlags(flags),
    body: {
      url,
      ...(id !== undefined ? { id } : {}),
    },
  });
  if (jsonFlag(flags)) {
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  process.stdout.write(`added ${body.source.id} (${body.source.adapter})\n`);
  process.stdout.write(`source: ${body.source.sourceUrl}\n`);
  process.stdout.write(`mount: datafetch mount ${body.source.id} --intent "<intent>"\n`);
}

export async function cmdList(
  _positionals: string[],
  flags: Flags,
): Promise<void> {
  const body = await jsonRequest<{ datasets: ManifestDataset[] }>({
    method: "GET",
    path: "/v1/manifest",
    serverUrl: serverUrlFromFlags(flags),
  });
  if (jsonFlag(flags)) {
    process.stdout.write(
      `${JSON.stringify({ ...body, sources: body.datasets }, null, 2)}\n`,
    );
    return;
  }
  if (body.datasets.length === 0) {
    process.stdout.write("no datasets initialized\n");
    return;
  }
  for (const source of body.datasets) {
    const rows = source.rows ?? totalRows(source.collections ?? []);
    process.stdout.write(
      `${source.id}\t${source.adapter ?? "unknown"}\t${source.status}${
        rows !== null ? `\t${rows} rows` : ""
      }\n`,
    );
  }
}

export async function cmdInspect(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const id = positionals[0];
  if (!id) throw new Error("inspect: <source-id> is required");
  const body = await jsonRequest<{ source: CatalogSource }>({
    method: "GET",
    path: `/v1/catalog/sources/${encodeURIComponent(id)}`,
    serverUrl: serverUrlFromFlags(flags),
  });
  if (jsonFlag(flags)) {
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  const source = body.source;
  process.stdout.write(`Dataset: ${source.title}\n`);
  process.stdout.write(`ID: ${source.id}\n`);
  process.stdout.write(`Source: ${source.adapter} ${source.uri}\n`);
  process.stdout.write(`URL: ${source.sourceUrl}\n`);
  if (source.splits && source.splits.length > 0) {
    process.stdout.write("Splits:\n");
    for (const split of source.splits) {
      process.stdout.write(
        `- ${split.config}/${split.split}${
          split.rows !== undefined ? ` (${split.rows} rows)` : ""
        }\n`,
      );
    }
  }
  process.stdout.write("\nMount:\n");
  process.stdout.write(`datafetch mount ${source.id} --intent "<intent>"\n`);
}

export async function ensureCatalogSourceMounted(args: {
  datasetId: string;
  flags: Flags;
}): Promise<boolean> {
  const serverUrl = serverUrlFromFlags(args.flags);
  try {
    await jsonRequest<{ source: CatalogSource }>({
      method: "GET",
      path: `/v1/catalog/sources/${encodeURIComponent(args.datasetId)}`,
      serverUrl,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return false;
    throw err;
  }
  await jsonRequest({
    method: "POST",
    path: `/v1/catalog/sources/${encodeURIComponent(args.datasetId)}/mount`,
    serverUrl,
  });
  return true;
}

function totalRows(source: CatalogSource | Array<{ rows?: number }>): number | null {
  const splits = Array.isArray(source) ? source : source.splits;
  if (!splits) return null;
  let total = 0;
  let saw = false;
  for (const split of splits) {
    if (typeof split.rows !== "number") continue;
    total += split.rows;
    saw = true;
  }
  return saw ? total : null;
}
