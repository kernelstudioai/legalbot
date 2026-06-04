import type { RoutingDecisionType } from "../../contracts";

export interface RuntimeContext {
  runtime: "client" | "lawyer" | "shared";
}

export const deriveRuntimeContext = (
  routingDecision: RoutingDecisionType
): RuntimeContext => {
  if (routingDecision.targetRuntime === "drop") {
    return { runtime: "shared" };
  }

  return { runtime: routingDecision.targetRuntime };
};
