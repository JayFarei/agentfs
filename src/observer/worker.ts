// Observer worker.
//
// In-process, fire-and-forget from the snippet runtime's perspective. The
// worker reads a saved trajectory, runs the learning gate, and (if the gate
// passes) dispatches the authoring step. No file watcher; no
// background daemon. The snippet runtime's `onTrajectorySaved` callback is
// the trigger.
//
// Per design.md §8.3 + plan Phase 5: the production form clusters >=3
// trajectories before learning an interface. The MVP collapses N to 1 (every
// qualifying trajectory learns immediately) so the demo can show
// turn 5 of personas.md §3 ("Coming back the next day"). The shape-hash
// de-dup in the gate keeps re-running the same snippet from producing a
// second learned-interface file.

import path from "node:path";

import { defaultBaseDir } from "../paths.js";
import { enforceMapCap } from "../util/bounded.js";

import {
  getLibraryResolver,
  readTrajectory,
  type LibraryResolver,
  type TrajectoryRecord,
} from "../sdk/index.js";

import { authorFunction, type AuthorResult } from "./author.js";
import { shouldCrystallise } from "./gate.js";
import {
  extractCandidateTemplates,
  readLibrarySnapshot,
  type CallTemplate,
} from "./template.js";
import { resolveWorkspaceHeadForTrajectory } from "./workspaceHead.js";

// --- Public types ----------------------------------------------------------

export type ObserveSkipped = {
  kind: "skipped";
  reason: string;
};

export type ObserveCrystallised = {
  kind: "crystallised";
  name: string;
  path: string;
  // Goal-3 iter 10: when sub-graph extraction also crystallises one or
  // more sibling helpers, they show up here. The primary `name`/`path`
  // still references the whole-trajectory crystallisation when one was
  // accepted; if only sub-graphs cleared the gate, the first sub-graph
  // is promoted to the primary.
  additional?: Array<{ name: string; path: string }>;
};

export type ObserveResult = ObserveSkipped | ObserveCrystallised;

export type ObserverOpts = {
  baseDir?: string;
  // Restrict observation to a single tenant. The trajectory file's
  // `tenantId` field still rules; a mismatch is surfaced as a `skipped`.
  // Useful for tests and for installations where one observer instance
  // serves one tenant.
  tenantId?: string;
  codifierSkill?: string | null;
  // Override the resolver. Defaults to the SDK module-level singleton
  // wired by `installSnippetRuntime`.
  libraryResolver?: LibraryResolver;
  // Workspace commits are written by the client after /v1/snippets returns.
  // The observer waits briefly for result/HEAD.json before deciding whether
  // this commit is still the current worktree HEAD.
  workspaceHeadTimeoutMs?: number;
};

// --- Observer --------------------------------------------------------------

// Cap the in-flight-promise map so a long-lived data plane doesn't
// accumulate trajectory ids forever. 256 covers a realistic burst with
// headroom; FIFO eviction is fine since callers grab the promise at
// observation time.
const OBSERVER_PROMISE_CAP = 256;

export class Observer {
  private readonly baseDir: string;
  private readonly tenantId: string | null;
  private readonly codifierSkill: string | null;
  private readonly resolverOverride: LibraryResolver | null;
  private readonly workspaceHeadTimeoutMs: number;

  // Test-friendly: every `observe(id)` call records its in-flight Promise
  // here so smoke tests can `await observer.observerPromise.get(id)`.
  // Bounded with FIFO eviction (`OBSERVER_PROMISE_CAP`) so a long-lived
  // data plane doesn't accumulate one entry per snippet forever; tests
  // settle within the cap and aren't affected.
  readonly observerPromise: Map<string, Promise<ObserveResult>> = new Map();

  constructor(opts: ObserverOpts = {}) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
    this.tenantId = opts.tenantId ?? null;
    this.codifierSkill =
      opts.codifierSkill ?? process.env["DATAFETCH_CODIFIER_SKILL"] ?? null;
    this.resolverOverride = opts.libraryResolver ?? null;
    this.workspaceHeadTimeoutMs = opts.workspaceHeadTimeoutMs ?? 2_000;
  }

  async observe(trajectoryId: string): Promise<ObserveResult> {
    const inFlight = this.runObserve(trajectoryId);
    this.observerPromise.set(trajectoryId, inFlight);
    enforceMapCap(this.observerPromise, OBSERVER_PROMISE_CAP);
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

    const workspaceHead = await resolveWorkspaceHeadForTrajectory(trajectory, {
      timeoutMs: this.workspaceHeadTimeoutMs,
    });
    if (workspaceHead.kind === "stale") {
      return {
        kind: "skipped",
        reason: workspaceHead.reason,
      };
    }
    const allowOverwrite = workspaceHead.kind === "head";

    // Build the template + library snapshot.
    let candidates: CallTemplate[];
    try {
      candidates = extractCandidateTemplates(trajectory);
    } catch (err) {
      return {
        kind: "skipped",
        reason: `template extraction failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    if (candidates.length === 0) {
      return { kind: "skipped", reason: "no template candidates extracted" };
    }
    const whole = candidates[0]!;
    const subGraphs = candidates.slice(1);

    const snapshot = await readLibrarySnapshot({
      baseDir: this.baseDir,
      tenantId: trajectory.tenantId,
    });

  const gateSnapshot =
    allowOverwrite && snapshot.shapeHashes.has(whole.shapeHash)
      ? {
          shapeHashes: new Set(
            [...snapshot.shapeHashes].filter((h) => h !== whole.shapeHash),
          ),
          learnedNames: snapshot.learnedNames,
        }
      : snapshot;

    const resolver = this.resolverOverride ?? getLibraryResolver();
    if (!resolver) {
      return {
        kind: "skipped",
        reason: "no LibraryResolver registered (call installSnippetRuntime first)",
      };
    }

    // Run the whole-trajectory candidate through the gate first. Sub-graph
    // candidates run after, with a relaxed gate (`subGraph: true`). Each
    // additional crystallisation gets accumulated; the primary result keeps
    // the existing semantics (whole-trajectory if it cleared the gate;
    // otherwise the first sub-graph that cleared).
    const wholeGate = shouldCrystallise({
      trajectory,
      shapeHash: whole.shapeHash,
      existing: gateSnapshot,
    });
    let primary: { name: string; path: string } | null = null;
    const additional: Array<{ name: string; path: string }> = [];
    const skipReasons: string[] = [];
    const acceptedHashes = new Set<string>(gateSnapshot.shapeHashes);
    const acceptedNames = new Set<string>(gateSnapshot.learnedNames);
    if (wholeGate.ok) {
      const authored = await authorFunction({
        tenantId: trajectory.tenantId,
        baseDir: this.baseDir,
        trajectory,
        template: whole,
        libraryResolver: resolver,
        codifierSkill: this.codifierSkill,
        allowOverwrite,
      });
      if (authored.kind === "skipped") {
        skipReasons.push(`whole: ${authored.reason}`);
      } else {
        primary = { name: authored.name, path: authored.path };
        acceptedHashes.add(whole.shapeHash);
        acceptedNames.add(whole.name);
      }
    } else {
      skipReasons.push(`whole: ${wholeGate.reason}`);
    }

    for (const sub of subGraphs) {
      const slice = sliceForTemplate(trajectory, sub);
      const subGate = shouldCrystallise({
        trajectory,
        shapeHash: sub.shapeHash,
        existing: { shapeHashes: acceptedHashes, learnedNames: acceptedNames },
        subGraph: true,
        callsSlice: slice,
      });
      if (!subGate.ok) {
        skipReasons.push(`sub:${sub.topic}: ${subGate.reason}`);
        continue;
      }
      // Sub-graph templates have slice-relative call indices, so the
      // author's `pickExample` must walk the slice (not the original
      // trajectory) when harvesting literal values for the function's
      // first example. Build a synthetic trajectory whose `calls` is the
      // slice; everything else (id, tenantId, question, etc) stays the
      // same so the author's headers reference the original trajectory.
      const sliceTrajectory: TrajectoryRecord = {
        ...trajectory,
        calls: slice as TrajectoryRecord["calls"],
      };
      const authored: AuthorResult = await authorFunction({
        tenantId: trajectory.tenantId,
        baseDir: this.baseDir,
        trajectory: sliceTrajectory,
        template: sub,
        libraryResolver: resolver,
        codifierSkill: this.codifierSkill,
        allowOverwrite,
      });
      if (authored.kind === "skipped") {
        skipReasons.push(`sub:${sub.topic}: ${authored.reason}`);
        continue;
      }
      acceptedHashes.add(sub.shapeHash);
      acceptedNames.add(sub.name);
      const slot = { name: authored.name, path: authored.path };
      if (primary === null) {
        primary = slot;
      } else {
        additional.push(slot);
      }
    }

    if (primary === null) {
      return {
        kind: "skipped",
        reason: skipReasons.join("; ") || "no template candidate cleared the gate",
      };
    }
    return {
      kind: "crystallised",
      name: primary.name,
      path: primary.path,
      ...(additional.length > 0 ? { additional } : {}),
    };
  }
}

// Identify which contiguous slice of trajectory.calls a sub-graph template
// was extracted from. We look for a contiguous span of calls whose
// primitives match the template's step primitives in order; the search is
// O(N*K) but trajectories are small. Falls back to the whole calls array
// when no slice matches (defensive — should not happen in practice).
function sliceForTemplate(
  trajectory: TrajectoryRecord,
  template: CallTemplate,
): ReadonlyArray<TrajectoryRecord["calls"][number]> {
  const calls = trajectory.calls;
  const stepPrimitives = template.steps.map((s) => s.primitive);
  if (stepPrimitives.length === 0) return calls;
  const n = calls.length;
  const k = stepPrimitives.length;
  for (let start = 0; start + k <= n; start += 1) {
    let match = true;
    for (let i = 0; i < k; i += 1) {
      if (calls[start + i]!.primitive !== stepPrimitives[i]) {
        match = false;
        break;
      }
    }
    if (match) return calls.slice(start, start + k);
  }
  return calls;
}
