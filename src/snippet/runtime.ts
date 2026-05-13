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

import {
  TrajectoryRecorder,
  type TrajectoryRecord,
} from "../trajectory/recorder.js";
import {
  costZero,
  type Cost,
  type CostTier,
  type DispatchContext,
} from "../sdk/index.js";

import type {
  SessionCtx,
  SnippetPhase,
  SnippetRuntime,
} from "../bash/snippetRuntime.js";

import { buildDf, type DfBinding } from "./dfBinding.js";
import {
  isAnswerEnvelope,
  makeAnswerEnvelope,
  validateAnswerEnvelope,
  type AnswerEnvelope,
  type AnswerValidation,
} from "./answer.js";

// --- Public types ----------------------------------------------------------

export type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  trajectoryId?: string;
  cost?: Cost;
  phase?: SnippetPhase;
  crystallisable?: boolean;
  artifactDir?: string;
  answer?: unknown;
  validation?: AnswerValidation;
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
    phase?: SnippetPhase;
    sourcePath?: string;
    sessionCtx: SessionCtx;
  }): Promise<RunResult> {
    const { source, phase, sourcePath, sessionCtx } = args;

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
    const effectiveSessionCtx: SessionCtx =
      phase === undefined ? sessionCtx : { ...sessionCtx, phase };
    const df = buildDf({ sessionCtx: effectiveSessionCtx, dispatchCtx });

    // 2. Run the snippet under captured stdout/stderr.
    const { stdout, stderr, exitCode, error, returnValue } = await runSnippet({
      source,
      df,
      seq: ++this.seq,
      sourcePath,
      timeoutMs: sessionCtx.snippetTimeoutMs ?? numberFromEnv("DF_SNIPPET_TIMEOUT_MS"),
    });

    // Substrate-rooted chain gate. When the caller asks (the eval sets
    // this when a tenant mount is present), the recorded trajectory must
    // contain at least one db.* or lib.* primitive. If neither appears and
    // the snippet otherwise succeeded, rewrite the answer envelope to
    // `status: "unsupported"` so the observer sees a clean "did not use
    // the substrate" signal and the eval treats the episode as failed.
    let substrateChainRewriteApplied = false;
    let effectiveReturnValue: unknown = returnValue;
    if (
      sessionCtx.requireSubstrateRootedChain === true &&
      error === undefined
    ) {
      const hasSubstrateCall = recorder.snapshot.calls.some(
        (c) =>
          c.primitive.startsWith("db.") || c.primitive.startsWith("lib."),
      );
      if (!hasSubstrateCall) {
        const rewritten: AnswerEnvelope = makeAnswerEnvelope({
          status: "unsupported",
          reason:
            "substrate-rooted chain absent: trajectory contained neither df.db.* nor df.lib.* calls. " +
            "When df.db.records is mounted for this episode, scripts/answer.ts must reach the answer through " +
            "df.db.records.* (entity lookup) and/or df.lib.<helper> (substrate-crystallised or seed helper); " +
            "pure df.tool.* fan-out without a substrate-rooted entry point is rejected.",
        });
        effectiveReturnValue = rewritten;
        substrateChainRewriteApplied = true;
      }
    }

    recorder.setResult(effectiveReturnValue);

    const answer = isAnswerEnvelope(effectiveReturnValue)
      ? (effectiveReturnValue as AnswerEnvelope)
      : undefined;
    const validation =
      phase === "commit"
        ? validateAnswerEnvelope({
            value: effectiveReturnValue,
            lineageCallCount: recorder.snapshot.calls.length,
          })
        : undefined;
    if (answer !== undefined) recorder.setAnswer(answer);
    if (validation !== undefined) recorder.setAnswerValidation(validation);
    // Echo quality warnings to stderr so they're visible when the agent
    // runs the snippet via `pnpm datafetch:run` during rehearsal. The
    // warning doesn't block; the eval still scores the answer normally.
    let augmentedStderr = stderr;
    if (answer?.qualityWarnings && answer.qualityWarnings.length > 0) {
      const lines = answer.qualityWarnings.map(
        (w) =>
          `[df.answer] quality warning (${w.code}): ${w.message}` +
          (w.examples.length > 0 ? `\n[df.answer]   examples: ${w.examples.slice(0, 3).join(", ")}` : ""),
      );
      augmentedStderr = `${augmentedStderr}${lines.join("\n")}\n`;
    }
    if (substrateChainRewriteApplied && answer !== undefined) {
      augmentedStderr = `${augmentedStderr}[snippet/runtime] substrate-rooted chain gate fired: ${answer.reason}\n`;
    }
    const effectiveExitCode = substrateChainRewriteApplied
      ? 1
      : phase === "commit" && validation?.accepted !== true
        ? 1
        : exitCode;

    // 3. Persist trajectory.
    //    Mode classification (PRD §8.1, D-010):
    //      - errored snippet              → mode unchanged (default
    //        "interpreted"), `errored=true`. The observer gate skips on
    //        `errored`, NOT on mode.
    //      - successful run that invoked a learned interface from the tenant
    //        overlay → "interpreted", tier 2.
    //      - successful first-time composition (no learned interface)
    //        → "novel", tier 4 (full ReAct / ad-hoc composition).
    const usedLearnedInterface = await calledLearnedInterface({
      snapshot: recorder.snapshot,
      baseDir: sessionCtx.baseDir,
      tenantId: sessionCtx.tenantId,
    });
    if (error || effectiveExitCode !== 0) {
      recorder.setErrored(true);
      // Leave mode at the recorder's default ("interpreted"); error-path
      // gating uses `errored`.
    } else if (usedLearnedInterface) {
      recorder.setMode("interpreted");
      // Tier accumulator already reflects substrate (2) / LLM (3) max.
    } else {
      recorder.setMode("novel");
      // Bump tier to 4 (full ReAct / novel composition) per PRD §8.1.
      // The accumulator may have been raised to 2 by substrate calls or
      // 3 by LLM calls; max() preserves whichever is higher, but for an
      // explicit "novel" composition the tier IS 4 by definition.
      dispatchCtx.cost.tier = 4;
    }
    recorder.setCost(snapshotCost(dispatchCtx.cost));
    recorder.setProvenance({
      tenant: sessionCtx.tenantId,
      mount: dispatchCtx.mount,
    });
    const phaseMetadata =
      phase === undefined
        ? undefined
        : {
            phase,
            crystallisable: isCrystallisablePhase(phase, validation),
            ...(sourcePath !== undefined ? { sourcePath } : {}),
            artifactDir: phaseArtifactDir({
              baseDir: sessionCtx.baseDir,
              sessionId: sessionCtx.sessionId,
              phase,
              trajectoryId: recorder.id,
              sourcePath,
            }),
          };
    if (phaseMetadata) {
      recorder.setExecutionMetadata(phaseMetadata);
    }
    const trajectory = recorder.snapshot;
    try {
      await recorder.save(sessionCtx.baseDir);
      if (phaseMetadata) {
        await writePhaseArtifacts({
          artifactDir: phaseMetadata.artifactDir,
          source,
          stdout,
          stderr: augmentedStderr,
          exitCode: effectiveExitCode,
          trajectory,
          cost: snapshotCost(dispatchCtx.cost),
          result: returnValue,
          answer,
          validation,
        });
      }
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
      stderr: augmentedStderr,
      exitCode: effectiveExitCode,
      trajectoryId: recorder.id,
      cost: snapshotCost(dispatchCtx.cost),
      ...(answer !== undefined ? { answer } : {}),
      ...(validation !== undefined ? { validation } : {}),
      ...(phaseMetadata
        ? {
            phase: phaseMetadata.phase,
            crystallisable: phaseMetadata.crystallisable,
            artifactDir: phaseMetadata.artifactDir,
          }
        : {}),
    };
  }
}

// --- Snippet execution ------------------------------------------------------

type RunArgs = {
  source: string;
  df: DfBinding;
  seq: number;
  sourcePath?: string;
  timeoutMs?: number;
};

type RunResp = {
  stdout: string;
  stderr: string;
  exitCode: number;
  returnValue?: unknown;
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
  const { imports, body } = splitLeadingImports(source);
  const autoInvokeTrailer = buildAutoInvokeTrailer(body);
  return [
    "// Stamped by DiskSnippetRuntime",
    ...imports,
    "export const __df_done = (async () => {",
    body,
    autoInvokeTrailer,
    "})();",
  ].join("\n");
}

// Detect a common agent failure mode: the script declares
// `async function main()` (or `run`/`solve`) but never invokes it at
// top level, so the IIFE wrapper resolves with zero df.* calls. When
// a candidate entry-point is declared and not visibly invoked, append
// a runtime-guarded auto-invocation. Generic — no family or task
// awareness. Opt-out via DATAFETCH_DISABLE_AUTO_INVOKE=1.
const AUTO_INVOKE_NAMES = ["main", "run", "solve"] as const;

export function buildAutoInvokeTrailer(body: string): string {
  if (process.env["DATAFETCH_DISABLE_AUTO_INVOKE"] === "1") return "";
  const targets: string[] = [];
  for (const name of AUTO_INVOKE_NAMES) {
    if (isDeclaredEntryPoint(body, name) && !isInvokedAtTopLevel(body, name)) {
      targets.push(name);
    }
  }
  if (targets.length === 0) return "";
  const lines = targets.map(
    (name) =>
      `  // @ts-ignore — auto-invoke by DiskSnippetRuntime when ${name}() was declared but never called` +
      `\n  if (typeof ${name} === "function") { console.error("[snippet/runtime] auto-invoking ${name}() — declaration without top-level call"); await ${name}(); }`,
  );
  return lines.join("\n");
}

function isDeclaredEntryPoint(body: string, name: string): boolean {
  const declRegex = new RegExp(
    String.raw`(^|\n)\s*(export\s+)?(async\s+)?function\s+${name}\s*\(`,
  );
  if (declRegex.test(body)) return true;
  const constRegex = new RegExp(
    String.raw`(^|\n)\s*(export\s+)?(const|let|var)\s+${name}\s*=\s*(async\s*)?\(`,
  );
  return constRegex.test(body);
}

function isInvokedAtTopLevel(body: string, name: string): boolean {
  const lines = body.split("\n");
  let depth = 0;
  let inBlockComment = false;
  for (const rawLine of lines) {
    let line = rawLine;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end < 0) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    // Strip same-line block comments, then detect a comment that opens
    // and remains unclosed.
    line = line.replace(/\/\*[\s\S]*?\*\//g, "");
    const blockStart = line.indexOf("/*");
    if (blockStart >= 0) {
      inBlockComment = true;
      line = line.slice(0, blockStart);
    }
    const stripped = line.replace(/\/\/.*$/, "");
    if (depth === 0) {
      const invokeRegex = new RegExp(
        String.raw`(^|[^\w$.])(await\s+|return\s+|void\s+|\(\s*await\s+|=\s*(await\s+)?)?${name}\s*\(`,
      );
      if (invokeRegex.test(stripped)) {
        const decl = new RegExp(
          String.raw`(^|[^\w$])(function|const|let|var)\s+${name}\b`,
        );
        if (!decl.test(stripped)) return true;
      }
    }
    for (const ch of stripped) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

async function runSnippet(args: RunArgs): Promise<RunResp> {
  const { source, df, seq, sourcePath, timeoutMs } = args;

  const sourceDir = sourcePath !== undefined ? path.dirname(sourcePath) : null;
  const runBesideSource = sourceDir !== null && (await dirExists(sourceDir));
  const tmpDir = runBesideSource
    ? sourceDir!
    : path.join(os.tmpdir(), `df-snippet-${process.pid}-${Date.now()}-${seq}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const file =
    sourcePath !== undefined
      ? path.join(
          tmpDir,
          `.datafetch-run-${process.pid}-${Date.now()}-${seq}.mts`,
        )
      : path.join(tmpDir, "snippet.mts");
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
  const origProcessExit = process.exit;
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
  const origCwd = process.cwd();
  (globalThis as Record<string, unknown>)["df"] = df;
  console.log = writeLine(stdout);
  console.info = writeLine(stdout);
  console.warn = writeLine(stderr);
  console.error = writeLine(stderr);
  console.debug = writeLine(stderr);
  process.exit = ((code?: number | string | null | undefined): never => {
    throw new Error(`[snippet/runtime] process.exit(${code ?? ""}) called`);
  }) as typeof process.exit;

  let error: Error | undefined;
  let returnValue: unknown;
  try {
    const mod = (await import(
      `${pathToFileURL(file).href}?seq=${seq}`
    )) as { __df_done?: Promise<unknown> };
    if (mod.__df_done) {
      returnValue = await withTimeout(mod.__df_done, timeoutMs);
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
    process.exit = origProcessExit;
    if (origDf === undefined) {
      delete (globalThis as Record<string, unknown>)["df"];
    } else {
      (globalThis as Record<string, unknown>)["df"] = origDf;
    }
    try {
      process.chdir(origCwd);
    } catch (err) {
      stderr.push(
        `[snippet/runtime] failed to restore cwd ${origCwd}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
    // Best-effort cleanup; ignore failures. Source-path execution writes a
    // temp sibling file so relative imports resolve from the script directory.
    if (runBesideSource) {
      fsp.rm(file, { force: true }).catch(() => undefined);
    } else {
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    exitCode: error ? 1 : 0,
    ...(returnValue !== undefined ? { returnValue } : {}),
    ...(error ? { error } : {}),
  };
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[snippet/runtime] timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const st = await fsp.stat(dir);
    return st.isDirectory();
  } catch {
    return false;
  }
}

// --- Helpers ---------------------------------------------------------------

// True iff any recorded call resolved through a learned /lib/<tenant>
// interface. Semantic names are detected by reading the tenant overlay file for
// `@shape-hash`; the legacy `crystallise_*` prefix is kept as a compatibility
// path for older generated interfaces.
async function calledLearnedInterface(args: {
  snapshot: { calls: ReadonlyArray<{ primitive: string }> };
  baseDir: string;
  tenantId: string;
}): Promise<boolean> {
  for (const call of args.snapshot.calls) {
    if (!call.primitive.startsWith("lib.")) continue;
    const name = call.primitive.slice("lib.".length);
    if (name.startsWith("crystallise")) return true;
    const file = path.join(args.baseDir, "lib", args.tenantId, `${name}.ts`);
    try {
      const content = await fsp.readFile(file, "utf8");
      if (/@shape-hash:\s*[0-9a-f]{8,}/.test(content)) return true;
    } catch {
      // Seed primitives or missing files are not learned interfaces.
    }
  }
  return false;
}

function firstNonEmptyLine(source: string): string | null {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function splitLeadingImports(source: string): {
  imports: string[];
  body: string;
} {
  const lines = source.split("\n");
  const imports: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      imports.push(line);
      index += 1;
      continue;
    }
    if (!trimmed.startsWith("import ")) break;
    imports.push(line);
    index += 1;
    while (
      index < lines.length &&
      !(lines[index - 1] ?? "").trimEnd().endsWith(";")
    ) {
      imports.push(lines[index] ?? "");
      index += 1;
    }
  }
  return {
    imports,
    body: lines.slice(index).join("\n"),
  };
}

function snapshotCost(c: Cost): Cost {
  return {
    tier: c.tier as CostTier,
    tokens: { hot: c.tokens.hot, cold: c.tokens.cold },
    ms: { hot: c.ms.hot, cold: c.ms.cold },
    llmCalls: c.llmCalls,
  };
}

function isCrystallisablePhase(
  phase: SnippetPhase,
  validation?: AnswerValidation,
): boolean {
  if (phase === "commit") return validation?.accepted === true;
  return phase === "execute";
}

function phaseArtifactDir(args: {
  baseDir: string;
  sessionId?: string;
  phase: SnippetPhase;
  trajectoryId: string;
  sourcePath?: string;
}): string {
  const sessionId = args.sessionId ?? "__adhoc__";
  if (args.phase === "plan" || args.phase === "run") {
    return path.join(
      args.baseDir,
      "sessions",
      sessionId,
      args.phase,
      "attempts",
      args.trajectoryId,
    );
  }
  return path.join(
    args.baseDir,
    "sessions",
    sessionId,
    args.phase,
    args.trajectoryId,
  );
}

async function writePhaseArtifacts(args: {
  artifactDir: string;
  source: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  trajectory: TrajectoryRecord;
  cost: Cost;
  result: unknown;
  answer?: unknown;
  validation?: AnswerValidation;
}): Promise<void> {
  await fsp.mkdir(args.artifactDir, { recursive: true });
  const sourceName =
    args.trajectory.phase === "execute" || args.trajectory.phase === "commit"
      ? `${args.trajectory.phase}.ts`
      : "source.ts";
  await Promise.all([
    fsp.writeFile(path.join(args.artifactDir, sourceName), args.source, "utf8"),
    fsp.writeFile(path.join(args.artifactDir, "stdout.txt"), args.stdout, "utf8"),
    fsp.writeFile(path.join(args.artifactDir, "stderr.txt"), args.stderr, "utf8"),
    fsp.writeFile(
      path.join(args.artifactDir, "result.json"),
      `${JSON.stringify(
        {
          trajectoryId: args.trajectory.id,
          phase: args.trajectory.phase,
          crystallisable: args.trajectory.crystallisable,
          exitCode: args.exitCode,
          mode: args.trajectory.mode,
          callPrimitives: args.trajectory.calls.map((call) => call.primitive),
          cost: args.cost,
          result: args.result,
          answer: args.answer,
          validation: args.validation,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    fsp.writeFile(
      path.join(args.artifactDir, "trajectory.json"),
      `${JSON.stringify(args.trajectory, null, 2)}\n`,
      "utf8",
    ),
  ]);
  if (args.trajectory.phase === "commit") {
    await Promise.all([
      fsp.writeFile(
        path.join(args.artifactDir, "answer.json"),
        `${JSON.stringify(args.answer ?? null, null, 2)}\n`,
        "utf8",
      ),
      fsp.writeFile(
        path.join(args.artifactDir, "validation.json"),
        `${JSON.stringify(args.validation ?? null, null, 2)}\n`,
        "utf8",
      ),
      fsp.writeFile(
        path.join(args.artifactDir, "answer.md"),
        renderAnswerMarkdown(args.answer, args.validation),
        "utf8",
      ),
      fsp.writeFile(
        path.join(args.artifactDir, "lineage.json"),
        `${JSON.stringify(args.trajectory, null, 2)}\n`,
        "utf8",
      ),
    ]);
  }
}

function renderAnswerMarkdown(
  answer: unknown,
  validation: AnswerValidation | undefined,
): string {
  const lines: string[] = ["# datafetch answer", ""];
  if (validation) {
    lines.push(`accepted: ${validation.accepted ? "yes" : "no"}`);
    if (validation.blockers.length > 0) {
      lines.push("");
      lines.push("blockers:");
      for (const blocker of validation.blockers) lines.push(`- ${blocker}`);
    }
    lines.push("");
  }
  lines.push("```json");
  lines.push(JSON.stringify(answer ?? null, null, 2));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}
