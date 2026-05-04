// datafetch CLI — four subcommands.
//
//   pnpm datafetch publish <mount-id> [--uri <atlas>] [--db <name>]
//     Publishes a mount via publishMount({source: atlasMount({...})}) and
//     streams stage events to stdout. Returns the inventory at the end.
//
//   pnpm datafetch connect [--tenant <id>]
//     Stub for the tenant handshake. Prints the tenant token and the live
//     mount inventory. Real tenant tokens land post-MVP; today this is a
//     courtesy command for the demo flow.
//
//   pnpm datafetch agent [--tenant <id>] [--mount <id>]
//     Interactive bash session against the registered mounts. Reads stdin
//     line-by-line, sends each line through BashSession.exec, and prints
//     stdout/stderr/exitCode.
//
//   pnpm datafetch demo [--mount finqa-2024] [--tenant demo-tenant] [--no-cache]
//     Runs the headline two-question scenario via runDemo({...}).

import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";

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
import { installSnippetRuntime } from "./snippet/install.js";

loadProjectEnv();

// --- Flag parsing ----------------------------------------------------------

type Flags = Record<string, string | boolean | string[]>;

function parseFlags(argv: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  const booleanFlags = new Set(["no-cache", "help"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
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
      "datafetch — bash workspace over a mounted dataset",
      "",
      "Commands:",
      "  pnpm datafetch publish <mount-id> [--uri <atlas-uri>] [--db <db-name>]",
      "    Publish a mount; stream warm-up stage events to stdout.",
      "",
      "  pnpm datafetch connect [--tenant <id>]",
      "    Print the tenant token and current mount inventory.",
      "",
      "  pnpm datafetch agent [--tenant <id>] [--mount <id>]",
      "    Open an interactive bash session in the registered mount(s).",
      "",
      "  pnpm datafetch demo [--mount finqa-2024] [--tenant demo-tenant] [--no-cache]",
      "    Run the two-question Q1/Q2 demo end-to-end.",
      "",
      "Environment:",
      "  DATAFETCH_HOME     baseDir for /db/, /lib/, trajectories",
      "  ATLAS_URI          MongoDB Atlas connection string",
      "  PORT               HTTP server port (server.ts only)",
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
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
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
