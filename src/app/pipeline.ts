import type {
  CanonicalEnvelopeType,
  OutputPlanType,
  RoutingDecisionType,
  RuntimeDecisionType
} from "../contracts";
import { normalizeInbound } from "../ingress/normalizeInbound";
import { buildOutputPlan } from "../output/buildOutputPlan";
import { resolveRouting } from "../routing/resolveRouting";
import { decideNextAction } from "../runtime/shared/decideNextAction";
import { deriveRuntimeContext } from "../runtime/shared/runtimeContext";
import type { OpenWaMessage } from "../transport/openwa/types";

export interface PipelineResult {
  envelope: CanonicalEnvelopeType;
  routingDecision: RoutingDecisionType;
  runtimeDecision: RuntimeDecisionType;
  outputPlan: OutputPlanType;
}

export const runInboundPipeline = (rawMessage: OpenWaMessage): PipelineResult => {
  const envelope = normalizeInbound(rawMessage);
  const routingDecision = resolveRouting(envelope);
  const runtimeContext = deriveRuntimeContext(routingDecision);
  const runtimeDecision = decideNextAction({
    envelope,
    routingDecision,
    runtimeContext
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
