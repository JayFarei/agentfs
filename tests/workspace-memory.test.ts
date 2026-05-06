import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { regenerateWorkspaceMemory } from "../src/bootstrap/workspaceMemory.js";

describe("regenerateWorkspaceMemory", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-memory-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function writeFinqaMount(): Promise<void> {
    const mountRoot = path.join(baseDir, "mounts", "finqa-2024");
    const collRoot = path.join(mountRoot, "finqa_cases");
    await mkdir(collRoot, { recursive: true });
    await writeFile(
      path.join(mountRoot, "_inventory.json"),
      JSON.stringify(
        {
          mountId: "finqa-2024",
          substrate: "atlas",
          generatedAt: "2026-05-06T00:00:00.000Z",
          collections: [
            {
              ident: "finqaCases",
              name: "finqa_cases",
              rows: 8281,
              fingerprint: "sha256:abcdef",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(collRoot, "_descriptor.json"),
      JSON.stringify(
        {
          kind: "documents",
          cardinality: { rows: 8281 },
          fields: {
            question: { role: "text", presence: 1, embeddable: true },
            answer: { role: "number", presence: 0.92 },
            program: { role: "text", presence: 0.88 },
            sector: { role: "label", presence: 0.5, cardinality_estimate: 12 },
          },
          affordances: ["findExact", "search", "findSimilar", "hybrid"],
          polymorphic_variants: null,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  it("writes AGENTS.md and a Claude-compatible symlink from mount metadata", async () => {
    await writeFinqaMount();

    await regenerateWorkspaceMemory({
      baseDir,
      tenantId: "test-jay",
      mountIds: ["finqa-2024"],
    });

    const agents = await readFile(path.join(baseDir, "AGENTS.md"), "utf8");
    expect(agents).toContain("Datafetch Workspace Memory");
    expect(agents).toContain("df.d.ts");
    expect(agents).toContain("validated plan");
    expect(agents).toContain("df.db.finqaCases");
    expect(agents).toContain("financial question answering");
    expect(agents).toContain("question");
    expect(agents).toContain("sector");

    const alias = path.join(baseDir, "CLAUDE.md");
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await readlink(alias)).toBe("AGENTS.md");
  });

  it("does not clobber a human-authored CLAUDE.md", async () => {
    await writeFinqaMount();
    await writeFile(path.join(baseDir, "CLAUDE.md"), "# Human Notes\n", "utf8");

    await regenerateWorkspaceMemory({
      baseDir,
      tenantId: "test-jay",
      mountIds: ["finqa-2024"],
    });

    expect(await readFile(path.join(baseDir, "CLAUDE.md"), "utf8")).toBe(
      "# Human Notes\n",
    );
  });
});
