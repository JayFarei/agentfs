import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DatafetchWorkspace } from "../src/workspace/datafetch.js";
import { initWorkspace, reviewWorkspaceDraft, runWorkspaceQuery } from "../src/workspace/runtime.js";
import { buildState } from "../src/server/state.js";

const execFileAsync = promisify(execFile);

async function runAtlasfs(args: string[], atlasfsHome: string): Promise<string> {
  const { stdout } = await execFileAsync("pnpm", ["atlasfs", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ATLASFS_HOME: atlasfsHome,
      ATLASFS_SKIP_ENV_FILE: "1",
      MONGODB_URI: "",
      ATLAS_URI: ""
    },
    maxBuffer: 1024 * 1024 * 10
  });
  return stdout;
}

function parseCliJson<T>(stdout: string): T {
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new Error(`No JSON object in CLI output: ${stdout}`);
  }
  return JSON.parse(stdout.slice(start)) as T;
}

async function listRelativeFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(full, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

describe("self-contained AtlasFS workspace", () => {
  it("keeps repo-root Flue agents to templates and one generic tenant launcher", async () => {
    const agentFiles = await readdir(path.join(process.cwd(), ".flue", "agents"));

    expect(agentFiles).toEqual(
      expect.arrayContaining([
        "finqa-agent-factory.ts",
        "finqa-observer.ts",
        "finqa-outlook-agent-factory.ts",
        "tenant-agent-launcher.ts"
      ])
    );
    expect(agentFiles).not.toContain("finqa-task-agent.ts");
    expect(agentFiles).not.toContain("finqa-outlook-scorer.ts");
  });

  it("initializes a blank ATLASFS_HOME and runs a fixture query using only that workspace", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "atlasfs-workspace-"));

    const initOut = await runAtlasfs(["init", "--fixture", "all"], home);
    expect(initOut).toContain("initialized");

    const runOut = await runAtlasfs(
      ["run", "what is total revenue for acme?", "--local", "--tenant", "data-analyst"],
      home
    );
    const result = parseCliJson<{
      mode: string;
      answer: number;
      procedureName?: string;
      trajectoryId?: string;
    }>(runOut);

    expect(result).toMatchObject({
      mode: "novel",
      answer: 425
    });
    expect(result.trajectoryId).toBeTruthy();

    const supportOut = await runAtlasfs(
      ["run", "how many open support tickets for acme?", "--local", "--tenant", "support-analyst"],
      home
    );
    const support = parseCliJson<{
      mode: string;
      answer: number;
      calls: Array<{ primitive: string }>;
    }>(supportOut);
    expect(support).toMatchObject({
      mode: "novel",
      answer: 1
    });
    expect(support.calls.map((call) => call.primitive)).toEqual([
      "hooks.support.customer_open_tickets",
      "tickets.search",
      "tickets.count"
    ]);

    const manifest = JSON.parse(await readFile(path.join(home, "workspace.json"), "utf8")) as {
      datasets: Array<{ id: string }>;
      tenants: string[];
    };
    expect(manifest.datasets.map((dataset) => dataset.id)).toEqual([
      "fixture-finance",
      "fixture-support",
      "fixture-events"
    ]);
    expect(manifest.tenants).toContain("data-analyst");

    const files = await listRelativeFiles(home);
    expect(files).toEqual(
      expect.arrayContaining([
        "workspace.json",
        "data/fixture-finance/orders.jsonl",
        "data/fixture-support/tickets.jsonl",
        "data/fixture-events/events.jsonl"
      ])
    );
    expect(files.every((file) => !file.startsWith(".."))).toBe(true);
  });

  it("synthesizes read-only typed modules for fixture collections", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "atlasfs-datafetch-"));
    await initWorkspace({ baseDir: home, fixture: "all" });
    const workspace = new DatafetchWorkspace(home);

    const source = await workspace.readFile("/datafetch/db/orders.ts");

    expect(source).toContain('export const SCHEMA_VERSION = "sha256:');
    expect(source).toContain("export type OrdersRow");
    expect(source).toContain("@example");
    expect(source).toContain("findExact");
    expect(source).toContain("findSimilar");
    expect(source).toContain("search");
    expect(source).toContain("hybrid");

    const eventsSource = await workspace.readFile("/datafetch/db/events.ts");
    expect(eventsSource).toContain("export type EventsRow = DeployEvent | IncidentEvent");
    expect(eventsSource).toContain('kind: "deploy";');
    expect(eventsSource).toContain('kind: "incident";');
    expect(eventsSource).toContain("@presence 50%");
    expect(eventsSource).toContain("rollback: boolean;");

    const hookSource = await workspace.readFile("/datafetch/hooks/support/customer_open_tickets.ts");
    expect(hookSource).toContain("hook · support.customer_open_tickets");
    expect(hookSource).toContain("export interface CustomerOpenTicketsIntent");
    expect(hookSource).toContain("tickets.search");
    expect(hookSource).toContain("tickets.count");

    await expect(workspace.writeFile("/datafetch/db/orders.ts", "// nope")).rejects.toMatchObject({
      code: "EACCES"
    });
  });

  it("mints and reuses a learned deterministic function in the workspace", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "atlasfs-functions-"));
    await runAtlasfs(["init", "--fixture", "all"], home);

    const first = parseCliJson<{
      answer: number;
      calls: Array<{ primitive: string }>;
    }>(
      await runAtlasfs(
        ["run", "what is the standard deviation of order amounts for acme?", "--local", "--tenant", "data-analyst"],
        home
      )
    );
    expect(first.answer).toBe(87.5);
    expect(first.calls.map((call) => call.primitive)).toEqual([
      "orders.search",
      "observer.codifyFunction",
      "function_store.save",
      "stats.stddev"
    ]);

    const files = await listRelativeFiles(home);
    expect(files).toEqual(
      expect.arrayContaining([
        "functions/data-analyst/stats.stddev.json",
        "functions/data-analyst/stats.stddev.ts"
      ])
    );

    const second = parseCliJson<{
      answer: number;
      calls: Array<{ primitive: string }>;
    }>(
      await runAtlasfs(
        ["run", "what is the standard deviation of order amounts for beta?", "--local", "--tenant", "data-analyst"],
        home
      )
    );
    expect(second.answer).toBe(0);
    expect(second.calls.map((call) => call.primitive)).toEqual([
      "orders.search",
      "function_store.findReusable",
      "stats.stddev"
    ]);

    const previousHome = process.env.ATLASFS_HOME;
    process.env.ATLASFS_HOME = home;
    try {
      const state = await buildState("alice");
      expect(state.learnedFunctions?.map((fn) => fn.name)).toContain("stats.stddev");
    } finally {
      if (previousHome === undefined) {
        delete process.env.ATLASFS_HOME;
      } else {
        process.env.ATLASFS_HOME = previousHome;
      }
    }
  });

  it("rejects promotion when verifier shadow replay fails", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "atlasfs-verifier-fail-"));
    await initWorkspace({ baseDir: home, fixture: "all" });
    const run = await runWorkspaceQuery({
      question: "what is total revenue for acme?",
      tenantId: "data-analyst",
      baseDir: home
    });
    expect(run.draftId).toBeTruthy();

    await appendFile(
      path.join(home, "data", "fixture-finance", "orders.jsonl"),
      `${JSON.stringify({ id: "ord_bad_shadow", customer: "beta", region: "west", status: "paid", amount: 1, product: "support" })}\n`,
      "utf8"
    );

    await expect(
      reviewWorkspaceDraft({
        draftIdOrPath: run.draftId!,
        tenantId: "data-analyst",
        baseDir: home
      })
    ).rejects.toThrow("Verifier failed");

    const rejection = await readFile(path.join(home, "review-events", `${run.draftId}.jsonl`), "utf8");
    expect(rejection).toContain("rejected_promotion");
    await expect(
      readFile(path.join(home, "procedures", "data-analyst", "customer_total_revenue.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("promotes, verifies, replays, budgets, checks drift, and records eval metrics locally", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "atlasfs-lifecycle-"));
    await runAtlasfs(["init", "--fixture", "all"], home);

    const first = parseCliJson<{
      mode: string;
      answer: number;
      draftId: string;
      calls: Array<{ primitive: string }>;
    }>(await runAtlasfs(["run", "what is total revenue for acme?", "--local", "--tenant", "data-analyst"], home));
    expect(first.mode).toBe("novel");
    expect(first.answer).toBe(425);
    expect(first.draftId).toBeTruthy();
    expect(first.calls.map((call) => call.primitive)).toContain("hooks.finance.customer_total_revenue");

    const promoted = parseCliJson<{
      procedureName: string;
      verifier: { status: string; shadowAnswer: number };
    }>(await runAtlasfs(["review", first.draftId, "--yes", "--local"], home));
    expect(promoted).toMatchObject({
      procedureName: "customer_total_revenue",
      verifier: { status: "passed", shadowAnswer: 210 }
    });

    const replay = parseCliJson<{
      mode: string;
      answer: number;
      calls: Array<{ primitive: string }>;
    }>(await runAtlasfs(["run", "what is total revenue for beta?", "--local", "--tenant", "data-analyst"], home));
    expect(replay).toMatchObject({ mode: "procedure", answer: 210 });
    expect(replay.calls.map((call) => call.primitive)).toEqual(["procedures.customer_total_revenue"]);

    const budget = parseCliJson<{ procedureName: string; status: string; beforeCost: number; afterCost: number }>(
      await runAtlasfs(["budget", "customer_total_revenue", "--tenant", "data-analyst"], home)
    );
    expect(budget).toMatchObject({
      procedureName: "customer_total_revenue",
      status: "compiled",
      beforeCost: 3,
      afterCost: 1
    });
    const compiledPlan = JSON.parse(
      await readFile(path.join(home, "compiled", "data-analyst", "customer_total_revenue.json"), "utf8")
    ) as { procedureName: string; operation: string; collection: string };
    expect(compiledPlan).toMatchObject({
      procedureName: "customer_total_revenue",
      operation: "sum",
      collection: "orders"
    });

    const compiledReplay = parseCliJson<{
      mode: string;
      answer: number;
      calls: Array<{ primitive: string; input: { compiled?: boolean; compiledPlan?: string } }>;
    }>(await runAtlasfs(["run", "what is total revenue for beta?", "--local", "--tenant", "data-analyst"], home));
    expect(compiledReplay).toMatchObject({ mode: "procedure", answer: 210 });
    expect(compiledReplay.calls[0].input.compiled).toBe(true);
    expect(compiledReplay.calls[0].input.compiledPlan).toContain("compiled/data-analyst/customer_total_revenue.json");

    await appendFile(
      path.join(home, "data", "fixture-finance", "orders.jsonl"),
      `${JSON.stringify({ id: "ord_004", customer: "acme", region: "north", status: "paid", amount: 50, product: "training" })}\n`,
      "utf8"
    );
    const cleanDrift = parseCliJson<{ procedures: Array<{ name: string; drift: string }> }>(
      await runAtlasfs(["drift", "check"], home)
    );
    expect(cleanDrift.procedures).toContainEqual(expect.objectContaining({ name: "customer_total_revenue", drift: "current" }));

    await appendFile(
      path.join(home, "data", "fixture-finance", "orders.jsonl"),
      `${JSON.stringify({ id: "ord_005", customer: "acme", region: "north", status: "paid", amount: 75, product: "training", discount: 5 })}\n`,
      "utf8"
    );
    const drifted = parseCliJson<{ procedures: Array<{ name: string; drift: string }> }>(
      await runAtlasfs(["drift", "check"], home)
    );
    expect(drifted.procedures).toContainEqual(expect.objectContaining({ name: "customer_total_revenue", drift: "drifted" }));

    const evalResult = parseCliJson<{ round: number; rows: number; L_n: number }>(
      await runAtlasfs(["eval", "--round", "0", "--tenant", "data-analyst", "--tenant", "support-analyst"], home)
    );
    expect(evalResult).toMatchObject({ round: 0, rows: 6 });
    expect(evalResult.L_n).toBeGreaterThanOrEqual(0);

    const ledger = await readFile(path.join(home, "eval", "ledger.jsonl"), "utf8");
    const rows = ledger
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { baseline: string; tenant: string; L_n: number });
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.baseline))).toEqual(
      new Set(["vanilla_rag", "static_typed", "atlasfs"])
    );
    expect(rows.filter((row) => row.baseline === "atlasfs").map((row) => row.L_n)).toEqual([1, 1]);

    const hydration = parseCliJson<{
      dbName: string;
      collections: Array<{ collection: string; documentCount: number; targetCollection: string }>;
    }>(await runAtlasfs(["hydrate-atlas", "--dry-run", "--db", "atlasfs_test"], home));
    expect(hydration.dbName).toBe("atlasfs_test");
    expect(hydration.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: "orders", targetCollection: "orders", documentCount: 5 }),
        expect.objectContaining({ collection: "tickets", targetCollection: "tickets", documentCount: 2 }),
        expect.objectContaining({ collection: "events", targetCollection: "events", documentCount: 2 })
      ])
    );

    const previousHome = process.env.ATLASFS_HOME;
    process.env.ATLASFS_HOME = home;
    try {
      const state = await buildState("data-analyst");
      expect(state.cluster.collections.map((collection) => collection.name)).toEqual(["orders", "tickets", "events"]);
      expect(state.hooks?.map((hook) => hook.name)).toContain("finance.customer_total_revenue");
      expect(state.hooks?.map((hook) => hook.name)).toContain("support.customer_open_tickets");
      expect(state.drift).toContainEqual(
        expect.objectContaining({ name: "customer_total_revenue", drift: "drifted" })
      );
      expect(state.evalMetrics).toHaveLength(6);

      const webState = await buildState("alice");
      expect(webState.agent.tenant).toBe("data-analyst");
      expect(webState.procedures.map((procedure) => procedure.name)).toContain("customer_total_revenue");
      expect(webState.hooks?.map((hook) => hook.name)).toContain("finance.customer_total_revenue");
      expect(webState.hooks?.map((hook) => hook.name)).toContain("support.customer_open_tickets");
      expect(webState.drift).toContainEqual(
        expect.objectContaining({ name: "customer_total_revenue", drift: "drifted" })
      );
      expect(webState.evalMetrics).toHaveLength(6);
    } finally {
      if (previousHome === undefined) {
        delete process.env.ATLASFS_HOME;
      } else {
        process.env.ATLASFS_HOME = previousHome;
      }
    }
  }, 15000);
});
