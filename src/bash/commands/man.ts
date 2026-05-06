// `man <fn>` custom command.
//
// Renders structured docs for a typed function in /lib/, modelled on the
// real Unix man-page convention. The exact line shape mirrors
// kb/prd/personas.md §3 Turn 2:
//
//   NAME
//          <name> - <intent>
//   SYNOPSIS
//          df.lib.<name>(<input-shape>)
//   INPUT SCHEMA
//          <field>: <type>
//          ...
//   OUTPUT
//          <field>: <type>
//          ...
//   EXAMPLES
//          df.lib.<name>(<example.input>) → <example.output>
//
// On miss: `No manual entry for <name>` to stderr, exit 1 (matches `man`).

import { defineCommand, type Command } from "just-bash";

import {
  describeLibraryFunction,
  renderManPage,
} from "../../discovery/librarySearch.js";
import type { LibraryResolver } from "../../sdk/index.js";

// --- Inputs needed at construction -----------------------------------------

export type ManCommandDeps = {
  baseDir: string;
  resolveTenant: () => string;
  resolveLibrary: () => LibraryResolver | null;
};

// --- Command factory -------------------------------------------------------

export function createManCommand(deps: ManCommandDeps): Command {
  return defineCommand("man", async (args, _ctx) => {
    const name = args[0];
    if (!name) {
      return {
        stdout: "",
        stderr: "What manual page do you want?\nFor example, try 'man man'.\n",
        exitCode: 1,
      };
    }

    const resolver = deps.resolveLibrary();
    if (!resolver) {
      return {
        stdout: "",
        stderr: `No manual entry for ${name}\n`,
        exitCode: 1,
      };
    }

    const tenant = deps.resolveTenant();
    let entry;
    try {
      entry = await describeLibraryFunction({
        baseDir: deps.baseDir,
        tenantId: tenant,
        resolver,
        name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        stdout: "",
        stderr: `man: error resolving ${name}: ${msg}\n`,
        exitCode: 1,
      };
    }

    if (!entry) {
      return {
        stdout: "",
        stderr: `No manual entry for ${name}\n`,
        exitCode: 1,
      };
    }

    return {
      stdout: renderManPage(entry),
      stderr: "",
      exitCode: 0,
    };
  });
}
