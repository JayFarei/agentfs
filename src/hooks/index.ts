// Public barrel for the VFS hook registry.
//
// Importers should pull types and helpers from this file, not from the
// per-module files, so the internal layout can evolve without churning
// every callsite.

export { getInterfaceMode, hooksEnabled, type InterfaceMode } from "./mode.js";
export {
  HookRegistry,
  getHookRegistry,
  setHookRegistry,
  hookManifestFile,
  type HookLookup,
  type RegistryOpts,
} from "./registry.js";
export {
  freshManifest,
  hookDir,
  hookManifestPath,
  listManifests,
  readManifest,
  writeManifest,
} from "./manifest.js";
export { classifyQuarantine, errorMessage } from "./quarantine.js";
export { invokeHook, describeNotCallable, type InvokeHookArgs, type HookInvokeOutcome } from "./invoke.js";
export {
  emptyHookStats,
  type HookCallability,
  type HookImplementationKind,
  type HookMaturity,
  type HookQuarantineReason,
  type VfsHookManifest,
} from "./types.js";
