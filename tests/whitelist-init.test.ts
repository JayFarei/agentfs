import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { closeAllMounts, getMountRuntimeRegistry } from "../src/adapter/runtime.js";
import { createServer } from "../src/server/server.js";

const tempDirs: string[] = [];
const envBefore = process.env["HF_DATASETS_SERVER_URL"];

afterEach(async () => {
  await closeAllMounts();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  if (envBefore === undefined) delete process.env["HF_DATASETS_SERVER_URL"];
  else process.env["HF_DATASETS_SERVER_URL"] = envBefore;
});

describe("server whitelist dataset initialization", () => {
  it("initializes whitelisted Hugging Face datasets and exposes them in the manifest", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "df-whitelist-"));
    tempDirs.push(baseDir);
    const datasetsFile = path.join(baseDir, "datasets.json");
    const hf = await startFakeHfServer();
    try {
      process.env["HF_DATASETS_SERVER_URL"] = hf.url;
      await writeFile(
        datasetsFile,
        `${JSON.stringify(
          {
            datasets: [
              {
                id: "opentraces-devtime",
                adapter: "huggingface",
                url: "https://huggingface.co/datasets/OpenTraces/opentraces-devtime",
                target: "open",
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const { app } = await createServer({ baseDir, datasetsFile });
      const res = await app.request("/v1/manifest");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        datasets: Array<{
          id: string;
          adapter: string;
          status: string;
          target?: string;
          collections: Array<{ ident: string; name: string; rows?: number }>;
        }>;
      };
      expect(body.datasets).toHaveLength(1);
      expect(body.datasets[0]).toMatchObject({
        id: "opentraces-devtime",
        adapter: "huggingface",
        status: "ready",
        target: "open",
      });
      expect(body.datasets[0]?.collections).toEqual([
        { ident: "train", name: "train", rows: 3 },
      ]);

      expect(getMountRuntimeRegistry().get("opentraces-devtime")).not.toBeNull();
      const sourceJson = JSON.parse(
        await readFile(
          path.join(baseDir, "sources", "opentraces-devtime", "source.json"),
          "utf8",
        ),
      ) as { id: string; adapter: string };
      expect(sourceJson).toMatchObject({
        id: "opentraces-devtime",
        adapter: "huggingface",
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
              description: "Small trace dataset for datafetch tests.",
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
