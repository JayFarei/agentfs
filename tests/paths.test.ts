import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultBaseDir,
  isReservedTenantId,
  locateRepoRoot,
  locateRepoSubdir,
  walkUpFor,
} from "../src/paths.js";

describe("defaultBaseDir", () => {
  const SAVE = {
    DATAFETCH_HOME: process.env.DATAFETCH_HOME,
    ATLASFS_HOME: process.env.ATLASFS_HOME,
  };

  beforeEach(() => {
    delete process.env.DATAFETCH_HOME;
    delete process.env.ATLASFS_HOME;
  });

  afterEach(() => {
    if (SAVE.DATAFETCH_HOME !== undefined) {
      process.env.DATAFETCH_HOME = SAVE.DATAFETCH_HOME;
    } else {
      delete process.env.DATAFETCH_HOME;
    }
    if (SAVE.ATLASFS_HOME !== undefined) {
      process.env.ATLASFS_HOME = SAVE.ATLASFS_HOME;
    } else {
      delete process.env.ATLASFS_HOME;
    }
  });

  it("prefers DATAFETCH_HOME when set", () => {
    process.env.DATAFETCH_HOME = "/tmp/df-test";
    process.env.ATLASFS_HOME = "/tmp/legacy";
    expect(defaultBaseDir()).toBe("/tmp/df-test");
  });

  it("falls back to ATLASFS_HOME for backward compat", () => {
    process.env.ATLASFS_HOME = "/tmp/legacy";
    expect(defaultBaseDir()).toBe("/tmp/legacy");
  });

  it("falls back to <cwd>/.datafetch when neither env is set", () => {
    const got = defaultBaseDir();
    expect(got).toBe(path.join(process.cwd(), ".datafetch"));
  });
});

describe("isReservedTenantId", () => {
  it.each([
    ["__seed__", true],
    ["__cache__", true],
    ["__abc123__", true],
    ["seed", false],
    ["__seed", false],
    ["seed__", false],
    ["", false],
    ["acme", false],
    ["__seed_with_more__", true],
  ])("isReservedTenantId(%j) === %s", (input, expected) => {
    expect(isReservedTenantId(input)).toBe(expected);
  });
});

describe("locateRepoRoot", () => {
  it("returns a directory containing src/sdk/index.ts and package.json", async () => {
    const root = await locateRepoRoot();
    const { stat } = await import("node:fs/promises");
    const sdk = await stat(path.join(root, "src", "sdk", "index.ts"));
    const pkg = await stat(path.join(root, "package.json"));
    expect(sdk.isFile()).toBe(true);
    expect(pkg.isFile()).toBe(true);
  });

  it("is cached across calls (returns same value)", async () => {
    const a = await locateRepoRoot();
    const b = await locateRepoRoot();
    expect(a).toBe(b);
  });
});

describe("locateRepoSubdir", () => {
  it("locates seeds/lib relative to the repo root", async () => {
    const seedLib = await locateRepoSubdir(path.join("seeds", "lib"));
    expect(seedLib).not.toBeNull();
    expect(seedLib).toMatch(/seeds[/\\]lib$/);
  });

  it("locates seeds/skills relative to the repo root", async () => {
    const seedSkills = await locateRepoSubdir(path.join("seeds", "skills"));
    expect(seedSkills).not.toBeNull();
    expect(seedSkills).toMatch(/seeds[/\\]skills$/);
  });

  it("returns null for a non-existent subdir", async () => {
    const missing = await locateRepoSubdir("does-not-exist-xyz");
    expect(missing).toBeNull();
  });
});

describe("walkUpFor", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "walkup-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns the first dir matching the predicate", async () => {
    const inner = path.join(tmp, "a", "b", "c");
    await mkdir(inner, { recursive: true });
    const target = path.join(tmp, "a");
    const found = await walkUpFor(inner, async (dir) => dir === target);
    expect(found).toBe(target);
  });

  it("returns null when nothing matches within the bound", async () => {
    const inner = path.join(tmp, "x");
    await mkdir(inner, { recursive: true });
    const found = await walkUpFor(inner, async () => false, 3);
    expect(found).toBeNull();
  });

  it("respects the levels cap", async () => {
    let calls = 0;
    await walkUpFor("/", async () => {
      calls += 1;
      return false;
    }, 4);
    expect(calls).toBeLessThanOrEqual(4);
  });
});
