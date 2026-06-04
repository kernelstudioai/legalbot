import { OutputPlan } from "../contracts/index.ts";
import type {
  CanonicalEnvelopeType,
  OutputPlanType,
  RoutingDecisionType,
  RuntimeDecisionType
} from "../contracts/index.ts";
import {
  consentMessageTemplates,
  isConsentRuntimeAction
} from "../runtime/client/consent.ts";

export interface BuildOutputPlanInput {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeDecision: RuntimeDecisionType;
}

export const buildOutputPlan = ({
  envelope,
  routingDecision,
  runtimeDecision
}: BuildOutputPlanInput): OutputPlanType => {
  if (runtimeDecision.action === "ignore") {
    return OutputPlan.parse({
      messages: [],
      auditNote: `Built output plan for ${envelope.messageId} using action ${runtimeDecision.action}`
    });
  }

  const body = isConsentRuntimeAction(runtimeDecision.action)
    ? consentMessageTemplates[runtimeDecision.action]
    : `Placeholder response prepared for ${routingDecision.targetRuntime} runtime.`;

  return OutputPlan.parse({
    messages: [
      {
        kind: "text",
        to: envelope.transportMetadata.chatId,
        body
      }
    ],
    auditNote: `Built output plan for ${envelope.messageId} using action ${runtimeDecision.action}`
  });
};
