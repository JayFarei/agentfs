import { atlasfsHome } from "../../trajectory/recorder.js";
import { primitiveRegistry } from "./registry.js";
import { LocalFunctionStore } from "./learned_functions.js";
import { LocalLearnedAgentStore } from "../../agents/learned_store.js";
import type { PlannerCapabilities } from "../../planner/types.js";

/**
 * Snapshot the full set of typed callables visible to the planner for a tenant:
 * - boot-time primitives from the registry,
 * - learned TS functions previously codified by the observer,
 * - learned Flue agents previously minted by the observer (the parallel store,
 *   not the legacy outlook spec).
 *
 * The legacy outlook flow's `OutlookScorerAgentSpec` is intentionally NOT
 * included here — it has its own dispatch path and is dispatched by the
 * existing `isNegativeOutlookReferencesIntent` predicate.
 */
export async function getCapabilities(
  tenantId: string,
  baseDir = atlasfsHome()
): Promise<PlannerCapabilities> {
  const fnStore = new LocalFunctionStore(baseDir);
  const agentStore = new LocalLearnedAgentStore(baseDir);
  const [learnedFns, learnedAgents] = await Promise.all([
    fnStore.list(tenantId),
    agentStore.list(tenantId),
  ]);

  return {
    primitives: primitiveRegistry.map((p) => ({
      name: p.name,
      signature: p.signature,
      description: p.description,
      implementation: p.implementation,
    })),
    learnedFunctions: learnedFns.map((fn) => ({
      name: fn.name,
      signature: fn.signature,
      description: fn.description,
    })),
    learnedAgents: learnedAgents.map((a) => ({
      name: a.agentName,
      capability: a.capability,
      description: a.description,
    })),
  };
}
