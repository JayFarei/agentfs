// VFS hook registry — types.
//
// A "hook" is the public, command-shaped affordance attached to the
// virtual dataset filesystem. The hook is the contract; an
// "implementation" is the body behind it. Skills are interim bodies, not
// the public artifact. The hook registry — not the observer's authored
// .ts file — owns public callability of df.lib.<name>.
//
// See docs/hook-registry-experiment.md for framing and design intent.

export type HookMaturity =
  | "observed"
  | "draft-agentic"
  | "candidate-typescript"
  | "validated-typescript"
  | "provider-native";

export type HookCallability =
  | "not-callable"
  | "callable-with-fallback"
  | "callable"
  | "quarantined";

export type HookImplementationKind =
  | "none"
  | "skill"
  | "typescript"
  | "adapter"
  | "provider";

export type HookQuarantineReason =
  | "missing_export"
  | "transform_failure"
  | "reference_error"
  | "type_error"
  | "schema_validation"
  | "payload_assumption"
  | "quota_before_answer"
  | "runtime_error";

export type VfsHookManifest = {
  name: string;
  path: string;
  intent: string;

  inputSchemaRef?: string;
  outputSchemaRef?: string;
  evidencePolicy: "required" | "optional" | "none";

  maturity: HookMaturity;
  callability: HookCallability;

  implementation: {
    kind: HookImplementationKind;
    ref?: string;
  };

  origin: {
    tenantId: string;
    sourceId?: string;
    trajectoryIds: string[];
    shapeHash?: string;
    createdAt: string;
    updatedAt: string;
  };

  stats: {
    attempts: number;
    successes: number;
    validationFailures: number;
    runtimeErrors: number;
    quotaFailures: number;
    replaysPassed: number;
    replaysFailed: number;
    abstentions: number;
  };

  quarantine?: {
    reason: HookQuarantineReason;
    message: string;
    firstSeenAt: string;
    lastSeenAt: string;
  };
};

export function emptyHookStats(): VfsHookManifest["stats"] {
  return {
    attempts: 0,
    successes: 0,
    validationFailures: 0,
    runtimeErrors: 0,
    quotaFailures: 0,
    replaysPassed: 0,
    replaysFailed: 0,
    abstentions: 0,
  };
}
