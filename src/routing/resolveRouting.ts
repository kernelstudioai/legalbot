import { RoutingDecision } from "../contracts";
import type { CanonicalEnvelopeType, RoutingDecisionType } from "../contracts";

export const resolveRouting = (
  envelope: CanonicalEnvelopeType
): RoutingDecisionType => {
  const normalizedBody = envelope.body.toLowerCase();

  if (envelope.transportMetadata.fromMe) {
    return RoutingDecision.parse({
      targetRuntime: "drop",
      reason: "Ignoring self-authored messages",
      labels: ["self-message"]
    });
  }

  if (normalizedBody.includes("lawyer")) {
    return RoutingDecision.parse({
      targetRuntime: "lawyer",
      reason: "Inbound text explicitly mentions lawyer routing",
      labels: ["keyword:lawyer"]
    });
  }

  return RoutingDecision.parse({
    targetRuntime: "client",
    reason: "Default placeholder routing for inbound client messages",
    labels: ["default-client-route"]
  });
};
