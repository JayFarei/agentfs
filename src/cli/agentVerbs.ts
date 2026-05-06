// Agent verbs: `datafetch tsx`, `datafetch man`, `datafetch apropos`.
//
// These are the verbs a plain-bash agent (Claude Code) drives. Each
// resolves the active session, then either:
//   - tsx     → POSTs to /v1/snippets and streams stdout/stderr; appends
//               the Result envelope after a `--- envelope ---` separator.
//   - man     → reads `<baseDir>/lib/<tenant>/<fn>.ts` (via the same
//               DiskLibraryResolver the bash command uses) and renders a
//               man-style page.
//   - apropos → searches both `<baseDir>/lib/<tenant>/*.ts` and the
//               `__seed__` overlay for matches above the score threshold.

import { promises as fsp } from "node:fs";
import path from "node:path";

import type { SnippetPhase } from "../bash/snippetRuntime.js";
import {
  describeLibraryFunction,
  renderManPage,
  searchLibrary,
} from "../discovery/librarySearch.js";
import { defaultBaseDir } from "../paths.js";
import { DiskLibraryResolver } from "../snippet/library.js";

import { jsonRequest, resolveServerUrl } from "./httpClient.js";
import { resolveActiveSession, type SessionRecord } from "./session.js";
import type { Flags } from "./types.js";

// --- Flag helpers ----------------------------------------------------------

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function jsonFlag(flags: Flags): boolean {
  return flags["json"] === true;
}

function serverUrlFromFlags(flags: Flags): string {
  return resolveServerUrl(flagString(flags, "server")).baseUrl;
}

function baseDirFromFlags(flags: Flags): string {
  const flag = flagString(flags, "base-dir");
  return flag ? path.resolve(flag) : defaultBaseDir();
}

// Fetch the session record from the server (we need the tenantId for
// disk-side reads). Throws if the server can't find it.
async function fetchSessionRecord(
  serverUrl: string,
  sessionId: string,
): Promise<SessionRecord> {
  return jsonRequest<SessionRecord>({
    method: "GET",
    path: `/v1/sessions/${encodeURIComponent(sessionId)}`,
    serverUrl,
  });
}

// --- snippet runners -------------------------------------------------------

async function runSnippetCommand(
  positionals: string[],
  flags: Flags,
  phase?: SnippetPhase,
): Promise<void> {
  const baseDir = baseDirFromFlags(flags);
  const { sessionId } = await resolveActiveSession(flags, baseDir);
  const serverUrl = serverUrlFromFlags(flags);

  // `tsx -e '<source>'` or `tsx <file>`
  const eFlag = flagString(flags, "e");
  let source: string;
  let sourcePath: string | undefined;
  if (eFlag !== undefined) {
    source = eFlag;
  } else {
    const file = positionals[0];
    if (!file) {
      const verb = phase ?? "tsx";
      throw new Error(`${verb}: provide -e '<source>' or a path to a .ts file`);
    }
    sourcePath = path.resolve(file);
    source = await fsp.readFile(sourcePath, "utf8");
  }

  type SnippetResponse = {
    stdout: string;
    stderr: string;
    exitCode: number;
    trajectoryId?: string;
    cost?: unknown;
    mode?: string;
    functionName?: string;
    callPrimitives?: string[];
    phase?: SnippetPhase;
    crystallisable?: boolean;
    artifactDir?: string;
  };

  const body: {
    sessionId: string;
    source: string;
    phase?: SnippetPhase;
    sourcePath?: string;
  } = { sessionId, source };
  if (phase !== undefined) body.phase = phase;
  if (sourcePath !== undefined) body.sourcePath = sourcePath;

  const res = await jsonRequest<SnippetResponse>({
    method: "POST",
    path: "/v1/snippets",
    body,
    serverUrl,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  // Trailing newline guard so the separator doesn't run into snippet output.
  if (res.stdout && !res.stdout.endsWith("\n")) process.stdout.write("\n");
  process.stdout.write("--- envelope ---\n");
  process.stdout.write(
    `${JSON.stringify(
      {
        trajectoryId: res.trajectoryId,
        mode: res.mode,
        functionName: res.functionName,
        callPrimitives: res.callPrimitives,
        phase: res.phase,
        crystallisable: res.crystallisable,
        artifactDir: res.artifactDir,
        cost: res.cost,
        exitCode: res.exitCode,
      },
      null,
      2,
    )}\n`,
  );

  process.exitCode = res.exitCode;
}

// --- tsx / plan / execute --------------------------------------------------

export async function cmdTsx(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  await runSnippetCommand(positionals, flags);
}

export async function cmdPlan(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  await runSnippetCommand(positionals, flags, "plan");
}

export async function cmdExecute(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  await runSnippetCommand(positionals, flags, "execute");
}

// --- man -------------------------------------------------------------------

export async function cmdMan(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const name = positionals[0];
  if (!name) {
    process.stderr.write("What manual page do you want?\n");
    process.exitCode = 1;
    return;
  }
  const baseDir = baseDirFromFlags(flags);
  const { sessionId } = await resolveActiveSession(flags, baseDir);
  const serverUrl = serverUrlFromFlags(flags);

  const record = await fetchSessionRecord(serverUrl, sessionId);
  const resolver = new DiskLibraryResolver({ baseDir });
  const entry = await describeLibraryFunction({
    baseDir,
    tenantId: record.tenantId,
    resolver,
    name,
  });
  if (!entry) {
    process.stderr.write(`man: no manual entry for ${name}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(renderManPage(entry));
}

// --- apropos ---------------------------------------------------------------

export async function cmdApropos(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  if (positionals.length === 0) {
    process.stderr.write("apropos what?\n");
    process.exitCode = 1;
    return;
  }
  const baseDir = baseDirFromFlags(flags);
  const { sessionId } = await resolveActiveSession(flags, baseDir);
  const serverUrl = serverUrlFromFlags(flags);

  const record = await fetchSessionRecord(serverUrl, sessionId);
  const resolver = new DiskLibraryResolver({ baseDir });

  let scored;
  try {
    scored = await searchLibrary({
      baseDir,
      tenantId: record.tenantId,
      resolver,
      query: positionals.join(" "),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`apropos: error listing /lib/: ${msg}\n`);
    process.exitCode = 1;
    return;
  }

  if (jsonFlag(flags)) {
    process.stdout.write(`${JSON.stringify({ matches: scored })}\n`);
    return;
  }

  if (scored.length === 0) {
    process.stdout.write("(no matches above 0.5)\n");
    return;
  }
  const maxName = Math.min(
    24,
    scored.reduce((m, x) => Math.max(m, x.name.length), 0),
  );
  for (const m of scored) {
    const padded = m.name.padEnd(maxName, " ");
    process.stdout.write(`${padded} (${m.kind}) - ${m.intent}\n`);
  }
}
