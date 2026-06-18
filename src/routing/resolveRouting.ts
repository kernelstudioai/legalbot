import { RoutingDecision } from "../contracts/index.ts";
import type { CanonicalEnvelopeType, RoutingDecisionType } from "../contracts/index.ts";

export const resolveRouting = (
  envelope: CanonicalEnvelopeType
): RoutingDecisionType => {
  if (envelope.transportMetadata.fromMe) {
    return RoutingDecision.parse({
      targetRuntime: "drop",
      reason: "Ignoring self-authored messages",
      labels: ["self-message"]
    });
  }

  if (envelope.transportMetadata.actor === "lawyer") {
    return RoutingDecision.parse({
      targetRuntime: "lawyer",
      reason: "Inbound sender matched configured operator identity",
      labels: ["actor:lawyer"]
    });
  }

  return RoutingDecision.parse({
    targetRuntime: "client",
    reason: "Default placeholder routing for inbound client messages",
    labels: ["default-client-route"]
  });
};
