import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { closeAllMounts, getMountRuntimeRegistry } from "../src/adapter/runtime.js";
import { createCatalogApp } from "../src/server/v1catalog.js";

const tempDirs: string[] = [];
const envBefore = process.env["HF_DATASETS_SERVER_URL"];

afterEach(async () => {
  await closeAllMounts();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  if (envBefore === undefined) delete process.env["HF_DATASETS_SERVER_URL"];
  else process.env["HF_DATASETS_SERVER_URL"] = envBefore;
});

describe("Hugging Face catalog sources", () => {
  it("adds a HF dataset URL, mounts it, and exposes rows through df.db", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "df-hf-catalog-"));
    tempDirs.push(baseDir);
    const hf = await startFakeHfServer();
    try {
      process.env["HF_DATASETS_SERVER_URL"] = hf.url;
      const app = createCatalogApp({ baseDir });

      const add = await app.request("/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://huggingface.co/datasets/OpenTraces/opentraces-devtime",
        }),
      });
      expect(add.status).toBe(200);
      const addBody = (await add.json()) as {
        source: { id: string; adapter: string; source: { endpoint?: string } };
      };
      expect(addBody.source).toMatchObject({
        id: "opentraces-devtime",
        adapter: "huggingface",
      });
      expect(addBody.source.source.endpoint).toBe(hf.url);

      const mount = await app.request("/sources/opentraces-devtime/mount", {
        method: "POST",
      });
      expect(mount.status).toBe(200);
      const mountBody = (await mount.json()) as {
        mount: { collections: Array<{ ident: string; name: string }> };
      };
      expect(mountBody.mount.collections).toEqual([{ ident: "train", name: "train" }]);

      const inventory = JSON.parse(
        await readFile(
          path.join(baseDir, "mounts", "opentraces-devtime", "_inventory.json"),
          "utf8",
        ),
      ) as { substrate: string; collections: Array<{ rows: number }> };
      expect(inventory.substrate).toBe("huggingface");
      expect(inventory.collections[0]?.rows).toBe(3);

      const runtime = getMountRuntimeRegistry().get("opentraces-devtime");
      expect(runtime).not.toBeNull();
      const rows = await runtime!.collection<Record<string, unknown>>("train").search(
        "debug",
        { limit: 2 },
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        _hfRowIdx: 1,
        trace_id: "trace-2",
        text: "debug CLI failure",
      });
    } finally {
      await hf.close();
    }
  });
});

async function startFakeHfServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const rows = [
    { trace_id: "trace-1", text: "write docs", label: "docs" },
    { trace_id: "trace-2", text: "debug CLI failure", label: "debug" },
    { trace_id: "trace-3", text: "review release", label: "review" },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/splits") {
      res.end(
        JSON.stringify({
          splits: [
            {
              dataset: "OpenTraces/opentraces-devtime",
              config: "default",
              split: "train",
            },
          ],
        }),
      );
      return;
    }
    if (url.pathname === "/info") {
      res.end(
        JSON.stringify({
          dataset_info: {
            default: {
              license: "cc-by-4.0",
              features: {
                trace_id: { dtype: "string", _type: "Value" },
                text: { dtype: "string", _type: "Value" },
                label: { dtype: "string", _type: "Value" },
              },
              splits: {
                train: { name: "train", num_examples: rows.length },
              },
            },
          },
        }),
      );
      return;
    }
    if (url.pathname === "/rows") {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const length = Number(url.searchParams.get("length") ?? "10");
      res.end(
        JSON.stringify({
          rows: rows.slice(offset, offset + length).map((row, i) => ({
            row_idx: offset + i,
            row,
          })),
          num_rows_total: rows.length,
        }),
      );
      return;
    }
    if (url.pathname === "/search") {
      const query = (url.searchParams.get("query") ?? "").toLowerCase();
      const matched = rows
        .map((row, i) => ({ row, row_idx: i }))
        .filter(({ row }) => JSON.stringify(row).toLowerCase().includes(query));
      res.end(JSON.stringify({ rows: matched }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP fake HF server address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
