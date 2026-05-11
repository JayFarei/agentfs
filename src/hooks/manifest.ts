// Hook manifest persistence.
//
// Layout: <baseDir>/hooks/<tenantId>/<name>.json
//
// The manifest is the registry's source of truth. It is independent of
// whether the implementation .ts file under <baseDir>/lib/<tenantId>/
// loads successfully — a quarantined hook keeps its manifest so the
// observer signal (an agent tried to learn this affordance) survives
// even when the generated body is unusable.

import { promises as fsp } from "node:fs";
import path from "node:path";

import { emptyHookStats, type VfsHookManifest } from "./types.js";

export function hookDir(baseDir: string, tenantId: string): string {
  return path.join(baseDir, "hooks", tenantId);
}

export function hookManifestPath(
  baseDir: string,
  tenantId: string,
  name: string,
): string {
  return path.join(hookDir(baseDir, tenantId), `${name}.json`);
}

export async function readManifest(
  baseDir: string,
  tenantId: string,
  name: string,
): Promise<VfsHookManifest | null> {
  const file = hookManifestPath(baseDir, tenantId, name);
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as VfsHookManifest;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeManifest(
  baseDir: string,
  manifest: VfsHookManifest,
): Promise<void> {
  const file = hookManifestPath(baseDir, manifest.origin.tenantId, manifest.name);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function listManifests(
  baseDir: string,
  tenantId: string,
): Promise<VfsHookManifest[]> {
  const dir = hookDir(baseDir, tenantId);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: VfsHookManifest[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const name = entry.name.slice(0, -5);
    const manifest = await readManifest(baseDir, tenantId, name);
    if (manifest) out.push(manifest);
  }
  return out;
}

export function freshManifest(args: {
  name: string;
  intent: string;
  tenantId: string;
  implementationKind: VfsHookManifest["implementation"]["kind"];
  implementationRef?: string;
  trajectoryId?: string;
  shapeHash?: string;
  evidencePolicy?: VfsHookManifest["evidencePolicy"];
}): VfsHookManifest {
  const now = new Date().toISOString();
  return {
    name: args.name,
    path: `df.lib.${args.name}`,
    intent: args.intent,
    evidencePolicy: args.evidencePolicy ?? "optional",
    maturity: "observed",
    callability: "not-callable",
    implementation: {
      kind: args.implementationKind,
      ...(args.implementationRef ? { ref: args.implementationRef } : {}),
    },
    origin: {
      tenantId: args.tenantId,
      trajectoryIds: args.trajectoryId ? [args.trajectoryId] : [],
      ...(args.shapeHash ? { shapeHash: args.shapeHash } : {}),
      createdAt: now,
      updatedAt: now,
    },
    stats: emptyHookStats(),
  };
}
