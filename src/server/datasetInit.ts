import { promises as fsp } from "node:fs";
import path from "node:path";

import { publishMount } from "../adapter/publishMount.js";
import type { PublishedMountInventory } from "../adapter/publishMount.js";

import { CatalogStore, type CatalogSourceRecord } from "./catalogStore.js";
import {
  authorDatasetEnvironmentTemplate,
  buildDatasetTemplateInput,
  DATASET_INIT_TEMPLATE_SKILL,
  type DatasetEnvironmentTemplate,
  type DatasetInitMode,
  type DatasetTemplateAuthor,
  type DatasetTemplateAuthorInput,
  type DatasetTemplateReport,
} from "./datasetTemplateAgent.js";
import { buildSourceRecord } from "./v1catalog.js";

export type DatasetWhitelistEntry = {
  id: string;
  adapter: "huggingface";
  url: string;
  target?: string;
  init?: DatasetInitMode;
  initModel?: string;
};

type DatasetWhitelistFile = {
  datasets?: DatasetWhitelistEntry[];
};

export async function initializeWhitelistedDatasets(args: {
  baseDir: string;
  datasetsFile?: string;
  templateAuthor?: DatasetTemplateAuthor;
}): Promise<CatalogSourceRecord[]> {
  if (!args.datasetsFile) return [];
  const entries = await readWhitelist(args.datasetsFile);
  const out: CatalogSourceRecord[] = [];
  for (const entry of entries) {
    const record = await initializeDataset({
      baseDir: args.baseDir,
      entry,
      templateAuthor: args.templateAuthor,
    });
    out.push(record);
  }
  return out;
}

export async function initializeDataset(args: {
  baseDir: string;
  entry: DatasetWhitelistEntry;
  templateAuthor?: DatasetTemplateAuthor;
}): Promise<CatalogSourceRecord> {
  const store = new CatalogStore({ baseDir: args.baseDir });
  const built = await buildSourceRecord(args.entry.url, args.entry.id);
  const record: CatalogSourceRecord = {
    ...built,
    target: args.entry.target ?? "open",
    initializedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const saved = await store.upsert(record);
  const handle = await publishMount({
    id: saved.mountId,
    source: saved.source,
    baseDir: args.baseDir,
    warmup: "eager",
  });
  const inventory = await handle.inventory();
  const collections = collectionsFor(saved, inventory);
  const templateContext = await buildDatasetTemplateInput({
    baseDir: args.baseDir,
    source: saved,
    collections,
  });
  const templateResult = await resolveTemplate({
    entry: args.entry,
    context: templateContext,
    templateAuthor: args.templateAuthor,
  });
  await writeInitializedSource({
    baseDir: args.baseDir,
    source: saved,
    inventory,
    collections,
    templateContext,
    template: templateResult.template,
    report: templateResult.report,
  });
  return saved;
}

export async function renderManifest(args: {
  baseDir: string;
}): Promise<{
  version: 1;
  datasets: Array<{
    id: string;
    title: string;
    adapter: string;
    status: string;
    target?: string;
    sourceUrl: string;
    rows: number | null;
    collections: Array<{ ident: string; name: string; rows?: number }>;
    template?: Pick<DatasetTemplateReport, "mode" | "status" | "source" | "skill">;
    initializedAt?: string;
    updatedAt: string;
  }>;
}> {
  const store = new CatalogStore({ baseDir: args.baseDir });
  const sources = await store.list();
  const datasets = await Promise.all(
    sources.map(async (source) => {
      const sourceManifest = await readSourceManifest(args.baseDir, source.id);
      const collections =
        sourceManifest?.collections ??
        (source.splits ?? []).map((split) => ({
          ident: split.split,
          name: split.split,
          ...(split.rows !== undefined ? { rows: split.rows } : {}),
        }));
      const templateReport = await readTemplateReport(args.baseDir, source.id);
      return {
        id: source.id,
        title: source.title,
        adapter: source.adapter,
        status: source.status,
        ...(source.target !== undefined ? { target: source.target } : {}),
        sourceUrl: source.sourceUrl,
        rows: totalRows(collections),
        collections,
        ...(templateReport !== null
          ? {
              template: {
                mode: templateReport.mode,
                status: templateReport.status,
                source: templateReport.source,
                skill: templateReport.skill,
              },
            }
          : {}),
        ...(source.initializedAt !== undefined
          ? { initializedAt: source.initializedAt }
          : {}),
        updatedAt: source.updatedAt,
      };
    }),
  );
  return { version: 1, datasets };
}

async function readWhitelist(file: string): Promise<DatasetWhitelistEntry[]> {
  const raw = await fsp.readFile(file, "utf8");
  const parsed = JSON.parse(raw) as DatasetWhitelistFile;
  const entries = parsed.datasets ?? [];
  for (const entry of entries) {
    if (entry.adapter !== "huggingface") {
      throw new Error(`unsupported dataset adapter in whitelist: ${entry.adapter}`);
    }
    if (!entry.id || !entry.url) {
      throw new Error("dataset whitelist entries require id and url");
    }
    if (
      entry.init !== undefined &&
      entry.init !== "deterministic" &&
      entry.init !== "agent"
    ) {
      throw new Error(`unsupported dataset init mode: ${entry.init}`);
    }
  }
  return entries;
}

async function writeInitializedSource(args: {
  baseDir: string;
  source: CatalogSourceRecord;
  inventory: PublishedMountInventory;
  collections: Array<{ ident: string; name: string; rows?: number }>;
  templateContext: DatasetTemplateAuthorInput;
  template: DatasetEnvironmentTemplate;
  report: DatasetTemplateReport;
}): Promise<void> {
  const sourceRoot = path.join(args.baseDir, "sources", args.source.id);
  await fsp.mkdir(path.join(sourceRoot, "templates", "scripts"), {
    recursive: true,
  });
  const collections = args.collections;
  const sourceJson = {
    ...args.source,
    source: redactSourceForDisk(args.source.source),
  };
  await writeJson(path.join(sourceRoot, "source.json"), sourceJson);
  await writeJson(path.join(sourceRoot, "adapter-profile.json"), {
    version: 1,
    adapter: args.source.adapter,
    sourceUrl: args.source.sourceUrl,
    capabilities:
      args.source.adapter === "huggingface"
        ? {
            exact: true,
            lexical: true,
            semantic: false,
            hybrid: false,
            compiled: false,
            streaming: false,
          }
        : {},
    evidenceRefShape:
      args.source.adapter === "huggingface"
        ? "hf:<dataset>/<config>/<split>/<row_idx>"
        : "<adapter-specific-ref>",
    collections,
  });
  await writeJson(path.join(sourceRoot, "manifest.json"), {
    version: 1,
    id: args.source.id,
    title: args.source.title,
    adapter: args.source.adapter,
    status: args.source.status,
    target: args.source.target ?? "open",
    sourceUrl: args.source.sourceUrl,
    initializedAt: args.source.initializedAt,
    updatedAt: args.source.updatedAt,
    collections,
    template: {
      mode: args.report.mode,
      status: args.report.status,
      source: args.report.source,
      skill: args.report.skill,
    },
  });
  await writeJson(path.join(sourceRoot, "init-context.json"), args.templateContext);
  await writeJson(path.join(sourceRoot, "init-agent.json"), args.report);
  await fsp.writeFile(
    path.join(sourceRoot, "templates", "AGENTS.md"),
    args.template.agentsMd,
    "utf8",
  );
  await fsp.writeFile(
    path.join(sourceRoot, "templates", "CLAUDE.md"),
    args.template.claudeMd ?? args.template.agentsMd,
    "utf8",
  );
  await fsp.writeFile(
    path.join(sourceRoot, "templates", "scripts", "scratch.ts"),
    args.template.scratchTs,
    "utf8",
  );
  await fsp.writeFile(
    path.join(sourceRoot, "templates", "scripts", "answer.ts"),
    args.template.answerTs,
    "utf8",
  );
  if (args.template.notesMd !== undefined) {
    await fsp.writeFile(
      path.join(sourceRoot, "templates", "init-notes.md"),
      args.template.notesMd,
      "utf8",
    );
  }
}

async function readSourceManifest(
  baseDir: string,
  id: string,
): Promise<{ collections?: Array<{ ident: string; name: string; rows?: number }> } | null> {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(baseDir, "sources", id, "manifest.json"), "utf8"),
    ) as { collections?: Array<{ ident: string; name: string; rows?: number }> };
  } catch {
    return null;
  }
}

async function readTemplateReport(
  baseDir: string,
  id: string,
): Promise<DatasetTemplateReport | null> {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(baseDir, "sources", id, "init-agent.json"), "utf8"),
    ) as DatasetTemplateReport;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function redactSourceForDisk(source: CatalogSourceRecord["source"]): unknown {
  if (source.kind === "atlas") {
    return { ...source, uri: "<redacted>" };
  }
  return source;
}

function renderAgentsTemplate(
  context: DatasetTemplateAuthorInput,
): string {
  const defaultIdent = context.collections[0]?.ident ?? "<collection>";
  return [
    "# datafetch intent workspace",
    "",
    `Dataset: ${context.dataset.id}`,
    `Source: ${context.dataset.sourceUrl}`,
    `Target: ${context.dataset.target}`,
    "",
    "This file belongs to the mounted user-space worktree. You may edit it when you discover durable guidance.",
    "",
    "Boundaries:",
    "- `db/` is immutable dataset context and typed retrieval primitives.",
    "- `lib/` is tenant/user-space code: helpers, learned interfaces, and skills.",
    "- `scripts/scratch.ts` is for exploratory mapping.",
    "- `scripts/answer.ts` is the committed visible trajectory.",
    "- Final answers must come from `datafetch commit` and return `df.answer(...)`.",
    "",
    "Dataset entry points:",
    ...context.collections.map((c) => `- \`df.db.${c.ident}\` maps to \`${c.name}\`${c.rows !== undefined ? ` (${c.rows} rows)` : ""}.`),
    "",
    "Starter query:",
    "```ts",
    `const rows = await df.db.${defaultIdent}.search(input.query, { limit: 10 });`,
    "```",
    "",
  ].join("\n");
}

function renderScratchTemplate(
  context: DatasetTemplateAuthorInput,
): string {
  const defaultIdent = context.collections[0]?.ident ?? "train";
  return [
    "const query = typeof input !== \"undefined\" && input?.query ? String(input.query) : \"debug\";",
    `const rows = await df.db.${defaultIdent}.search(query, { limit: 10 });`,
    "console.log(JSON.stringify({ count: rows.length, first: rows[0] ?? null }, null, 2));",
    "",
  ].join("\n");
}

function renderAnswerTemplate(): string {
  return [
    "// Replace this with the visible, repeatable trajectory for the intent.",
    "// Commit will reject answers that do not return df.answer(...).",
    "return df.answer({",
    '  status: "unsupported",',
    "  evidence: [],",
    '  reason: "answer.ts has not been implemented yet",',
    "});",
    "",
  ].join("\n");
}

function collectionsFor(
  source: CatalogSourceRecord,
  inventory: PublishedMountInventory,
): Array<{ ident: string; name: string; rows?: number }> {
  return inventory.identMap.map((item) => {
    const split = source.splits?.find((s) => s.split === item.name);
    return {
      ident: item.ident,
      name: item.name,
      ...(split?.rows !== undefined ? { rows: split.rows } : {}),
    };
  });
}

async function resolveTemplate(args: {
  entry: DatasetWhitelistEntry;
  context: DatasetTemplateAuthorInput;
  templateAuthor?: DatasetTemplateAuthor;
}): Promise<{ template: DatasetEnvironmentTemplate; report: DatasetTemplateReport }> {
  const mode = requestedInitMode(args.entry);
  const deterministic = deterministicTemplate(args.context);
  if (mode !== "agent") {
    return {
      template: deterministic,
      report: {
        version: 1,
        mode,
        status: "skipped",
        source: "deterministic",
        skill: DATASET_INIT_TEMPLATE_SKILL,
        createdAt: new Date().toISOString(),
      },
    };
  }

  const model = args.entry.initModel ?? process.env["DATAFETCH_INIT_MODEL"];
  try {
    const author = args.templateAuthor ?? authorDatasetEnvironmentTemplate;
    const template = await author(args.context, { model });
    return {
      template,
      report: {
        version: 1,
        mode,
        status: "accepted",
        source: "agent",
        skill: DATASET_INIT_TEMPLATE_SKILL,
        ...(model !== undefined ? { model } : {}),
        createdAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      template: deterministic,
      report: {
        version: 1,
        mode,
        status: "fallback",
        source: "deterministic",
        skill: DATASET_INIT_TEMPLATE_SKILL,
        ...(model !== undefined ? { model } : {}),
        error: err instanceof Error ? err.message : String(err),
        createdAt: new Date().toISOString(),
      },
    };
  }
}

function requestedInitMode(entry: DatasetWhitelistEntry): DatasetInitMode {
  if (entry.init !== undefined) return entry.init;
  const env = process.env["DATAFETCH_INIT_TEMPLATE"];
  return env === "agent" ? "agent" : "deterministic";
}

function deterministicTemplate(
  context: DatasetTemplateAuthorInput,
): DatasetEnvironmentTemplate {
  return {
    agentsMd: renderAgentsTemplate(context),
    scratchTs: renderScratchTemplate(context),
    answerTs: renderAnswerTemplate(),
  };
}

function totalRows(collections: Array<{ rows?: number }>): number | null {
  let total = 0;
  let saw = false;
  for (const collection of collections) {
    if (typeof collection.rows !== "number") continue;
    total += collection.rows;
    saw = true;
  }
  return saw ? total : null;
}
