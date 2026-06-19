import type {
  CanonicalEnvelopeType,
  OutputPlanType,
  RoutingDecisionType,
  RuntimeDecisionType
} from "../contracts/index.ts";
import { normalizeInbound } from "../ingress/normalizeInbound.ts";
import { buildOutputPlan } from "../output/buildOutputPlan.ts";
import type {
  ClientConsentPersistence,
  ClientIntakePersistence
} from "../runtime/client/clientRuntime.ts";
import type { PracticeCreationPersistence } from "../domain/practices/practiceCreationService.ts";
import type { AiNormalizationProvider } from "../domain/practices/aiNormalization.ts";
import type { LawyerRuntimeOptions } from "../runtime/lawyer/lawyerRuntime.ts";
import { resolveRouting } from "../routing/resolveRouting.ts";
import { decideNextAction } from "../runtime/shared/decideNextAction.ts";
import { deriveRuntimeContext } from "../runtime/shared/runtimeContext.ts";
import type { TransportInboundMessage } from "../transport/inboundMessage.ts";

export interface PipelineResult {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeDecision: RuntimeDecisionType;
  outputPlan: OutputPlanType;
}

export interface RunInboundPipelineOptions {
  clientConsentPersistence?: ClientConsentPersistence;
  clientIntakePersistence?: ClientIntakePersistence;
  practicePersistence?: PracticeCreationPersistence;
  aiNormalizationProvider?: AiNormalizationProvider;
  lawyerRuntime?: LawyerRuntimeOptions;
  requireBusinessPersistence?: boolean;
}

export const runInboundPipeline = async (
  rawMessage: TransportInboundMessage,
  options: RunInboundPipelineOptions = {}
): Promise<PipelineResult> => {
  const envelope = normalizeInbound(rawMessage);
  const routingDecision = resolveRouting(envelope);
  const runtimeContext = deriveRuntimeContext(routingDecision);
  const runtimeDecision = await decideNextAction({
    envelope,
    routingDecision,
    runtimeContext,
    requireBusinessPersistence: options.requireBusinessPersistence ?? false,
    ...(options.clientConsentPersistence
      ? {
          clientConsentPersistence: options.clientConsentPersistence
        }
      : {}),
    ...(options.clientIntakePersistence
      ? {
          clientIntakePersistence: options.clientIntakePersistence
        }
      : {}),
    ...(options.practicePersistence
      ? {
          practicePersistence: options.practicePersistence
        }
      : {}),
    ...(options.aiNormalizationProvider
      ? {
          aiNormalizationProvider: options.aiNormalizationProvider
        }
      : {}),
    ...(options.lawyerRuntime
      ? {
          lawyerRuntime: options.lawyerRuntime
        }
      : {})
  });
  const outputPlan = buildOutputPlan({
    envelope,
    routingDecision,
    runtimeDecision
  });

  return {
    envelope,
    routingDecision,
    runtimeDecision,
    outputPlan
  };
};
