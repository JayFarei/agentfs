// Generic per-family records mount and a generic per-entity seed
// renderer. Used by the SkillCraft full harness (and the
// pnpm datafetch:run probe path) to give the agent a substrate-rooted
// chain. The observer's crystallisation gate requires a db.* first
// call followed by a downstream lib.* with data-flow; without these,
// SkillCraft trajectories are pure-tool fan-out and the gate rejects
// every one of them.
//
// Nothing in this file branches on family / task / bundle / tool
// identity. Per-family records are derived from the task's
// initial_workspace JSON file by finding the single array-valued
// top-level key that is not `output_file`. The seed body is one
// generic function that loops a configurable bundle/tool combination
// over a list of entity ids; the agent supplies the bundle, tool, and
// param-name at call time.

import { promises as fsp } from "node:fs";
import path from "node:path";

import {
  type CollectionHandle,
  type MountAdapter,
  type MountInventory,
  type SampleOpts,
  type SourceCapabilities,
} from "../sdk/adapter.js";

export interface EvalRecord {
  id: string;
  family: string;
  entity: string;
  label: string;
  attributes: Record<string, string | number | boolean>;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1);
}

class EvalCollectionHandle implements CollectionHandle<EvalRecord> {
  constructor(
    readonly mountId: string,
    readonly resourceId: string,
    private readonly records: EvalRecord[],
  ) {}

  async search(query: string, opts?: { limit?: number }): Promise<EvalRecord[]> {
    const tokens = tokenize(query);
    const ranked = this.records
      .map((record) => {
        const haystack = [
          record.id,
          record.family,
          record.entity,
          record.label,
          ...Object.entries(record.attributes).map(([key, value]) => `${key} ${String(value)}`),
        ]
          .join(" ")
          .toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (haystack.includes(token)) score += 1;
        }
        if (record.family && query.includes(record.family)) score += 4;
        if (query.includes(record.entity)) score += 3;
        if (record.label && query.includes(record.label.toLowerCase())) score += 3;
        return { record, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id))
      .map((entry) => entry.record);
    return ranked.slice(0, opts?.limit ?? 25);
  }

  async findExact(filter: Partial<EvalRecord>, limit?: number): Promise<EvalRecord[]> {
    const filterEntries = Object.entries(filter);
    const matched = filterEntries.length === 0
      ? this.records.slice()
      : this.records.filter((record) =>
          filterEntries.every(([field, value]) => {
            const topLevel = record as unknown as Record<string, unknown>;
            if (topLevel[field] === value) return true;
            return record.attributes[field] === value;
          }),
        );
    return limit !== undefined ? matched.slice(0, limit) : matched;
  }

  async findByField(field: string, value: string | number | boolean): Promise<EvalRecord[]> {
    return this.records.filter((record) => {
      const topLevel = record as unknown as Record<string, unknown>;
      if (topLevel[field] === value) return true;
      return record.attributes[field] === value;
    });
  }

  async findSimilar(query: string, limit?: number): Promise<EvalRecord[]> {
    return this.search(query, limit === undefined ? undefined : { limit });
  }

  async hybrid(query: string, opts?: { limit?: number }): Promise<EvalRecord[]> {
    return this.search(query, opts);
  }
}

export class EvalRecordsMount implements MountAdapter {
  readonly id: string;

  constructor(id: string, private readonly records: EvalRecord[]) {
    this.id = id;
  }

  capabilities(): SourceCapabilities {
    return { vector: false, lex: true, stream: false, compile: false };
  }

  async probe(): Promise<MountInventory> {
    return { collections: [{ name: "records", rows: this.records.length }] };
  }

  async sample(_collection: string, opts: SampleOpts): Promise<unknown[]> {
    return this.records.slice(0, opts.size);
  }

  collection<T>(name: string): CollectionHandle<T> {
    if (name !== "records") {
      throw new Error(`EvalRecordsMount: unknown collection ${name}`);
    }
    return new EvalCollectionHandle(this.id, name, this.records) as unknown as CollectionHandle<T>;
  }

  async close(): Promise<void> {
    // in-memory adapter; nothing to release
  }
}

// Read the family's initial_workspace JSON files and return one
// EvalRecord per discovered entity. Entities are taken from the
// single array-valued top-level key that is not `output_file`. The
// per-record `attributes` field carries everything the source JSON
// provided about the entity so the agent can findExact against any
// of those fields.
export async function extractFamilyEntities(input: {
  family: string;
  initialWorkspaceDir: string;
}): Promise<EvalRecord[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(input.initialWorkspaceDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: EvalRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(input.initialWorkspaceDir, entry.name);
    let raw: string;
    try {
      raw = await fsp.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key === "output_file") continue;
      if (!Array.isArray(value)) continue;
      // Heuristic: this is the entity list. Each item should be an
      // object describing one entity.
      for (let idx = 0; idx < value.length; idx += 1) {
        const item = value[idx];
        const entity = normaliseEntity(item, input.family, idx);
        if (entity) records.push(entity);
      }
      // First array-valued key wins, stop looking in this file
      break;
    }
  }
  return records;
}

function normaliseEntity(
  item: unknown,
  family: string,
  index: number,
): EvalRecord | null {
  if (typeof item === "object" && item !== null && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    // Pick the first string-or-number value as the entity identifier
    // and the first string-valued field that is not the identifier as
    // the label. Fall back to index when neither exists. No field
    // names are family-specific.
    const idCandidate = pickIdValue(obj);
    const labelCandidate = pickLabelValue(obj, idCandidate);
    const entity = idCandidate !== undefined ? String(idCandidate) : String(index);
    const label = labelCandidate ?? entity;
    const attributes: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        attributes[key] = value;
      }
    }
    return {
      id: `${family}:${entity}`,
      family,
      entity,
      label,
      attributes,
    };
  }
  if (typeof item === "string" || typeof item === "number") {
    const entity = String(item);
    return {
      id: `${family}:${entity}`,
      family,
      entity,
      label: entity,
      attributes: { value: item },
    };
  }
  return null;
}

function pickIdValue(obj: Record<string, unknown>): string | number | undefined {
  // Prefer keys ending in "_id" / "id"; otherwise first string/number
  // value in entry order.
  for (const [key, value] of Object.entries(obj)) {
    if ((typeof value === "string" || typeof value === "number") && /(^|_)id$/i.test(key)) {
      return value;
    }
  }
  for (const value of Object.values(obj)) {
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return undefined;
}

function pickLabelValue(
  obj: Record<string, unknown>,
  idValue: string | number | undefined,
): string | undefined {
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && value !== idValue) return value;
  }
  return undefined;
}

// Body for the substrate-level `per_entity` seed. Loops a configurable
// bundle/tool combination over a list of entity ids and aggregates
// the results. Generic: no tenant-, dataset-, or family-specific
// knowledge; the agent supplies `toolBundle`, `toolNames`, and
// `paramName` at call time. Name has no SkillCraft prefix because
// this helper is substrate-level, not benchmark-level.
export function renderPerEntitySeed(): string {
  const body = `import { fn } from "@datafetch/sdk";
import * as v from "valibot";

type ToolCallEnvelope = { value: unknown } | unknown;

declare const df: {
  tool: Record<string, Record<string, (input: Record<string, unknown>) => Promise<unknown>>>;
};

type Input = {
  entityIds: Array<string | number>;
  toolBundle: string;
  toolNames: string[];
  paramName: string;
  extraInput?: Record<string, unknown>;
};

export const per_entity = fn({
  intent: "Fan out a configurable list of tools over a list of entity ids, sharing one parameter, and aggregate the results per entity.",
  examples: [],
  input: v.object({
    entityIds: v.array(v.union([v.string(), v.number()])),
    toolBundle: v.string(),
    toolNames: v.array(v.string()),
    paramName: v.string(),
    extraInput: v.optional(v.record(v.string(), v.unknown())),
  }),
  output: v.unknown(),
  async body(input) {
    const i = input as Input;
    const bundle = df.tool[i.toolBundle];
    if (!bundle) {
      return { value: { error: "unknown_bundle", toolBundle: i.toolBundle } };
    }
    const results: Array<{ entityId: string | number; tools: Record<string, unknown> }> = [];
    for (const entityId of i.entityIds) {
      const perTool: Record<string, unknown> = {};
      for (const toolName of i.toolNames) {
        const tool = bundle[toolName];
        if (!tool) {
          perTool[toolName] = { error: "unknown_tool", tool: toolName };
          continue;
        }
        const payload: Record<string, unknown> = {
          ...(i.extraInput ?? {}),
          [i.paramName]: entityId,
        };
        try {
          perTool[toolName] = await tool(payload);
        } catch (err) {
          perTool[toolName] = { error: String(err) };
        }
      }
      results.push({ entityId, tools: perTool });
    }
    return results;
  },
});
`;
  return body;
}

export const PER_ENTITY_SEED_NAME = "per_entity";
