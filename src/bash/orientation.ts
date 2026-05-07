// Orientation file generators.
//
// The bash session seeds these files into the VFS at construction time so
// the agent's first `cat /AGENTS.md` returns useful content. Three scopes
// per kb/prd/design.md §4.2:
//
//   /AGENTS.md + /CLAUDE.md                 workspace orientation (~600 tokens)
//   /usr/share/datafetch/skill/SKILL.md     SDK skill bundle
//   /README.md                              short project description
//   /package.json                           plausible Node project metadata
//
// Per-mount /db/<mount-id>/README.md is owned by the bootstrap pipeline
// and surfaced through the MountReader; this module only handles the
// session-level files.

// --- Inputs -----------------------------------------------------------------

export type OrientationContext = {
  tenantId: string;
  mountIds: string[];
  // Names of /lib/<name>.ts files visible at session start. Snapshot only;
  // the agent re-reads /lib/ for the live view.
  libFunctions: string[];
};

// --- /AGENTS.md -------------------------------------------------------------

export function renderAgentsMd(ctx: OrientationContext): string {
  const mountList =
    ctx.mountIds.length > 0
      ? ctx.mountIds.map((m) => `- /db/${m}/`).join("\n")
      : "- (no mounts attached)";
  const libList =
    ctx.libFunctions.length > 0
      ? ctx.libFunctions.map((n) => `- /lib/${n}.ts`).join("\n")
      : "- (empty — write your first function with `cat > /lib/<name>.ts <<EOF`)";

  return `# Datafetch workspace

You are an agent in a datafetch bash workspace. Your only tool is \`bash\`.
Standard Unix tools are available (\`cat\`, \`ls\`, \`grep\`, \`find\`,
\`head\`, \`tail\`, \`jq\`, \`awk\`, \`sed\`, \`tree\`, \`xargs\`, ...).
Three custom commands extend the surface: \`npx tsx\`, \`man\`, \`apropos\`.

## Layout

Two regions plus an ephemeral working area:

\`\`\`
/db/      IMMUTABLE   the substrate's typed surface, synthesised from sampling
/lib/     MUTABLE     your function pool — typed callables authored via fn({...})
/tmp/     EPHEMERAL   per-session working area; cleared at conversation end
\`\`\`

### Mounts available to this session

${mountList}

Each mount has \`/db/<mount-id>/README.md\` describing the dataset, plus
per-collection \`<coll>.ts\` modules and \`<coll>/_descriptor.json\`,
\`_samples.json\`, \`_stats.json\` introspection files.

### Functions in /lib/

${libList}

## Discovery flow

When the user asks for something, work in this order:

1. \`cat /db/<mount>/README.md\` — what's in this dataset, typical query patterns.
2. \`apropos <keywords>\` — semantic search across /lib/ intents.
3. \`man <fn>\` — structured docs (NAME / SYNOPSIS / INPUT SCHEMA / OUTPUT / EXAMPLES).
4. \`cat /lib/<fn>.ts\` — read the source if you want to use it as a template.

If a function exists for what you need, call it directly through
\`npx tsx -e "console.log(JSON.stringify(await df.lib.<name>(<input>)))"\`.

If nothing fits, compose primitives in a \`npx tsx\` snippet
(see "authoring" below). When that succeeds, the observer will mine the
trajectory and may crystallise a parameterised \`/lib/<name>.ts\` for next time.

## Authoring a new function

Real bash, real heredocs. To create \`/lib/<name>.ts\`:

\`\`\`bash
cat > /lib/myFunction.ts <<'EOF'
import { fn, agent } from "@datafetch/sdk";
import * as v from "valibot";

export const myFunction = fn({
  intent: "<one-sentence description>",
  examples: [{ input: { /* ... */ }, output: { /* ... */ } }],
  input:  v.object({ /* ... */ }),
  output: v.object({ /* ... */ }),
  body: /* pure TS or agent({prompt, model}) / agent({skill, model}) */,
});
EOF
\`\`\`

The runtime registers the file on next read. \`df.lib.myFunction(input)\` is
callable immediately — no \`register\` or \`synthesize\` verb. See
\`/usr/share/datafetch/skill/SKILL.md\` for the SDK conventions on body
shapes and skill markdown sidecars.

## Skill markdown sidecars

When an agent-backed prompt is long enough to externalise, write
it as a markdown sidecar:

\`\`\`bash
cat > /lib/skills/score_narrative_tone.md <<'EOF'
---
name: score_narrative_tone
input:  { text: string }
output: { tone: "optimistic" | "neutral" | "cautious" | "defensive", confidence: number }
---

You score a paragraph for narrative tone. ...
EOF
\`\`\`

Then reference the skill from a function body via
\`agent({ skill: "score_narrative_tone", model: "..." })\`. Skills under
\`/lib/skills/\` are tenant-private; the in-process agent dispatcher reads
them by skill name when the function is called. The on-disk path that
the dispatcher resolves to is
\`<DATAFETCH_HOME>/lib/<tenant>/skills/<name>.md\` — the same path your
heredoc-written file lands at after the next \`npx tsx\` flush.

## Compose your full task in one snippet

The data plane records what runs through \`df.*\`. If you extract data
through \`df.db.<coll>.findExact(...)\` and then process it outside the
\`npx tsx\` snippet (e.g., calling your own LLM, transforming locally,
coming back for the next bit), the trajectory we mine will be fragmented
and the observer cannot crystallise a useful function from it. Compose
the whole task in one \`npx tsx\` snippet whenever you can. The result
envelope's \`provenance\` is your record of what was captured.

## Important: per-call shell-state reset

Each bash tool call is one \`exec\`. Filesystem state persists across
calls — files you write to \`/lib/\` and \`/tmp/\` stay. Shell state does
not — \`cd\`, \`export FOO=\`, and shell-defined functions reset between
calls. **Use absolute paths everywhere.** Don't rely on \`cd\` or env
vars to carry context between commands. If a command needs an env var,
inline it: \`FOO=bar some-command\`. If you need to keep a path, write it
into a file (\`echo /db/finqa-2024 > /tmp/mount\`) and \`cat\` it back.

## Result envelope

Every \`df.lib.<fn>\` and \`df.db.<coll>.<method>\` call returns a uniform
\`Result<T>\` shape: \`{ value, mode, cost, provenance, escalations,
warnings? }\`. The \`mode\` field tells you whether the runtime hit a
learned interface (\`interpreted\`), an agent-backed body
(\`llm-backed\`), or a from-scratch composition (\`novel\`). The \`cost\`
field is what a user-facing dashboard plots over time. Print the whole
envelope (\`JSON.stringify(r, null, 2)\`) when debugging.
`;
}

// --- /usr/share/datafetch/skill/SKILL.md ------------------------------------

export function renderSkillMd(): string {
  return `# Datafetch SDK skill bundle

Conventions that don't change per workspace. Read this once when you
land in a new datafetch session; revisit when authoring a new function.

## The fn({...}) factory

One factory authors every callable in \`/lib/\`. Three required schemas
(\`intent\`, \`examples\`, \`input\`, \`output\`) plus a \`body\`:

\`\`\`ts
import { fn, agent } from "@datafetch/sdk";
import * as v from "valibot";

export const totalRevenue = fn({
  intent: "total revenue for a named company in a given filing year",
  examples: [
    { input: { company: "AAPL", year: 2017 },
      output: { amount: 229_234_000_000, evidence: [/* ... */] } },
  ],
  input:  v.object({ company: v.string(), year: v.number() }),
  output: v.object({ amount: v.number(), evidence: v.array(v.unknown()) }),
  body:   /* pure TypeScript or agent({prompt}) / agent({skill}) */,
});
\`\`\`

\`intent\`, \`examples\`, \`input\`, \`output\` are the contract — what
\`man <fn>\` and \`apropos\` see. The agent reads them; the runtime
validates I/O on every call.

## Body shapes

### 1. Pure TypeScript

For deterministic primitives (parsing, arithmetic, normalisation):

\`\`\`ts
body: ({ n, d }) => n / d
\`\`\`

### 2. Agent-backed, inline prompt

When the prompt is short enough to read alongside the function:

\`\`\`ts
body: agent({
  model: "anthropic/claude-haiku-4-5",
  prompt: \`You score a paragraph for narrative tone. ...\`,
})
\`\`\`

### 3. Agent body referencing a skill markdown

When the prompt is long enough to externalise, write
\`/lib/skills/<name>.md\` with frontmatter (\`name\`, \`input\`, \`output\`,
\`model?\`) and the prompt body, then:

\`\`\`ts
body: agent({ skill: "score_narrative_tone", model: "anthropic/claude-haiku-4-5" })
\`\`\`

Skills are an *optimisation*, not a required artefact. Inline
\`agent({prompt: ...})\` is the default; externalise only when the prompt
deserves its own file.

The agent writes skills inside the \`/lib/skills/\` namespace (i.e.
alongside their referencing functions in \`/lib/\`); the runtime
canonicalises the on-disk location to
\`<DATAFETCH_HOME>/lib/<tenant>/skills/<name>.md\` and the in-process
agent dispatcher reads from there. There is no separate top-level
\`/skills/\` directory.

### 4. Composition

Async function calling \`df.db.*\` and \`df.lib.*\`:

\`\`\`ts
body: async ({ company, year }) => {
  const cands  = await df.db.cases.findSimilar(\`\${company} \${year} revenue\`, 5);
  const filing = await df.lib.pickFiling({ question: \`\${company} \${year}\`, candidates: cands });
  const figure = await df.lib.locateFigure({ question: "total revenue", filing });
  return { amount: figure.value, evidence: [figure] };
}
\`\`\`

## Error recovery

When a call fails, you have three escape hatches in TypeScript itself:

\`\`\`ts
try {
  return await df.lib.totalRevenue({ company, year });
} catch (e) {
  if (e.code === "stale_pin") { /* re-derive against current /db/ */ }
  if (e.name === "SchemaValidationError") { /* contract mismatch */ }
  // Fallback: compose from primitives.
  const cands = await df.db.cases.findSimilar(...);
  // ...
}
\`\`\`

There is no invisible router rerouting calls server-side. The agent owns
the failure mode in plain TypeScript.

## When to externalise to a skill markdown

Inline \`agent({prompt: ...})\` is right when:
- The prompt is < 30 lines.
- One function uses it; nothing else.
- You want the prompt and schema visible in one \`cat\`.

Externalise to \`/lib/skills/<name>.md\` when:
- The prompt is > ~50 lines or has lots of examples.
- Multiple functions share it.
- You want to edit the prompt without editing TypeScript.

Both agent forms work; this is just a refactor.

## Things that should never go in /lib/

- Tenant-private secrets or credentials. The data plane holds substrate
  and LLM credentials; \`/lib/\` files are for typed logic only.
- Free-floating snippets. Use \`/tmp/\` for one-off composition before you
  decide whether to commit.
- Scripts that don't return through \`fn({...})\`. The result envelope is
  the contract; if you can't express it that way, it doesn't belong in
  \`/lib/\`.
`;
}

// --- /README.md -------------------------------------------------------------

export function renderRootReadme(): string {
  return `# datafetch workspace

A bash-shaped Unix workspace over a mounted dataset. Datasets live under
\`/db/\` (read-only, synthesised from sampling); typed functions live
under \`/lib/\` (read-write, your working pool).

See \`/AGENTS.md\` for orientation and
\`/usr/share/datafetch/skill/SKILL.md\` for the SDK conventions.
`;
}

// --- /package.json ----------------------------------------------------------

export function renderPackageJson(ctx: OrientationContext): string {
  const obj = {
    name: `datafetch-workspace-${ctx.tenantId}`,
    version: "0.0.0",
    description: "Datafetch bash workspace (synthesised; not a real npm package)",
    type: "module",
    scripts: {},
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}
