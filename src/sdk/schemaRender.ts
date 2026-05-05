// Shared valibot-schema → string renderer.
//
// Two consumers want this:
//   - The man-page renderers (bash/commands/man.ts, cli/agentVerbs.ts) which
//     format `T?` for optional fields (the common Unix man-page convention).
//   - The TS declaration renderer (server/manifest.ts) which formats
//     `T | undefined` for optional fields (so the output is valid TypeScript).
//
// The only meaningful divergence is the optional rendering, exposed via
// `opts.optional`. Object-field optionality is handled at both the
// `renderSchemaInline` level (which produces strings ending in `?` or
// ` | undefined`) and the consumer's caller (which strips the marker and
// re-emits the field with `key?:` syntax). Centralising the renderer here
// removes a 3-way duplication.

import type { GenericSchema } from "valibot";

// Structural type matching what valibot's runtime introspection exposes
// on schema instances. We avoid pulling in valibot's full internal types
// because they're broad and we only inspect a stable subset.
export type SchemaShape = {
  type?: string;
  kind?: string;
  expects?: string;
  entries?: Record<string, SchemaShape>;
  item?: SchemaShape;
  wrapped?: SchemaShape;
  options?: unknown[];
  literal?: unknown;
};

export type RenderOpts = {
  // How to render optional types.
  //   "suffix" → "T?"           (man-page convention; the default)
  //   "union"  → "T | undefined" (valid TypeScript; used by manifest.ts)
  optional?: "suffix" | "union";
};

const DEFAULT_OPTS: Required<RenderOpts> = { optional: "suffix" };

export function renderSchemaInline(
  schema: GenericSchema<unknown> | unknown,
  opts: RenderOpts = {},
): string {
  const o = { ...DEFAULT_OPTS, ...opts };
  const s = schema as SchemaShape | null | undefined;
  if (!s || typeof s !== "object") return "unknown";
  switch (s.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "unknown":
    case "any":
      return "unknown";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "literal":
      return JSON.stringify(s.literal);
    case "picklist": {
      const opts2 = (s.options ?? []) as unknown[];
      if (opts2.length === 0) return "never";
      return opts2.map((v) => JSON.stringify(v)).join(" | ");
    }
    case "array": {
      const inner = s.item
        ? renderSchemaInline(s.item, o)
        : "unknown";
      return `${inner}[]`;
    }
    case "optional": {
      const inner = s.wrapped
        ? renderSchemaInline(s.wrapped, o)
        : "unknown";
      // Don't double-wrap if the inner already carries an optional marker.
      const stripped = stripOptionalSuffix(inner, o.optional);
      return o.optional === "suffix"
        ? `${stripped}?`
        : `${stripped} | undefined`;
    }
    case "object": {
      const entries = s.entries ?? {};
      const fields = Object.entries(entries).map(([key, child]) => {
        const inner = renderSchemaInline(child, o);
        const optionalMarker =
          o.optional === "suffix" ? "?" : " | undefined";
        if (inner.endsWith(optionalMarker)) {
          return `${key}?: ${inner.slice(0, -optionalMarker.length)}`;
        }
        return `${key}: ${inner}`;
      });
      const sep = o.optional === "suffix" ? ", " : "; ";
      return `{ ${fields.join(sep)} }`;
    }
    default:
      return s.expects ?? "unknown";
  }
}

export function renderSchemaBlock(
  schema: GenericSchema<unknown> | unknown,
  opts: RenderOpts = {},
): string[] {
  const o = { ...DEFAULT_OPTS, ...opts };
  const s = schema as SchemaShape | null | undefined;
  if (s && s.type === "object" && s.entries) {
    const lines: string[] = [];
    const optionalMarker =
      o.optional === "suffix" ? "?" : " | undefined";
    for (const [key, child] of Object.entries(s.entries)) {
      const inner = renderSchemaInline(child, o);
      if (inner.endsWith(optionalMarker)) {
        lines.push(`       ${key}?: ${inner.slice(0, -optionalMarker.length)}`);
      } else {
        lines.push(`       ${key}: ${inner}`);
      }
    }
    return lines;
  }
  return [`       ${renderSchemaInline(schema, o)}`];
}

export function renderSynopsisArg(
  schema: GenericSchema<unknown> | unknown,
  opts: RenderOpts = {},
): string {
  const o = { ...DEFAULT_OPTS, ...opts };
  const s = schema as SchemaShape | null | undefined;
  if (s && s.type === "object" && s.entries) {
    const optionalMarker =
      o.optional === "suffix" ? "?" : " | undefined";
    const fields = Object.keys(s.entries).map((key) => {
      const child = s.entries![key]!;
      const inner = renderSchemaInline(child, o);
      return inner.endsWith(optionalMarker) ? `${key}?` : key;
    });
    return `{ ${fields.join(", ")} }`;
  }
  return renderSchemaInline(schema, o);
}

// Strip an optional marker from the tail of an already-rendered type so
// callers can decorate it with their own suffix without doubling up.
function stripOptionalSuffix(s: string, style: "suffix" | "union"): string {
  if (style === "suffix" && s.endsWith("?")) return s.slice(0, -1);
  if (style === "union" && s.endsWith(" | undefined")) {
    return s.slice(0, -" | undefined".length);
  }
  return s;
}
