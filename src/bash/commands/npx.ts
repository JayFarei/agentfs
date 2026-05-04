// `npx <subcommand>` custom command.
//
// Dispatches on subcommand:
//   npx tsx <file>          read <file> from VFS, hand source to SnippetRuntime
//   npx tsx -e "<snippet>"  literal source
//   npx tsx -               read source from stdin
//   npx ts-node <args>      alias of `npx tsx <args>`
//   pnpm exec tsx <args>    alias (split across two custom commands; see below)
//   yarn tsx <args>         alias (split across two custom commands; see below)
//
// Per kb/prd/design.md §12.3:
//   "npx <package> doesn't actually install npm packages. The custom npx
//    command dispatches on subcommand: npx tsx and a few aliases route to
//    the data-plane TS runtime; everything else returns a clear 'not
//    available in this sandbox' message."
//
// Aliases that arrive as a leading word other than `npx` (`pnpm`, `yarn`)
// are surfaced through their own defineCommand wrappers in the export
// below.

import { defineCommand, type Command, type CommandContext } from "just-bash";

import type { SessionCtx, SnippetRuntime } from "../snippetRuntime.js";

// --- Inputs needed at construction -----------------------------------------

export type NpxCommandDeps = {
  resolveSessionCtx: () => SessionCtx;
  resolveRuntime: () => SnippetRuntime;
};

// --- Shared dispatch logic -------------------------------------------------

// Result the dispatcher promises to the just-bash command shim.
type DispatchResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// Read a file from the VFS via the CommandContext, returning a structured
// error if the read fails.
async function readVfs(
  ctx: CommandContext,
  path: string,
): Promise<{ ok: true; source: string } | { ok: false; reason: string }> {
  try {
    const source = await ctx.fs.readFile(path);
    return { ok: true, source };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

// Resolve a possibly-relative path against the command context's cwd.
function absPath(ctx: CommandContext, p: string): string {
  if (p.startsWith("/")) return p;
  return ctx.fs.resolvePath(ctx.cwd, p);
}

// Core: given the post-`tsx` argv (e.g. `["-e", "console.log(1)"]`), run
// it through the injected SnippetRuntime.
async function runTsx(
  args: string[],
  ctx: CommandContext,
  deps: NpxCommandDeps,
): Promise<DispatchResult> {
  if (args.length === 0) {
    return {
      stdout: "",
      stderr: "tsx: no script provided\n",
      exitCode: 1,
    };
  }

  const first = args[0]!;
  let source: string;

  if (first === "-e") {
    if (args.length < 2) {
      return {
        stdout: "",
        stderr: "tsx -e: missing snippet\n",
        exitCode: 1,
      };
    }
    source = args.slice(1).join(" ");
  } else if (first === "-") {
    source = ctx.stdin ?? "";
  } else {
    const path = absPath(ctx, first);
    const read = await readVfs(ctx, path);
    if (!read.ok) {
      return {
        stdout: "",
        stderr: `tsx: cannot read ${path}: ${read.reason}\n`,
        exitCode: 1,
      };
    }
    source = read.source;
  }

  const runtime = deps.resolveRuntime();
  const sessionCtx = deps.resolveSessionCtx();
  return runtime.run({ source, sessionCtx });
}

// --- npx ------------------------------------------------------------------

const SUPPORTED_NPX_SUBCMDS = new Set(["tsx", "ts-node"]);

export function createNpxCommand(deps: NpxCommandDeps): Command {
  return defineCommand("npx", async (args, ctx) => {
    if (args.length === 0) {
      return {
        stdout: "",
        stderr: "npx: missing subcommand\n",
        exitCode: 1,
      };
    }

    const sub = args[0]!;
    if (SUPPORTED_NPX_SUBCMDS.has(sub)) {
      return runTsx(args.slice(1), ctx, deps);
    }
    return {
      stdout: "",
      stderr: `npx ${sub}: not available in this datafetch sandbox\n`,
      exitCode: 127,
    };
  });
}

// --- pnpm exec tsx --------------------------------------------------------

export function createPnpmCommand(deps: NpxCommandDeps): Command {
  return defineCommand("pnpm", async (args, ctx) => {
    if (args[0] === "exec" && (args[1] === "tsx" || args[1] === "ts-node")) {
      return runTsx(args.slice(2), ctx, deps);
    }
    return {
      stdout: "",
      stderr: `pnpm ${args.join(" ")}: not available in this datafetch sandbox\n`,
      exitCode: 127,
    };
  });
}

// --- yarn tsx -------------------------------------------------------------

export function createYarnCommand(deps: NpxCommandDeps): Command {
  return defineCommand("yarn", async (args, ctx) => {
    if (args[0] === "tsx" || args[0] === "ts-node") {
      return runTsx(args.slice(1), ctx, deps);
    }
    return {
      stdout: "",
      stderr: `yarn ${args.join(" ")}: not available in this datafetch sandbox\n`,
      exitCode: 127,
    };
  });
}
