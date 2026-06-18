import { RuntimeDecision } from "../../contracts/index.ts";
import type { CanonicalEnvelopeType, RoutingDecisionType, RuntimeDecisionType } from "../../contracts/index.ts";
import type {
  ClientConsentPersistence,
  ClientIntakePersistence
} from "../client/clientRuntime.ts";
import { runClientRuntime } from "../client/clientRuntime.ts";
import { runLawyerRuntime, type LawyerRuntimeOptions } from "../lawyer/lawyerRuntime.ts";
import type { RuntimeContext } from "./runtimeContext.ts";

export interface DecideNextActionInput {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeContext: RuntimeContext;
  clientConsentPersistence?: ClientConsentPersistence;
  clientIntakePersistence?: ClientIntakePersistence;
  lawyerRuntime?: LawyerRuntimeOptions;
  requireBusinessPersistence?: boolean;
}

export const decideNextAction = ({
  envelope,
  routingDecision,
  runtimeContext,
  clientConsentPersistence,
  clientIntakePersistence,
  lawyerRuntime,
  requireBusinessPersistence = false
}: DecideNextActionInput): Promise<RuntimeDecisionType> => {
  if (runtimeContext.runtime === "client") {
    return runClientRuntime({
      envelope,
      requireBusinessPersistence,
      ...(clientConsentPersistence
        ? {
            consentPersistence: clientConsentPersistence
          }
        : {}),
      ...(clientIntakePersistence
        ? {
            intakePersistence: clientIntakePersistence
          }
        : {})
    }).then((result) => result.runtimeDecision);
  }

  if (runtimeContext.runtime === "lawyer") {
    return runLawyerRuntime({
      envelope,
      ...(lawyerRuntime?.getStatus
        ? {
            getStatus: lawyerRuntime.getStatus
          }
        : {}),
      ...(lawyerRuntime?.listReadyIntakes
        ? {
            listReadyIntakes: lawyerRuntime.listReadyIntakes
          }
        : {})
    });
  }

  return Promise.resolve(
    RuntimeDecision.parse({
      actor: runtimeContext.runtime,
      action: routingDecision.targetRuntime === "drop" ? "ignore" : "acknowledge",
      rationale: `Prepared placeholder action for inbound message ${envelope.messageId}`
    })
  );
};
