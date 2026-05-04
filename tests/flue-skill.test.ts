import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseSkillFile,
  DiskSkillLoader,
  SkillParseError,
  SkillNotFoundError,
} from "../src/flue/skill.js";

describe("parseSkillFile", () => {
  it("parses a minimal frontmatter + body", () => {
    const src = [
      "---",
      "name: reverser",
      "input: input string",
      "output: reversed string",
      "---",
      "",
      "Reverse the input.",
      "",
    ].join("\n");
    const skill = parseSkillFile("reverser", src);
    expect(skill.frontmatter).toEqual({
      name: "reverser",
      input: "input string",
      output: "reversed string",
    });
    expect(skill.prompt).toBe("Reverse the input.");
  });

  it("captures an optional model field", () => {
    const src = [
      "---",
      "name: x",
      "input: i",
      "output: o",
      "model: anthropic/claude-haiku-4-5",
      "---",
      "Body.",
    ].join("\n");
    const skill = parseSkillFile("x", src);
    expect(skill.frontmatter.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("strips matching surrounding quotes from values", () => {
    const src = [
      "---",
      'name: "quoted"',
      "input: 'single'",
      "output: bare",
      "---",
      "body",
    ].join("\n");
    const skill = parseSkillFile("q", src);
    expect(skill.frontmatter.name).toBe("quoted");
    expect(skill.frontmatter.input).toBe("single");
    expect(skill.frontmatter.output).toBe("bare");
  });

  it("ignores comments and blank lines in the frontmatter", () => {
    const src = [
      "---",
      "# a comment",
      "name: foo",
      "",
      "input: i",
      "output: o",
      "---",
      "body",
    ].join("\n");
    const skill = parseSkillFile("foo", src);
    expect(skill.frontmatter.name).toBe("foo");
  });

  it("throws when leading delimiter is missing", () => {
    const src = "name: foo\n---\nbody";
    expect(() => parseSkillFile("foo", src)).toThrow(SkillParseError);
  });

  it("throws when trailing delimiter is missing", () => {
    const src = "---\nname: foo\ninput: i\noutput: o\nbody-without-end";
    expect(() => parseSkillFile("foo", src)).toThrow(SkillParseError);
  });

  it("throws when name is missing", () => {
    const src = ["---", "input: i", "output: o", "---", "body"].join("\n");
    expect(() => parseSkillFile("anon", src)).toThrow(/missing.*name/);
  });

  it("throws when a non-comment line lacks a colon", () => {
    const src = [
      "---",
      "name: foo",
      "this-is-not-a-keyvalue",
      "input: i",
      "output: o",
      "---",
      "body",
    ].join("\n");
    expect(() => parseSkillFile("foo", src)).toThrow(/missing colon/);
  });
});

describe("DiskSkillLoader", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-skill-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  function writeSkill(rel: string, body: string): Promise<void> {
    const file = path.join(baseDir, rel);
    return mkdir(path.dirname(file), { recursive: true })
      .then(() => writeFile(file, body, "utf8"));
  }

  const FRONT = (name: string): string =>
    [
      "---",
      `name: ${name}`,
      "input: i",
      "output: o",
      "---",
      `Body for ${name}.`,
    ].join("\n");

  it("resolves a tenant-overlay skill", async () => {
    await writeSkill("lib/acme/skills/foo.md", FRONT("foo"));
    const loader = new DiskSkillLoader({ baseDir });
    const skill = await loader.load("foo", "acme");
    expect(skill.frontmatter.name).toBe("foo");
    expect(skill.prompt).toContain("Body for foo");
  });

  it("falls back to the seed bundle when tenant overlay is missing", async () => {
    await writeSkill("lib/__seed__/skills/foo.md", FRONT("foo"));
    const loader = new DiskSkillLoader({ baseDir });
    const skill = await loader.load("foo", "acme");
    expect(skill.frontmatter.name).toBe("foo");
  });

  it("prefers tenant overlay over seed bundle", async () => {
    await writeSkill(
      "lib/__seed__/skills/foo.md",
      FRONT("foo-seed"),
    );
    await writeSkill(
      "lib/acme/skills/foo.md",
      FRONT("foo-tenant"),
    );
    const loader = new DiskSkillLoader({ baseDir });
    const skill = await loader.load("foo", "acme");
    expect(skill.frontmatter.name).toBe("foo-tenant");
  });

  it("throws SkillNotFoundError when neither layer has the skill", async () => {
    const loader = new DiskSkillLoader({ baseDir });
    await expect(loader.load("nope", "acme")).rejects.toThrow(SkillNotFoundError);
  });
});
