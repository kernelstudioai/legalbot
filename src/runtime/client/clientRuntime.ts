import { randomUUID } from "node:crypto";
import type { CanonicalEnvelopeType, RuntimeDecisionType } from "../../contracts/index.ts";
import type {
  AppendConsentEventInput,
  AppendIntakeEventInput,
  ConsentState,
  IntakeFieldName,
  IntakeSnapshot,
  IntakeState,
  SetConsentStateMetadata
} from "../../persistence/index.ts";
import type { RuntimeContext } from "../shared/runtimeContext.ts";
import { resolveConsentRuntimeDecision } from "./consent.ts";
import {
  createPracticeCreationService,
  type PracticeCreationPersistence
} from "../../domain/practices/practiceCreationService.ts";
import type { AiNormalizationProvider } from "../../domain/practices/aiNormalization.ts";
import type { ClientIntakeRecord, SetClientIntakeRecordInput } from "./intake.ts";
import { resolveClientIntakeRuntimeDecision } from "./intake.ts";

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

export interface ClientIntakePersistence {
  getIntakeState(subjectId: string): Promise<IntakeState>;
  getIntakeSnapshot(subjectId: string): Promise<IntakeSnapshot | null>;
  setIntakeState(
    subjectId: string,
    state: IntakeState,
    metadata?: {
      updatedAt?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<unknown>;
  setIntakeField(
    subjectId: string,
    fieldName: IntakeFieldName,
    value: string,
    metadata?: {
      updatedAt?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<unknown>;
  appendIntakeEvent(event: AppendIntakeEventInput): Promise<unknown>;
}

export interface RunClientRuntimeInput {
  envelope: CanonicalEnvelopeType;
  consentPersistence?: ClientConsentPersistence;
  intakePersistence?: ClientIntakePersistence;
  practicePersistence?: PracticeCreationPersistence;
  aiNormalizationProvider?: AiNormalizationProvider;
  requireBusinessPersistence?: boolean;
}

export interface RunClientRuntimeResult {
  subjectId: string;
  consentState: ConsentState;
  runtimeDecision: RuntimeDecisionType;
}

const deriveConsentSubjectId = (envelope: CanonicalEnvelopeType): string =>
  envelope.transportMetadata.chatId;

const buildPracticeCreatedMessage = (practiceCode: string): string =>
  `La ringrazio. La richiesta e stata registrata come pratica ${practiceCode}. Lo studio la revisionera e La contattera se servono integrazioni. Non Le sto fornendo consulenza legale.`;

const buildConsentMetadata = (
  envelope: CanonicalEnvelopeType
): Record<string, unknown> => ({
  channel: envelope.channel,
  messageId: envelope.messageId,
  subjectIdSource: "transport.chatId",
  runtime: "client"
});

const buildIntakeMetadata = (
  envelope: CanonicalEnvelopeType
): Record<string, unknown> => ({
  channel: envelope.channel,
  messageId: envelope.messageId,
  subjectIdSource: "transport.chatId",
  runtime: "client"
});

const toClientIntakeRecord = (snapshot: IntakeSnapshot | null): ClientIntakeRecord | null =>
  snapshot
    ? {
        subjectId: snapshot.subjectId,
        state: snapshot.state,
        updatedAt: snapshot.updatedAt,
        ...(snapshot.fields.firstName ? { firstName: snapshot.fields.firstName } : {}),
        ...(snapshot.fields.lastName ? { lastName: snapshot.fields.lastName } : {}),
        ...(snapshot.fields.birthDate ? { birthDate: snapshot.fields.birthDate } : {}),
        ...(snapshot.fields.city ? { city: snapshot.fields.city } : {}),
        ...(snapshot.fields.problemSummary
          ? {
              problemSummary: snapshot.fields.problemSummary
            }
          : {}),
        ...(snapshot.fields.attachmentMetadata
          ? {
              attachmentMetadata: snapshot.fields.attachmentMetadata
            }
          : {})
      }
    : null;

const persistIntakeRecord = async (
  intakePersistence: ClientIntakePersistence,
  envelope: CanonicalEnvelopeType,
  currentRecord: ClientIntakeRecord | null,
  nextRecord: SetClientIntakeRecordInput
): Promise<void> => {
  const metadata = buildIntakeMetadata(envelope);
  const currentState = currentRecord?.state ?? "not_started";

  if (currentState !== nextRecord.state) {
    await intakePersistence.setIntakeState(nextRecord.subjectId, nextRecord.state, {
      ...(nextRecord.updatedAt ? { updatedAt: nextRecord.updatedAt } : {}),
      metadata
    });
    await intakePersistence.appendIntakeEvent({
      eventId: randomUUID(),
      subjectId: nextRecord.subjectId,
      eventType: "intake_state_updated",
      state: nextRecord.state,
      ...(nextRecord.updatedAt ? { occurredAt: nextRecord.updatedAt } : {}),
      metadata
    });
  }

  for (const fieldName of [
    "firstName",
    "lastName",
    "birthDate",
    "city",
    "problemSummary",
    "attachmentMetadata"
  ] as const) {
    const nextValue = nextRecord[fieldName];
    const currentValue = currentRecord?.[fieldName];

    if (!nextValue || currentValue === nextValue) {
      continue;
    }

    await intakePersistence.setIntakeField(nextRecord.subjectId, fieldName, nextValue, {
      ...(nextRecord.updatedAt ? { updatedAt: nextRecord.updatedAt } : {}),
      metadata
    });
    await intakePersistence.appendIntakeEvent({
      eventId: randomUUID(),
      subjectId: nextRecord.subjectId,
      eventType: "intake_field_accepted",
      state: nextRecord.state,
      fieldName,
      ...(nextRecord.updatedAt ? { occurredAt: nextRecord.updatedAt } : {}),
      metadata
    });
  }
};

export const runClientRuntime = async ({
  envelope,
  consentPersistence,
  intakePersistence,
  practicePersistence,
  aiNormalizationProvider,
  requireBusinessPersistence = false
}: RunClientRuntimeInput): Promise<RunClientRuntimeResult> => {
  if (requireBusinessPersistence && (!consentPersistence || !intakePersistence)) {
    throw new Error(
      "Business persistence is required for client runtime. Provide explicit consent and intake persistence."
    );
  }

  const subjectId = deriveConsentSubjectId(envelope);
  const currentConsentState = consentPersistence
    ? await consentPersistence.getConsentState(subjectId)
    : "unknown";
  const consentDecision = resolveConsentRuntimeDecision({
    consentState: currentConsentState,
    inboundText: envelope.body
  });

  if (consentPersistence) {
    if (currentConsentState === "unknown" && consentDecision.consentState === "requested") {
      await consentPersistence.setConsentState(subjectId, "requested", {
        metadata: buildConsentMetadata(envelope)
      });
    }

    if (currentConsentState !== "granted" && consentDecision.consentState === "granted") {
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

    if (currentConsentState !== "denied" && consentDecision.consentState === "denied") {
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

  if (consentDecision.consentState !== "granted") {
    return {
      subjectId,
      consentState: consentDecision.consentState,
      runtimeDecision: consentDecision.runtimeDecision
    };
  }

  const existingPracticeForMessage = practicePersistence
    ? await practicePersistence.findPracticeBySourceMessageId(envelope.messageId)
    : null;

  if (existingPracticeForMessage) {
    return {
      subjectId,
      consentState: consentDecision.consentState,
      runtimeDecision: {
        actor: "client",
        action: "intake_complete_ack",
        rationale: "Duplicate intake completion message matched an existing practice",
        messageOverride: buildPracticeCreatedMessage(existingPracticeForMessage.practiceCode)
      }
    };
  }

  const intakeSnapshot = intakePersistence
    ? await intakePersistence.getIntakeSnapshot(subjectId)
    : null;
  const intakeRecord = toClientIntakeRecord(intakeSnapshot);
  const intakeDecision = resolveClientIntakeRuntimeDecision({
    subjectId,
    intakeRecord,
    inboundText: envelope.body,
    consentJustGranted:
      currentConsentState !== "granted" && consentDecision.consentState === "granted",
    ...(aiNormalizationProvider
      ? {
          aiNormalizationProvider
        }
      : {}),
    ...(envelope.attachments
      ? {
          attachments: envelope.attachments
        }
      : {})
  });

  if (intakePersistence && intakeDecision.nextRecord) {
    await persistIntakeRecord(intakePersistence, envelope, intakeRecord, intakeDecision.nextRecord);
  }

  if (practicePersistence && intakeDecision.nextRecord?.state === "intake_complete") {
    const practiceCreation = createPracticeCreationService({
      persistence: practicePersistence,
      ...(aiNormalizationProvider
        ? {
            aiNormalizationProvider
          }
        : {})
    });
    const result = await practiceCreation.createPracticeFromCompletedIntake({
      subjectId,
      sourceMessageId: envelope.messageId
    });

    return {
      subjectId,
      consentState: consentDecision.consentState,
      runtimeDecision: {
        ...intakeDecision.runtimeDecision,
        messageOverride: buildPracticeCreatedMessage(result.practiceRecord.practiceCode)
      }
    };
  }

  return {
    subjectId,
    consentState: consentDecision.consentState,
    runtimeDecision: intakeDecision.runtimeDecision
  };
};
