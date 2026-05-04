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
// the LLM API key (ANTHROPIC_API_KEY / ANTHROPIC_KEY) is read here, on the
// data plane, at session-construction time. The agent client never sees it.
// Do not export the key, do not stringify it into prompts, do not pass it
// to any client-facing code path.
//
// ────────────────────────────────────────────────────────────────────────────

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

// Default model — can be overridden per-call by the body's `model` field
// (D-016 says the body's `model` is authoritative). This default is used
// only when an init() options.model is required by the SDK's resolveModel
// hook chain; in practice every prompt() / skill() call we issue passes
// `{ model: body.model }` explicitly.
const FALLBACK_MODEL = "anthropic/claude-sonnet-4-6";

// Per-tenant pool entry: holds the FlueAgent (sandbox + tools) and its
// default session.
type Entry = {
  agent: FlueAgent;
  session: FlueSession;
};

export class FlueSessionPool {
  private readonly entries = new Map<string, Promise<Entry>>();
  private readonly store = new InMemorySessionStore();

  /**
   * Get or lazily create the persistent session for a tenant.
   *
   * Concurrent calls with the same tenantId share the same in-flight
   * construction promise; only one Flue agent is built per tenant.
   */
  async getSession(tenantId: string): Promise<FlueSession> {
    let pending = this.entries.get(tenantId);
    if (pending === undefined) {
      pending = this.buildEntry(tenantId);
      this.entries.set(tenantId, pending);
    }
    const entry = await pending;
    return entry.session;
  }

  private async buildEntry(tenantId: string): Promise<Entry> {
    // Read the LLM API key on the data plane. We honour both
    // ANTHROPIC_API_KEY and the legacy ANTHROPIC_KEY name (the
    // .flue/agents/*.ts files used the latter as a fallback).
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
        resolveModel,
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
