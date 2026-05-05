// datafetch CLI — multiple subcommands.
//
// Existing (Phase 0/1):
//   publish, connect, agent, demo, server.
//
// New (Phase 2+3+4):
//   session new|list|resume|end|switch|current   — tenant session lifecycle.
//   tsx -e '<src>' | tsx <file>                  — primary agent execution verb.
//   man <fn>                                     — render structured docs.
//   apropos <kw>                                 — semantic search across /lib/.
//   install-skill                                — copy SKILL.md into ~/.claude/skills/.

import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";

import { serve } from "@hono/node-server";

import { atlasMount } from "./adapter/atlasMount.js";
import { publishMount } from "./adapter/publishMount.js";
import { closeAllMounts, getMountRuntimeRegistry } from "./adapter/runtime.js";
import { BashSession } from "./bash/session.js";
import { DiskMountReader } from "./bash/mountReader.js";
import { runDemo } from "./demo/index.js";
import { loadProjectEnv } from "./env.js";
import { installFlueDispatcher } from "./flue/install.js";
import { installObserver } from "./observer/install.js";
import { getLibraryResolver } from "./sdk/index.js";
import { createServer } from "./server/server.js";
import { installSnippetRuntime } from "./snippet/install.js";

import type { Flags } from "./cli/types.js";
import { cmdSession } from "./cli/session.js";
import { cmdApropos, cmdMan, cmdTsx } from "./cli/agentVerbs.js";
import { cmdInstallSkill } from "./cli/installSkill.js";

loadProjectEnv();

// --- Flag parsing ----------------------------------------------------------
//
// Pure-string flags (e.g. `--tenant t`) overwrite. Repeatable flags
// (`--mount a --mount b`) accumulate into a string[]. Boolean flags
// stand alone (`--json`, `--force`, `--no-cache`, `--help`).

const BOOLEAN_FLAGS = new Set(["no-cache", "help", "json", "force"]);
const REPEATABLE_FLAGS = new Set(["mount"]);

// Short-flag aliases: a leading `-e <value>` is treated like `--e <value>`.
// This matches how Node / tsx accept `-e '<source>'` for one-liners and
// keeps the SKILL.md examples (`datafetch tsx -e '...'`) working without
// forcing the agent to use `--e`.
const SHORT_FLAG_ALIAS: Record<string, string> = {
  "-e": "e",
};

function parseFlags(argv: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    let key: string | null = null;
    if (arg.startsWith("--")) {
      key = arg.slice(2);
    } else if (Object.prototype.hasOwnProperty.call(SHORT_FLAG_ALIAS, arg)) {
      key = SHORT_FLAG_ALIAS[arg]!;
    }
    if (key === null) {
      positionals.push(arg);
      continue;
    }
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = argv[i + 1];
    let value: string | true;
    if (next === undefined || next.startsWith("--")) {
      value = true;
    } else {
      value = next;
      i += 1;
    }
    if (REPEATABLE_FLAGS.has(key) && typeof value === "string") {
      const prior = flags[key];
      if (Array.isArray(prior)) prior.push(value);
      else if (typeof prior === "string") flags[key] = [prior, value];
      else flags[key] = [value];
    } else {
      flags[key] = value;
    }
  }
  return { positionals, flags };
}

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

// --- Usage ----------------------------------------------------------------

function usage(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "datafetch — bash-shaped workspace over a mounted dataset",
      "",
      "Server / data plane:",
      "  datafetch server [--port 8080] [--base-dir <path>]",
      "    Boot the data plane (Hono app + snippet runtime + Flue + observer).",
      "",
      "  datafetch publish <mount-id> [--uri <atlas-uri>] [--db <db-name>]",
      "    Publish a mount; stream warm-up stage events to stdout.",
      "",
      "Sessions (talks to the server over HTTP):",
      "  datafetch session new --tenant <id> [--mount <id>...] [--json]",
      "  datafetch session list [--json]",
      "  datafetch session resume <sessionId>",
      "  datafetch session end <sessionId>",
      "  datafetch session switch --tenant <id> [--mount <id>...]",
      "  datafetch session current",
      "    Manage the active session pointer at $DATAFETCH_HOME/active-session.",
      "",
      "Agent verbs (resolve --session / DATAFETCH_SESSION / pointer):",
      "  datafetch tsx -e '<source>' | datafetch tsx <file>",
      "    Run a TS snippet against the active session; prints stdout/stderr",
      "    and the Result envelope after a `--- envelope ---` separator.",
      "  datafetch man <fn>",
      "    Render NAME / SYNOPSIS / INPUT / OUTPUT / EXAMPLES for a /lib/ fn.",
      "  datafetch apropos <kw> [--json]",
      "    Search /lib/<tenant>/ and /lib/__seed__/ by intent overlap.",
      "",
      "Skill bundle:",
      "  datafetch install-skill [--path <dir>] [--force]",
      "    Copy skills/datafetch/SKILL.md into ~/.claude/skills/datafetch/.",
      "",
      "Misc:",
      "  datafetch connect [--tenant <id>]",
      "    Print a tenant token and the current mount inventory (in-process).",
      "  datafetch agent [--tenant <id>] [--mount <id>]",
      "    Interactive bash session against the registered mount(s) (in-process).",
      "  datafetch demo [--mount finqa-2024] [--tenant demo-tenant] [--no-cache]",
      "    Run the two-question Q1/Q2 demo end-to-end.",
      "",
      "Common flags:",
      "  --server <url>       data-plane base URL (default http://localhost:8080)",
      "  --session <id>       override the active session pointer",
      "  --base-dir <path>    override DATAFETCH_HOME",
      "",
      "Environment:",
      "  DATAFETCH_HOME       baseDir for /db/, /lib/, trajectories, sessions",
      "  DATAFETCH_SESSION    fallback session id when no --session flag is set",
      "  DATAFETCH_SERVER_URL fallback server base URL (default localhost:8080)",
      "  ATLAS_URI            MongoDB Atlas connection string",
      "  PORT                 HTTP server port (server.ts only)",
    ].join("\n"),
  );
}

// --- Subcommands -----------------------------------------------------------

async function cmdPublish(positionals: string[], flags: Flags): Promise<void> {
  const id = positionals[0];
  if (!id) {
    throw new Error("publish: <mount-id> is required");
  }
  const uri = flagString(flags, "uri") ?? process.env["ATLAS_URI"];
  if (!uri) {
    throw new Error(
      "publish: --uri or ATLAS_URI environment variable is required",
    );
  }
  const db = flagString(flags, "db") ?? "finqa";

  // The publish CLI runs against a fresh in-process boot; if the user is
  // also running a long-lived server (server.ts), they'll want to publish
  // through the HTTP API instead. For the local CLI path we install the
  // snippet runtime so seeds mirror to disk.
  const { baseDir } = await installSnippetRuntime({});
  await installFlueDispatcher({ baseDir });

  const handle = await publishMount({
    id,
    source: atlasMount({ uri, db }),
    baseDir,
    warmup: "lazy",
  });

  // eslint-disable-next-line no-console
  console.log(`[publish] mount=${id} db=${db} baseDir=${baseDir}`);
  for await (const evt of handle.status()) {
    // Some stages carry collection / progress; render whatever fields are
    // present without poking at fields the discriminated union doesn't
    // declare for that variant.
    const { stage, ...rest } = evt as { stage: string; [k: string]: unknown };
    const tail = Object.keys(rest).length > 0 ? " " + JSON.stringify(rest) : "";
    // eslint-disable-next-line no-console
    console.log(`[publish] ${stage}${tail}`);
  }
  const inventory = await handle.inventory();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(inventory, null, 2));
  await handle.close();
}

async function cmdConnect(_positionals: string[], flags: Flags): Promise<void> {
  const tenant = flagString(flags, "tenant") ?? "demo-tenant";
  const reg = getMountRuntimeRegistry();
  const mounts = reg.list().map((r) => ({
    mountId: r.mountId,
    adapterId: r.adapter.id,
    collections: r.identMap.map((m) => ({ ident: m.ident, name: m.name })),
  }));
  // The MVP carries only a tenant token; opaque opaque-prefixed string is
  // sufficient until real auth lands.
  const token = `dft_${tenant}_${Date.now().toString(36)}`;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ tenant, token, mounts }, null, 2));
}

async function cmdAgent(_positionals: string[], flags: Flags): Promise<void> {
  const tenant = flagString(flags, "tenant") ?? "demo-tenant";
  // Default to all currently registered mounts; if none are registered, the
  // user is expected to have run `publish` first (or to point --mount at a
  // pre-bootstrapped mount on disk under `<baseDir>/mounts/<id>/`).
  const explicitMount = flagString(flags, "mount");
  const { snippetRuntime, baseDir } = await installSnippetRuntime({});
  await installFlueDispatcher({ baseDir });
  installObserver({ baseDir, tenantId: tenant, snippetRuntime });

  const reg = getMountRuntimeRegistry();
  const mountIds = explicitMount
    ? [explicitMount]
    : reg.list().map((r) => r.mountId);
  if (mountIds.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[agent] no mounts registered. Run `datafetch publish <id> --uri <atlas>` first " +
        "or pass --mount <id> to read a pre-bootstrapped mount from disk.",
    );
  }

  const session = new BashSession({
    tenantId: tenant,
    mountIds,
    mountReader: new DiskMountReader({ baseDir }),
    snippetRuntime,
    libraryResolver: getLibraryResolver(),
    baseDir,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[agent] tenant=${tenant} mounts=${JSON.stringify(mountIds)} baseDir=${baseDir}`,
  );
  // eslint-disable-next-line no-console
  console.log("[agent] type bash commands; ^D / ^C to exit");

  const rl = readline.createInterface({ input, output, prompt: "$ " });
  rl.prompt();
  rl.on("line", async (line) => {
    const command = line.trim();
    if (!command) {
      rl.prompt();
      return;
    }
    try {
      const result = await session.exec(command);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.exitCode !== 0) {
        // eslint-disable-next-line no-console
        console.log(`[agent] exit=${result.exitCode}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[agent] exec failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    rl.prompt();
  });
  rl.on("close", () => {
    void session.flushLib().catch(() => undefined);
    void closeAllMounts().catch(() => undefined);
    // eslint-disable-next-line no-console
    console.log("\n[agent] bye");
    process.exit(0);
  });
}

async function cmdDemo(_positionals: string[], flags: Flags): Promise<void> {
  const opts: Parameters<typeof runDemo>[0] = {
    mount: flagString(flags, "mount") ?? "finqa-2024",
    tenant: flagString(flags, "tenant") ?? "demo-tenant",
    noCache: Boolean(flags["no-cache"]),
  };
  const atlasUri = flagString(flags, "uri") ?? process.env["ATLAS_URI"];
  if (atlasUri) opts.atlasUri = atlasUri;
  const atlasDb = flagString(flags, "db") ?? process.env["ATLAS_DB_NAME"];
  if (atlasDb) opts.atlasDb = atlasDb;
  const baseDirFlag = flagString(flags, "base-dir");
  if (baseDirFlag) opts.baseDir = path.resolve(baseDirFlag);

  await runDemo(opts);
}

async function cmdServer(_positionals: string[], flags: Flags): Promise<void> {
  const portRaw = flagString(flags, "port") ?? process.env["PORT"] ?? "8080";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`server: invalid --port ${portRaw}`);
  }
  const baseDirFlag = flagString(flags, "base-dir");

  const createOpts: Parameters<typeof createServer>[0] = {};
  if (baseDirFlag) createOpts.baseDir = path.resolve(baseDirFlag);

  const { app, baseDir } = await createServer(createOpts);
  const handle = serve({ fetch: app.fetch, port });

  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[server] baseDir=${baseDir}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received; closing mounts and shutting down`);
    try {
      await closeAllMounts();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[server] closeAllMounts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    handle.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Stay in the foreground. The signal handlers above own process exit.
  await new Promise<void>(() => {
    /* never resolves; the process exits via the signal handler */
  });
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);

  if (!command || command === "help" || command === "--help" || flags["help"]) {
    usage();
    return;
  }

  switch (command) {
    case "publish":
      await cmdPublish(positionals, flags);
      return;
    case "connect":
      await cmdConnect(positionals, flags);
      return;
    case "agent":
      await cmdAgent(positionals, flags);
      return;
    case "demo":
      await cmdDemo(positionals, flags);
      return;
    case "server":
      await cmdServer(positionals, flags);
      return;
    case "session":
      await cmdSession(positionals, flags);
      return;
    case "tsx":
      await cmdTsx(positionals, flags);
      return;
    case "man":
      await cmdMan(positionals, flags);
      return;
    case "apropos":
      await cmdApropos(positionals, flags);
      return;
    case "install-skill":
      await cmdInstallSkill(positionals, flags);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main()
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    if (process.env["DEBUG"] === "1" && err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    // Best-effort: close any leftover mounts. The agent subcommand handles
    // this in its readline 'close' hook; the others publish/close mount
    // handles in-line.
    try {
      await closeAllMounts();
    } catch {
      // ignore
    }
  });
