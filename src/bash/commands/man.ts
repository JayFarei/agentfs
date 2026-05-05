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

import type { Fn, FnSpec, LibraryResolver } from "../../sdk/index.js";
import {
  renderSchemaBlock,
  renderSynopsisArg,
} from "../../sdk/schemaRender.js";

// --- Inputs needed at construction -----------------------------------------

export type ManCommandDeps = {
  resolveTenant: () => string;
  resolveLibrary: () => LibraryResolver | null;
};

// --- Schema introspection --------------------------------------------------

// Render a valibot schema as a one-line type string for the man-page body.
// We don't try to render every valibot construct; we cover the shapes
// Schema renderers are shared with the CLI's man verb and the server's
// df.d.ts manifest generator. See src/sdk/schemaRender.ts.

// --- Page rendering --------------------------------------------------------

function renderManPage(name: string, spec: FnSpec<unknown, unknown>): string {
  const lines: string[] = [];
  lines.push("NAME");
  lines.push(`       ${name} - ${spec.intent}`);
  lines.push("SYNOPSIS");
  lines.push(`       df.lib.${name}(${renderSynopsisArg(spec.input)})`);
  lines.push("INPUT SCHEMA");
  lines.push(...renderSchemaBlock(spec.input));
  lines.push("OUTPUT");
  lines.push(...renderSchemaBlock(spec.output));
  if (spec.examples.length > 0) {
    lines.push("EXAMPLES");
    for (const example of spec.examples) {
      const inputJson = JSON.stringify(example.input);
      const outputJson = JSON.stringify(example.output);
      lines.push(`       df.lib.${name}(${inputJson}) → ${outputJson}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

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
    let entry: Fn<unknown, unknown> | null;
    try {
      entry = await resolver.resolve(tenant, name);
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
      stdout: renderManPage(name, entry.spec),
      stderr: "",
      exitCode: 0,
    };
  });
}
