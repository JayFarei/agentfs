// Observer worker.
//
// In-process, fire-and-forget from the snippet runtime's perspective. The
// worker reads a saved trajectory, runs the crystallisation gate, and (if
// the gate passes) dispatches the authoring step. No file watcher; no
// background daemon. The snippet runtime's `onTrajectorySaved` callback is
// the trigger.
//
// Per design.md §8.3 + plan Phase 5: the production form clusters >=3
// trajectories before crystallising. The MVP collapses N to 1 (every
// qualifying trajectory crystallises immediately) so the demo can show
// turn 5 of personas.md §3 ("Coming back the next day"). The shape-hash
// de-dup in the gate keeps re-running the same snippet from producing a
// second crystallised file.

import path from "node:path";

import {
  getLibraryResolver,
  readTrajectory,
  type LibraryResolver,
  type TrajectoryRecord,
} from "../sdk/index.js";

import { authorFunction, type AuthorResult } from "./author.js";
import { shouldCrystallise } from "./gate.js";
import {
  extractTemplate,
  readLibrarySnapshot,
} from "./template.js";

// --- Public types ----------------------------------------------------------

export type ObserveSkipped = {
  kind: "skipped";
  reason: string;
};

export type ObserveCrystallised = {
  kind: "crystallised";
  name: string;
  path: string;
};

export type ObserveResult = ObserveSkipped | ObserveCrystallised;

export type ObserverOpts = {
  baseDir?: string;
  // Restrict observation to a single tenant. The trajectory file's
  // `tenantId` field still rules; a mismatch is surfaced as a `skipped`.
  // Useful for tests and for installations where one observer instance
  // serves one tenant.
  tenantId?: string;
  codifierSkill?: string;
  // Override the resolver. Defaults to the SDK module-level singleton
  // wired by `installSnippetRuntime`.
  libraryResolver?: LibraryResolver;
};

// --- Observer --------------------------------------------------------------

export class Observer {
  private readonly baseDir: string;
  private readonly tenantId: string | null;
  private readonly codifierSkill: string;
  private readonly resolverOverride: LibraryResolver | null;

  // Test-friendly: every `observe(id)` call records its in-flight Promise
  // here so smoke tests can `await observer.observerPromise.get(id)`.
  // We do NOT remove entries when they settle; the map stays as a
  // history record for the duration of the Observer's lifetime. Tests
  // can clear it via `observer.observerPromise.delete(id)` if they care.
  readonly observerPromise: Map<string, Promise<ObserveResult>> = new Map();

  constructor(opts: ObserverOpts = {}) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
    this.tenantId = opts.tenantId ?? null;
    this.codifierSkill = opts.codifierSkill ?? "finqa_codify_table_function";
    this.resolverOverride = opts.libraryResolver ?? null;
  }

  async observe(trajectoryId: string): Promise<ObserveResult> {
    const inFlight = this.runObserve(trajectoryId);
    this.observerPromise.set(trajectoryId, inFlight);
    return inFlight;
  }

  // --- internal -----------------------------------------------------------

  private async runObserve(trajectoryId: string): Promise<ObserveResult> {
    let trajectory: TrajectoryRecord;
    try {
      trajectory = await readTrajectory(trajectoryId, this.baseDir);
    } catch (err) {
      return {
        kind: "skipped",
        reason: `failed to read trajectory ${trajectoryId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    if (this.tenantId !== null && trajectory.tenantId !== this.tenantId) {
      return {
        kind: "skipped",
        reason: `trajectory tenant "${trajectory.tenantId}" != observer tenant "${this.tenantId}"`,
      };
    }

    // Build the template + library snapshot.
    let template;
    try {
      template = extractTemplate(trajectory);
    } catch (err) {
      return {
        kind: "skipped",
        reason: `template extraction failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    const snapshot = await readLibrarySnapshot({
      baseDir: this.baseDir,
      tenantId: trajectory.tenantId,
    });

    const gate = shouldCrystallise({
      trajectory,
      shapeHash: template.shapeHash,
      existing: snapshot,
    });
    if (!gate.ok) {
      return { kind: "skipped", reason: gate.reason };
    }

    const resolver = this.resolverOverride ?? getLibraryResolver();
    if (!resolver) {
      return {
        kind: "skipped",
        reason: "no LibraryResolver registered (call installSnippetRuntime first)",
      };
    }

    const authored: AuthorResult = await authorFunction({
      tenantId: trajectory.tenantId,
      baseDir: this.baseDir,
      trajectory,
      template,
      libraryResolver: resolver,
      codifierSkill: this.codifierSkill,
    });

    if (authored.kind === "skipped") {
      return { kind: "skipped", reason: authored.reason };
    }
    return {
      kind: "crystallised",
      name: authored.name,
      path: authored.path,
    };
  }
}

// --- Defaults --------------------------------------------------------------

function defaultBaseDir(): string {
  return (
    process.env["DATAFETCH_HOME"] ??
    process.env["ATLASFS_HOME"] ??
    path.join(process.cwd(), ".atlasfs")
  );
}
