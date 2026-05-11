// pnpm datafetch:run <script.ts>
//
// Bash-native multi-turn primitive for the agent during an eval
// episode. Lets the agent run an ad-hoc TS snippet against the same
// snippet runtime + df.* bindings + skillcraft tool bridge the final
// scripts/answer.ts will see, so it can probe tool shapes, test
// helpers under df.lib.<name>, and observe real output before
// committing to the final answer.
//
// Context discovery: reads `.datafetch-ctx.json` from the current
// working directory. The eval drops this file into the workspace at
// episode setup time (see writeEpisodeContext in
// skillcraftFullDatafetch.ts). Without it, this command exits with a
// clear "run me inside an episode workspace" message.
//
// Output: snippet stdout streams to this process's stdout; stderr
// streams to stderr; exit code mirrors snippetRuntime.run's exitCode.
// No fancy tool surface — just write a .ts file and run it.

import { promises as fsp } from "node:fs";
import path from "node:path";

import { installSnippetRuntime } from "../snippet/install.js";

interface DatafetchEpisodeCtx {
  tenantId: string;
  skillcraftDir: string;
  datafetchHome: string;
  bundles: string[];
  skillcraftToolRunnerPath: string;
  snippetTimeoutMs?: number;
}

const CTX_FILE = ".datafetch-ctx.json";

// When this script is invoked via `pnpm datafetch:run …`, pnpm cd's
// into the repo root before exec'ing tsx, which means process.cwd()
// is the repo root, NOT the workspace the agent was sitting in.
// pnpm exposes the original directory via INIT_CWD. Prefer that.
function originalCwd(): string {
  return process.env["INIT_CWD"] ?? process.cwd();
}

// Walk up from `start` looking for the first directory containing
// .datafetch-ctx.json. Caps the walk at 8 levels so a stray
// invocation outside any workspace exits cleanly rather than scanning
// the whole filesystem.
async function findCtxFile(start: string): Promise<string | null> {
  let cursor = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(cursor, CTX_FILE);
    try {
      await fsp.stat(candidate);
      return candidate;
    } catch {
      // not here, walk up
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

async function readCtx(file: string): Promise<DatafetchEpisodeCtx | null> {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw) as DatafetchEpisodeCtx;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stderr.write(
      [
        "usage: pnpm datafetch:run <script.ts>",
        "",
        "Runs the given TypeScript snippet through the datafetch snippet runtime",
        "with df.* bound (df.tool.*, df.db.*, df.lib.*, df.answer, df.run).",
        "",
        "Must be invoked from inside an eval episode workspace — i.e. a directory",
        `that contains a ${CTX_FILE} dropped by the eval harness at setup time.`,
        "",
        "Example:",
        "  echo 'console.log(await df.tool.cocktail.cocktail_search({q:\"margarita\"}))' \\",
        "    > scripts/probe.ts",
        "  pnpm datafetch:run scripts/probe.ts",
        "",
      ].join("\n"),
    );
    process.exit(argv.length === 0 ? 2 : 0);
    return;
  }
  const scriptArg = argv[0]!;
  const baseCwd = originalCwd();
  const scriptPath = path.isAbsolute(scriptArg)
    ? scriptArg
    : path.resolve(baseCwd, scriptArg);
  let source: string;
  try {
    source = await fsp.readFile(scriptPath, "utf8");
  } catch (err) {
    process.stderr.write(
      `pnpm datafetch:run: cannot read ${scriptPath}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(2);
    return;
  }

  // Look for the context file starting from the script's directory
  // (the workspace it lives in) and walking up. Falls back to baseCwd
  // if the script is in an unusual location.
  const ctxFile =
    (await findCtxFile(path.dirname(scriptPath))) ??
    (await findCtxFile(baseCwd));
  if (!ctxFile) {
    process.stderr.write(
      [
        `pnpm datafetch:run: no ${CTX_FILE} found near ${scriptPath} or ${baseCwd}.`,
        `This command must run inside an eval episode workspace.`,
        `The eval harness drops ${CTX_FILE} at episode setup; if you don't see it,`,
        "you're either in the wrong directory or running outside the eval flow.",
        "",
      ].join("\n"),
    );
    process.exit(2);
    return;
  }
  const ctx = await readCtx(ctxFile);
  if (!ctx) {
    process.stderr.write(
      `pnpm datafetch:run: ${ctxFile} exists but failed to parse as JSON.\n`,
    );
    process.exit(2);
    return;
  }

  const { snippetRuntime } = await installSnippetRuntime({
    baseDir: ctx.datafetchHome,
    skipSeedMirror: true,
  });

  const result = await snippetRuntime.run({
    source,
    sourcePath: scriptPath,
    sessionCtx: {
      tenantId: ctx.tenantId,
      mountIds: [],
      baseDir: ctx.datafetchHome,
      skillcraftToolBridge: {
        skillcraftDir: ctx.skillcraftDir,
        bundles: ctx.bundles,
        runnerPath: ctx.skillcraftToolRunnerPath,
      },
      snippetTimeoutMs: ctx.snippetTimeoutMs ?? 300_000,
    },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

main().catch((err) => {
  process.stderr.write(
    `pnpm datafetch:run: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
