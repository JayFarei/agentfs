// VFS hook registry.
//
// The registry owns public callability of df.lib.<name>. Responsibilities:
//   1. Maintain a hook manifest under <baseDir>/hooks/<tenant>/<name>.json
//      for every learned interface the observer or eval harness creates.
//   2. Validate the underlying implementation (transform/import + export
//      lookup) via the existing LibraryResolver, but treat a failure as
//      "quarantine the implementation, keep the manifest" rather than
//      "delete the .ts file".
//   3. Decide callability per the active interface mode.
//
// The registry is intentionally tenant-scoped at lookup time: a single
// in-process instance serves every tenant, and lookups consult the
// on-disk lib overlay + manifest dir for that tenant.

import { promises as fsp } from "node:fs";
import path from "node:path";

import { defaultBaseDir } from "../paths.js";
import type { Fn, LibraryResolver } from "../sdk/index.js";

import { writeTelemetryEvent } from "../server/telemetry.js";
import { getInterfaceMode, type InterfaceMode } from "./mode.js";
import {
  freshManifest,
  hookManifestPath,
  listManifests,
  readManifest,
  writeManifest,
} from "./manifest.js";
import { classifyQuarantine, errorMessage } from "./quarantine.js";
import {
  emptyHookStats,
  type HookCallability,
  type HookMaturity,
  type VfsHookManifest,
} from "./types.js";

export type HookLookup =
  | {
      kind: "callable";
      manifest: VfsHookManifest;
      fn: Fn<unknown, unknown>;
      withFallback: boolean;
    }
  | {
      kind: "not-callable";
      manifest: VfsHookManifest;
      reason: HookCallability;
    }
  | { kind: "absent" };

export type RegistryOpts = {
  baseDir?: string;
  resolver: LibraryResolver;
  // Optional override; otherwise reads DATAFETCH_INTERFACE_MODE on each call.
  mode?: InterfaceMode;
  telemetryEnabled?: boolean;
};

export class HookRegistry {
  private readonly baseDir: string;
  private readonly resolver: LibraryResolver;
  private readonly explicitMode: InterfaceMode | undefined;
  private readonly telemetry: boolean;
  // Tenant -> name -> manifest cache. Cleared whenever a manifest is
  // re-validated.
  private readonly cache = new Map<string, Map<string, VfsHookManifest>>();
  // Tenant -> "ingested" flag. We do one pass per tenant when the
  // registry is first asked about that tenant.
  private readonly ingested = new Set<string>();

  constructor(opts: RegistryOpts) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
    this.resolver = opts.resolver;
    if (opts.mode !== undefined) this.explicitMode = opts.mode;
    this.telemetry =
      opts.telemetryEnabled ?? process.env["DATAFETCH_TELEMETRY"] === "1";
  }

  mode(): InterfaceMode {
    return this.explicitMode ?? getInterfaceMode();
  }

  /**
   * Ingest every .ts file in <baseDir>/lib/<tenant>/ and write a hook
   * manifest for each. Failing files become quarantined manifests;
   * passing files become candidate-typescript with callability per mode.
   *
   * Idempotent: subsequent calls re-validate only files whose mtime
   * differs from the manifest, OR whose manifest is missing.
   *
   * Returns the manifests for the tenant after the pass.
   */
  async ingestTenant(tenantId: string): Promise<VfsHookManifest[]> {
    const dir = path.join(this.baseDir, "lib", tenantId);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      this.ingested.add(tenantId);
      return [];
    }
    const out: VfsHookManifest[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const name = entry.name.slice(0, -3);
      const manifest = await this.validateImplementation({
        tenantId,
        name,
        filePath: path.join(dir, entry.name),
        implementationKind: "typescript",
      });
      out.push(manifest);
    }
    this.ingested.add(tenantId);
    return out;
  }

  /**
   * Look up a hook by tenant + name. Returns "callable" / "not-callable"
   * / "absent" + the manifest if one exists.
   */
  async lookup(tenantId: string, name: string): Promise<HookLookup> {
    if (!this.ingested.has(tenantId)) {
      await this.ingestTenant(tenantId);
    }
    // Check cache first.
    let manifest = this.cache.get(tenantId)?.get(name);
    if (!manifest) {
      manifest = (await readManifest(this.baseDir, tenantId, name)) ?? undefined;
      if (manifest) this.rememberManifest(manifest);
    }

    const filePath = path.join(this.baseDir, "lib", tenantId, `${name}.ts`);
    const fileExists = await pathExists(filePath);

    if (!manifest && !fileExists) {
      return { kind: "absent" };
    }
    if (!manifest && fileExists) {
      manifest = await this.validateImplementation({
        tenantId,
        name,
        filePath,
        implementationKind: "typescript",
      });
    }

    if (!manifest) return { kind: "absent" };

    if (manifest.callability === "callable" || manifest.callability === "callable-with-fallback") {
      const fn = await this.resolver.resolve(tenantId, name);
      if (!fn) {
        // Promotion-time validation passed; live resolution still fails
        // (file edited away, transform regressed). Quarantine on demand.
        manifest = await this.quarantineManifest({
          existing: manifest,
          err: new Error(`live resolve returned null for df.lib.${name}`),
        });
        return { kind: "not-callable", manifest, reason: manifest.callability };
      }
      return {
        kind: "callable",
        manifest,
        fn,
        withFallback: manifest.callability === "callable-with-fallback",
      };
    }
    return {
      kind: "not-callable",
      manifest,
      reason: manifest.callability,
    };
  }

  /**
   * Update the stats block for a hook after an invocation. Best-effort:
   * a failed manifest write does not propagate.
   */
  async recordInvocation(args: {
    tenantId: string;
    name: string;
    outcome: "success" | "unsupported" | "failure";
    errorClass?: ReturnType<typeof classifyQuarantine>;
    quarantineOnFailure?: boolean;
    errorMessage?: string;
  }): Promise<void> {
    const manifest = await readManifest(this.baseDir, args.tenantId, args.name);
    if (!manifest) return;

    manifest.stats = manifest.stats ?? emptyHookStats();
    manifest.stats.attempts += 1;
    if (args.outcome === "success") {
      manifest.stats.successes += 1;
    } else if (args.outcome === "unsupported") {
      manifest.stats.abstentions += 1;
    } else {
      manifest.stats.runtimeErrors += 1;
      if (args.errorClass === "quota_before_answer") {
        manifest.stats.quotaFailures += 1;
      }
      if (args.errorClass === "schema_validation") {
        manifest.stats.validationFailures += 1;
      }
      if (args.quarantineOnFailure && args.errorClass) {
        const now = new Date().toISOString();
        manifest.callability = "quarantined";
        manifest.quarantine = {
          reason: args.errorClass,
          message: args.errorMessage ?? "runtime invocation failure",
          firstSeenAt: manifest.quarantine?.firstSeenAt ?? now,
          lastSeenAt: now,
        };
      }
    }
    manifest.origin.updatedAt = new Date().toISOString();
    await writeManifest(this.baseDir, manifest);
    this.rememberManifest(manifest);
    if (this.telemetry) {
      await this.emit(args.outcome === "success" ? "hook.invoked" : args.outcome === "unsupported" ? "hook.returned_unsupported" : "hook.invoke_failed", {
        name: args.name,
        tenantId: args.tenantId,
        maturity: manifest.maturity,
        callability: manifest.callability,
        implementationKind: manifest.implementation.kind,
        errorClass: args.errorClass ?? null,
        message: args.errorMessage ?? null,
      });
    }
  }

  /**
   * List manifests for a tenant (post-ingest). Used by apropos/df.d.ts.
   */
  async listForTenant(tenantId: string): Promise<VfsHookManifest[]> {
    if (!this.ingested.has(tenantId)) {
      await this.ingestTenant(tenantId);
    }
    return listManifests(this.baseDir, tenantId);
  }

  /**
   * Validate a single implementation file and (re-)write the manifest
   * for it. Public so the observer can call this after authoring a
   * candidate body, and so the eval harness can run a one-shot
   * post-mirror validation pass.
   */
  async validateImplementation(args: {
    tenantId: string;
    name: string;
    filePath: string;
    implementationKind: VfsHookManifest["implementation"]["kind"];
    intent?: string;
    trajectoryId?: string;
    shapeHash?: string;
  }): Promise<VfsHookManifest> {
    const existing = await readManifest(this.baseDir, args.tenantId, args.name);
    const manifest: VfsHookManifest =
      existing ??
      freshManifest({
        name: args.name,
        intent: args.intent ?? `learned interface ${args.name}`,
        tenantId: args.tenantId,
        implementationKind: args.implementationKind,
        implementationRef: args.filePath,
        ...(args.trajectoryId ? { trajectoryId: args.trajectoryId } : {}),
        ...(args.shapeHash ? { shapeHash: args.shapeHash } : {}),
      });

    if (args.implementationKind !== manifest.implementation.kind) {
      manifest.implementation.kind = args.implementationKind;
    }
    manifest.implementation.ref = args.filePath;
    if (args.shapeHash && !manifest.origin.shapeHash) {
      manifest.origin.shapeHash = args.shapeHash;
    }
    if (args.trajectoryId && !manifest.origin.trajectoryIds.includes(args.trajectoryId)) {
      manifest.origin.trajectoryIds.push(args.trajectoryId);
    }

    let fn: Fn<unknown, unknown> | null = null;
    let validationError: unknown = null;
    try {
      fn = await this.resolver.resolve(args.tenantId, args.name);
      if (!fn) {
        validationError = new Error(
          `module does not export a Fn named "${args.name}" (or default Fn)`,
        );
      }
    } catch (err) {
      validationError = err;
    }

    const mode = this.mode();
    const now = new Date().toISOString();

    if (validationError) {
      const reason = classifyQuarantine(validationError);
      manifest.callability = "quarantined";
      manifest.quarantine = {
        reason,
        message: errorMessage(validationError),
        firstSeenAt: manifest.quarantine?.firstSeenAt ?? now,
        lastSeenAt: now,
      };
      manifest.stats.validationFailures += 1;
    } else {
      // Validation passed at load+export time. Maturity transitions to
      // candidate-typescript. Smoke replay would gate validated-typescript;
      // we leave that promotion to the eval harness's separate replay step.
      const previousMaturity: HookMaturity =
        manifest.maturity === "validated-typescript" ||
        manifest.maturity === "provider-native"
          ? manifest.maturity
          : "candidate-typescript";
      manifest.maturity = previousMaturity;
      manifest.callability = this.decideCallability(manifest, mode);
      // Clear any stale quarantine record on a successful re-validation.
      if (manifest.quarantine && manifest.callability !== "quarantined") {
        delete manifest.quarantine;
      }
    }

    manifest.origin.updatedAt = now;
    await writeManifest(this.baseDir, manifest);
    this.rememberManifest(manifest);

    if (this.telemetry) {
      if (!existing) {
        await this.emit("hook.created", {
          name: manifest.name,
          tenantId: args.tenantId,
          maturity: manifest.maturity,
          callability: manifest.callability,
          implementationKind: manifest.implementation.kind,
        });
      } else {
        await this.emit("hook.implementation_attached", {
          name: manifest.name,
          tenantId: args.tenantId,
          maturity: manifest.maturity,
          callability: manifest.callability,
          implementationKind: manifest.implementation.kind,
        });
      }
      if (manifest.callability === "quarantined") {
        await this.emit("hook.quarantined", {
          name: manifest.name,
          tenantId: args.tenantId,
          reason: manifest.quarantine?.reason ?? "runtime_error",
          message: manifest.quarantine?.message ?? "",
        });
      } else if (manifest.callability === "callable" && manifest.maturity === "validated-typescript") {
        await this.emit("hook.promoted", {
          name: manifest.name,
          tenantId: args.tenantId,
          maturity: manifest.maturity,
          callability: manifest.callability,
        });
      }
    }

    return manifest;
  }

  /**
   * Goal-3 iter 12 — smoke-replay promotion gate.
   *
   * After the observer authors a candidate-typescript body, this method
   * statically compares the call sequence in the authored source to the
   * trajectory's recorded primitives (or a sub-graph's expected step
   * list). When they match exactly, the hook is promoted to
   * validated-typescript with callability="callable" and the stats
   * block records a passed replay. When they mismatch, the hook stays
   * candidate-typescript with callability="callable-with-fallback" and
   * the stats block records a failed replay alongside a structured
   * mismatch reason.
   *
   * The match is static-shape (primitive name sequence) rather than a
   * full runtime invocation: the authored body's call ordering captures
   * the substrate-rooted chain we trust; the SDK's valibot schema
   * handles input validation at call time. A full replay would need the
   * mount + tool bridge to be live for the manifest write, which couples
   * promotion to a side-effecting harness step.
   */
  async smokeReplayAndPromote(args: {
    tenantId: string;
    name: string;
    filePath: string;
    expectedPrimitives: ReadonlyArray<string>;
  }): Promise<{
    matched: boolean;
    reason: string;
    bodyPrimitives: string[];
    manifest: VfsHookManifest | null;
  }> {
    const existing = await readManifest(this.baseDir, args.tenantId, args.name);
    if (!existing) {
      return {
        matched: false,
        reason: "no manifest to promote (run validateImplementation first)",
        bodyPrimitives: [],
        manifest: null,
      };
    }
    if (existing.callability === "quarantined") {
      return {
        matched: false,
        reason: "hook is quarantined; cannot promote",
        bodyPrimitives: [],
        manifest: existing,
      };
    }
    let source: string;
    try {
      source = await fsp.readFile(args.filePath, "utf8");
    } catch (err) {
      return {
        matched: false,
        reason: `failed to read implementation file: ${errorMessage(err)}`,
        bodyPrimitives: [],
        manifest: existing,
      };
    }
    const bodyPrimitives = extractAuthoredPrimitives(source);
    const expected = Array.from(args.expectedPrimitives);
    const matched =
      bodyPrimitives.length === expected.length &&
      bodyPrimitives.every((p, i) => p === expected[i]);

    const now = new Date().toISOString();
    existing.stats = existing.stats ?? emptyHookStats();
    if (matched) {
      existing.stats.replaysPassed += 1;
      // Don't downgrade provider-native; otherwise promote candidates to
      // validated-typescript and recompute callability under current mode.
      if (
        existing.maturity !== "provider-native" &&
        existing.maturity !== "validated-typescript"
      ) {
        existing.maturity = "validated-typescript";
      }
      existing.callability = this.decideCallability(existing, this.mode());
    } else {
      existing.stats.replaysFailed += 1;
      // Leave maturity at candidate-typescript; downgrade callability so
      // a fallback runs when the agent invokes the hook.
      if (
        existing.maturity !== "validated-typescript" &&
        existing.maturity !== "provider-native"
      ) {
        existing.maturity = "candidate-typescript";
      }
      // Under hooks-draft we already use callable-with-fallback for
      // candidates; in legacy mode the call path doesn't gate on
      // callability, so the demotion is harmless. Recompute to keep the
      // manifest consistent.
      existing.callability = this.decideCallability(existing, this.mode());
    }
    existing.origin.updatedAt = now;
    await writeManifest(this.baseDir, existing);
    this.rememberManifest(existing);

    if (this.telemetry) {
      await this.emit(matched ? "hook.replay_passed" : "hook.replay_failed", {
        name: existing.name,
        tenantId: args.tenantId,
        maturity: existing.maturity,
        callability: existing.callability,
        bodyPrimitives,
        expectedPrimitives: expected,
      });
      if (matched && existing.maturity === "validated-typescript") {
        await this.emit("hook.promoted", {
          name: existing.name,
          tenantId: args.tenantId,
          maturity: existing.maturity,
          callability: existing.callability,
        });
      }
    }

    return {
      matched,
      reason: matched
        ? "primitive sequence matches trajectory"
        : `body primitives [${bodyPrimitives.join(", ")}] did not match expected [${expected.join(", ")}]`,
      bodyPrimitives,
      manifest: existing,
    };
  }

  /**
   * Manually quarantine an existing manifest (used when a later runtime
   * crash reveals the body is unsafe even though static validation
   * passed).
   */
  private async quarantineManifest(args: {
    existing: VfsHookManifest;
    err: unknown;
  }): Promise<VfsHookManifest> {
    const reason = classifyQuarantine(args.err);
    const now = new Date().toISOString();
    const updated: VfsHookManifest = {
      ...args.existing,
      callability: "quarantined",
      quarantine: {
        reason,
        message: errorMessage(args.err),
        firstSeenAt: args.existing.quarantine?.firstSeenAt ?? now,
        lastSeenAt: now,
      },
      origin: { ...args.existing.origin, updatedAt: now },
    };
    await writeManifest(this.baseDir, updated);
    this.rememberManifest(updated);
    if (this.telemetry) {
      await this.emit("hook.quarantined", {
        name: updated.name,
        tenantId: updated.origin.tenantId,
        reason,
        message: errorMessage(args.err),
      });
    }
    return updated;
  }

  private decideCallability(
    manifest: VfsHookManifest,
    mode: InterfaceMode,
  ): HookCallability {
    if (mode === "legacy") return "callable";
    if (mode === "hooks-candidate-only") return "not-callable";

    if (mode === "hooks-validated-only") {
      if (
        manifest.maturity === "validated-typescript" ||
        manifest.maturity === "provider-native"
      ) {
        return "callable";
      }
      return "not-callable";
    }

    // hooks-draft
    if (manifest.maturity === "observed") return "not-callable";
    if (
      manifest.maturity === "validated-typescript" ||
      manifest.maturity === "provider-native"
    ) {
      return "callable";
    }
    return "callable-with-fallback";
  }

  private rememberManifest(manifest: VfsHookManifest): void {
    let perTenant = this.cache.get(manifest.origin.tenantId);
    if (!perTenant) {
      perTenant = new Map();
      this.cache.set(manifest.origin.tenantId, perTenant);
    }
    perTenant.set(manifest.name, manifest);
  }

  private async emit(event: string, fields: Record<string, unknown>): Promise<void> {
    try {
      await writeTelemetryEvent({
        baseDir: this.baseDir,
        event: { event, ...fields },
      });
    } catch {
      // best-effort; never let telemetry tear down a request
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// --- Module-level singleton ----------------------------------------------

let _registry: HookRegistry | null = null;

export function setHookRegistry(reg: HookRegistry | null): void {
  _registry = reg;
}

export function getHookRegistry(): HookRegistry | null {
  return _registry;
}

// Helpers used by tests / external callers.
export function hookManifestFile(
  baseDir: string,
  tenantId: string,
  name: string,
): string {
  return hookManifestPath(baseDir, tenantId, name);
}

// Goal-3 iter 12 — extract the primitive call sequence from an authored
// helper's source. Recognises three call shapes:
//   - df.db.<ident>.<method>(...)         → "db.<ident>.<method>"
//   - df.lib.<name>(...)                  → "lib.<name>"
//   - df.tool.<bundle>.<tool>(...) OR
//     df.tool.<bundle>["<tool>"]({...})   → "tool.<bundle>.<tool>"
// The match order follows source order so the resulting array is
// directly comparable to a trajectory's `calls.map(c => c.primitive)`.
// Calls inside `await Promise.all([...])` are included in the order they
// appear in the source, which matches the trajectory's record order
// (the trajectory records on call boundary, not on await resolution).
export function extractAuthoredPrimitives(source: string): string[] {
  // Strip line + block comments so commented-out df.* calls aren't counted.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  const out: Array<{ pos: number; primitive: string }> = [];

  // df.db.<ident>.<method>(...)
  const dbRe = /\bdf\.db\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of stripped.matchAll(dbRe)) {
    out.push({
      pos: m.index ?? 0,
      primitive: `db.${m[1]}.${m[2]}`,
    });
  }
  // df.lib.<name>(...)
  const libRe = /\bdf\.lib\.([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of stripped.matchAll(libRe)) {
    out.push({
      pos: m.index ?? 0,
      primitive: `lib.${m[1]}`,
    });
  }
  // df.tool.<bundle>.<tool>(...)  AND  df.tool.<bundle>["<tool>"](...)
  const toolDotRe = /\bdf\.tool\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of stripped.matchAll(toolDotRe)) {
    out.push({
      pos: m.index ?? 0,
      primitive: `tool.${m[1]}.${m[2]}`,
    });
  }
  const toolBracketRe = /\bdf\.tool\.([A-Za-z_$][\w$]*)\[\s*["']([^"']+)["']\s*\]\s*\(/g;
  for (const m of stripped.matchAll(toolBracketRe)) {
    out.push({
      pos: m.index ?? 0,
      primitive: `tool.${m[1]}.${m[2]}`,
    });
  }
  out.sort((a, b) => a.pos - b.pos);
  return out.map((c) => c.primitive);
}
