#!/usr/bin/env node
// datafetch — launcher shim.
//
// Why a shim? Two problems to solve simultaneously:
//
// 1. Node's CLI flag parser consumes the first `-e` it sees as `--eval`.
//    `node --import tsx src/cli.ts tsx -e 'console.log(1)'` eats the user's
//    `-e` before it ever reaches the script.
// 2. When `datafetch` runs from outside the package directory (e.g. via
//    `pnpm link --global` from `/tmp`), Node resolves `--import tsx`
//    relative to the cwd, not the script, so a bare `--import tsx` fails
//    with ERR_MODULE_NOT_FOUND.
//
// Fix: this shim runs as a plain Node script (no tsx loader yet), resolves
// the absolute paths to tsx's loader and to `src/cli.ts` from its own
// location, then re-executes Node with those absolutes. User args are
// appended *after* the cli path, so they live in `process.argv[2+]` and
// Node never sees the user's `-e` as its own flag.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const cliPath = path.join(pkgRoot, "src", "cli.ts");

// Resolve the tsx loader from the package's own node_modules so we work
// regardless of cwd. createRequire anchored at the package root gives us
// `tsx`'s package "." export, which is the loader entry point.
const requireFromPkg = createRequire(path.join(pkgRoot, "package.json"));
const tsxLoaderUrl = pathToFileURL(requireFromPkg.resolve("tsx")).href;

const userArgs = process.argv.slice(2);
const child = spawn(
  process.execPath,
  ["--import", tsxLoaderUrl, cliPath, ...userArgs],
  { stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
