import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { loadProjectEnv } from "./env.js";
import { createObserverRuntime } from "./datafetch/db/finqa_observe.js";
import { createOutlookAgentRuntime } from "./datafetch/db/finqa_outlook.js";
import { getAtlasSearchStatus } from "./loader/setupAtlasSearch.js";
import { runQuery, type RunQueryResult } from "./runner.js";
import type { StoredAgentSpec } from "./agents/store.js";
import type { StoredProcedure } from "./procedures/types.js";

type LiveObserverKind = "flue" | "anthropic";

export type LiveDemoOptions = {
  projectDir: string;
  tenantId?: string;
  reset?: boolean;
  observer?: LiveObserverKind;
  outlookAgent?: "flue";
  skipAtlasCheck?: boolean;
};

type ArtifactSnapshot = {
  files: string[];
};

const sentenceQuery =
  "Find the negative competitive outlook references about Visa, count them, and show evidence sentences.";
const titleQuery = "Find the negative competitive outlook references about Visa, but only from titles or quotes.";

export async function runLiveDemo(options: LiveDemoOptions): Promise<void> {
  loadProjectEnv();

  const tenantId = options.tenantId ?? "financial-analyst";
  const projectDir = path.resolve(options.projectDir);
  const baseDir = path.join(projectDir, ".atlasfs");
  const observer = options.observer ?? "flue";
  const outlookAgent = options.outlookAgent ?? "flue";

  assertLiveEnvironment();

  if (options.reset) {
    await rm(baseDir, { recursive: true, force: true });
  }
  await mkdir(projectDir, { recursive: true });

  const initial = await snapshotArtifacts(baseDir);
  if (initial.files.length > 0) {
    throw new Error(
      `${displayPath(baseDir)} is not clean. Re-run with --reset or choose a fresh --project directory.`
    );
  }

  printBanner({
    projectDir,
    baseDir,
    tenantId,
    observer,
    outlookAgent
  });

  if (!options.skipAtlasCheck) {
    await runStep("Check MongoDB Atlas data and Search indexes", async () => {
      const status = await getAtlasSearchStatus();
      const blocked = status.indexes.filter((index) => !index.queryable);
      console.log(`  db: ${status.dbName}`);
      console.log(`  collections: ${status.counts.cases} FinQA cases, ${status.counts.searchUnits} search units`);
      for (const index of status.indexes) {
        console.log(
          `  search index: ${index.collection}.${index.name} ${index.queryable ? "queryable" : index.status ?? index.error ?? "not queryable"}`
        );
      }
      if (status.counts.cases === 0 || status.counts.searchUnits === 0) {
        throw new Error("Atlas has no FinQA data loaded. Run `pnpm atlasfs load-finqa --all --reset` first.");
      }
      if (blocked.length > 0) {
        throw new Error("Atlas Search is not ready. Run `pnpm atlasfs setup-search --timeout-ms=240000` first.");
      }
    });
  }

  await runIntent({
    label: "Intent 1: discover a table-manipulation procedure",
    question: "what is the mathematical range for chemical revenue from 2014-2016, in millions?",
    tenantId,
    baseDir
  });

  await runIntent({
    label: "Intent 2: replay the sibling intent through the saved procedure",
    question: "what is the mathematical range for coal revenue from 2014-2016, in millions?",
    tenantId,
    baseDir
  });

  const observerRuntime = createObserverRuntime(observer);
  const outlookAgentRuntime = createOutlookAgentRuntime(outlookAgent);

  await runIntent({
    label: "Intent 3: use live agents and crystallize an agentic procedure",
    question: sentenceQuery,
    tenantId,
    baseDir,
    observerRuntime,
    outlookAgentRuntime
  });

  await runIntent({
    label: "Intent 4: reuse the stored agent and create only new glue",
    question: titleQuery,
    tenantId,
    baseDir,
    observerRuntime,
    outlookAgentRuntime
  });

  await runIntent({
    label: "Intent 5: execute the evolved intent as one procedure call",
    question: titleQuery,
    tenantId,
    baseDir,
    outlookAgentRuntime
  });

  await runStep("Final project inventory", async () => {
    await printStoredProcedures(baseDir, tenantId);
    await printStoredAgents(baseDir, tenantId);
  });
}

function assertLiveEnvironment(): void {
  const missing: string[] = [];
  if (!process.env.MONGODB_URI && !process.env.ATLAS_URI) {
    missing.push("MONGODB_URI or ATLAS_URI");
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_KEY) {
    missing.push("ANTHROPIC_API_KEY or ANTHROPIC_KEY");
  }
  if (missing.length > 0) {
    throw new Error(`Live demo requires ${missing.join(" and ")}. Put them in .env or export them first.`);
  }
}

function printBanner(args: {
  projectDir: string;
  baseDir: string;
  tenantId: string;
  observer: string;
  outlookAgent: string;
}): void {
  console.log("");
  console.log("AtlasFS live terminal demo");
  console.log("==========================");
  console.log(`project: ${displayPath(args.projectDir)}`);
  console.log(`memory:  ${displayPath(args.baseDir)}`);
  console.log(`tenant:  ${args.tenantId}`);
  console.log("data:    MongoDB Atlas + Atlas Search");
  console.log(`agents:  observer=${args.observer}, outlook=${args.outlookAgent}`);
  console.log("");
}

async function runStep(label: string, fn: () => Promise<void>): Promise<void> {
  const started = Date.now();
  console.log(`\n== ${label}`);
  await fn();
  console.log(`  done in ${Date.now() - started}ms`);
}

async function runIntent(args: {
  label: string;
  question: string;
  tenantId: string;
  baseDir: string;
  observerRuntime?: Parameters<typeof runQuery>[0]["observerRuntime"];
  outlookAgentRuntime?: Parameters<typeof runQuery>[0]["outlookAgentRuntime"];
}): Promise<RunQueryResult> {
  const before = await snapshotArtifacts(args.baseDir);
  let result: RunQueryResult | undefined;
  await runStep(args.label, async () => {
    console.log(`  $ atlasfs run "${args.question}"`);
    result = await runQuery({
      question: args.question,
      tenantId: args.tenantId,
      backend: { kind: "atlas" },
      baseDir: args.baseDir,
      observerRuntime: args.observerRuntime,
      outlookAgentRuntime: args.outlookAgentRuntime
    });
    printRunResult(result);
  });
  const after = await snapshotArtifacts(args.baseDir);
  printArtifactDelta(before, after);
  return result!;
}

function printRunResult(result: RunQueryResult): void {
  console.log(`  mode: ${result.mode}${result.procedureName ? ` (${result.procedureName})` : ""}`);
  console.log(`  answer: ${formatAnswer(result)}`);
  if (result.trajectoryId) {
    console.log(`  trajectory: ${result.trajectoryId}`);
  }
  console.log("  calls:");
  for (const [index, call] of result.calls.entries()) {
    const primitive = (call as { primitive?: string }).primitive ?? "unknown";
    console.log(`    ${index + 1}. ${primitive}${primitiveHint(primitive)}`);
  }
}

function formatAnswer(result: RunQueryResult): string {
  if (typeof result.roundedAnswer === "number") {
    return `${String(result.answer)} (rounded ${result.roundedAnswer})`;
  }
  return String(result.answer);
}

function primitiveHint(primitive: string): string {
  if (primitive === "finqa_cases.findSimilar") {
    return " [MongoDB Atlas Search]";
  }
  if (primitive === "finqa_table_math.execute") {
    return " [deterministic table manipulation]";
  }
  if (primitive.startsWith("finqa_outlook.") || primitive.startsWith("finqa_observe.")) {
    return " [live agent]";
  }
  if (primitive.startsWith("procedures.")) {
    return " [stored procedure]";
  }
  if (primitive === "agent_store.save") {
    return " [new reusable agent]";
  }
  if (primitive === "procedure_store.save") {
    return " [new procedure]";
  }
  return "";
}

async function snapshotArtifacts(baseDir: string): Promise<ArtifactSnapshot> {
  return {
    files: await listRelativeFiles(baseDir)
  };
}

function printArtifactDelta(before: ArtifactSnapshot, after: ArtifactSnapshot): void {
  const previous = new Set(before.files);
  const added = after.files.filter((file) => !previous.has(file));
  if (added.length === 0) {
    console.log("  artifacts: no new files");
    return;
  }
  console.log("  artifacts added:");
  for (const file of added) {
    console.log(`    + ${file}`);
  }
}

async function printStoredProcedures(baseDir: string, tenantId: string): Promise<void> {
  const dir = path.join(baseDir, "procedures", tenantId);
  const files = (await listRelativeFiles(dir)).filter((file) => file.endsWith(".json"));
  console.log("  procedures:");
  if (files.length === 0) {
    console.log("    none");
    return;
  }
  for (const file of files) {
    const procedure = JSON.parse(await readFile(path.join(dir, file), "utf8")) as StoredProcedure;
    const agent =
      procedure.implementation.kind === "agentic_ts_function" || procedure.implementation.kind === "task_agent"
        ? `, agent=${procedure.implementation.agentName}`
        : "";
    console.log(`    - ${procedure.name}: ${procedure.implementation.kind}${agent}`);
  }
}

async function printStoredAgents(baseDir: string, tenantId: string): Promise<void> {
  const dir = path.join(baseDir, "agents", tenantId);
  const files = (await listRelativeFiles(dir)).filter((file) => file.endsWith(".json"));
  console.log("  agents:");
  if (files.length === 0) {
    console.log("    none");
    return;
  }
  for (const file of files) {
    const agent = JSON.parse(await readFile(path.join(dir, file), "utf8")) as StoredAgentSpec;
    console.log(`    - ${agent.agentName}: ${agent.capability}`);
  }
}

async function listRelativeFiles(dir: string, prefix = ""): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const relativePath = path.join(prefix, entry.name);
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listRelativeFiles(fullPath, relativePath)));
      } else if (entry.isFile() || (await isFile(fullPath))) {
        files.push(relativePath);
      }
    }
    return files.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  if (!relative || relative.startsWith("..")) {
    return file;
  }
  return relative;
}
