// Skill markdown loader.
//
// Per design.md §6.3 + plan R3/R4 + acceptance criteria for Phase 4: skills
// are optional markdown sidecars at `/lib/skills/<name>.md` (or, on the
// host filesystem, `<DATAFETCH_HOME>/skills/<tenant>/<name>.md`). The
// dispatcher loads the skill, parses its frontmatter, and uses the body
// as the system instruction for an `agent({skill})` body call.
//
// ─── LibraryResolver vs SkillLoader ─────────────────────────────────────
//
// The Wave 1 LibraryResolver interface (src/sdk/runtime.ts) only knows how
// to resolve a *function* by name (`/lib/<name>.ts`). Skills are a different
// namespace (`/lib/skills/<name>.md`). Rather than mutate the Wave 1
// contract, we keep skill loading as a side-channel here: the dispatcher
// holds its own `SkillLoader` instance, defaulting to `DiskSkillLoader`.
//
// Path layout the disk loader walks:
//   <baseDir>/skills/<tenant>/<name>.md      (tenant overlay; preferred)
//   <baseDir>/skills/__seed__/<name>.md      (seed fallback bundled with the SDK)
//
// The seed bundle is copied here by `installFlueDispatcher({...})` at boot.
//
// ────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";

// --- Public types -----------------------------------------------------------

export type SkillFrontmatter = {
  name: string;
  /** MVP: a free-text description string. Future: JSONSchema-like shape. */
  input: string;
  /** MVP: a free-text description string. */
  output: string;
  /** Optional default model. Body `model` always wins (D-016). */
  model?: string;
};

export type Skill = {
  frontmatter: SkillFrontmatter;
  /** Markdown body below the frontmatter delimiters. */
  prompt: string;
};

export type SkillLoader = {
  load(name: string, tenantId: string): Promise<Skill>;
};

// --- Errors -----------------------------------------------------------------

export class SkillNotFoundError extends Error {
  constructor(name: string, tenantId: string) {
    super(
      `Skill "${name}" not found for tenant "${tenantId}". ` +
        `Looked in tenant overlay and seed bundle.`,
    );
    this.name = "SkillNotFoundError";
  }
}

export class SkillParseError extends Error {
  constructor(name: string, reason: string) {
    super(`Skill "${name}" failed to parse: ${reason}`);
    this.name = "SkillParseError";
  }
}

// --- Frontmatter parser -----------------------------------------------------

// Parse Flue's frontmatter format: a YAML-ish header between `---`
// delimiters at the very top of the file, followed by the body.
//
// We accept simple `key: value` lines; values may be quoted strings.
// Unknown keys are ignored. This is not a full YAML parser — by design,
// frontmatter is meant to be one-line scalars per design.md §6.3.
export function parseSkillFile(name: string, source: string): Skill {
  const lines = source.split(/\r?\n/);
  if (lines.length === 0 || lines[0]?.trim() !== "---") {
    throw new SkillParseError(name, "missing leading `---` frontmatter delimiter");
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    throw new SkillParseError(name, "missing trailing `---` frontmatter delimiter");
  }

  const header: Record<string, string> = {};
  for (let i = 1; i < endIndex; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      throw new SkillParseError(name, `frontmatter line missing colon: "${trimmed}"`);
    }
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    header[key] = value;
  }

  const fmName = header["name"];
  const fmInput = header["input"];
  const fmOutput = header["output"];
  if (typeof fmName !== "string" || fmName === "") {
    throw new SkillParseError(name, "frontmatter missing `name`");
  }
  if (typeof fmInput !== "string" || fmInput === "") {
    throw new SkillParseError(name, "frontmatter missing `input`");
  }
  if (typeof fmOutput !== "string" || fmOutput === "") {
    throw new SkillParseError(name, "frontmatter missing `output`");
  }

  const frontmatter: SkillFrontmatter = {
    name: fmName,
    input: fmInput,
    output: fmOutput,
  };
  const fmModel = header["model"];
  if (typeof fmModel === "string" && fmModel !== "") {
    frontmatter.model = fmModel;
  }

  const body = lines.slice(endIndex + 1).join("\n").trim();
  return { frontmatter, prompt: body };
}

// --- Disk loader ------------------------------------------------------------

export type DiskSkillLoaderOpts = {
  /** Datafetch home; the same `baseDir` other components use. */
  baseDir: string;
};

export class DiskSkillLoader implements SkillLoader {
  private readonly skillsDir: string;

  constructor(opts: DiskSkillLoaderOpts) {
    this.skillsDir = path.join(opts.baseDir, "skills");
  }

  async load(name: string, tenantId: string): Promise<Skill> {
    const tenantPath = path.join(this.skillsDir, tenantId, `${name}.md`);
    const seedPath = path.join(this.skillsDir, "__seed__", `${name}.md`);

    const candidates = [tenantPath, seedPath];
    for (const file of candidates) {
      try {
        const source = await fs.readFile(file, "utf8");
        return parseSkillFile(name, source);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") throw err;
      }
    }
    throw new SkillNotFoundError(name, tenantId);
  }
}
