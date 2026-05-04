// MountReader — cross-agent contract.
//
// The Atlas-adapter / bootstrap agent (Wave 2) implements this. The bash
// session uses it to populate /db/<mount-id>/ on demand: synthesised
// `<coll>.ts` modules, per-mount README, descriptor JSON, samples, stats.
//
// Storage layout (per kb/plans/004-datafetch-bash-mvp.md "Storage layout"):
//
//   $DATAFETCH_HOME/mounts/<mount-id>/
//     <coll>.ts                  synthesised typed module
//     <coll>/_descriptor.json
//     <coll>/_samples.json
//     <coll>/_stats.json
//     README.md
//
// `DiskMountReader` is the default impl. It reads files written by the
// bootstrap pipeline. Tests / smoke harnesses can substitute their own
// `MountReader` instance.

import { promises as fs } from "node:fs";
import path from "node:path";

// --- Public interface -------------------------------------------------------

export type MountReader = {
  // Returns the synthesised /db/<mount-id>/<coll>.ts module text.
  readModule(mountId: string, collection: string): Promise<string>;
  // Returns the per-mount README markdown.
  readReadme(mountId: string): Promise<string>;
  // Returns the descriptor JSON contents (parsed).
  readDescriptor(mountId: string, collection: string): Promise<unknown>;
  // Returns sample documents (parsed).
  readSamples(mountId: string, collection: string): Promise<unknown[]>;
  // Returns stats JSON (parsed).
  readStats(mountId: string, collection: string): Promise<unknown>;
  // Lists collections for the mount.
  listCollections(mountId: string): Promise<string[]>;
};

// --- DiskMountReader --------------------------------------------------------

export type DiskMountReaderOpts = {
  // Root of the datafetch home; collection trees live under
  // `<baseDir>/mounts/<mount-id>/`. Caller normally injects the same
  // `baseDir` it gave to BashSession.
  baseDir: string;
};

export class DiskMountReader implements MountReader {
  private readonly mountsDir: string;

  constructor(opts: DiskMountReaderOpts) {
    this.mountsDir = path.join(opts.baseDir, "mounts");
  }

  private mountDir(mountId: string): string {
    return path.join(this.mountsDir, mountId);
  }

  private collDir(mountId: string, collection: string): string {
    return path.join(this.mountDir(mountId), collection);
  }

  async readModule(mountId: string, collection: string): Promise<string> {
    const file = path.join(this.mountDir(mountId), `${collection}.ts`);
    return fs.readFile(file, "utf8");
  }

  async readReadme(mountId: string): Promise<string> {
    const file = path.join(this.mountDir(mountId), "README.md");
    return fs.readFile(file, "utf8");
  }

  async readDescriptor(mountId: string, collection: string): Promise<unknown> {
    const file = path.join(this.collDir(mountId, collection), "_descriptor.json");
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as unknown;
  }

  async readSamples(mountId: string, collection: string): Promise<unknown[]> {
    const file = path.join(this.collDir(mountId, collection), "_samples.json");
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new TypeError(
        `_samples.json for ${mountId}/${collection} is not an array`,
      );
    }
    return parsed;
  }

  async readStats(mountId: string, collection: string): Promise<unknown> {
    const file = path.join(this.collDir(mountId, collection), "_stats.json");
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as unknown;
  }

  async listCollections(mountId: string): Promise<string[]> {
    const dir = this.mountDir(mountId);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw err;
    }
    const collections: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        collections.push(entry.name.slice(0, -3));
      }
    }
    collections.sort();
    return collections;
  }
}
