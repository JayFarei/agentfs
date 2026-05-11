// Interface mode flag.
//
// DATAFETCH_INTERFACE_MODE controls how the VFS hook registry exposes
// learned interfaces as df.lib.<name> callables. The default
// ("hooks-candidate-only") keeps the registry in the hot path but does
// not expose any draft callable — every learned interface lives as a
// hook record only. Set DATAFETCH_INTERFACE_MODE=legacy to bypass the
// registry entirely (the resolver answers df.lib.<name> directly, the
// old behavior).
//
// Modes:
//   legacy                  resolver answers df.lib.<name> directly; no
//                           hook records, no fallback. Matches pre-hooks
//                           behavior.
//   hooks-candidate-only    hook records always created; nothing is
//                           callable (every hook stays "observed"
//                           publicly). The eval baseline that isolates
//                           "learned interfaces never reach the agent".
//   hooks-draft             callable-with-fallback: validated TypeScript
//                           and draft-agentic implementations are
//                           callable, but every invocation is wrapped so
//                           runtime crashes are converted to structured
//                           unsupported.
//   hooks-validated-only    only validated-typescript / provider-native
//                           implementations are exposed as callable.
//                           Draft / candidate implementations are
//                           recorded but not invokable.

export type InterfaceMode =
  | "legacy"
  | "hooks-candidate-only"
  | "hooks-draft"
  | "hooks-validated-only";

const DEFAULT_INTERFACE_MODE: InterfaceMode = "hooks-candidate-only";

const KNOWN: Set<InterfaceMode> = new Set([
  "legacy",
  "hooks-candidate-only",
  "hooks-draft",
  "hooks-validated-only",
]);

export function getInterfaceMode(): InterfaceMode {
  const raw = process.env["DATAFETCH_INTERFACE_MODE"];
  if (raw && KNOWN.has(raw as InterfaceMode)) {
    return raw as InterfaceMode;
  }
  // Compatibility shim: DATAFETCH_HOOKS=1 selects the candidate-only
  // mode; DATAFETCH_HOOKS=0 forces legacy.
  const flag = process.env["DATAFETCH_HOOKS"];
  if (flag === "0" || flag === "false") return "legacy";
  if (flag === "1" || flag === "true") return "hooks-candidate-only";
  return DEFAULT_INTERFACE_MODE;
}

export function hooksEnabled(): boolean {
  return getInterfaceMode() !== "legacy";
}
