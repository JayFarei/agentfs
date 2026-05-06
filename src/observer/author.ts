// Function authoring.
//
// Two paths:
//   - Pure composition (preferred for MVP): generate the TS source directly
//     from the template. The function body composes the same primitives in
//     the same order with the same dataflow. Deterministic; no LLM.
//   - Codifier-skill (fallback): dispatch the `finqa_codify_table_function`
//     seed skill via Flue. Used when the pure path can't produce a valid
//     `fn({...})` source — for example, if the trajectory shape involves
//     reshaping the template extractor doesn't know how to handle.
//
// The author writes to `<baseDir>/lib/<tenantId>/<name>.ts`. It refuses to
// overwrite unless a later workspace HEAD supersedes the same learned shape.
// Validation: after writing, it asks the supplied
// LibraryResolver to load the file; if loading fails (TS error, missing
// fn export, schema parse), it deletes the file and returns the failure
// so the observer can surface a clean `kind: "skipped"`.

import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getBodyDispatcher,
  type LibraryResolver,
  type TrajectoryRecord,
} from "../sdk/index.js";

import type {
  CallTemplate,
  TemplateParameter,
  TemplateStep,
  TypeLabel,
} from "./template.js";

// --- Types -----------------------------------------------------------------

export type AuthorOk = {
  kind: "authored";
  name: string;
  path: string;
  source: string;
};

export type AuthorSkipped = {
  kind: "skipped";
  reason: string;
};

export type AuthorResult = AuthorOk | AuthorSkipped;

export type AuthorFunctionArgs = {
  tenantId: string;
  baseDir: string;
  trajectory: TrajectoryRecord;
  template: CallTemplate;
  libraryResolver: LibraryResolver;
  // Workspace HEAD promotion is allowed to replace an older authored file
  // with the same stable shape/name when a later accepted commit supersedes it.
  allowOverwrite?: boolean;
  // Skill name to dispatch when the pure-composition path can't produce
  // valid source. Defaults to "finqa_codify_table_function".
  codifierSkill?: string;
};

// --- Public API ------------------------------------------------------------

export async function authorFunction(
  args: AuthorFunctionArgs,
): Promise<AuthorResult> {
  const { tenantId, baseDir, trajectory, template, libraryResolver } = args;

  const dir = path.join(baseDir, "lib", tenantId);
  const file = path.join(dir, `${template.name}.ts`);

  // Don't overwrite. The observer's de-dup gate should catch the
  // shape-hash before we get here, but a name collision (e.g. a hand-
  // authored file that happens to share the slug) should not be
  // clobbered.
  const existingSource = await readExistingSource(file);
  if (existingSource !== null && args.allowOverwrite !== true) {
    return { kind: "skipped", reason: `name already exists at ${file}` };
  }

  // Try the pure-composition path first.
  const pureSource = generatePureSource({
    template,
    trajectory,
  });

  let source: string | null = pureSource;
  let pathTaken: "pure" | "codifier" = "pure";

  if (source === null) {
    // Fallback: dispatch the codifier skill via the registered Flue
    // dispatcher. The dispatcher takes the trajectory + first lib call
    // as input and returns `{functionName, description, source}`.
    const skill = args.codifierSkill ?? "finqa_codify_table_function";
    const codified = await dispatchCodifier({ skill, trajectory });
    if (codified === null) {
      return {
        kind: "skipped",
        reason:
          "pure-composition path could not emit source and codifier skill produced no result",
      };
    }
    source = codified;
    pathTaken = "codifier";
  }

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(file, source, "utf8");

  // Validate the written file by attempting to load it through the
  // resolver. If anything fails, clean up.
  const callable = await libraryResolver.resolve(tenantId, template.name);
  if (!callable) {
    if (existingSource !== null) {
      await fsp.writeFile(file, existingSource, "utf8");
    } else {
      await fsp.rm(file, { force: true });
    }
    return {
      kind: "skipped",
      reason: `authored file failed to load (path=${pathTaken})`,
    };
  }

  // Refresh the typed API manifest and workspace memory so the newly learned
  // interface shows up in df.d.ts / AGENTS.md on the next read.
  // Lazy imports keep the observer module light for runDemo and smoke tests.
  void (async () => {
    try {
      const { regenerateManifest } = await import(
        "../server/manifest.js"
      );
      const { regenerateWorkspaceMemory } = await import(
        "../bootstrap/workspaceMemory.js"
      );
      await regenerateManifest({ baseDir, tenantId });
      await regenerateWorkspaceMemory({ baseDir, tenantId });
    } catch {
      // best-effort
    }
  })();

  return { kind: "authored", name: template.name, path: file, source };
}

// --- Pure-composition source generation ------------------------------------

type GenerateArgs = {
  template: CallTemplate;
  trajectory: TrajectoryRecord;
};

function generatePureSource(args: GenerateArgs): string | null {
  const { template, trajectory } = args;
  if (template.steps.length === 0) return null;

  // External parameters: those not derived from earlier-call outputs.
  const externalParams = template.parameters.filter(
    (p) => p.derivedFromCallIndex === undefined,
  );

  // Build the input/output schema fragments.
  const inputSchema = renderInputSchema(externalParams);
  const inputType = renderInputType(externalParams);

  // The function's first example: harvest values from bindings against
  // the originating trajectory's literal call inputs.
  const example = pickExample({
    template,
    trajectory,
    externalParams,
  });
  if (example === null) return null;

  // Render the body. Each step becomes a `const out<i> = await ...;` line.
  const bodyLines: string[] = [];
  for (let i = 0; i < template.steps.length; i += 1) {
    const step = template.steps[i]!;
    const expr = renderStepExpression(step, externalParams);
    if (expr === null) return null;
    bodyLines.push(`  const ${step.outputName} = ${expr};`);
  }
  bodyLines.push(`  return ${template.finalOutputBinding};`);
  const body = bodyLines.join("\n");

  // Sample output: the last call's output, JSON-stringified.
  const exampleOutputJson = safeJsonStringify(
    trajectory.calls[trajectory.calls.length - 1]!.output,
  );

  // The learned interface file lives at <baseDir>/lib/<tenantId>/<name>.ts,
  // outside the repo tree. We use an absolute file:// URL to the SDK
  // barrel so the import resolves regardless of where baseDir lives —
  // same trick as snippet/install.ts seed shim.
  const sdkUrl = sdkIndexUrl();
  const valibotUrl = valibotEntryUrl();

  const fm = frontmatter({ template, trajectory, example, externalParams });
  const header = headerComment({ template, trajectory });
  return [
    fm,
    header,
    `import { fn } from "${sdkUrl}";`,
    `import * as v from "${valibotUrl}";`,
    "",
    `// Learned interface composition. The function body uses the snippet runtime's`,
    `// global \`df\` to call the same primitives the originating trajectory`,
    `// recorded.`,
    `declare const df: {`,
    `  db: Record<string, {`,
    `    findExact(filter: Record<string, unknown>, limit?: number): Promise<unknown[]>;`,
    `    search(query: string, opts?: { limit?: number }): Promise<unknown[]>;`,
    `    findSimilar(query: string, limit?: number): Promise<unknown[]>;`,
    `    hybrid(query: string, opts?: { limit?: number }): Promise<unknown[]>;`,
    `  }>;`,
    `  lib: Record<string, (input: unknown) => Promise<{ value: unknown }>>;`,
    `};`,
    "",
    `type Input = ${inputType};`,
    "",
    `export const ${template.name} = fn<Input, unknown>({`,
    `  intent: ${JSON.stringify(intentString(template))},`,
    `  examples: [`,
    `    {`,
    `      input: ${safeJsonStringify(example)},`,
    `      output: ${exampleOutputJson},`,
    `    },`,
    `  ],`,
    `  input: ${inputSchema},`,
    `  output: v.unknown(),`,
    `  body: async (input: Input): Promise<unknown> => {`,
    body,
    `  },`,
    `});`,
    "",
  ].join("\n");
}

// --- Source helpers --------------------------------------------------------

function renderInputType(params: TemplateParameter[]): string {
  if (params.length === 0) return "Record<string, unknown>";
  const fields = params
    .map((p) => `${jsonProp(p.name)}: ${jsTypeToTs(p.jsType)}`)
    .join("; ");
  return `{ ${fields} }`;
}

function renderInputSchema(params: TemplateParameter[]): string {
  if (params.length === 0) return "v.object({})";
  const fields = params
    .map((p) => `${jsonProp(p.name)}: ${jsTypeToValibot(p.jsType)}`)
    .join(", ");
  return `v.object({ ${fields} })`;
}

function jsTypeToTs(t: TypeLabel): string {
  switch (t) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "unknown[]";
    case "object":
      return "Record<string, unknown>";
    case "null":
      return "null";
    case "unknown":
      return "unknown";
  }
}

function jsTypeToValibot(t: TypeLabel): string {
  switch (t) {
    case "string":
      return "v.string()";
    case "number":
      return "v.number()";
    case "boolean":
      return "v.boolean()";
    case "array":
      return "v.array(v.unknown())";
    case "object":
      return "v.record(v.string(), v.unknown())";
    case "null":
      return "v.null_()";
    case "unknown":
      return "v.unknown()";
  }
}

// JS identifier that's safe to use as an object property without quoting,
// otherwise quote.
function jsonProp(name: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return name;
  return JSON.stringify(name);
}

// Render a single step's RHS expression. db calls go through
// `df.db.<ident>.<method>`; lib calls unwrap `.value` from the Result
// envelope.
function renderStepExpression(
  step: TemplateStep,
  externalParams: TemplateParameter[],
): string | null {
  const isLib = step.primitive.startsWith("lib.");
  const isDb = step.primitive.startsWith("db.");
  if (!isLib && !isDb) return null;

  if (isDb) {
    const [, ident, method] = step.primitive.split(".");
    if (!ident || !method) return null;
    const args: string[] = [];
    if (step.callShape === "positional-query-limit") {
      const q = bindingExpr(step.inputBindings["query"], externalParams);
      const l = bindingExpr(step.inputBindings["limit"], externalParams);
      if (q === null) return null;
      if (l !== null) args.push(q, l);
      else args.push(q);
    } else if (step.callShape === "positional-query-opts") {
      const q = bindingExpr(step.inputBindings["query"], externalParams);
      const o = bindingExpr(step.inputBindings["opts"], externalParams);
      if (q === null) return null;
      args.push(q);
      if (o !== null) args.push(o);
    } else if (step.callShape === "positional-filter-limit") {
      const f = bindingExpr(step.inputBindings["filter"], externalParams);
      const l = bindingExpr(step.inputBindings["limit"], externalParams);
      if (f === null) return null;
      if (l !== null) args.push(f, l);
      else args.push(f);
    } else {
      const obj = renderBindingObject(step.inputBindings, externalParams);
      if (obj === null) return null;
      args.push(obj);
    }
    return `await df.db.${ident}.${method}(${args.join(", ")})`;
  }

  // lib.*: single-arg input object; unwrap the Result envelope.
  const obj = renderBindingObject(step.inputBindings, externalParams);
  if (obj === null) return null;
  const libName = step.primitive.slice("lib.".length);
  return `(await df.lib.${libName}(${obj})).value`;
}

// Render the bindings as an object literal `{field: <expr>, ...}`.
function renderBindingObject(
  bindings: TemplateStep["inputBindings"],
  externalParams: TemplateParameter[],
): string | null {
  const props: string[] = [];
  for (const [field, binding] of Object.entries(bindings)) {
    if (field === "__atom") continue;
    const expr = bindingExpr(binding, externalParams);
    if (expr === null) return null;
    props.push(`${jsonProp(field)}: ${expr}`);
  }
  return `{ ${props.join(", ")} }`;
}

// Render a single binding as a TS expression.
function bindingExpr(
  binding: TemplateStep["inputBindings"][string] | undefined,
  externalParams: TemplateParameter[],
): string | null {
  if (!binding) return null;
  if (binding.kind === "ref") return binding.ref;
  const known = externalParams.some((p) => p.name === binding.param);
  if (!known) return null;
  return `input.${jsonProp(binding.param)}`;
}

// --- Example harvesting ----------------------------------------------------

type PickExampleArgs = {
  template: CallTemplate;
  trajectory: TrajectoryRecord;
  externalParams: TemplateParameter[];
};

// Reconstruct the public function's first example by harvesting the
// originating trajectory's literal inputs for each external parameter.
// Walks the steps in order; the FIRST step whose binding references a
// given param is where we pull the literal value.
function pickExample(args: PickExampleArgs): Record<string, unknown> | null {
  const { template, trajectory, externalParams } = args;
  const out: Record<string, unknown> = {};
  for (const param of externalParams) {
    let found = false;
    for (let i = 0; i < template.steps.length; i += 1) {
      const step = template.steps[i]!;
      const call = trajectory.calls[i];
      if (!call) continue;
      const callInput = call.input;
      if (callInput === null || typeof callInput !== "object") {
        // atomic binding
        const atom = step.inputBindings["__atom"];
        if (atom && atom.kind === "param" && atom.param === param.name) {
          out[param.name] = callInput;
          found = true;
          break;
        }
        continue;
      }
      const inputObj = callInput as Record<string, unknown>;
      for (const [field, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind !== "param" || binding.param !== param.name) continue;
        if (field === "__atom") continue;
        out[param.name] = inputObj[field];
        found = true;
        break;
      }
      if (found) break;
    }
    if (!found) return null;
  }
  return out;
}

// --- Misc helpers ----------------------------------------------------------

function intentString(template: CallTemplate): string {
  const seq = template.steps.map((s) => s.primitive).join(" -> ");
  return `reusable learned interface for the ${template.topic} intent shape; internally composes ${seq}`;
}

function headerComment(args: {
  template: CallTemplate;
  trajectory: TrajectoryRecord;
}): string {
  return [
    `// Learned by datafetch observer from trajectory ${args.trajectory.id}.`,
    `// @shape-hash: ${args.template.shapeHash}`,
    `// @origin-trajectory: ${args.trajectory.id}`,
    `// @origin-question: ${JSON.stringify(args.trajectory.question)}`,
    `// @steps: ${args.template.steps.map((s) => s.primitive).join(" -> ")}`,
    "",
  ].join("\n");
}

// YAML frontmatter at the very top of the learned interface file. Mirrors the
// format Claude Code skills use at `~/.claude/skills/<name>/SKILL.md`:
// `name` + a `description` block whose text gives the agent enough signal
// to decide whether to call the wrapper directly vs compose from primitives.
//
// Pure-template, no LLM call. Pulls the originating question out of the
// example's longest string value (typically a `query` parameter), the call
// graph from the template's steps, and the input shape from the parameter
// names. The resulting block reads as an affordance the agent can match
// against its task — same shape it's already trained to scan.
function frontmatter(args: {
  template: CallTemplate;
  trajectory: TrajectoryRecord;
  example: Record<string, unknown>;
  externalParams: TemplateParameter[];
}): string {
  const userQuestion =
    longestStringValue(args.example) ?? args.trajectory.question;
  const callGraph = args.template.steps
    .map((s) => s.primitive)
    .join(" -> ");
  const inputKeys = args.externalParams.map((p) => p.name).join(", ");

  // Indent the description's body by two spaces so YAML's `|` block
  // scalar parses cleanly. Newlines inside the block are preserved.
  const descLines = [
    `Learned datafetch interface for questions shaped like:`,
    `  "${userQuestion.replace(/"/g, '\\"')}"`,
    `Internally chains: ${callGraph}.`,
    `Use when the user's question has the same task shape, even if`,
    `the entity, metric, period, or wording differs. Prefer this before`,
    `recomposing the primitive chain. Pass input as { ${inputKeys} };`,
    `the runtime returns the last call's output.`,
  ];
  const description = descLines.map((l) => `  ${l}`).join("\n");

  return [
    "/* ---",
    `name: ${args.template.name}`,
    `status: provisional`,
    `description: |`,
    description,
    `trajectory: ${args.trajectory.id}`,
    `shape-hash: ${args.template.shapeHash}`,
    "--- */",
    "",
  ].join("\n");
}

function longestStringValue(obj: Record<string, unknown>): string | null {
  let best: string | null = null;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.length > 8) {
      if (best === null || v.length > best.length) best = v;
    }
  }
  return best;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "null";
  }
}

async function readExistingSource(p: string): Promise<string | null> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return null;
  }
}

// Locate the on-disk SDK barrel as a file:// URL.
function sdkIndexUrl(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/observer/author.ts -> src/sdk/index.ts
  const target = path.resolve(here, "..", "sdk", "index.ts");
  return `file://${target.replace(/\\/g, "/")}`;
}

// Locate valibot's ESM entry as a file:// URL. The learned interface
// lives at <baseDir>/lib/<tenantId>/<name>.ts (outside the repo tree),
// so the bare `valibot` specifier wouldn't resolve at import time. We
// embed the absolute URL in the generated source instead. Node 20.6+
// gives us this resolution synchronously via `import.meta.resolve`,
// honouring the package's exports field.
function valibotEntryUrl(): string {
  // `import.meta.resolve` is sync since Node 20.6; not yet in the
  // default lib types in some configs, so cast through `unknown`.
  const resolve = (
    import.meta as unknown as { resolve: (specifier: string) => string }
  ).resolve;
  return resolve("valibot");
}

// --- Codifier-skill fallback -----------------------------------------------

// Dispatch the codifier skill via the registered BodyDispatcher. We hand
// it the trajectory as input and expect a `{source}` field in the
// response.
async function dispatchCodifier(args: {
  skill: string;
  trajectory: TrajectoryRecord;
}): Promise<string | null> {
  const dispatcher = getBodyDispatcher();
  if (!dispatcher) return null;
  const body = {
    kind: "agent" as const,
    skill: args.skill,
    model:
      process.env.DATAFETCH_CODIFIER_MODEL ??
      process.env.DATAFETCH_LLM_MODEL ??
      process.env.DF_LLM_MODEL ??
      "openai-codex/gpt-5.3-codex-spark",
  };
  // The skill expects {question, filing, context}. We surface the first
  // lib call's output as the "filing" proxy.
  const firstLib = args.trajectory.calls.find((c) =>
    c.primitive.startsWith("lib."),
  );
  const skillInput = {
    question: args.trajectory.question,
    filing: firstLib?.output ?? args.trajectory.calls[0]?.output,
    context: { calls: args.trajectory.calls.map((c) => c.primitive) },
  };
  let raw: unknown;
  try {
    raw = await dispatcher.dispatch(body, skillInput, {
      tenant: args.trajectory.tenantId,
      mount: args.trajectory.provenance?.mount ?? "unknown",
      cost: {
        tier: 3,
        tokens: { hot: 0, cold: 0 },
        ms: { hot: 0, cold: 0 },
        llmCalls: 0,
      },
    });
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const source = rec["source"];
  if (typeof source !== "string") return null;
  if (source.includes("fn({")) return source;
  // Bare function bodies don't fit the fn() factory contract; the
  // observer skips with a clean reason rather than wrap heuristically.
  return null;
}
