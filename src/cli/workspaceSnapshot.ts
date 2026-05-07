import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";

export const DEFAULT_DATAFETCHIGNORE = [
  "# datafetch commit snapshots capture the learnable workspace surface.",
  "# Generated run/result artifacts are stored beside the snapshot.",
  "",
  ".git/",
  "node_modules/",
  ".cache/",
  "dist/",
  "",
  "tmp/**",
  "result/**",
  "",
  "raw/",
  "downloads/",
  "*.ndjson",
  "",
  ".env",
  "*.key",
  "*.pem",
  "",
].join("\n");

export type SnapshotFile =
  | {
      path: string;
      kind: "file";
      size: number;
      sha256: string;
    }
  | {
      path: string;
      kind: "symlink";
      target: string;
    };

export type WorkspaceSnapshot = {
  version: 1;
  generatedAt: string;
  ignoreFile: ".datafetchignore";
  ignorePatterns: string[];
  files: SnapshotFile[];
  skipped: Array<{ path: string; reason: string }>;
};

export async function ensureDatafetchIgnore(root: string): Promise<void> {
  const file = path.join(root, ".datafetchignore");
  try {
    await fsp.access(file);
  } catch {
    await fsp.writeFile(file, DEFAULT_DATAFETCHIGNORE, "utf8");
  }
}

export async function writeWorkspaceSnapshot(args: {
  root: string;
  targetDir: string;
}): Promise<WorkspaceSnapshot> {
  const { root, targetDir } = args;
  await ensureDatafetchIgnore(root);
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(targetDir, "files"), { recursive: true });

  const ignorePatterns = await readIgnorePatterns(root);
  const rules = ignorePatterns.map(parseRule).filter((r): r is IgnoreRule => r !== null);
  const files: SnapshotFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  async function walk(abs: string, rel: string): Promise<void> {
    const relPath = normalizeRel(rel);
    if (relPath) {
      const ignored = applyRules(rules, relPath);
      if (ignored && !(await mayContainIncludedDescendant(abs, relPath, rules))) {
        skipped.push({ path: relPath, reason: "ignored" });
        return;
      }
    }

    let st;
    try {
      st = await fsp.lstat(abs);
    } catch (err) {
      skipped.push({
        path: relPath || ".",
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (st.isSymbolicLink()) {
      const target = await fsp.readlink(abs);
      try {
        const targetStat = await fsp.stat(abs);
        if (targetStat.isDirectory()) {
          await walkDirectory(abs, relPath);
          return;
        }
      } catch {
        // Broken symlink still gets recorded.
      }
      if (!applyRules(rules, relPath)) {
        files.push({ path: relPath, kind: "symlink", target });
      }
      return;
    }

    if (st.isDirectory()) {
      await walkDirectory(abs, relPath);
      return;
    }

    if (!st.isFile()) {
      skipped.push({ path: relPath, reason: "unsupported-file-type" });
      return;
    }

    if (applyRules(rules, relPath)) {
      skipped.push({ path: relPath, reason: "ignored" });
      return;
    }

    const content = await fsp.readFile(abs);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const target = path.join(targetDir, "files", relPath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
    files.push({ path: relPath, kind: "file", size: content.byteLength, sha256 });
  }

  async function walkDirectory(abs: string, relPath: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (err) {
      skipped.push({
        path: relPath || ".",
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      await walk(path.join(abs, entry.name), relPath ? `${relPath}/${entry.name}` : entry.name);
    }
  }

  await walk(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));

  const snapshot: WorkspaceSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ignoreFile: ".datafetchignore",
    ignorePatterns,
    files,
    skipped,
  };
  await fsp.writeFile(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  return snapshot;
}

async function readIgnorePatterns(root: string): Promise<string[]> {
  await ensureDatafetchIgnore(root);
  const raw = await fsp.readFile(path.join(root, ".datafetchignore"), "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

type IgnoreRule = {
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  regex: RegExp;
};

function parseRule(raw: string): IgnoreRule | null {
  let pattern = raw;
  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }
  pattern = pattern.replace(/^\/+/, "");
  if (pattern.length === 0) return null;
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = `${pattern}**`;
  return {
    pattern,
    negated,
    directoryOnly,
    regex: globRegex(pattern),
  };
}

function applyRules(rules: IgnoreRule[], relPath: string): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(relPath)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

async function mayContainIncludedDescendant(
  abs: string,
  relPath: string,
  rules: IgnoreRule[],
): Promise<boolean> {
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return false;
  }
  if (!st.isDirectory()) return false;
  return rules.some(
    (rule) =>
      rule.negated &&
      (rule.pattern.startsWith(`${relPath}/`) || relPath.startsWith(`${rule.pattern}/`)),
  );
}

function globRegex(pattern: string): RegExp {
  const anchored = pattern.includes("/");
  const parts: string[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === "*" && next === "*") {
      parts.push(".*");
      i += 1;
    } else if (ch === "*") {
      parts.push("[^/]*");
    } else {
      parts.push(escapeRegex(ch ?? ""));
    }
  }
  const body = parts.join("");
  return anchored ? new RegExp(`^${body}$`) : new RegExp(`(^|/)${body}$`);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}
