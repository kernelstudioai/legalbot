import { RuntimeDecision } from "../../contracts";
import type { CanonicalEnvelopeType, RoutingDecisionType, RuntimeDecisionType } from "../../contracts";
import type { RuntimeContext } from "./runtimeContext";

export interface DecideNextActionInput {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeContext: RuntimeContext;
}

export const decideNextAction = ({
  envelope,
  routingDecision,
  runtimeContext
}: DecideNextActionInput): RuntimeDecisionType =>
  RuntimeDecision.parse({
    actor: runtimeContext.runtime,
    action: routingDecision.targetRuntime === "drop" ? "ignore" : "acknowledge",
    rationale: `Prepared placeholder action for inbound message ${envelope.messageId}`
  });
