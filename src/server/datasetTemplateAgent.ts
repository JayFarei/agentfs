import path from "node:path";
import { promises as fsp } from "node:fs";

import { agent } from "../sdk/body.js";
import { costZero } from "../sdk/result.js";
import { getBodyDispatcher } from "../sdk/runtime.js";

import type { CatalogSourceRecord } from "./catalogStore.js";

export const DATASET_INIT_TEMPLATE_SKILL = "datafetch_init_mount_template";

export type DatasetInitMode = "deterministic" | "agent";

export type DatasetEnvironmentTemplate = {
  agentsMd: string;
  claudeMd?: string;
  scratchTs: string;
  answerTs: string;
  notesMd?: string;
};

export type DatasetTemplateAuthorInput = {
  version: 1;
  dataset: {
    id: string;
    title: string;
    adapter: string;
    sourceUrl: string;
    target: string;
    description?: string;
    license?: string;
  };
  adapterProfile: {
    capabilities: Record<string, unknown>;
    evidenceRefShape: string;
  };
  collections: Array<{
    ident: string;
    name: string;
    rows?: number;
    descriptor?: unknown;
    stats?: unknown;
  }>;
  samples: Record<string, unknown[]>;
  constraints: {
    dbIsImmutable: true;
    libIsTenantWritable: true;
    finalAnswerRequiresDfAnswer: true;
    scripts: {
      scratch: "explore";
      answer: "commit";
    };
  };
};

export type DatasetTemplateAuthor = (
  input: DatasetTemplateAuthorInput,
  opts: { model?: string },
) => Promise<DatasetEnvironmentTemplate>;

export type DatasetTemplateReport = {
  version: 1;
  mode: DatasetInitMode;
  status: "skipped" | "accepted" | "fallback";
  source: "deterministic" | "agent";
  skill: typeof DATASET_INIT_TEMPLATE_SKILL;
  model?: string;
  error?: string;
  createdAt: string;
};

export async function authorDatasetEnvironmentTemplate(
  input: DatasetTemplateAuthorInput,
  opts: { model?: string } = {},
): Promise<DatasetEnvironmentTemplate> {
  const dispatcher = getBodyDispatcher();
  if (dispatcher === null) {
    throw new Error("dataset init agent requested but no Flue BodyDispatcher is installed");
  }
  const model =
    opts.model ??
    process.env["DATAFETCH_INIT_MODEL"] ??
    process.env["DATAFETCH_LLM_MODEL"] ??
    process.env["DF_LLM_MODEL"] ??
    "openai-codex/gpt-5.3-codex-spark";
  const value = await dispatcher.dispatch(
    agent({
      skill: DATASET_INIT_TEMPLATE_SKILL,
      model,
    }),
    input,
    {
      tenant: "__system__",
      mount: input.dataset.id,
      cost: costZero(),
      functionName: DATASET_INIT_TEMPLATE_SKILL,
    },
  );
  return normalizeDatasetEnvironmentTemplate(value);
}

export async function buildDatasetTemplateInput(args: {
  baseDir: string;
  source: CatalogSourceRecord;
  collections: Array<{ ident: string; name: string; rows?: number }>;
}): Promise<DatasetTemplateAuthorInput> {
  const samples: Record<string, unknown[]> = {};
  const collections: DatasetTemplateAuthorInput["collections"] = [];
  for (const collection of args.collections) {
    const collectionRoot = path.join(
      args.baseDir,
      "mounts",
      args.source.mountId,
      collection.name,
    );
    const descriptor = await readJsonIfExists(
      path.join(collectionRoot, "_descriptor.json"),
    );
    const stats = await readJsonIfExists(path.join(collectionRoot, "_stats.json"));
    const sampleRows = await readJsonIfExists(
      path.join(collectionRoot, "_samples.json"),
    );
    samples[collection.ident] = Array.isArray(sampleRows) ? sampleRows : [];
    collections.push({
      ident: collection.ident,
      name: collection.name,
      ...(collection.rows !== undefined ? { rows: collection.rows } : {}),
      ...(descriptor !== undefined ? { descriptor } : {}),
      ...(stats !== undefined ? { stats } : {}),
    });
  }

  return {
    version: 1,
    dataset: {
      id: args.source.id,
      title: args.source.title,
      adapter: args.source.adapter,
      sourceUrl: args.source.sourceUrl,
      target: args.source.target ?? "open",
      ...(args.source.description !== undefined
        ? { description: args.source.description }
        : {}),
      ...(args.source.license !== undefined ? { license: args.source.license } : {}),
    },
    adapterProfile: {
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
    },
    collections,
    samples,
    constraints: {
      dbIsImmutable: true,
      libIsTenantWritable: true,
      finalAnswerRequiresDfAnswer: true,
      scripts: {
        scratch: "explore",
        answer: "commit",
      },
    },
  };
}

export function normalizeDatasetEnvironmentTemplate(
  value: unknown,
): DatasetEnvironmentTemplate {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dataset init agent returned a non-object template");
  }
  const record = value as Record<string, unknown>;
  return {
    agentsMd: requiredString(record, "agentsMd"),
    ...(optionalString(record, "claudeMd") !== undefined
      ? { claudeMd: optionalString(record, "claudeMd") }
      : {}),
    scratchTs: requiredString(record, "scratchTs"),
    answerTs: requiredString(record, "answerTs"),
    ...(optionalString(record, "notesMd") !== undefined
      ? { notesMd: optionalString(record, "notesMd") }
      : {}),
  };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`dataset init agent template missing non-empty ${key}`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`dataset init agent template field ${key} must be a string`);
  }
  return value;
}

async function readJsonIfExists(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as unknown;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return undefined;
    throw err;
  }
}
