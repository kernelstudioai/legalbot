import { randomUUID } from "node:crypto";
import type {
  AuditEventRecord,
  PersistenceService,
  PracticeAttachmentMetadata,
  PracticeRecord
} from "../../persistence/index.ts";
import { toOperatorSubjectId } from "../../persistence/index.ts";
import {
  validateAcceptedBirthDate,
  validateAcceptedCity,
  validateAcceptedFirstName,
  validateAcceptedLastName,
  validateAcceptedProblemSummary
} from "../intake/acceptedFields.ts";
import { validateAiIssueSummary, type AiNormalizationProvider } from "./aiNormalization.ts";

export type PracticeCreationPersistence = Pick<
  PersistenceService,
  "allocatePracticeCode"
    | "appendAuditEvent"
    | "createPractice"
    | "findPracticeBySourceMessageId"
    | "getConsentState"
    | "getIntakeSnapshot"
    | "runInTransaction"
>;

export interface CreatePracticeCreationServiceOptions {
  persistence: PracticeCreationPersistence;
  aiNormalizationProvider?: AiNormalizationProvider;
  now?: () => string;
}

export interface CreatePracticeFromCompletedIntakeInput {
  subjectId: string;
  sourceMessageId: string;
}

export interface CreatePracticeFromCompletedIntakeResult {
  practiceRecord: PracticeRecord;
  auditEvent: AuditEventRecord;
  idempotent: boolean;
}

export interface PracticeCreationService {
  createPracticeFromCompletedIntake(
    input: CreatePracticeFromCompletedIntakeInput
  ): Promise<CreatePracticeFromCompletedIntakeResult>;
}

export class PracticeCreationPreconditionError extends Error {
  readonly code:
    | "consent_not_granted"
    | "intake_not_complete"
    | "missing_first_name"
    | "missing_last_name"
    | "missing_birth_date"
    | "missing_city"
    | "missing_legal_issue"
    | "invalid_first_name"
    | "invalid_last_name"
    | "invalid_birth_date"
    | "invalid_city"
    | "invalid_legal_issue"
    | "invalid_attachment_metadata";

  constructor(code: PracticeCreationPreconditionError["code"], message: string) {
    super(message);
    this.name = "PracticeCreationPreconditionError";
    this.code = code;
  }
}

const acceptedFieldNames = [
  "firstName",
  "lastName",
  "birthDate",
  "city",
  "problemSummary",
  "attachmentMetadata"
] as const;

const requireValidated = (
  value: string | undefined,
  missingCode: PracticeCreationPreconditionError["code"],
  invalidCode: PracticeCreationPreconditionError["code"],
  validate: (value: string | undefined) => { valid: true; value: string } | { valid: false }
): string => {
  if (value === undefined) {
    throw new PracticeCreationPreconditionError(missingCode, `${missingCode} is required`);
  }

  const parsed = validate(value);

  if (!parsed.valid) {
    throw new PracticeCreationPreconditionError(invalidCode, `${invalidCode} is invalid`);
  }

  return parsed.value;
};

const parseAttachmentMetadata = (value: string | undefined): PracticeAttachmentMetadata[] => {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PracticeCreationPreconditionError(
      "invalid_attachment_metadata",
      "Attachment metadata must be valid JSON"
    );
  }

  if (!Array.isArray(parsed)) {
    throw new PracticeCreationPreconditionError(
      "invalid_attachment_metadata",
      "Attachment metadata must be an array"
    );
  }

  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const kind = record.kind;

    if (kind !== "audio" && kind !== "document" && kind !== "image" && kind !== "video") {
      return [];
    }

    return [
      {
        kind,
        ...(typeof record.providerMediaId === "string" && record.providerMediaId.length > 0
          ? { providerMediaId: record.providerMediaId }
          : {}),
        ...(typeof record.mimeType === "string" && record.mimeType.length > 0
          ? { mimeType: record.mimeType }
          : {}),
        ...(typeof record.fileName === "string" && record.fileName.length > 0
          ? { fileName: record.fileName }
          : {}),
        ...(typeof record.sha256 === "string" && record.sha256.length > 0
          ? { sha256: record.sha256 }
          : {}),
        ...(typeof record.receivedAt === "string" && record.receivedAt.length > 0
          ? { receivedAt: record.receivedAt }
          : {})
      }
    ];
  });
};

export const createPracticeCreationService = ({
  persistence,
  aiNormalizationProvider,
  now = () => new Date().toISOString()
}: CreatePracticeCreationServiceOptions): PracticeCreationService => ({
  async createPracticeFromCompletedIntake({ subjectId, sourceMessageId }) {
    return persistence.runInTransaction(async () => {
      const existingPractice = await persistence.findPracticeBySourceMessageId(sourceMessageId);

      if (existingPractice) {
        const auditEvent = await persistence.appendAuditEvent({
          eventId: `audit-practice-create-idempotent-hit-${randomUUID()}`,
          eventType: "practice_create_idempotent_hit",
          entityType: "practice",
          entityId: existingPractice.practiceCode,
          occurredAt: now(),
          metadata: {
            source: "completed_intake",
            existingStatus: existingPractice.status,
            acceptedFieldNames
          }
        });

        return {
          practiceRecord: existingPractice,
          auditEvent,
          idempotent: true
        };
      }

      const consentState = await persistence.getConsentState(subjectId);

      if (consentState !== "granted") {
        throw new PracticeCreationPreconditionError(
          "consent_not_granted",
          `Consent must be granted before creating a practice. Received: ${consentState}`
        );
      }

      const intakeSnapshot = await persistence.getIntakeSnapshot(subjectId);

      if (intakeSnapshot?.state !== "intake_complete") {
        throw new PracticeCreationPreconditionError(
          "intake_not_complete",
          "Intake must be complete before creating a practice"
        );
      }

      const firstName = requireValidated(
        intakeSnapshot.fields.firstName,
        "missing_first_name",
        "invalid_first_name",
        validateAcceptedFirstName
      );
      const lastName = requireValidated(
        intakeSnapshot.fields.lastName,
        "missing_last_name",
        "invalid_last_name",
        validateAcceptedLastName
      );
      const birthDate = requireValidated(
        intakeSnapshot.fields.birthDate,
        "missing_birth_date",
        "invalid_birth_date",
        validateAcceptedBirthDate
      );
      const city = requireValidated(
        intakeSnapshot.fields.city,
        "missing_city",
        "invalid_city",
        validateAcceptedCity
      );
      const legalIssueText = requireValidated(
        intakeSnapshot.fields.problemSummary,
        "missing_legal_issue",
        "invalid_legal_issue",
        validateAcceptedProblemSummary
      );
      const attachmentMetadata = parseAttachmentMetadata(intakeSnapshot.fields.attachmentMetadata);
      const cleanedIssue = aiNormalizationProvider
        ? validateAiIssueSummary(
            aiNormalizationProvider.summarizeLegalIssue({
              legalIssueText
            })
          )
        : null;
      const createdAt = now();
      const practiceCode = await persistence.allocatePracticeCode();
      const practiceRecord = await persistence.createPractice({
        practiceCode,
        subjectId,
        status: "draft",
        clientFirstName: firstName,
        clientLastName: lastName,
        birthDate,
        city,
        subjectRef: toOperatorSubjectId(subjectId),
        legalIssueText,
        ...(cleanedIssue?.cleanedIssueText
          ? {
              cleanedIssueText: cleanedIssue.cleanedIssueText
            }
          : {}),
        attachmentMetadata,
        sourceMessageId,
        createdAt,
        updatedAt: createdAt
      });
      const completionEvent = await persistence.appendAuditEvent({
        eventId: `audit-client-intake-completed-${sourceMessageId}`,
        eventType: "client_intake_completed",
        entityType: "intake",
        entityId: subjectId,
        occurredAt: createdAt,
        metadata: {
          acceptedFieldNames
        }
      });

      await persistence.appendAuditEvent({
        eventId: `audit-practice-created-from-intake-${practiceCode}`,
        eventType: "practice_created_from_intake",
        entityType: "practice",
        entityId: practiceCode,
        occurredAt: createdAt,
        metadata: {
          source: "completed_intake",
          consentState: "granted",
          intakeState: "intake_complete",
          acceptedFieldNames,
          attachmentCount: attachmentMetadata.length
        }
      });

      return {
        practiceRecord,
        auditEvent: completionEvent,
        idempotent: false
      };
    });
  }
});
