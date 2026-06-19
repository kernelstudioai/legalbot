import { RuntimeDecision } from "../../contracts/index.ts";
import type { CanonicalEnvelopeType, RoutingDecisionType, RuntimeDecisionType } from "../../contracts/index.ts";
import type {
  ClientConsentPersistence,
  ClientIntakePersistence
} from "../client/clientRuntime.ts";
import type { PracticeCreationPersistence } from "../../domain/practices/practiceCreationService.ts";
import type { AiNormalizationProvider } from "../../domain/practices/aiNormalization.ts";
import { runClientRuntime } from "../client/clientRuntime.ts";
import { runLawyerRuntime, type LawyerRuntimeOptions } from "../lawyer/lawyerRuntime.ts";
import type { RuntimeContext } from "./runtimeContext.ts";

export interface DecideNextActionInput {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeContext: RuntimeContext;
  clientConsentPersistence?: ClientConsentPersistence;
  clientIntakePersistence?: ClientIntakePersistence;
  practicePersistence?: PracticeCreationPersistence;
  aiNormalizationProvider?: AiNormalizationProvider;
  lawyerRuntime?: LawyerRuntimeOptions;
  requireBusinessPersistence?: boolean;
}

export const decideNextAction = ({
  envelope,
  routingDecision,
  runtimeContext,
  clientConsentPersistence,
  clientIntakePersistence,
  practicePersistence,
  aiNormalizationProvider,
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
        : {}),
      ...(practicePersistence
        ? {
            practicePersistence
          }
        : {}),
      ...(aiNormalizationProvider
        ? {
            aiNormalizationProvider
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
        : {}),
      ...(lawyerRuntime?.listPractices
        ? {
            listPractices: lawyerRuntime.listPractices
          }
        : {}),
      ...(lawyerRuntime?.getPracticeByCode
        ? {
            getPracticeByCode: lawyerRuntime.getPracticeByCode
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
