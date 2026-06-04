import type {
  CanonicalEnvelopeType,
  OutputPlanType,
  RoutingDecisionType,
  RuntimeDecisionType
} from "../contracts/index.ts";
import { normalizeInbound } from "../ingress/normalizeInbound.ts";
import { buildOutputPlan } from "../output/buildOutputPlan.ts";
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
