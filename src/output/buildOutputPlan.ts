import { OutputPlan } from "../contracts";
import type {
  CanonicalEnvelopeType,
  OutputPlanType,
  RoutingDecisionType,
  RuntimeDecisionType
} from "../contracts";

export interface BuildOutputPlanInput {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeDecision: RuntimeDecisionType;
}

export const buildOutputPlan = ({
  envelope,
  routingDecision,
  runtimeDecision
}: BuildOutputPlanInput): OutputPlanType =>
  OutputPlan.parse({
    messages:
      runtimeDecision.action === "ignore"
        ? []
        : [
            {
              kind: "text",
              to: envelope.transportMetadata.chatId,
              body: `Placeholder response prepared for ${routingDecision.targetRuntime} runtime.`
            }
          ],
    auditNote: `Built output plan for ${envelope.messageId} using action ${runtimeDecision.action}`
  });
