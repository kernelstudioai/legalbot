import { RuntimeDecision } from "../../contracts/index.ts";
import type { CanonicalEnvelopeType, RoutingDecisionType, RuntimeDecisionType } from "../../contracts/index.ts";
import type { ClientConsentPersistence } from "../client/clientRuntime.ts";
import { runClientRuntime } from "../client/clientRuntime.ts";
import type { RuntimeContext } from "./runtimeContext.ts";

export interface DecideNextActionInput {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeContext: RuntimeContext;
  clientConsentPersistence?: ClientConsentPersistence;
}

export const decideNextAction = ({
  envelope,
  routingDecision,
  runtimeContext,
  clientConsentPersistence
}: DecideNextActionInput): Promise<RuntimeDecisionType> => {
  if (runtimeContext.runtime === "client") {
    return runClientRuntime({
      envelope,
      ...(clientConsentPersistence
        ? {
            consentPersistence: clientConsentPersistence
          }
        : {})
    }).then((result) => result.runtimeDecision);
  }

  return Promise.resolve(
    RuntimeDecision.parse({
      actor: runtimeContext.runtime,
      action: routingDecision.targetRuntime === "drop" ? "ignore" : "acknowledge",
      rationale: `Prepared placeholder action for inbound message ${envelope.messageId}`
    })
  );
};
