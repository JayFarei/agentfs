// SnippetRuntime — cross-agent contract.
//
// The Flue / snippet-runtime agent (Wave 3) implements this. The bash
// session's `npx tsx` custom command delegates to it whenever the agent
// runs `npx tsx <file>` / `npx tsx -e "..."` / `npx tsx -`.
//
// In Phase 1 we ship `StubSnippetRuntime` so the bash plumbing is
// end-to-end testable without the real evaluator.

// --- Session context -------------------------------------------------------

// The minimum context a snippet evaluator needs to bind `df.*` for the
// active session: which tenant, which mounts are visible, where the
// datafetch home is on disk, and (optional) the active trajectory id so
// nested calls can record into the same envelope.
export type SessionCtx = {
  tenantId: string;
  mountIds: string[];
  baseDir: string;
  trajectoryId?: string;
};

// --- Runtime interface ------------------------------------------------------

export type SnippetRuntime = {
  run(args: {
    source: string;
    sessionCtx: SessionCtx;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

// --- Stub implementation ----------------------------------------------------

// Returned to the bash session whenever `npx tsx ...` runs and no real
// runtime has been wired. Wave 3 swaps this for the in-process Flue-bound
// evaluator. The stub deliberately exits 1 with a descriptive stderr so
// the smoke test can assert the routing path works.
export class StubSnippetRuntime implements SnippetRuntime {
  async run(_args: {
    source: string;
    sessionCtx: SessionCtx;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return {
      stdout: "",
      stderr: "snippet runtime not yet wired (Wave 3)\n",
      exitCode: 1,
    };
  }
}
