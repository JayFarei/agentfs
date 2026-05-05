// Read the leading YAML frontmatter block from a `.ts` file in /lib/ in
// one bounded read. Both manifest.ts and the CLI's `apropos` need to know
// (a) whether a file carries the wrapper frontmatter at all (the
// tool-vs-primitive signal) and (b) the description text. Doing both
// from one open avoids the prior pattern of opening the same file twice.
//
// Frontmatter shape (written by src/observer/author.ts:frontmatter):
//   /* ---
//   name: <name>
//   description: |
//     <multi-line block scalar>
//   trajectory: <id>
//   shape-hash: <hash>
//   --- */

import { promises as fsp } from "node:fs";

// First N bytes of the file are guaranteed to contain the frontmatter
// (it's at column 0 line 1). 4 KiB covers any plausible description.
const HEAD_BYTES = 4096;

export type FrontmatterHead = {
  // True iff the file opens with the frontmatter marker `/* ---` (or
  // `/*---`). Files without it are treated as primitives.
  isTool: boolean;
  // The `description: |` block scalar's body, with the YAML indentation
  // stripped. `null` if the block is missing or the file isn't a tool.
  description: string | null;
};

const NEGATIVE: FrontmatterHead = { isTool: false, description: null };

// Read at most HEAD_BYTES from the file's start and parse the frontmatter
// out of that buffer. Errors (missing file, permission, etc.) collapse to
// "not a tool" — callers don't need to distinguish those cases.
export async function readFrontmatterHead(
  filePath: string,
): Promise<FrontmatterHead> {
  let head: string;
  try {
    head = await readHead(filePath, HEAD_BYTES);
  } catch {
    return NEGATIVE;
  }
  const trimmed = head.slice(0, 32).trimStart();
  const isTool =
    trimmed.startsWith("/* ---") || trimmed.startsWith("/*---");
  if (!isTool) return NEGATIVE;
  return { isTool: true, description: parseDescription(head) };
}

// Bounded read using an explicit fd so we don't load multi-MB files into
// memory just to inspect the first 4 KiB.
async function readHead(filePath: string, max: number): Promise<string> {
  const fh = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

// Pull the `description: |` block scalar out of the frontmatter.
// Walks line-by-line: find `description: |`, then collect every
// subsequent indented line until the next column-zero key or the
// closing `--- */`. Strips leading two-space indent.
export function parseDescription(source: string): string | null {
  const fmMatch = source.match(/\/\*\s*---\s*\n([\s\S]*?)\n\s*---\s*\*\//);
  if (!fmMatch || !fmMatch[1]) return null;
  const yaml = fmMatch[1];
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (/^\s*description\s*:\s*\|\s*$/.test(lines[i]!)) break;
    i += 1;
  }
  if (i >= lines.length) return null;
  const body: string[] = [];
  for (let j = i + 1; j < lines.length; j += 1) {
    const line = lines[j]!;
    if (/^[a-zA-Z][a-zA-Z0-9_-]*\s*:/.test(line)) break; // next top-level key
    body.push(line);
  }
  const trimmed = body
    .map((l) => l.replace(/^ {0,4}/, ""))
    .join("\n")
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}
