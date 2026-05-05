// `datafetch install-skill [--path <dir>] [--force]`
//
// Copies `skills/datafetch/SKILL.md` from the repo into the target dir
// (default `~/.claude/skills/datafetch`). Refuses to overwrite an
// existing target unless `--force` is set.

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

import { locateRepoRoot } from "../paths.js";

import type { Flags } from "./types.js";

const SOURCE_REL = path.join("skills", "datafetch", "SKILL.md");
const DEFAULT_TARGET = path.join(
  os.homedir(),
  ".claude",
  "skills",
  "datafetch",
);

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function cmdInstallSkill(
  _positionals: string[],
  flags: Flags,
): Promise<void> {
  const targetDir = path.resolve(flagString(flags, "path") ?? DEFAULT_TARGET);
  const force = flags["force"] === true;

  const repoRoot = await locateRepoRoot();
  const sourcePath = path.join(repoRoot, SOURCE_REL);
  let content: string;
  try {
    content = await fsp.readFile(sourcePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`install-skill: cannot read source ${sourcePath}: ${msg}`);
  }

  const targetFile = path.join(targetDir, "SKILL.md");
  try {
    const stat = await fsp.stat(targetFile);
    if (stat.isFile() && !force) {
      throw new Error(
        `install-skill: ${targetFile} already exists. Pass --force to overwrite.`,
      );
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }

  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.writeFile(targetFile, content, "utf8");
  process.stdout.write(`[install-skill] wrote ${targetFile}\n`);
}
