// DiskSnippetRuntime — implements `SnippetRuntime` from
// src/bash/snippetRuntime.ts.
//
// Evaluates an `npx tsx` snippet in-process with `df` bound as a global.
// Strategy (per the plan):
//   1. Mint a trajectory id; build a TrajectoryRecorder.
//   2. Build a fresh DispatchContext (cost accumulator at zero, tier 0).
//   3. Build the `df` global via `buildDf({sessionCtx, dispatchCtx})`.
//   4. Write the snippet to a temp .ts file; stamp a tiny prelude that
//      imports nothing (the snippet uses `df` as a global) and wraps the
//      source in an async IIFE so top-level `await` works under tsx.
//   5. Set `globalThis.df = df` on the host process; capture
//      console.log/error during the import; await `import(<file-url>)`.
//   6. Save the trajectory with mode/cost/provenance.
//   7. Return {stdout, stderr, exitCode, trajectoryId, cost}.
//
// SECURITY NOTE: the snippet runs in the data-plane process; we are
// explicitly not sandboxing. Per the plan's Scope Boundaries section
// ("No security boundary"), this is acceptable for the MVP. Wave 6 +
// downstream isolation work will replace this with a Vercel Sandbox /
// V8 isolate.

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { TrajectoryRecorder } from "../trajectory/recorder.js";
import {
  costZero,
  type Cost,
  type CostTier,
  type DispatchContext,
} from "../sdk/index.js";

import type { SessionCtx, SnippetRuntime } from "../bash/snippetRuntime.js";

import { buildDf, type DfBinding } from "./dfBinding.js";

// --- Public types ----------------------------------------------------------

export type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  trajectoryId?: string;
  cost?: Cost;
};

export type DiskSnippetRuntimeOpts = {
  // No options today. Reserved for future configuration (e.g. capture
  // size limits, custom temp dir).
};

// Optional callback fired (fire-and-forget) after a trajectory is saved
// to disk. Wave 4's `installObserver({...})` registers a handler here so
// the observer can mine completed trajectories asynchronously without
// blocking the snippet's return.
export type TrajectorySavedCallback = (trajectoryId: string) => void;

// --- Implementation --------------------------------------------------------

export class DiskSnippetRuntime implements SnippetRuntime {
  // Sequence id for unique temp filenames within one process.
  private seq = 0;

  // Wave 4 hook: invoked fire-and-forget after a trajectory is saved.
  // The observer registers itself here. Errors thrown by the callback
  // are swallowed (this is the snippet runtime; the observer is async).
  onTrajectorySaved?: TrajectorySavedCallback;

  constructor(_opts: DiskSnippetRuntimeOpts = {}) {
    void _opts;
  }

  async run(args: {
    source: string;
    sessionCtx: SessionCtx;
  }): Promise<RunResult> {
    const { source, sessionCtx } = args;

    // 1. Build recorder + dispatch ctx.
    const question = firstNonEmptyLine(source) ?? "<snippet>";
    const recorder = new TrajectoryRecorder({
      tenantId: sessionCtx.tenantId,
      question,
      ...(sessionCtx.trajectoryId ? { id: sessionCtx.trajectoryId } : {}),
    });
    const dispatchCtx: DispatchContext = {
      tenant: sessionCtx.tenantId,
      mount: sessionCtx.mountIds[0] ?? "<no-mount>",
      trajectory: recorder,
      cost: costZero(0),
      pins: {},
    };
    const df = buildDf({ sessionCtx, dispatchCtx });

    // 2. Run the snippet under captured stdout/stderr.
    const { stdout, stderr, exitCode, error } = await runSnippet({
      source,
      df,
      seq: ++this.seq,
    });

    // 3. Persist trajectory.
    recorder.setMode(error ? "novel" : "interpreted");
    recorder.setCost(snapshotCost(dispatchCtx.cost));
    recorder.setProvenance({
      tenant: sessionCtx.tenantId,
      mount: dispatchCtx.mount,
    });
    try {
      await recorder.save(sessionCtx.baseDir);
      // Notify the observer (Wave 4). Fire-and-forget; any thrown error
      // from the callback is swallowed — the snippet's return must not
      // depend on the observer's success.
      if (this.onTrajectorySaved) {
        try {
          this.onTrajectorySaved(recorder.id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[snippet/runtime] onTrajectorySaved callback threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } catch (err) {
      // Best-effort; saving the trajectory must not crash the runtime.
      // eslint-disable-next-line no-console
      console.warn(
        `[snippet/runtime] failed to save trajectory: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      stdout,
      stderr,
      exitCode,
      trajectoryId: recorder.id,
      cost: snapshotCost(dispatchCtx.cost),
    };
  }
}

// --- Snippet execution ------------------------------------------------------

type RunArgs = {
  source: string;
  df: DfBinding;
  seq: number;
};

type RunResp = {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: Error;
};

// Wrap the user's snippet so its top-level statements run inside an
// async function whose completion the snippet runtime can await. The
// snippet exports a promise as `__df_done` so the host can `await
// mod.__df_done` after `await import(...)` returns. ESM's top-level
// await would also work, but stamping a `__df_done` export gives us a
// cleaner signal — we don't depend on Node sequencing every top-level
// `await` before resolving the dynamic-import promise (the snippet may
// fire promises with chained awaits that wouldn't otherwise be awaited
// at module-load time).
//
// `df` is a host-injected global; any imports the snippet itself
// declares (e.g. `import * as v from "valibot"`) resolve through tsx
// + Node ESM as usual.
function wrapSource(source: string): string {
  return [
    "// Stamped by DiskSnippetRuntime",
    "export const __df_done = (async () => {",
    source,
    "})();",
  ].join("\n");
}

async function runSnippet(args: RunArgs): Promise<RunResp> {
  const { source, df, seq } = args;

  const tmpDir = path.join(
    os.tmpdir(),
    `df-snippet-${process.pid}-${Date.now()}-${seq}`,
  );
  await fsp.mkdir(tmpDir, { recursive: true });
  const file = path.join(tmpDir, "snippet.mts");
  await fsp.writeFile(file, wrapSource(source), "utf8");

  // Patch globals.
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const formatArg = (v: unknown): string => {
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const writeLine = (sink: string[]) =>
    (...vals: unknown[]): void => {
      sink.push(`${vals.map(formatArg).join(" ")}\n`);
    };
  const origDf = (globalThis as Record<string, unknown>)["df"];
  (globalThis as Record<string, unknown>)["df"] = df;
  console.log = writeLine(stdout);
  console.info = writeLine(stdout);
  console.warn = writeLine(stderr);
  console.error = writeLine(stderr);
  console.debug = writeLine(stderr);

  let error: Error | undefined;
  try {
    const mod = (await import(
      `${pathToFileURL(file).href}?seq=${seq}`
    )) as { __df_done?: Promise<unknown> };
    if (mod.__df_done) {
      await mod.__df_done;
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    stderr.push(
      error.stack
        ? `${error.stack}\n`
        : `${error.name}: ${error.message}\n`,
    );
  } finally {
    // Restore globals.
    console.log = origConsole.log;
    console.info = origConsole.info;
    console.warn = origConsole.warn;
    console.error = origConsole.error;
    console.debug = origConsole.debug;
    if (origDf === undefined) {
      delete (globalThis as Record<string, unknown>)["df"];
    } else {
      (globalThis as Record<string, unknown>)["df"] = origDf;
    }
    // Best-effort cleanup; ignore failures.
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    exitCode: error ? 1 : 0,
    ...(error ? { error } : {}),
  };
}

// --- Helpers ---------------------------------------------------------------

function firstNonEmptyLine(source: string): string | null {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function snapshotCost(c: Cost): Cost {
  return {
    tier: c.tier as CostTier,
    tokens: { hot: c.tokens.hot, cold: c.tokens.cold },
    ms: { hot: c.ms.hot, cold: c.ms.cold },
    llmCalls: c.llmCalls,
  };
}
