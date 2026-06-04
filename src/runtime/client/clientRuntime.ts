import { randomUUID } from "node:crypto";
import type { CanonicalEnvelopeType, RuntimeDecisionType } from "../../contracts/index.ts";
import type {
  AppendConsentEventInput,
  ConsentState,
  SetConsentStateMetadata
} from "../../persistence/index.ts";
import type { RuntimeContext } from "../shared/runtimeContext.ts";
import { resolveConsentRuntimeDecision } from "./consent.ts";

export const clientRuntimeContext: RuntimeContext = {
  runtime: "client"
};

export interface ClientConsentPersistence {
  getConsentState(subjectId: string): Promise<ConsentState>;
  setConsentState(
    subjectId: string,
    state: ConsentState,
    metadata?: SetConsentStateMetadata
  ): Promise<unknown>;
  appendConsentEvent(event: AppendConsentEventInput): Promise<unknown>;
}

export interface RunClientRuntimeInput {
  envelope: CanonicalEnvelopeType;
  consentPersistence?: ClientConsentPersistence;
}

export interface RunClientRuntimeResult {
  subjectId: string;
  consentState: ConsentState;
  runtimeDecision: RuntimeDecisionType;
}

const deriveConsentSubjectId = (envelope: CanonicalEnvelopeType): string =>
  envelope.transportMetadata.chatId;

const buildConsentMetadata = (
  envelope: CanonicalEnvelopeType
): Record<string, unknown> => ({
  channel: envelope.channel,
  messageId: envelope.messageId,
  subjectIdSource: "transport.chatId",
  runtime: "client"
});

export const runClientRuntime = async ({
  envelope,
  consentPersistence
}: RunClientRuntimeInput): Promise<RunClientRuntimeResult> => {
  const subjectId = deriveConsentSubjectId(envelope);
  const currentConsentState = consentPersistence
    ? await consentPersistence.getConsentState(subjectId)
    : "unknown";
  const decision = resolveConsentRuntimeDecision({
    consentState: currentConsentState,
    inboundText: envelope.body
  });

  if (consentPersistence) {
    if (currentConsentState === "unknown" && decision.consentState === "requested") {
      await consentPersistence.setConsentState(subjectId, "requested", {
        metadata: buildConsentMetadata(envelope)
      });
    }

    if (currentConsentState === "requested" && decision.consentState === "granted") {
      await consentPersistence.setConsentState(subjectId, "granted", {
        metadata: buildConsentMetadata(envelope)
      });
      await consentPersistence.appendConsentEvent({
        eventId: randomUUID(),
        subjectId,
        state: "granted",
        eventType: "consent_granted",
        metadata: buildConsentMetadata(envelope)
      });
    }

    if (currentConsentState === "requested" && decision.consentState === "denied") {
      await consentPersistence.setConsentState(subjectId, "denied", {
        metadata: buildConsentMetadata(envelope)
      });
      await consentPersistence.appendConsentEvent({
        eventId: randomUUID(),
        subjectId,
        state: "denied",
        eventType: "consent_denied",
        metadata: buildConsentMetadata(envelope)
      });
    }
  }

  return {
    subjectId,
    consentState: decision.consentState,
    runtimeDecision: decision.runtimeDecision
  };
};
