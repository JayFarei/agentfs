// Agent verbs: `datafetch tsx`, `datafetch man`, `datafetch apropos`.
//
// These are the verbs a plain-bash agent (Claude Code) drives. Each
// resolves the active session, then either:
//   - tsx     → POSTs to /v1/snippets and streams stdout/stderr; appends
//               the Result envelope after a `--- envelope ---` separator.
//   - man     → reads `<baseDir>/lib/<tenant>/<fn>.ts` (via the same
//               DiskLibraryResolver the bash command uses) and renders a
//               man-style page.
//   - apropos → searches both `<baseDir>/lib/<tenant>/*.ts` and the
//               `__seed__` overlay for matches above the score threshold.

import { promises as fsp } from "node:fs";
import path from "node:path";

import type { GenericSchema } from "valibot";

import { defaultBaseDir } from "../paths.js";
import type { Fn, FnSpec, LibraryEntry } from "../sdk/index.js";
import { DiskLibraryResolver } from "../snippet/library.js";

import { jsonRequest, resolveServerUrl } from "./httpClient.js";
import { resolveActiveSession, type SessionRecord } from "./session.js";
import type { Flags } from "./types.js";

// --- Flag helpers ----------------------------------------------------------

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function jsonFlag(flags: Flags): boolean {
  return flags["json"] === true;
}

function serverUrlFromFlags(flags: Flags): string {
  return resolveServerUrl(flagString(flags, "server")).baseUrl;
}

function baseDirFromFlags(flags: Flags): string {
  const flag = flagString(flags, "base-dir");
  return flag ? path.resolve(flag) : defaultBaseDir();
}

// Fetch the session record from the server (we need the tenantId for
// disk-side reads). Throws if the server can't find it.
async function fetchSessionRecord(
  serverUrl: string,
  sessionId: string,
): Promise<SessionRecord> {
  return jsonRequest<SessionRecord>({
    method: "GET",
    path: `/v1/sessions/${encodeURIComponent(sessionId)}`,
    serverUrl,
  });
}

// --- Tool detection --------------------------------------------------------
//
// A "tool" is a crystallised wrapper — a function authored by the observer
// with a YAML frontmatter block at the top of the file. The frontmatter is
// the affordance signal: `name`, `description`, plus a "Use when..." clause
// the agent reads to decide whether to call directly vs compose.
//
// Anything without that frontmatter is a "primitive" — a building block
// shipped in /lib/__seed__/ or hand-authored. Primitives compose into tools.
//
// Detection: read the first ~256 bytes; if the file opens with `/* ---` or
// `/*---` (the YAML-in-comment frontmatter marker), it's a tool.

async function isTool(
  baseDir: string,
  tenantId: string,
  name: string,
): Promise<boolean> {
  const candidates = [
    path.join(baseDir, "lib", tenantId, `${name}.ts`),
    path.join(baseDir, "lib", "__seed__", `${name}.ts`),
  ];
  for (const file of candidates) {
    try {
      const head = await fsp.readFile(file, { encoding: "utf8" });
      const trimmed = head.slice(0, 32).trimStart();
      return trimmed.startsWith("/* ---") || trimmed.startsWith("/*---");
    } catch {
      // try the next candidate
    }
  }
  return false;
}

// --- tsx -------------------------------------------------------------------

export async function cmdTsx(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const baseDir = baseDirFromFlags(flags);
  const { sessionId } = await resolveActiveSession(flags, baseDir);
  const serverUrl = serverUrlFromFlags(flags);

  // `tsx -e '<source>'` or `tsx <file>`
  const eFlag = flagString(flags, "e");
  let source: string;
  if (eFlag !== undefined) {
    source = eFlag;
  } else {
    const file = positionals[0];
    if (!file) {
      throw new Error("tsx: provide -e '<source>' or a path to a .ts file");
    }
    source = await fsp.readFile(path.resolve(file), "utf8");
  }

  type SnippetResponse = {
    stdout: string;
    stderr: string;
    exitCode: number;
    trajectoryId?: string;
    cost?: unknown;
    mode?: string;
    functionName?: string;
    callPrimitives?: string[];
  };

  const res = await jsonRequest<SnippetResponse>({
    method: "POST",
    path: "/v1/snippets",
    body: { sessionId, source },
    serverUrl,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  // Trailing newline guard so the separator doesn't run into snippet output.
  if (res.stdout && !res.stdout.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write("--- envelope ---\n");
  process.stdout.write(
    `${JSON.stringify(
      {
        trajectoryId: res.trajectoryId,
        mode: res.mode,
        functionName: res.functionName,
        callPrimitives: res.callPrimitives,
        cost: res.cost,
        exitCode: res.exitCode,
      },
      null,
      2,
    )}\n`,
  );

  process.exitCode = res.exitCode;
}

// --- man -------------------------------------------------------------------

export async function cmdMan(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const name = positionals[0];
  if (!name) {
    process.stderr.write("What manual page do you want?\n");
    process.exitCode = 1;
    return;
  }
  const baseDir = baseDirFromFlags(flags);
  const { sessionId } = await resolveActiveSession(flags, baseDir);
  const serverUrl = serverUrlFromFlags(flags);

  const record = await fetchSessionRecord(serverUrl, sessionId);
  const resolver = new DiskLibraryResolver({ baseDir });
  const entry = await resolver.resolve(record.tenantId, name);
  if (!entry) {
    process.stderr.write(`man: no manual entry for ${name}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(renderManPage(name, entry.spec));
}

// --- apropos ---------------------------------------------------------------

export async function cmdApropos(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  if (positionals.length === 0) {
    process.stderr.write("apropos what?\n");
    process.exitCode = 1;
    return;
  }
  const baseDir = baseDirFromFlags(flags);
  const { sessionId } = await resolveActiveSession(flags, baseDir);
  const serverUrl = serverUrlFromFlags(flags);

  const record = await fetchSessionRecord(serverUrl, sessionId);
  const resolver = new DiskLibraryResolver({ baseDir });

  // DiskLibraryResolver.list() already merges tenant overlay with the
  // __seed__ fallback when the tenantId is non-reserved.
  let entries: LibraryEntry[];
  try {
    entries = await resolver.list(record.tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`apropos: error listing /lib/: ${msg}\n`);
    process.exitCode = 1;
    return;
  }

  const query = positionals.join(" ");
  const queryTokens = tokenise(query);
  const scoredRaw = entries
    .map((entry) => ({
      name: entry.name,
      intent: entry.spec.intent,
      score: scoreEntry(entry, queryTokens),
    }))
    .filter((m) => m.score >= SCORE_THRESHOLD);

  // Tag each match as tool vs primitive. Tools (crystallised wrappers
  // with YAML frontmatter) sort ahead of primitives within the score
  // ranking. The presence of the frontmatter — visible via `head -25`
  // on the .ts file — is the affordance signal; this sort is a hint.
  const scored = await Promise.all(
    scoredRaw.map(async (m) => ({
      ...m,
      isTool: await isTool(baseDir, record.tenantId, m.name),
    })),
  );
  scored.sort(
    (a, b) =>
      (a.isTool === b.isTool ? 0 : a.isTool ? -1 : 1) || b.score - a.score,
  );

  if (jsonFlag(flags)) {
    process.stdout.write(`${JSON.stringify({ matches: scored })}\n`);
    return;
  }

  if (scored.length === 0) {
    process.stdout.write("(no matches above 0.5)\n");
    return;
  }
  const maxName = Math.min(
    24,
    scored.reduce((m, x) => Math.max(m, x.name.length), 0),
  );
  for (const m of scored) {
    const padded = m.name.padEnd(maxName, " ");
    const tag = m.isTool ? "tool" : "primitive";
    process.stdout.write(`${padded} (${tag}) - ${m.intent}\n`);
  }
}

// --- Schema rendering (lifted from src/bash/commands/man.ts) ---------------

type SchemaShape = {
  type?: string;
  kind?: string;
  expects?: string;
  entries?: Record<string, SchemaShape>;
  item?: SchemaShape;
  wrapped?: SchemaShape;
  options?: unknown[];
  literal?: unknown;
};

function renderSchemaInline(schema: GenericSchema<unknown>): string {
  const s = schema as unknown as SchemaShape;
  switch (s.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "unknown":
      return "unknown";
    case "any":
      return "any";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "literal":
      return JSON.stringify(s.literal);
    case "picklist": {
      const opts = (s.options ?? []) as unknown[];
      return opts.map((o) => JSON.stringify(o)).join(" | ");
    }
    case "array": {
      const inner = s.item
        ? renderSchemaInline(s.item as unknown as GenericSchema<unknown>)
        : "unknown";
      return `${inner}[]`;
    }
    case "optional": {
      const inner = s.wrapped
        ? renderSchemaInline(s.wrapped as unknown as GenericSchema<unknown>)
        : "unknown";
      return `${inner}?`;
    }
    case "object": {
      const entries = s.entries ?? {};
      const fields = Object.keys(entries).map((key) => {
        const child = entries[key]!;
        const inner = renderSchemaInline(child as unknown as GenericSchema<unknown>);
        if (inner.endsWith("?")) {
          return `${key}?: ${inner.slice(0, -1)}`;
        }
        return `${key}: ${inner}`;
      });
      return `{ ${fields.join(", ")} }`;
    }
    default:
      return s.expects ?? "unknown";
  }
}

function renderSchemaBlock(schema: GenericSchema<unknown>): string[] {
  const s = schema as unknown as SchemaShape;
  if (s.type === "object" && s.entries) {
    const lines: string[] = [];
    for (const [key, child] of Object.entries(s.entries)) {
      const inner = renderSchemaInline(child as unknown as GenericSchema<unknown>);
      if (inner.endsWith("?")) {
        lines.push(`       ${key}?: ${inner.slice(0, -1)}`);
      } else {
        lines.push(`       ${key}: ${inner}`);
      }
    }
    return lines;
  }
  return [`       ${renderSchemaInline(schema)}`];
}

function renderSynopsisArg(schema: GenericSchema<unknown>): string {
  const s = schema as unknown as SchemaShape;
  if (s.type === "object" && s.entries) {
    const fields = Object.keys(s.entries).map((key) => {
      const child = s.entries![key]!;
      const inner = renderSchemaInline(child as unknown as GenericSchema<unknown>);
      return inner.endsWith("?") ? `${key}?` : key;
    });
    return `{ ${fields.join(", ")} }`;
  }
  return renderSchemaInline(schema);
}

function renderManPage(name: string, spec: FnSpec<unknown, unknown>): string {
  const lines: string[] = [];
  lines.push("NAME");
  lines.push(`       ${name} - ${spec.intent}`);
  lines.push("SYNOPSIS");
  lines.push(`       df.lib.${name}(${renderSynopsisArg(spec.input)})`);
  lines.push("INPUT SCHEMA");
  lines.push(...renderSchemaBlock(spec.input));
  lines.push("OUTPUT");
  lines.push(...renderSchemaBlock(spec.output));
  if (spec.examples.length > 0) {
    lines.push("EXAMPLES");
    for (const example of spec.examples) {
      const inputJson = JSON.stringify(example.input);
      const outputJson = JSON.stringify(example.output);
      lines.push(`       df.lib.${name}(${inputJson}) → ${outputJson}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// --- Apropos scoring (lifted from src/bash/commands/apropos.ts) ------------

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

function tokenise(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

// Walk an arbitrary value and add the tokenised forms of every string it
// contains (recursively, including arrays and nested objects). Used to
// pull keywords out of the originating user question that crystallisation
// preserves as `examples[0].input.query`.
function collectStringValues(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    for (const tok of tokenise(value)) into.add(tok);
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

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) if (b.has(tok)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function coverage(query: Set<string>, entry: Set<string>): number {
  if (query.size === 0) return 0;
  let intersection = 0;
  for (const tok of query) if (entry.has(tok)) intersection += 1;
  return intersection / query.size;
}

function scoreEntry(entry: LibraryEntry, queryTokens: Set<string>): number {
  const entryTokens = tokenise(entry.spec.intent);
  for (const example of entry.spec.examples) {
    const input = example.input;
    if (input && typeof input === "object") {
      for (const key of Object.keys(input as Record<string, unknown>)) {
        for (const tok of tokenise(key)) entryTokens.add(tok);
      }
      // Also tokenise example input STRING values. Crystallised wrappers
      // carry the originating user question as the first example's
      // string value (e.g. "what is the range of chemicals revenue...").
      // Without this, apropos can't find a wrapper by the user-facing
      // words even though they're sitting in the file as data.
      collectStringValues(input, entryTokens);
    }
  }
  for (const tok of tokenise(entry.name)) entryTokens.add(tok);
  return Math.max(coverage(queryTokens, entryTokens), jaccard(queryTokens, entryTokens));
}

const SCORE_THRESHOLD = 0.25;

// `Fn` import is only needed for type hint; suppress unused warning by
// touching the type alias here.
export type _ManFn = Fn<unknown, unknown>;
