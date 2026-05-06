// CLI session subcommands + active-session pointer I/O.
//
// Active-session pointer
// ----------------------
// `$DATAFETCH_HOME/active-session` is a plain-text file containing one
// session id (no metadata, no JSON). Resolution order for any subcommand
// that needs a session:
//
//   1. `--session <id>` flag (highest priority)
//   2. `DATAFETCH_SESSION` env var
//   3. pointer file at `<baseDir>/active-session`
//
// `session new` and `session resume` write the pointer; `session end`
// clears it if the deleted id matches; `session switch` runs end+new.

import { promises as fsp } from "node:fs";
import path from "node:path";

import { defaultBaseDir } from "../paths.js";

import { jsonRequest, resolveServerUrl } from "./httpClient.js";
import { renderSessionNarrative } from "./sessionNarrative.js";
import type { Flags } from "./types.js";

// --- Types we mirror from the server side --------------------------------

export type SessionRecord = {
  sessionId: string;
  tenantId: string;
  mountIds: string[];
  createdAt: string;
  lastActiveAt: string;
};

// --- Active-session pointer I/O ------------------------------------------

function activeSessionPath(baseDir: string): string {
  return path.join(baseDir, "active-session");
}

export async function readActiveSession(baseDir: string): Promise<string | null> {
  try {
    const raw = await fsp.readFile(activeSessionPath(baseDir), "utf8");
    const id = raw.trim();
    return id.length > 0 ? id : null;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeActiveSession(
  baseDir: string,
  sessionId: string,
): Promise<void> {
  await fsp.mkdir(baseDir, { recursive: true });
  const target = activeSessionPath(baseDir);
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, `${sessionId}\n`, "utf8");
  await fsp.rename(tmp, target);
}

export async function clearActiveSession(baseDir: string): Promise<void> {
  try {
    await fsp.unlink(activeSessionPath(baseDir));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
}

// --- Active-session resolution -------------------------------------------

export type ResolvedSession = {
  sessionId: string;
  source: "flag" | "env" | "pointer";
};

// Resolve the active session id (without hitting the server). Throws a
// clear error if nothing resolves.
export async function resolveActiveSession(
  flags: Flags,
  baseDir: string,
): Promise<ResolvedSession> {
  const flagVal = typeof flags["session"] === "string" ? (flags["session"] as string) : undefined;
  if (flagVal) return { sessionId: flagVal, source: "flag" };
  const env = process.env["DATAFETCH_SESSION"];
  if (env && env.length > 0) return { sessionId: env, source: "env" };
  const pointer = await readActiveSession(baseDir);
  if (pointer) return { sessionId: pointer, source: "pointer" };
  throw new Error(
    "no active session. Run `datafetch session new --tenant <id>` " +
      "or pass `--session <id>` / set DATAFETCH_SESSION.",
  );
}

// --- Subcommand handlers --------------------------------------------------

function flagString(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagStringArray(flags: Flags, key: string): string[] | undefined {
  const v = flags[key];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return undefined;
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

// `datafetch session new --tenant <id> [--mount <id>...] [--json]`
export async function cmdSessionNew(
  _positionals: string[],
  flags: Flags,
): Promise<void> {
  const tenant = flagString(flags, "tenant");
  if (!tenant) throw new Error("session new: --tenant <id> is required");
  const mounts = flagStringArray(flags, "mount");
  const serverUrl = serverUrlFromFlags(flags);

  const body: { tenantId: string; mountIds?: string[] } = { tenantId: tenant };
  if (mounts) body.mountIds = mounts;

  const record = await jsonRequest<SessionRecord>({
    method: "POST",
    path: "/v1/connect",
    body,
    serverUrl,
  });

  const baseDir = baseDirFromFlags(flags);
  await writeActiveSession(baseDir, record.sessionId);

  if (jsonFlag(flags)) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }
  process.stdout.write(
    `[session] new: ${record.sessionId} (tenant=${record.tenantId} ` +
      `mounts=${JSON.stringify(record.mountIds)})\n` +
      `[session] active pointer written to ${activeSessionPath(baseDir)}\n`,
  );
}

// `datafetch session list [--json]`
export async function cmdSessionList(
  _positionals: string[],
  flags: Flags,
): Promise<void> {
  const serverUrl = serverUrlFromFlags(flags);
  const { sessions } = await jsonRequest<{ sessions: SessionRecord[] }>({
    method: "GET",
    path: "/v1/sessions",
    serverUrl,
  });
  if (jsonFlag(flags)) {
    process.stdout.write(`${JSON.stringify({ sessions })}\n`);
    return;
  }
  if (sessions.length === 0) {
    process.stdout.write("(no sessions)\n");
    return;
  }
  // Simple two-column table: id  tenant  mounts  lastActive
  const rows = sessions.map((s) => [
    s.sessionId,
    s.tenantId,
    s.mountIds.join(",") || "-",
    s.lastActiveAt,
  ]);
  const headers = ["SESSION", "TENANT", "MOUNTS", "LAST ACTIVE"];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? c.length, " ")).join("  ");
  process.stdout.write(`${fmt(headers)}\n`);
  for (const r of rows) process.stdout.write(`${fmt(r)}\n`);
}

// `datafetch session resume <sessionId>`
export async function cmdSessionResume(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const id = positionals[0];
  if (!id) throw new Error("session resume: <sessionId> is required");
  const serverUrl = serverUrlFromFlags(flags);
  const record = await jsonRequest<SessionRecord>({
    method: "GET",
    path: `/v1/sessions/${encodeURIComponent(id)}`,
    serverUrl,
  });
  const baseDir = baseDirFromFlags(flags);
  await writeActiveSession(baseDir, record.sessionId);
  process.stdout.write(
    `[session] active: ${record.sessionId} (tenant=${record.tenantId})\n`,
  );
}

// `datafetch session end <sessionId>`
export async function cmdSessionEnd(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const id = positionals[0];
  if (!id) throw new Error("session end: <sessionId> is required");
  const serverUrl = serverUrlFromFlags(flags);
  await jsonRequest({
    method: "DELETE",
    path: `/v1/sessions/${encodeURIComponent(id)}`,
    serverUrl,
  });
  const baseDir = baseDirFromFlags(flags);
  const active = await readActiveSession(baseDir);
  if (active === id) await clearActiveSession(baseDir);
  process.stdout.write(`[session] ended: ${id}\n`);
}

// `datafetch session switch --tenant <id> [--mount <id>...]`
export async function cmdSessionSwitch(
  _positionals: string[],
  flags: Flags,
): Promise<void> {
  const tenant = flagString(flags, "tenant");
  if (!tenant) throw new Error("session switch: --tenant <id> is required");
  const baseDir = baseDirFromFlags(flags);
  const serverUrl = serverUrlFromFlags(flags);
  const active = await readActiveSession(baseDir);
  if (active) {
    try {
      await jsonRequest({
        method: "DELETE",
        path: `/v1/sessions/${encodeURIComponent(active)}`,
        serverUrl,
      });
    } catch {
      // Best-effort: if the active pointer references a session the
      // server doesn't know about, clear and proceed.
    }
    await clearActiveSession(baseDir);
  }
  // Delegate the create half to cmdSessionNew with the same flags.
  await cmdSessionNew([], flags);
}

// `datafetch session current`
export async function cmdSessionCurrent(
  _positionals: string[],
  flags: Flags,
): Promise<void> {
  const baseDir = baseDirFromFlags(flags);
  const active = await readActiveSession(baseDir);
  process.stdout.write(`${active ?? "none"}\n`);
}

// `datafetch session narrative [sessionId]`
export async function cmdSessionNarrative(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const baseDir = baseDirFromFlags(flags);
  const sessionId =
    positionals[0] ?? (await resolveActiveSession(flags, baseDir)).sessionId;
  process.stdout.write(await renderSessionNarrative({ baseDir, sessionId }));
}

// Dispatch table — `cmdSession` is the single entry point bound to the
// `session` subcommand; sub-subcommands branch on positional[0].
export async function cmdSession(
  positionals: string[],
  flags: Flags,
): Promise<void> {
  const sub = positionals[0];
  const rest = positionals.slice(1);
  switch (sub) {
    case "new":
      await cmdSessionNew(rest, flags);
      return;
    case "list":
      await cmdSessionList(rest, flags);
      return;
    case "resume":
      await cmdSessionResume(rest, flags);
      return;
    case "end":
      await cmdSessionEnd(rest, flags);
      return;
    case "switch":
      await cmdSessionSwitch(rest, flags);
      return;
    case "current":
      await cmdSessionCurrent(rest, flags);
      return;
    case "narrative":
      await cmdSessionNarrative(rest, flags);
      return;
    case undefined:
      throw new Error(
        "session: subcommand required (new | list | resume | end | switch | current | narrative)",
      );
    default:
      throw new Error(`session: unknown subcommand "${sub}"`);
  }
}
