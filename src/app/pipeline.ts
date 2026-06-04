import type {
  CanonicalEnvelopeType,
  OutputPlanType,
  RoutingDecisionType,
  RuntimeDecisionType
} from "../contracts/index.ts";
import { normalizeInbound } from "../ingress/normalizeInbound.ts";
import { buildOutputPlan } from "../output/buildOutputPlan.ts";
import type { ClientConsentPersistence } from "../runtime/client/clientRuntime.ts";
import { resolveRouting } from "../routing/resolveRouting.ts";
import { decideNextAction } from "../runtime/shared/decideNextAction.ts";
import { deriveRuntimeContext } from "../runtime/shared/runtimeContext.ts";
import type { OpenWaMessage } from "../transport/openwa/types.ts";

export interface PipelineResult {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeDecision: RuntimeDecisionType;
  outputPlan: OutputPlanType;
}

export interface RunInboundPipelineOptions {
  clientConsentPersistence?: ClientConsentPersistence;
}

export const runInboundPipeline = async (
  rawMessage: OpenWaMessage,
  options: RunInboundPipelineOptions = {}
): Promise<PipelineResult> => {
  const envelope = normalizeInbound(rawMessage);
  const routingDecision = resolveRouting(envelope);
  const runtimeContext = deriveRuntimeContext(routingDecision);
  const runtimeDecision = await decideNextAction({
    envelope,
    routingDecision,
    runtimeContext,
    ...(options.clientConsentPersistence
      ? {
          clientConsentPersistence: options.clientConsentPersistence
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
