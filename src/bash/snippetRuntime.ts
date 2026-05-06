// SnippetRuntime — cross-agent contract.
//
// The Flue / snippet-runtime agent (Wave 3) implements this. The bash
// session's `npx tsx` custom command delegates to it whenever the agent
// runs `npx tsx <file>` / `npx tsx -e "..."` / `npx tsx -`.
//
// In Phase 1 we shipped `StubSnippetRuntime` so the bash plumbing was
// end-to-end testable without the real evaluator. Wave 3 widens the
// return type to surface the trajectory id and the per-snippet cost
// snapshot so the demo CLI (Wave 6) can render the cost panel without
// re-reading the trajectory file. The Stub still satisfies the wider
// type by leaving both fields undefined.

import type { Cost } from "../sdk/index.js";

// --- Session context -------------------------------------------------------

export type SnippetPhase = "plan" | "execute";

// The minimum context a snippet evaluator needs to bind `df.*` for the
// active session: which tenant, which mounts are visible, where the
// datafetch home is on disk, and (optional) the active trajectory id so
// nested calls can record into the same envelope.
export type SessionCtx = {
  sessionId?: string;
  phase?: SnippetPhase;
  tenantId: string;
  mountIds: string[];
  baseDir: string;
  trajectoryId?: string;
};

// --- Runtime interface ------------------------------------------------------

export type SnippetRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  // Wave 3 additions. Both optional so StubSnippetRuntime and any future
  // implementation that doesn't track them can still satisfy the type.
  trajectoryId?: string;
  cost?: Cost;
  phase?: SnippetPhase;
  crystallisable?: boolean;
  artifactDir?: string;
};

export type SnippetRuntime = {
  run(args: {
    source: string;
    phase?: SnippetPhase;
    sourcePath?: string;
    sessionCtx: SessionCtx;
  }): Promise<SnippetRunResult>;
};

// --- Stub implementation ----------------------------------------------------

// Returned to the bash session whenever `npx tsx ...` runs and no real
// runtime has been wired. Wave 3 swaps this for the in-process Flue-bound
// evaluator. The stub deliberately exits 1 with a descriptive stderr so
// the smoke test can assert the routing path works.
export class StubSnippetRuntime implements SnippetRuntime {
  async run(_args: {
    source: string;
    phase?: SnippetPhase;
    sourcePath?: string;
    sessionCtx: SessionCtx;
  }): Promise<SnippetRunResult> {
    return {
      stdout: "",
      stderr: "snippet runtime not yet wired (Wave 3)\n",
      exitCode: 1,
    };
  }
}
