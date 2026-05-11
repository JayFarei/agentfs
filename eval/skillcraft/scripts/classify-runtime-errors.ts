// Reproduces the error-class taxonomy that backed
// eval/skillcraft/reports/datafetch-runtime-error-taxonomy.json, but
// for an arbitrary single eval run dir.
//
// Usage:
//   pnpm tsx eval/skillcraft/scripts/classify-runtime-errors.ts \
//     --run eval/skillcraft/results/datafetch/<run-dir> \
//     [--out eval/skillcraft/reports/<run-name>-error-taxonomy.json]
//
// Walks <run>/episodes/*/*/snippet-stderr.txt and bins the first error
// line into one of:
//   bad_or_missing_lib_export, typescript_transform_failure,
//   generated_code_reference_error, generated_code_type_error,
//   tool_payload_assumption_error, lib_schema_validation_error,
//   agent_quota_limit_before_answer, hook_quarantined,
//   hook_unsupported_fallback, other.
//
// Hook-aware rule of thumb:
//   - Lines that mention "hook is observed only" or "implementation is
//     quarantined" are classified as hook_quarantined — these are
//     PREVENTED runtime errors, not exposed ones.
//   - When a fallback envelope is returned the snippet usually exits 0,
//     so we won't see a stderr line at all; those are visible only in
//     the hook manifest stats.

import { promises as fsp } from "node:fs";
import path from "node:path";

type Bucket =
  | "bad_or_missing_lib_export"
  | "typescript_transform_failure"
  | "generated_code_reference_error"
  | "generated_code_type_error"
  | "tool_payload_assumption_error"
  | "lib_schema_validation_error"
  | "agent_quota_limit_before_answer"
  | "hook_quarantined"
  | "hook_unsupported_fallback"
  | "other";

const ALL_BUCKETS: Bucket[] = [
  "bad_or_missing_lib_export",
  "typescript_transform_failure",
  "generated_code_reference_error",
  "generated_code_type_error",
  "tool_payload_assumption_error",
  "lib_schema_validation_error",
  "agent_quota_limit_before_answer",
  "hook_quarantined",
  "hook_unsupported_fallback",
  "other",
];

type Example = { taskKey: string; firstLine: string };

type Report = {
  generatedAt: string;
  run: string;
  totalEpisodes: number;
  episodesWithStderr: number;
  counts: Record<Bucket, number>;
  examples: Record<Bucket, Example[]>;
};

function classify(firstLine: string): Bucket {
  const lower = firstLine.toLowerCase();
  if (lower.includes("hook is observed only") || lower.includes("implementation is quarantined") || lower.includes("the registry will not expose")) {
    return "hook_quarantined";
  }
  if (lower.includes("snippet/library] failed to load") || lower.includes("function not found in tenant")) {
    if (lower.includes("transform failed")) return "typescript_transform_failure";
    return "bad_or_missing_lib_export";
  }
  if (lower.includes("transform failed")) return "typescript_transform_failure";
  if (lower.includes("referenceerror") || lower.includes("is not defined")) {
    return "generated_code_reference_error";
  }
  if (
    lower.includes("typeerror") ||
    lower.includes("cannot read properties of") ||
    lower.includes("is not a function") ||
    lower.includes("is not iterable")
  ) {
    return "generated_code_type_error";
  }
  if (lower.includes("schemavalidation") || lower.includes("invalid_type") || lower.includes("schema_validation")) {
    return "lib_schema_validation_error";
  }
  if (lower.includes("quota") || lower.includes("usage limit") || lower.includes("token limit")) {
    return "agent_quota_limit_before_answer";
  }
  if (lower.includes("skillcraft tool") || lower.includes("payload for") || lower.includes("missing evolution chain") || lower.includes("failed monster payload")) {
    return "tool_payload_assumption_error";
  }
  if (lower.includes("hook returned unsupported") || lower.includes("\"unsupported\":true")) {
    return "hook_unsupported_fallback";
  }
  return "other";
}

function firstStderrLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed;
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listDir(p: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let run: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--run") run = path.resolve(argv[++i]!);
    else if (a?.startsWith("--run=")) run = path.resolve(a.slice("--run=".length));
    else if (a === "--out") out = path.resolve(argv[++i]!);
    else if (a?.startsWith("--out=")) out = path.resolve(a.slice("--out=".length));
  }
  if (!run) {
    console.error("usage: classify-runtime-errors.ts --run <runDir> [--out <file>]");
    process.exit(2);
  }
  const episodesDir = path.join(run, "episodes");
  if (!(await pathExists(episodesDir))) {
    console.error(`no episodes dir at ${episodesDir}`);
    process.exit(1);
  }
  const counts = Object.fromEntries(ALL_BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  const examples = Object.fromEntries(ALL_BUCKETS.map((b) => [b, [] as Example[]])) as Record<Bucket, Example[]>;
  let totalEpisodes = 0;
  let withStderr = 0;

  const families = await listDir(episodesDir);
  for (const family of families) {
    const levels = await listDir(path.join(episodesDir, family));
    for (const level of levels) {
      totalEpisodes += 1;
      const stderrPath = path.join(episodesDir, family, level, "snippet-stderr.txt");
      if (!(await pathExists(stderrPath))) continue;
      const text = await fsp.readFile(stderrPath, "utf8");
      const line = firstStderrLine(text);
      if (!line) continue;
      withStderr += 1;
      const bucket = classify(line);
      counts[bucket] += 1;
      if (examples[bucket].length < 3) {
        examples[bucket].push({ taskKey: `${family}/${level}`, firstLine: line.slice(0, 240) });
      }
    }
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    run: path.relative(process.cwd(), run),
    totalEpisodes,
    episodesWithStderr: withStderr,
    counts,
    examples,
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, json, "utf8");
    console.log(`wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
