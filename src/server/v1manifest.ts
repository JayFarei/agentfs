import { Hono } from "hono";

import { defaultBaseDir } from "../paths.js";

import { renderManifest } from "./datasetInit.js";

export type ManifestAppDeps = {
  baseDir?: string;
};

export function createManifestApp(deps: ManifestAppDeps = {}): Hono {
  const baseDir = deps.baseDir ?? defaultBaseDir();
  const app = new Hono();

  app.get("/", async (c) => {
    return c.json(await renderManifest({ baseDir }));
  });

  return app;
}
