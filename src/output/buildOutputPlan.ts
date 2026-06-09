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
import { intakeMessageTemplates, isIntakeRuntimeAction } from "../runtime/client/intake.ts";

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

  const body =
    runtimeDecision.messageOverride ??
    (isConsentRuntimeAction(runtimeDecision.action)
      ? consentMessageTemplates[runtimeDecision.action]
      : isIntakeRuntimeAction(runtimeDecision.action)
        ? runtimeDecision.action === "intake_clarify_identity"
          ? runtimeDecision.messageOverride ?? "Per proseguire mi servono ancora alcuni dati."
          : intakeMessageTemplates[runtimeDecision.action]
        : `Placeholder response prepared for ${routingDecision.targetRuntime} runtime.`);

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
