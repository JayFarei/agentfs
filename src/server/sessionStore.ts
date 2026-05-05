// Persistent session store.
//
// One JSON file per session under `<baseDir>/sessions/<sessionId>.json`.
// The disk file is the source of truth for tenantId/mountIds/createdAt;
// `lastActiveAt` is bumped on every /v1/snippets and /v1/bash hit.
//
// In-memory `BashSession` instances are NOT stored here — those live in
// the per-route caches (createBashApp / createSnippetsApp) and are
// rehydrated lazily on first use using the disk record.

import { promises as fsp } from "node:fs";
import path from "node:path";

import { defaultBaseDir } from "../paths.js";

// --- Public types ----------------------------------------------------------

export type SessionRecord = {
  sessionId: string;
  tenantId: string;
  mountIds: string[];
  createdAt: string;
  lastActiveAt: string;
};

export type SessionStoreOpts = {
  baseDir?: string;
};

// --- Public API ------------------------------------------------------------

export class SessionStore {
  private readonly dir: string;

  constructor(opts: SessionStoreOpts = {}) {
    const baseDir = opts.baseDir ?? defaultBaseDir();
    this.dir = path.join(baseDir, "sessions");
  }

  async createSession(args: {
    tenantId: string;
    mountIds: string[];
  }): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      sessionId: mintSessionId(),
      tenantId: args.tenantId,
      mountIds: [...args.mountIds],
      createdAt: now,
      lastActiveAt: now,
    };
    await this.write(record);
    return record;
  }

  async loadSession(sessionId: string): Promise<SessionRecord | null> {
    const file = this.fileFor(sessionId);
    try {
      const raw = await fsp.readFile(file, "utf8");
      return JSON.parse(raw) as SessionRecord;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return null;
      throw err;
    }
  }

  async listSessions(): Promise<SessionRecord[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(this.dir, { withFileTypes: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw err;
    }
    const records: SessionRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const raw = await fsp.readFile(path.join(this.dir, entry.name), "utf8");
        records.push(JSON.parse(raw) as SessionRecord);
      } catch {
        // Skip corrupt files; the caller should not crash on a single
        // bad session record.
      }
    }
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return records;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const file = this.fileFor(sessionId);
    try {
      await fsp.unlink(file);
      return true;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return false;
      throw err;
    }
  }

  // Bump lastActiveAt. Returns the new record, or null if the session
  // was not found. Best-effort: read-modify-write without a lock; the
  // worst case for a race is a stale lastActiveAt by a few ms.
  async touchSession(sessionId: string): Promise<SessionRecord | null> {
    const record = await this.loadSession(sessionId);
    if (!record) return null;
    record.lastActiveAt = new Date().toISOString();
    await this.write(record);
    return record;
  }

  // --- internals ---

  private fileFor(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.json`);
  }

  private async write(record: SessionRecord): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(
      this.fileFor(record.sessionId),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
  }
}

// `sess_<base36-timestamp>_<6-char-random>`. Base36 keeps the ids short
// enough to be useful in URLs; the random suffix avoids collisions
// inside a single millisecond.
function mintSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `sess_${ts}_${rand}`;
}
