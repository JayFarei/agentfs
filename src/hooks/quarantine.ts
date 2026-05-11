// Classify a hook-implementation failure into a structured reason.
//
// The classifier is intentionally string-pattern based: the underlying
// errors come from a mix of tsx's esbuild transform, Node's module
// loader, valibot schema parsing, and arbitrary user code. We trust
// the message rather than the constructor.

import type { HookQuarantineReason } from "./types.js";

export function classifyQuarantine(err: unknown): HookQuarantineReason {
  const msg = errorMessage(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("transform failed") ||
    lower.includes("syntaxerror") ||
    lower.includes("parse error")
  ) {
    return "transform_failure";
  }
  if (
    lower.includes("module does not export") ||
    lower.includes("does not provide an export") ||
    lower.includes("no such export") ||
    lower.includes("has no exported member") ||
    lower.includes("not exported")
  ) {
    return "missing_export";
  }
  if (lower.includes("schemavalidation") || lower.includes("schema_validation")) {
    return "schema_validation";
  }
  if (
    lower.includes("invalid_type") ||
    lower.includes("invalid type") ||
    lower.includes("expected") && lower.includes("received")
  ) {
    return "schema_validation";
  }
  if (
    lower.includes("typeerror") ||
    lower.includes("cannot read properties of") ||
    lower.includes("is not a function") ||
    lower.includes("is not iterable")
  ) {
    return "type_error";
  }
  if (lower.includes("referenceerror") || lower.includes("is not defined")) {
    return "reference_error";
  }
  if (
    lower.includes("missing") &&
    (lower.includes("payload") || lower.includes("response"))
  ) {
    return "payload_assumption";
  }
  if (lower.includes("payload for")) {
    return "payload_assumption";
  }
  if (lower.includes("quota") || lower.includes("rate limit") || lower.includes("token limit")) {
    return "quota_before_answer";
  }
  return "runtime_error";
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
