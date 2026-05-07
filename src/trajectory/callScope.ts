import type { PrimitiveCallRecord } from "./recorder.js";

export type NestedCallSummary = {
  primitive: string;
  parent: string;
  root: string;
  depth: number;
};

export type NestedCallRootSummary = {
  root: string;
  count: number;
};

export type CallScopeSummary = {
  clientCallPrimitives: string[];
  nestedCallPrimitives: string[];
  nestedCalls: NestedCallSummary[];
  nestedByRoot: NestedCallRootSummary[];
};

export function summarizeCallScopes(
  calls: PrimitiveCallRecord[],
): CallScopeSummary {
  const clientCallPrimitives: string[] = [];
  const nestedCalls: NestedCallSummary[] = [];

  for (const call of calls) {
    const depth = call.scope?.depth ?? 0;
    if (depth <= 0) {
      clientCallPrimitives.push(call.primitive);
      continue;
    }
    nestedCalls.push({
      primitive: call.primitive,
      parent: call.scope?.parentPrimitive ?? "unknown",
      root: call.scope?.rootPrimitive ?? "unknown",
      depth,
    });
  }

  const rootCounts = new Map<string, number>();
  for (const call of nestedCalls) {
    rootCounts.set(call.root, (rootCounts.get(call.root) ?? 0) + 1);
  }

  return {
    clientCallPrimitives,
    nestedCallPrimitives: nestedCalls.map((call) => call.primitive),
    nestedCalls,
    nestedByRoot: [...rootCounts.entries()].map(([root, count]) => ({
      root,
      count,
    })),
  };
}
