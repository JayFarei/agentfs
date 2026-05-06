import { promises as fsp } from "node:fs";
import path from "node:path";

import { readFrontmatterHead } from "../sdk/frontmatter.js";
import type {
  Fn,
  FnSpec,
  LibraryEntry,
  LibraryResolver,
} from "../sdk/index.js";
import {
  renderSchemaBlock,
  renderSynopsisArg,
} from "../sdk/schemaRender.js";

export type LibraryFunctionKind = "tool" | "primitive";

export type RankedFunction = {
  name: string;
  kind: LibraryFunctionKind;
  score: number;
  intent: string;
  description?: string;
  why: string[];
  invocation: string;
  sourcePath: string;
};

export type LibraryFunctionDescription = {
  name: string;
  kind: LibraryFunctionKind;
  intent: string;
  description?: string;
  invocation: string;
  sourcePath: string;
  spec: FnSpec<unknown, unknown>;
};

export type SearchLibraryArgs = {
  baseDir: string;
  tenantId: string;
  resolver: LibraryResolver;
  query: string;
  threshold?: number;
};

export type DescribeLibraryFunctionArgs = {
  baseDir: string;
  tenantId: string;
  resolver: LibraryResolver;
  name: string;
};

const SCORE_THRESHOLD = 0.25;
const SOURCE_HEAD_BYTES = 4096;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
]);

export async function searchLibrary(
  args: SearchLibraryArgs,
): Promise<RankedFunction[]> {
  const threshold = args.threshold ?? SCORE_THRESHOLD;
  const queryTokens = tokenise(args.query);
  if (queryTokens.size === 0) return [];

  const entries = await args.resolver.list(args.tenantId);
  const scored = await Promise.all(
    entries.map(async (entry) => {
      const meta = await functionMetadata({
        baseDir: args.baseDir,
        tenantId: args.tenantId,
        name: entry.name,
      });
      return scoreEntry(entry, meta, queryTokens);
    }),
  );

  return scored
    .filter((m) => m.score >= threshold)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.kind !== b.kind) return a.kind === "tool" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function describeLibraryFunction(
  args: DescribeLibraryFunctionArgs,
): Promise<LibraryFunctionDescription | null> {
  const fn = await args.resolver.resolve(args.tenantId, args.name);
  if (!fn) return null;
  const meta = await functionMetadata({
    baseDir: args.baseDir,
    tenantId: args.tenantId,
    name: args.name,
  });
  return {
    name: args.name,
    kind: meta.kind,
    intent: fn.spec.intent,
    ...(meta.description ? { description: meta.description } : {}),
    invocation: renderInvocation(args.name, fn.spec),
    sourcePath: meta.sourcePath,
    spec: fn.spec,
  };
}

export function renderManPage(desc: LibraryFunctionDescription): string {
  const lines: string[] = [];
  lines.push("NAME");
  lines.push(`       ${desc.name} - ${desc.intent}`);
  lines.push("KIND");
  lines.push(`       ${desc.kind}`);
  if (desc.description) {
    lines.push("DESCRIPTION");
    for (const line of desc.description.split("\n")) {
      lines.push(`       ${line}`);
    }
  }
  lines.push("SYNOPSIS");
  lines.push(`       df.lib.${desc.name}(${renderSynopsisArg(desc.spec.input)})`);
  lines.push("INPUT SCHEMA");
  lines.push(...renderSchemaBlock(desc.spec.input));
  lines.push("OUTPUT");
  lines.push(...renderSchemaBlock(desc.spec.output));
  if (desc.spec.examples.length > 0) {
    lines.push("EXAMPLES");
    for (const example of desc.spec.examples) {
      const inputJson = jsonOneLine(example.input);
      const outputJson = jsonOneLine(example.output);
      lines.push(`       df.lib.${desc.name}(${inputJson}) => ${outputJson}`);
    }
  }
  lines.push("INVOCATION");
  lines.push(`       ${desc.invocation}`);
  lines.push("SOURCE");
  lines.push(`       ${desc.sourcePath}`);
  return `${lines.join("\n")}\n`;
}

type FunctionMetadata = {
  kind: LibraryFunctionKind;
  description: string | null;
  sourcePath: string;
  sourceHead: string;
};

async function functionMetadata(args: {
  baseDir: string;
  tenantId: string;
  name: string;
}): Promise<FunctionMetadata> {
  const candidates = [
    path.join(args.baseDir, "lib", args.tenantId, `${args.name}.ts`),
    path.join(args.baseDir, "lib", "__seed__", `${args.name}.ts`),
  ];

  for (const file of candidates) {
    if (!(await isFile(file))) continue;
    const head = await readFrontmatterHead(file);
    return {
      kind: head.isTool ? "tool" : "primitive",
      description: head.description,
      sourcePath: file,
      sourceHead: await readHead(file, SOURCE_HEAD_BYTES),
    };
  }

  return {
    kind: "primitive",
    description: null,
    sourcePath: path.join(args.baseDir, "lib", args.tenantId, `${args.name}.ts`),
    sourceHead: "",
  };
}

function scoreEntry(
  entry: LibraryEntry,
  meta: FunctionMetadata,
  queryTokens: Set<string>,
): RankedFunction {
  const buckets: Array<{ label: string; tokens: Set<string>; weight: number }> = [
    { label: "name", tokens: tokenise(entry.name), weight: 0.9 },
    { label: "intent", tokens: tokenise(entry.spec.intent), weight: 1 },
    {
      label: "description",
      tokens: tokenise(meta.description ?? ""),
      weight: 1,
    },
    {
      label: "examples",
      tokens: tokenise(examplesText(entry.spec)),
      weight: 0.95,
    },
    {
      label: "source",
      tokens: tokenise(meta.sourceHead),
      weight: 0.55,
    },
  ];

  const combined = new Set<string>();
  for (const bucket of buckets) {
    for (const tok of bucket.tokens) combined.add(tok);
  }

  let score = Math.max(coverage(queryTokens, combined), jaccard(queryTokens, combined));
  const why: string[] = [];
  for (const bucket of buckets) {
    const cov = coverage(queryTokens, bucket.tokens);
    const jac = jaccard(queryTokens, bucket.tokens);
    const bucketScore = Math.max(cov, jac) * bucket.weight;
    if (bucketScore > score) score = bucketScore;
    const hits = intersection(queryTokens, bucket.tokens);
    if (hits.length > 0) {
      why.push(`${bucket.label}: ${hits.slice(0, 5).join(", ")}`);
    }
  }

  if (meta.kind === "tool" && score > 0) {
    score = Math.min(1, score + 0.05);
  }

  return {
    name: entry.name,
    kind: meta.kind,
    score,
    intent: entry.spec.intent,
    ...(meta.description ? { description: meta.description } : {}),
    why,
    invocation: renderInvocation(entry.name, entry.spec),
    sourcePath: meta.sourcePath,
  };
}

function renderInvocation(name: string, spec: FnSpec<unknown, unknown>): string {
  const example = spec.examples[0];
  if (example !== undefined) {
    return `df.lib.${name}(${jsonOneLine(example.input)})`;
  }
  return `df.lib.${name}(${renderSynopsisArg(spec.input)})`;
}

function examplesText(spec: FnSpec<unknown, unknown>): string {
  const strings: string[] = [];
  for (const example of spec.examples) {
    collectStringValues(example.input, strings);
    collectStringValues(example.output, strings);
    strings.push(jsonOneLine(example.input));
  }
  return strings.join(" ");
}

function collectStringValues(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStringValues(v, into);
    }
  }
}

function tokenise(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersectionCount = 0;
  for (const tok of a) if (b.has(tok)) intersectionCount += 1;
  const union = a.size + b.size - intersectionCount;
  return union === 0 ? 0 : intersectionCount / union;
}

function coverage(query: Set<string>, entry: Set<string>): number {
  if (query.size === 0) return 0;
  let intersectionCount = 0;
  for (const tok of query) if (entry.has(tok)) intersectionCount += 1;
  return intersectionCount / query.size;
}

function intersection(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const tok of a) {
    if (b.has(tok)) out.push(tok);
  }
  return out;
}

function jsonOneLine(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "...";
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    const st = await fsp.stat(file);
    return st.isFile();
  } catch {
    return false;
  }
}

async function readHead(file: string, maxBytes: number): Promise<string> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await fh.close();
  }
}
