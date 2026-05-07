// Runtime-level interfaces and the module-level singletons that other
// modules wire up at boot.
//
// The `fn({...})` factory in `./fn.ts` does not know how to dispatch
// LLM- or agent-bodied calls on its own; it asks a registered
// `BodyDispatcher` to handle them. Same idea for the `LibraryResolver`
// used by the snippet runtime when binding `df.lib.<name>`.
//
// This file is types + setters/getters. No business logic.
//
// ============================================================================
// Cost-accumulation contract
// ============================================================================
//
// `DispatchContext.cost` is a mutable accumulator. Every dispatcher (and any
// nested call below it) MUST follow these rules so the cost panel in Wave 6
// and the trajectory envelope in Wave 4 don't double-count or under-report.
//
//   tokens.{hot,cold}, ms.{hot,cold}, llmCalls
//     Additive. The dispatcher does:
//       ctx.cost.tokens.cold += tokensSpent;
//       ctx.cost.ms.cold     += msElapsed;
//       ctx.cost.llmCalls    += 1;
//     Nested calls add into the same accumulator; the outer fn() reads the
//     final totals when it builds the Result envelope.
//
//   tier
//     Max-observed. The dispatcher does:
//       ctx.cost.tier = Math.max(ctx.cost.tier, thisTier) as CostTier;
//     Rationale: a composition that touches a tier-3 LLM call should report
//     tier 3 in its envelope, not the average. The most expensive tier
//     touched is the one the user pays for cold-start-wise.
//
// The fn() factory only falls back to wall-clock `elapsedMs` when both
// `ms.hot` and `ms.cold` are still zero after dispatch returned. Any
// dispatcher that charges ms itself takes precedence over that fallback.
//
// ============================================================================

import type { Body } from "./body.js";
import type { Cost, Provenance } from "./result.js";
import type { TrajectoryRecorder } from "./trajectory.js";
import type { FnSpec, Fn } from "./fn.js";

// --- Dispatch context -------------------------------------------------------

// Shared context passed to a BodyDispatcher when the runtime executes a
// non-pure body. Mutable accumulator-style fields (`cost`) are intentional:
// the dispatcher charges to them; the fn() callable folds them into the
// final Result envelope.
//
// The snippet runtime (Wave 3) constructs one DispatchContext per snippet
// and threads it through every `df.lib.<name>(input, ctx)` call so that
// trajectory + cost + provenance flow through nested compositions.
export type DispatchContext = {
  tenant: string;
  mount: string;
  // The active trajectory recorder, if a snippet is being recorded.
  // For one-off direct calls outside a snippet, this MAY be undefined.
  trajectory?: TrajectoryRecorder;
  /**
   * Mutable cost accumulator. See the cost-accumulation contract at the top
   * of this file:
   *   - tokens / ms / llmCalls — additive (`ctx.cost.tokens.cold += ...`)
   *   - tier — max-observed
   *     (`ctx.cost.tier = Math.max(ctx.cost.tier, thisTier) as CostTier`)
   */
  cost: Cost;
  // Optional. The function being executed, if known. Surfaces in
  // provenance.functionName.
  functionName?: string;
  // Optional pins block to thread through to the result envelope. The
  // fn() factory defaults this to `{}` when absent so `Provenance.pins`
  // is always populated.
  pins?: Record<string, string>;
  // Stack of currently executing df.lib.* primitives. Diagnostics use this
  // to distinguish client-visible calls from nested implementation work
  // performed inside a learned interface.
  callStack?: string[];
};

export type Provenance_ = Provenance; // re-export-friendly alias to avoid cycles

// --- Body dispatcher --------------------------------------------------------

// A BodyDispatcher knows how to execute non-pure bodies (`llm({...})` and
// `agent({...})`). The pure-TS body shape is dispatched directly by the
// fn() factory and never reaches the dispatcher.
//
// In the MVP, the only implementation lives next to the in-process Flue
// session in src/runtime/. Tests can register a stub.
export type BodyDispatcher = {
  dispatch<I, O>(body: Body<I, O>, input: I, ctx: DispatchContext): Promise<O>;
};

// --- Library resolver -------------------------------------------------------

// A LibraryResolver knows how to find a Fn by name within a tenant's
// /lib/ overlay. Used by the snippet runtime to bind `df.lib.<name>`.
export type LibraryEntry = {
  name: string;
  spec: FnSpec<unknown, unknown>;
};

export type LibraryResolver = {
  resolve(tenant: string, name: string): Promise<Fn<unknown, unknown> | null>;
  list(tenant: string): Promise<LibraryEntry[]>;
};

// --- Module-level singletons ------------------------------------------------

let _bodyDispatcher: BodyDispatcher | null = null;
let _libraryResolver: LibraryResolver | null = null;

export function setBodyDispatcher(d: BodyDispatcher | null): void {
  _bodyDispatcher = d;
}

export function getBodyDispatcher(): BodyDispatcher | null {
  return _bodyDispatcher;
}

export function setLibraryResolver(r: LibraryResolver | null): void {
  _libraryResolver = r;
}

export function getLibraryResolver(): LibraryResolver | null {
  return _libraryResolver;
}
