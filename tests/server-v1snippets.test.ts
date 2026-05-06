import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SnippetRuntime } from "../src/bash/snippetRuntime.js";
import { createSnippetsApp } from "../src/server/v1snippets.js";
import { SessionStore } from "../src/server/sessionStore.js";

describe("createSnippetsApp", () => {
  let baseDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), "df-snippets-"));
    store = new SessionStore({ baseDir });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  function postSnippet(app: ReturnType<typeof createSnippetsApp>, body: unknown) {
    return app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("passes phase, source path, and session id to the snippet runtime", async () => {
    const session = await store.createSession({
      tenantId: "tenant-a",
      mountIds: ["finqa"],
    });
    let captured: Parameters<SnippetRuntime["run"]>[0] | undefined;
    const runtime: SnippetRuntime = {
      async run(args) {
        captured = args;
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          trajectoryId: "traj_server",
          phase: args.phase,
          crystallisable: args.phase === "execute",
          artifactDir: "/tmp/artifact",
        };
      },
    };
    const app = createSnippetsApp({ baseDir, store, snippetRuntime: runtime });

    const res = await postSnippet(app, {
      sessionId: session.sessionId,
      source: "console.log(1)",
      phase: "execute",
      sourcePath: "/workspace/execute/final.ts",
    });

    expect(res.status).toBe(200);
    expect(captured).toMatchObject({
      source: "console.log(1)",
      phase: "execute",
      sourcePath: "/workspace/execute/final.ts",
      sessionCtx: {
        sessionId: session.sessionId,
        tenantId: "tenant-a",
        mountIds: ["finqa"],
        baseDir,
      },
    });
    expect(await res.json()).toMatchObject({
      trajectoryId: "traj_server",
      phase: "execute",
      crystallisable: true,
      artifactDir: "/tmp/artifact",
    });
  });
});
