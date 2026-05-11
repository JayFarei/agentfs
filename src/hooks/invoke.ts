// Safe hook invocation.
//
// Wraps a callable hook with the registry's fallback policy:
//   - If invocation throws, classify the failure, update stats, and
//     return a structured unsupported result instead of bubbling the
//     crash into the agent's episode.
//   - If invocation returns, update stats with success.
//
// The returned envelope mirrors the SDK's Result shape so the caller
// (df.lib proxy) can return it transparently without leaking hook
// machinery upward.

import { costZero, type DispatchContext, type Fn, type Result } from "../sdk/index.js";

import { classifyQuarantine, errorMessage } from "./quarantine.js";
import type { HookRegistry } from "./registry.js";
import type { HookCallability, VfsHookManifest } from "./types.js";

export type InvokeHookArgs = {
  registry: HookRegistry;
  manifest: VfsHookManifest;
  fn: Fn<unknown, unknown>;
  input: unknown;
  dispatch: DispatchContext;
  withFallback: boolean;
};

export type HookInvokeOutcome = {
  result: Result<unknown>;
  outcome: "success" | "unsupported" | "failure";
};

export async function invokeHook(args: InvokeHookArgs): Promise<HookInvokeOutcome> {
  const { registry, manifest, fn, input, dispatch, withFallback } = args;
  try {
    const result = (await fn(input, {
      tenant: dispatch.tenant,
      mount: dispatch.mount,
      cost: dispatch.cost,
      functionName: manifest.name,
      ...(dispatch.trajectory ? { trajectory: dispatch.trajectory } : {}),
      ...(dispatch.pins ? { pins: dispatch.pins } : {}),
      callStack: dispatch.callStack,
    })) as Result<unknown>;
    await registry.recordInvocation({
      tenantId: manifest.origin.tenantId,
      name: manifest.name,
      outcome: "success",
    });
    return { result, outcome: "success" };
  } catch (err) {
    const errorClass = classifyQuarantine(err);
    const message = errorMessage(err);
    if (!withFallback) {
      await registry.recordInvocation({
        tenantId: manifest.origin.tenantId,
        name: manifest.name,
        outcome: "failure",
        errorClass,
        errorMessage: message,
        // Without fallback, a runtime crash quarantines the implementation:
        // the registry should not keep offering it as callable.
        quarantineOnFailure: true,
      });
      throw err;
    }
    await registry.recordInvocation({
      tenantId: manifest.origin.tenantId,
      name: manifest.name,
      outcome: "unsupported",
      errorClass,
      errorMessage: message,
    });
    // Return a structured unsupported envelope. Callers can still
    // inspect `result.value` (a marker object) and decide how to
    // proceed.
    const unsupported = unsupportedEnvelope({
      manifest,
      errorClass,
      message,
      dispatch,
    });
    return { result: unsupported, outcome: "unsupported" };
  }
}

function unsupportedEnvelope(args: {
  manifest: VfsHookManifest;
  errorClass: string;
  message: string;
  dispatch: DispatchContext;
}): Result<unknown> {
  const value = {
    ok: false,
    unsupported: true,
    hook: args.manifest.name,
    reason: args.errorClass,
    message: args.message,
  };
  // We construct the envelope directly rather than going through
  // makeResult so we don't have to fabricate a trajectoryId — the proxy
  // already drives the wider trajectory recorder.
  return {
    value,
    mode: "novel",
    cost: costZero(),
    provenance: {
      tenant: args.dispatch.tenant,
      mount: args.dispatch.mount,
      functionName: args.manifest.name,
      trajectoryId: args.dispatch.trajectory?.id ?? "hook-unsupported",
      pins: args.dispatch.pins ?? {},
    },
    escalations: 0,
  };
}

export function describeNotCallable(callability: HookCallability): string {
  switch (callability) {
    case "quarantined":
      return "implementation is quarantined";
    case "not-callable":
      return "hook is observed only (no callable implementation)";
    case "callable-with-fallback":
    case "callable":
      return "callable";
    default:
      return "unknown";
  }
}
