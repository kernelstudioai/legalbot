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
