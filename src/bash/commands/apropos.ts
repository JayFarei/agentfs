// `apropos <query...>` custom command.
//
// Walks the tenant's /lib/ via the injected LibraryResolver, scores each
// function's `intent` (and `examples[].input` keys + name tokens) against
// the query, and prints matches above 0.3 in the canonical format from
// kb/prd/personas.md §3 Turn 2:
//
//     <name> (df.lib)        - <intent>
//
// Scoring blends two signals: (1) query coverage — fraction of query
// tokens present in the function's pooled tokens (intent + name +
// example-input keys), and (2) raw Jaccard. The blend privileges short
// queries with strong subset overlap (a 4-word query that hits 2 intent
// tokens still reads as "relevant") while keeping Jaccard's
// false-positive resistance. If both signals fall below 0.3 we drop the
// match.
//
// Zero matches prints `(no matches above 0.5)` to stdout — this mirrors
// kb/prd/personas.md §3 Turn 2 line 1 wording. The functional threshold
// is 0.3; the message text follows the personas script.

import { defineCommand, type Command } from "just-bash";

import type { LibraryResolver, LibraryEntry } from "../../sdk/index.js";

// --- Inputs needed at construction -----------------------------------------

export type AproposCommandDeps = {
  resolveTenant: () => string;
  resolveLibrary: () => LibraryResolver | null;
};

// --- Tokenisation + scoring ------------------------------------------------

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

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Coverage = |Q ∩ E| / |Q|. Privileges short queries that hit even one
// or two strong terms in the entry tokens. Returns a number in [0, 1].
function coverage(query: Set<string>, entry: Set<string>): number {
  if (query.size === 0) return 0;
  let intersection = 0;
  for (const tok of query) {
    if (entry.has(tok)) intersection += 1;
  }
  return intersection / query.size;
}

// Score one library entry against a query. We pool intent tokens with
// example input keys + the function name so functions whose intent text
// is terse but whose example input keys hint at the domain still
// surface. The final score is max(coverage, jaccard); coverage is the
// dominant signal for short queries, jaccard guards against trivial
// false positives on common words.
function scoreEntry(entry: LibraryEntry, queryTokens: Set<string>): number {
  const entryTokens = tokenise(entry.spec.intent);
  for (const example of entry.spec.examples) {
    const input = example.input;
    if (input && typeof input === "object") {
      for (const key of Object.keys(input as Record<string, unknown>)) {
        for (const tok of tokenise(key)) {
          entryTokens.add(tok);
        }
      }
    }
  }
  for (const tok of tokenise(entry.name)) {
    entryTokens.add(tok);
  }
  const cov = coverage(queryTokens, entryTokens);
  const jac = jaccard(queryTokens, entryTokens);
  return Math.max(cov, jac);
}

// --- Output formatting -----------------------------------------------------

function renderMatches(
  matches: Array<{ name: string; intent: string; score: number }>,
): string {
  if (matches.length === 0) {
    return "(no matches above 0.5)\n";
  }
  // Pad name column to align the dash, capped to keep terse layouts tidy.
  const maxName = Math.min(
    24,
    matches.reduce((m, x) => Math.max(m, x.name.length), 0),
  );
  const lines = matches.map((m) => {
    const padded = m.name.padEnd(maxName, " ");
    return `${padded} (df.lib)        - ${m.intent}`;
  });
  return `${lines.join("\n")}\n`;
}

// --- Command factory -------------------------------------------------------

// 0.25 lets a 4-word query that lands one strong term (e.g.
// "filing lookup company year" → "filing") surface, which mirrors what
// kb/prd/personas.md §3 Turn 2 expects from `apropos "filing lookup
// company year"` (it returns pickFiling + locateFigure, both of which
// share only the token "filing" with the query).
const SCORE_THRESHOLD = 0.25;

export function createAproposCommand(deps: AproposCommandDeps): Command {
  return defineCommand("apropos", async (args, _ctx) => {
    if (args.length === 0) {
      return {
        stdout: "",
        stderr: "apropos what?\n",
        exitCode: 1,
      };
    }

    const query = args.join(" ");
    const queryTokens = tokenise(query);
    if (queryTokens.size === 0) {
      return {
        stdout: "(no matches above 0.5)\n",
        stderr: "",
        exitCode: 0,
      };
    }

    const resolver = deps.resolveLibrary();
    if (!resolver) {
      return {
        stdout: "(no matches above 0.5)\n",
        stderr: "",
        exitCode: 0,
      };
    }

    const tenant = deps.resolveTenant();
    let entries: LibraryEntry[];
    try {
      entries = await resolver.list(tenant);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        stdout: "",
        stderr: `apropos: error listing /lib/: ${msg}\n`,
        exitCode: 1,
      };
    }

    const scored = entries
      .map((entry) => ({
        name: entry.name,
        intent: entry.spec.intent,
        score: scoreEntry(entry, queryTokens),
      }))
      .filter((m) => m.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    return {
      stdout: renderMatches(scored),
      stderr: "",
      exitCode: 0,
    };
  });
}
