// HuggingFaceMountAdapter — concrete MountAdapter for public Hugging Face
// datasets through the Dataset Viewer API.
//
// The adapter virtualises the interface, not the whole dataset: probe/sampling
// pull bounded metadata and rows, while runtime calls route through the
// Dataset Viewer endpoints. Search uses `/search` when available and falls
// back to bounded client-side filtering when the index is still loading.

import type {
  CollectionHandle,
  CollectionInventoryEntry,
  MountAdapter,
  MountInventory,
  SampleOpts,
  SourceCapabilities,
} from "../../sdk/index.js";

const DEFAULT_ENDPOINT = "https://datasets-server.huggingface.co";
const DEFAULT_LENGTH = 10;
const MAX_LENGTH = 100;

export type HuggingFaceMountAdapterConfig = {
  dataset: string;
  config?: string;
  split?: string;
  endpoint?: string;
};

type SplitRecord = {
  dataset: string;
  config: string;
  split: string;
};

type CollectionSpec = SplitRecord & {
  name: string;
  rows: number;
};

type InfoResponse = {
  dataset_info?: Record<
    string,
    {
      description?: string;
      license?: string;
      features?: unknown;
      splits?: Record<string, { num_examples?: number }>;
    }
  >;
};

type SplitsResponse = {
  splits?: SplitRecord[];
};

type RowsResponse = {
  rows?: Array<{ row_idx?: number; row?: unknown }>;
  num_rows_total?: number;
};

export class HuggingFaceMountAdapter implements MountAdapter {
  readonly id = "huggingface" as const;

  private readonly dataset: string;
  private readonly config?: string;
  private readonly split?: string;
  private readonly endpoint: string;
  private readonly collections = new Map<string, CollectionSpec>();

  constructor(config: HuggingFaceMountAdapterConfig) {
    this.dataset = config.dataset;
    if (config.config !== undefined) this.config = config.config;
    if (config.split !== undefined) this.split = config.split;
    this.endpoint = stripTrailingSlash(config.endpoint ?? DEFAULT_ENDPOINT);
  }

  capabilities(): SourceCapabilities {
    return {
      vector: false,
      lex: true,
      stream: false,
      compile: false,
    };
  }

  async probe(): Promise<MountInventory> {
    const [splits, info] = await Promise.all([
      this.getSplits(),
      this.getInfo().catch(() => null),
    ]);
    const filtered = splits.filter((s) => {
      if (this.config !== undefined && s.config !== this.config) return false;
      if (this.split !== undefined && s.split !== this.split) return false;
      return true;
    });
    const selected = filtered.length > 0 ? filtered : splits.slice(0, 1);

    const collections: CollectionInventoryEntry[] = [];
    this.collections.clear();
    for (const split of selected) {
      const name = collectionName(split, selected.length);
      const rows = rowCountFor(info, split) ?? 0;
      this.collections.set(name, { ...split, name, rows });
      collections.push({
        name,
        rows,
        indexes: ["dataset-viewer"],
      });
    }
    return { collections };
  }

  async sample(collection: string, opts: SampleOpts): Promise<unknown[]> {
    const spec = await this.resolveCollection(collection);
    const length = boundedLength(opts.size);
    return this.fetchRows(spec, { offset: 0, length });
  }

  collection<T>(name: string): CollectionHandle<T> {
    return {
      findExact: async (filter: Partial<T>, limit?: number): Promise<T[]> => {
        const spec = await this.resolveCollection(name);
        const cap = boundedLength(limit ?? DEFAULT_LENGTH);
        const record = filter as Record<string, unknown>;
        const rowIdx = rowIndexFilter(record);
        const rows =
          rowIdx === null
            ? await this.fetchRows(spec, { offset: 0, length: MAX_LENGTH })
            : await this.fetchRows(spec, { offset: rowIdx, length: 1 });
        return rows.filter((row) => matchesFilter(row, record)).slice(0, cap) as T[];
      },
      search: async (query: string, opts?: { limit?: number }): Promise<T[]> => {
        const spec = await this.resolveCollection(name);
        const cap = boundedLength(opts?.limit ?? DEFAULT_LENGTH);
        try {
          return (await this.searchRows(spec, query, cap)) as T[];
        } catch {
          const rows = await this.fetchRows(spec, { offset: 0, length: MAX_LENGTH });
          return rows.filter((row) => rowContains(row, query)).slice(0, cap) as T[];
        }
      },
      findSimilar: async (query: string, limit?: number): Promise<T[]> => {
        const cap = boundedLength(limit ?? DEFAULT_LENGTH);
        return this.collection<T>(name).search(query, { limit: cap });
      },
      hybrid: async (query: string, opts?: { limit?: number }): Promise<T[]> => {
        return this.collection<T>(name).search(query, opts);
      },
    };
  }

  async close(): Promise<void> {
    // Stateless HTTP adapter; nothing to close.
  }

  private async resolveCollection(name: string): Promise<CollectionSpec> {
    const existing = this.collections.get(name);
    if (existing) return existing;
    await this.probe();
    const afterProbe = this.collections.get(name);
    if (afterProbe) return afterProbe;
    throw new Error(`HuggingFaceMountAdapter: unknown collection ${name}`);
  }

  private async getSplits(): Promise<SplitRecord[]> {
    const json = await this.fetchJson<SplitsResponse>("/splits", {
      dataset: this.dataset,
    });
    return json.splits ?? [];
  }

  private async getInfo(): Promise<InfoResponse> {
    return this.fetchJson<InfoResponse>("/info", { dataset: this.dataset });
  }

  private async fetchRows(
    spec: CollectionSpec,
    opts: { offset: number; length: number },
  ): Promise<unknown[]> {
    const json = await this.fetchJson<RowsResponse>("/rows", {
      dataset: spec.dataset,
      config: spec.config,
      split: spec.split,
      offset: String(Math.max(0, opts.offset)),
      length: String(boundedLength(opts.length)),
    });
    return (json.rows ?? []).map((r) => normalizeRow(spec, r));
  }

  private async searchRows(
    spec: CollectionSpec,
    query: string,
    length: number,
  ): Promise<unknown[]> {
    const json = await this.fetchJson<RowsResponse>("/search", {
      dataset: spec.dataset,
      config: spec.config,
      split: spec.split,
      query,
      offset: "0",
      length: String(boundedLength(length)),
    });
    return (json.rows ?? []).map((r) => normalizeRow(spec, r));
  }

  private async fetchJson<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.endpoint}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url);
    const text = await res.text();
    let body: unknown;
    try {
      body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
    if (!res.ok) {
      const message = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`Hugging Face ${path} failed: ${res.status} ${message}`);
    }
    return body as T;
  }
}

function collectionName(split: SplitRecord, selectedCount: number): string {
  if (selectedCount === 1) return split.split;
  return `${sanitizeName(split.config)}__${sanitizeName(split.split)}`;
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "default";
}

function rowCountFor(info: InfoResponse | null, split: SplitRecord): number | null {
  const cfg = info?.dataset_info?.[split.config];
  const count = cfg?.splits?.[split.split]?.num_examples;
  return typeof count === "number" ? count : null;
}

function normalizeRow(
  spec: CollectionSpec,
  row: { row_idx?: number; row?: unknown },
): unknown {
  const value =
    row.row !== null && typeof row.row === "object" && !Array.isArray(row.row)
      ? { ...(row.row as Record<string, unknown>) }
      : { value: row.row };
  return {
    _hfRowIdx: row.row_idx ?? null,
    _hfDataset: spec.dataset,
    _hfConfig: spec.config,
    _hfSplit: spec.split,
    ...value,
  };
}

function boundedLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LENGTH;
  return Math.max(1, Math.min(MAX_LENGTH, Math.floor(n)));
}

function rowIndexFilter(filter: Record<string, unknown>): number | null {
  const raw = filter["_hfRowIdx"] ?? filter["row_idx"] ?? filter["rowIndex"];
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

function matchesFilter(row: unknown, filter: Record<string, unknown>): boolean {
  if (Object.keys(filter).length === 0) return true;
  if (row === null || typeof row !== "object" || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  for (const [key, expected] of Object.entries(filter)) {
    if (expected === undefined) continue;
    if (record[key] !== expected) return false;
  }
  return true;
}

function rowContains(row: unknown, query: string): boolean {
  const needle = query.toLowerCase();
  if (needle.length === 0) return true;
  return JSON.stringify(row).toLowerCase().includes(needle);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
