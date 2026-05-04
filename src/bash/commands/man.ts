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
import type { GenericSchema } from "valibot";

import type { Fn, FnSpec, LibraryResolver } from "../../sdk/index.js";

// --- Inputs needed at construction -----------------------------------------

export type ManCommandDeps = {
  resolveTenant: () => string;
  resolveLibrary: () => LibraryResolver | null;
};

// --- Schema introspection --------------------------------------------------

// Render a valibot schema as a one-line type string for the man-page body.
// We don't try to render every valibot construct; we cover the shapes
// `fn({...})` authors actually use in personas.md (object, string, number,
// boolean, array, optional, picklist, literal, unknown). Anything else
// falls back to the schema's `expects` string.
//
// The schema runtime shape we read:
//   { type, kind, expects, entries?, item?, wrapped?, options?, literal? }
type SchemaShape = {
  type?: string;
  kind?: string;
  expects?: string;
  entries?: Record<string, SchemaShape>;
  item?: SchemaShape;
  wrapped?: SchemaShape;
  options?: unknown[];
  literal?: unknown;
};

function renderSchemaInline(schema: GenericSchema<unknown>): string {
  const s = schema as unknown as SchemaShape;
  switch (s.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "unknown":
      return "unknown";
    case "any":
      return "any";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "literal":
      return JSON.stringify(s.literal);
    case "picklist": {
      const opts = (s.options ?? []) as unknown[];
      return opts.map((o) => JSON.stringify(o)).join(" | ");
    }
    case "array": {
      const inner = s.item
        ? renderSchemaInline(s.item as unknown as GenericSchema<unknown>)
        : "unknown";
      return `${inner}[]`;
    }
    case "optional": {
      const inner = s.wrapped
        ? renderSchemaInline(s.wrapped as unknown as GenericSchema<unknown>)
        : "unknown";
      return `${inner}?`;
    }
    case "object": {
      const entries = s.entries ?? {};
      const fields = Object.keys(entries).map((key) => {
        const child = entries[key]!;
        const inner = renderSchemaInline(child as unknown as GenericSchema<unknown>);
        // Strip trailing ? on field type and apply it to the field name.
        if (inner.endsWith("?")) {
          return `${key}?: ${inner.slice(0, -1)}`;
        }
        return `${key}: ${inner}`;
      });
      return `{ ${fields.join(", ")} }`;
    }
    default:
      return s.expects ?? "unknown";
  }
}

// Render the body of an INPUT SCHEMA / OUTPUT block. Object schemas render
// as one line per top-level field; non-object schemas render as a single
// `<inline>` line.
function renderSchemaBlock(schema: GenericSchema<unknown>): string[] {
  const s = schema as unknown as SchemaShape;
  if (s.type === "object" && s.entries) {
    const lines: string[] = [];
    for (const [key, child] of Object.entries(s.entries)) {
      const inner = renderSchemaInline(child as unknown as GenericSchema<unknown>);
      if (inner.endsWith("?")) {
        lines.push(`       ${key}?: ${inner.slice(0, -1)}`);
      } else {
        lines.push(`       ${key}: ${inner}`);
      }
    }
    return lines;
  }
  return [`       ${renderSchemaInline(schema)}`];
}

// Render the SYNOPSIS line. For object input we list field names with `?`
// suffix on optional fields (matches `df.lib.pickFiling({ question,
// candidates, priorTickers? })`). For non-object inputs we render the
// inline type.
function renderSynopsisArg(schema: GenericSchema<unknown>): string {
  const s = schema as unknown as SchemaShape;
  if (s.type === "object" && s.entries) {
    const fields = Object.keys(s.entries).map((key) => {
      const child = s.entries![key]!;
      const inner = renderSchemaInline(child as unknown as GenericSchema<unknown>);
      return inner.endsWith("?") ? `${key}?` : key;
    });
    return `{ ${fields.join(", ")} }`;
  }
  return renderSchemaInline(schema);
}

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
