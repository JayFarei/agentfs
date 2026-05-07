// Server-side dataset catalog.
//
// `datafetch add <url>` registers a source with the data plane. The current
// implementation supports Hugging Face dataset URLs and persists only
// lightweight metadata plus the source descriptor; mounted workspaces remain
// per-intent worktrees.

import { Hono } from "hono";
import * as v from "valibot";

import { publishMount } from "../adapter/publishMount.js";
import { getMountRuntimeRegistry } from "../adapter/runtime.js";
import type { HuggingFaceSource } from "../adapter/huggingfaceMount.js";
import { defaultBaseDir } from "../paths.js";

import { CatalogStore, type CatalogSourceRecord } from "./catalogStore.js";

type CatalogAppDeps = {
  baseDir?: string;
};

const addSourceSchema = v.object({
  url: v.pipe(v.string(), v.minLength(1)),
  id: v.optional(v.string()),
});

type HfSplitsResponse = {
  splits?: Array<{ config: string; split: string }>;
};

type HfInfoResponse = {
  dataset_info?: Record<
    string,
    {
      description?: string;
      license?: string;
      splits?: Record<string, { num_examples?: number }>;
    }
  >;
};

const DEFAULT_HF_ENDPOINT = "https://datasets-server.huggingface.co";

export function createCatalogApp(deps: CatalogAppDeps = {}): Hono {
  const baseDir = deps.baseDir ?? defaultBaseDir();
  const store = new CatalogStore({ baseDir });
  const app = new Hono();

  app.post("/sources", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = v.safeParse(addSourceSchema, raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          issues: parsed.issues.map((i) => i.message),
        },
        400,
      );
    }

    let record: CatalogSourceRecord;
    try {
      record = await buildSourceRecord(parsed.output.url, parsed.output.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "unsupported_source", message }, 400);
    }

    const saved = await store.upsert(record);
    return c.json({ source: saved });
  });

  app.get("/sources", async (c) => {
    return c.json({ sources: await store.list() });
  });

  app.get("/sources/:id", async (c) => {
    const source = await store.get(c.req.param("id"));
    if (!source) return c.json({ error: "not_found" }, 404);
    return c.json({ source });
  });

  app.post("/sources/:id/mount", async (c) => {
    const source = await store.get(c.req.param("id"));
    if (!source) return c.json({ error: "not_found" }, 404);
    const existing = getMountRuntimeRegistry().get(source.mountId);
    if (existing) {
      return c.json({
        source,
        mount: {
          mountId: existing.mountId,
          adapterId: existing.adapter.id,
          collections: existing.identMap,
          alreadyMounted: true,
        },
      });
    }

    const handle = await publishMount({
      id: source.mountId,
      source: source.source,
      baseDir,
      warmup: "eager",
    });
    const inventory = await handle.inventory();
    return c.json({
      source,
      mount: {
        mountId: handle.id,
        adapterId: source.adapter,
        collections: inventory.identMap,
        alreadyMounted: false,
      },
    });
  });

  return app;
}

export async function buildSourceRecord(
  inputUrl: string,
  overrideId: string | undefined,
): Promise<CatalogSourceRecord> {
  const parsed = parseHuggingFaceDatasetUrl(inputUrl);
  const source: HuggingFaceSource = {
    kind: "huggingface",
    dataset: parsed.dataset,
    sourceUrl: inputUrl,
    ...(hfEndpointOverride() !== null ? { endpoint: hfEndpoint() } : {}),
  };
  const [splits, info] = await Promise.all([
    hfJson<HfSplitsResponse>("/splits", { dataset: parsed.dataset }),
    hfJson<HfInfoResponse>("/info", { dataset: parsed.dataset }).catch(
      (): HfInfoResponse => ({}),
    ),
  ]);
  if (!splits.splits || splits.splits.length === 0) {
    throw new Error(`Hugging Face dataset ${parsed.dataset} has no visible splits`);
  }

  const splitSummaries = splits.splits.map((s) => ({
    config: s.config,
    split: s.split,
    ...(rowCount(info, s.config, s.split) !== null
      ? { rows: rowCount(info, s.config, s.split)! }
      : {}),
  }));
  const firstInfo = info.dataset_info?.[splits.splits[0]!.config];
  const id = sanitizeId(overrideId ?? parsed.dataset.split("/").at(-1) ?? parsed.dataset);
  const now = new Date().toISOString();
  return {
    id,
    title: titleFromDataset(parsed.dataset),
    adapter: "huggingface",
    uri: `hf://${parsed.dataset}`,
    sourceUrl: inputUrl,
    mountId: id,
    source,
    status: "ready",
    addedAt: now,
    updatedAt: now,
    ...(firstInfo?.description ? { description: firstInfo.description } : {}),
    ...(firstInfo?.license ? { license: firstInfo.license } : {}),
    splits: splitSummaries,
  };
}

function parseHuggingFaceDatasetUrl(input: string): { dataset: string } {
  if (input.startsWith("hf://")) {
    const dataset = input.slice("hf://".length).replace(/^\/+/, "");
    if (!dataset.includes("/")) throw new Error("hf:// URLs must be hf://owner/dataset");
    return { dataset };
  }
  const url = new URL(input);
  if (url.hostname !== "huggingface.co") {
    throw new Error("only huggingface.co dataset URLs are supported");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("datasets");
  if (idx === -1 || parts.length < idx + 3) {
    throw new Error("expected https://huggingface.co/datasets/<owner>/<dataset>");
  }
  return { dataset: `${parts[idx + 1]}/${parts[idx + 2]}` };
}

async function hfJson<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${hfEndpoint()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `Hugging Face ${path} failed: ${res.status} ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`,
    );
  }
  return body as T;
}

function hfEndpoint(): string {
  return stripTrailingSlash(process.env["HF_DATASETS_SERVER_URL"] ?? DEFAULT_HF_ENDPOINT);
}

function hfEndpointOverride(): string | null {
  const raw = process.env["HF_DATASETS_SERVER_URL"];
  return raw && raw.length > 0 ? stripTrailingSlash(raw) : null;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function rowCount(
  info: HfInfoResponse,
  config: string,
  split: string,
): number | null {
  const value = info.dataset_info?.[config]?.splits?.[split]?.num_examples;
  return typeof value === "number" ? value : null;
}

function sanitizeId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "dataset"
  );
}

function titleFromDataset(dataset: string): string {
  return dataset
    .split("/")
    .at(-1)!
    .split(/[-_]+/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(" ");
}
