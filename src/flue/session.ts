// FlueSessionPool — per-tenant in-process Flue agent + session.
//
// One persistent Flue session per tenant on the data plane. Sessions are
// constructed lazily on first call for a tenant and reused across calls;
// warm-up tokens are charged once.
//
// ─── Data-plane boundary ────────────────────────────────────────────────────
//
// THIS FILE IS THE DATA-PLANE BOUNDARY FOR LLM CREDENTIALS.
//
// Per design.md §10 + decisions.md D-008 + plan R8 + plan Verification 9:
// the LLM credential is read here, on the data plane, at session-construction
// time. The agent client never sees it.
// Do not export the key, do not stringify it into prompts, do not pass it
// to any client-facing code path.
//
// ────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { FlueAgent, FlueSession } from "@flue/sdk/client";
// Pull internal in-process bits from the SDK's internal entry — same as the
// SDK's own server uses. createFlueContext + InMemorySessionStore + the
// resolveModel helper give us a fully configured Flue agent without going
// through the build/dev/run CLI surface.
import {
  createFlueContext,
  InMemorySessionStore,
  bashFactoryToSessionEnv,
  resolveModel,
} from "@flue/sdk/internal";
import { Bash, InMemoryFs } from "just-bash";

import { enforceMapCap } from "../util/bounded.js";

// Default model — can be overridden per-call by the body's `model` field
// (D-016 says the body's `model` is authoritative). This default is used
// only when an init() options.model is required by the SDK's resolveModel
// hook chain; in practice every prompt() / skill() call we issue passes
// `{ model: body.model }` explicitly.
const FALLBACK_MODEL =
  process.env.DATAFETCH_LLM_MODEL ??
  process.env.DF_LLM_MODEL ??
  "openai-codex/gpt-5.3-codex-spark";

type ResolvedModel = ReturnType<typeof resolveModel>;

// Per-tenant pool entry: holds the FlueAgent (sandbox + tools) and its
// default session.
type Entry = {
  agent: FlueAgent;
  session: FlueSession;
};

// Cap on the per-tenant session pool. Each entry holds a Flue agent
// (sandbox + tools + system prompt) plus the active session; LLM tenant
// fan-out is the realistic memory pressure. 64 fits a few-dozen-tenant
// data plane; eviction destroys the agent so the underlying resources
// release before the entry drops.
const SESSION_POOL_CAP = 64;

export class FlueSessionPool {
  private readonly entries = new Map<string, Promise<Entry>>();
  private readonly store = new InMemorySessionStore();

  /**
   * Get or lazily create the persistent session for a tenant.
   *
   * Concurrent calls with the same tenantId share the same in-flight
   * construction promise; only one Flue agent is built per tenant.
   *
   * Re-fetched tenants move to the back of the FIFO order (LRU-ish on
   * access).
   */
  async getSession(tenantId: string): Promise<FlueSession> {
    let pending = this.entries.get(tenantId);
    if (pending === undefined) {
      pending = this.buildEntry(tenantId);
      this.entries.set(tenantId, pending);
      enforceMapCap(this.entries, SESSION_POOL_CAP, (_id, p) => {
        // Fire-and-forget destroy; concurrent users still hold the
        // session reference until they finish, but new lookups for
        // this tenantId will rebuild.
        void p
          .then((entry) => entry.agent.destroy())
          .catch(() => undefined);
      });
    } else {
      // Touch (move to back of insertion order) so that recently-used
      // tenants survive eviction over idle ones.
      this.entries.delete(tenantId);
      this.entries.set(tenantId, pending);
    }
    const entry = await pending;
    return entry.session;
  }

  private async buildEntry(tenantId: string): Promise<Entry> {
    // Read LLM credentials on the data plane. We still honour both
    // ANTHROPIC_API_KEY and the legacy ANTHROPIC_KEY name for old authored
    // bodies, but the default path now prefers Codex subscription OAuth.
    if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_KEY) {
      process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_KEY;
    }

    // An in-process FlueContext, configured for purely-in-memory sandbox
    // + persistence. We don't need AGENTS.md / .agents/skills/ discovery
    // here — the dispatcher's skill loader handles those itself by
    // reading our skill markdown sidecars.
    const ctx = createFlueContext({
      id: `tenant-${tenantId}`,
      payload: {},
      env: process.env,
      agentConfig: {
        systemPrompt: "",
        skills: {},
        roles: {},
        model: undefined,
        resolveModel: resolveDatafetchModel,
      },
      createDefaultEnv: async () =>
        bashFactoryToSessionEnv(() => new Bash({ fs: new InMemoryFs() })),
      createLocalEnv: async () =>
        bashFactoryToSessionEnv(() => new Bash({ fs: new InMemoryFs() })),
      defaultStore: this.store,
    });

    const agent = await ctx.init({
      id: `tenant-${tenantId}`,
      model: FALLBACK_MODEL,
    });
    const session = await agent.session();
    return { agent, session };
  }

  /** Graceful shutdown. Destroys every constructed agent. */
  async closeAll(): Promise<void> {
    const toClose = Array.from(this.entries.values());
    this.entries.clear();
    for (const pending of toClose) {
      try {
        const entry = await pending;
        await entry.agent.destroy();
      } catch {
        // Best-effort shutdown.
      }
    }
  }
}

function resolveDatafetchModel(modelString: string): ResolvedModel {
  const model = resolveModel(modelString);
  if (model.provider !== "openai-codex") {
    return model;
  }

  const token = readCodexSubscriptionToken();
  if (token !== null) {
    // pi-ai's openai-codex provider currently has no env-key mapping for
    // "openai-codex". The provider implementation already accepts ChatGPT
    // OAuth tokens; presenting the resolved model as provider "openai" makes
    // it pick up OPENAI_API_KEY without changing the API implementation.
    process.env.OPENAI_API_KEY = token;
    return { ...model, provider: "openai" } as ResolvedModel;
  }

  return model;
}

function readCodexSubscriptionToken(): string | null {
  const envToken =
    process.env.OPENAI_CODEX_API_KEY ??
    process.env.CODEX_OAUTH_TOKEN ??
    process.env.CLAW_CODEX_ACCESS_TOKEN;
  if (isNonEmptyString(envToken)) {
    return envToken;
  }

  return readClawCodexToken() ?? readCodexCliToken();
}

function readClawCodexToken(): string | null {
  const auth = readJsonObject(
    process.env.CLAW_CODEX_AUTH_FILE ??
      path.join(os.homedir(), ".claw-codex", "auth.json"),
  );
  const access = stringField(auth, "access");
  if (!isNonEmptyString(access)) {
    return null;
  }
  const expires = numberField(auth, "expires");
  if (expires !== null && expires <= Date.now() + 60_000) {
    return null;
  }
  return access;
}

function readCodexCliToken(): string | null {
  const auth = readJsonObject(path.join(os.homedir(), ".codex", "auth.json"));
  const tokens = recordField(auth, "tokens");
  const access = stringField(tokens, "access_token");
  return isNonEmptyString(access) ? access : null;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function recordField(
  value: Record<string, unknown> | null,
  field: string,
): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }
  const nested = value[field];
  return isRecord(nested) ? nested : null;
}

function stringField(
  value: Record<string, unknown> | null,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }
  const nested = value[field];
  return typeof nested === "string" ? nested : null;
}

function numberField(
  value: Record<string, unknown> | null,
  field: string,
): number | null {
  if (value === null) {
    return null;
  }
  const nested = value[field];
  return typeof nested === "number" ? nested : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
