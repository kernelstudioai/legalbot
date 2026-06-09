import { createHash, randomUUID } from "node:crypto";
import type { AuditEventRecord, CaseRecord, CreateCaseInput, PersistenceService } from "../../persistence/index.ts";
import {
  buildAcceptedDisplayName,
  validateAcceptedBirthDate,
  validateAcceptedCity,
  validateAcceptedFirstName,
  validateAcceptedLastName,
  validateAcceptedProblemSummary
} from "../intake/acceptedFields.ts";

export type CaseCreationPersistence = Pick<
  PersistenceService,
  "appendAuditEvent"
    | "createCaseWithAudit"
    | "findDraftCaseBySubjectId"
    | "getConsentState"
    | "getIntakeSnapshot"
    | "runInTransaction"
>;

export interface CaseReferenceGeneratorInput {
  subjectId: string;
  createdAt: string;
  firstName: string;
  lastName: string;
  problemSummary: string;
}

export interface CaseReferenceGenerator {
  generate(input: CaseReferenceGeneratorInput): string;
}

export interface CreateCaseCreationServiceOptions {
  persistence: CaseCreationPersistence;
  caseReferenceGenerator?: CaseReferenceGenerator;
  now?: () => string;
}

export interface CreateCaseFromCompletedIntakeResult {
  caseRecord: CaseRecord;
  auditEvent: AuditEventRecord;
}

export class CaseCreationPreconditionError extends Error {
  readonly code:
    | "consent_not_granted"
    | "intake_not_complete"
    | "missing_first_name"
    | "missing_last_name"
    | "missing_birth_date"
    | "missing_city"
    | "missing_problem_summary"
    | "invalid_first_name"
    | "invalid_last_name"
    | "invalid_birth_date"
    | "invalid_city"
    | "invalid_problem_summary";

  constructor(
    code:
      | "consent_not_granted"
      | "intake_not_complete"
      | "missing_first_name"
      | "missing_last_name"
      | "missing_birth_date"
      | "missing_city"
      | "missing_problem_summary"
      | "invalid_first_name"
      | "invalid_last_name"
      | "invalid_birth_date"
      | "invalid_city"
      | "invalid_problem_summary",
    message: string
  ) {
    super(message);
    this.name = "CaseCreationPreconditionError";
    this.code = code;
  }
}

const defaultCaseReferenceGenerator: CaseReferenceGenerator = {
  generate({ subjectId, createdAt, firstName, lastName, problemSummary }) {
    const datePart = createdAt.slice(0, 10).replaceAll("-", "");
    const digest = createHash("sha256")
      .update(`${subjectId}|${createdAt}|${firstName}|${lastName}|${problemSummary}`)
      .digest("hex")
      .slice(0, 10)
      .toUpperCase();

    return `CASE-${datePart}-${digest}`;
  }
};

const requireValidatedFirstName = (value: string | undefined): string => {
  if (value === undefined) {
    throw new CaseCreationPreconditionError(
      "missing_first_name",
      "Accepted intake first name is required"
    );
  }

  const parsed = validateAcceptedFirstName(value);

  if (!parsed.valid) {
    throw new CaseCreationPreconditionError(
      "invalid_first_name",
      "Accepted intake first name is invalid"
    );
  }

  return parsed.value;
};

const requireValidatedLastName = (value: string | undefined): string => {
  if (value === undefined) {
    throw new CaseCreationPreconditionError(
      "missing_last_name",
      "Accepted intake last name is required"
    );
  }

  const parsed = validateAcceptedLastName(value);

  if (!parsed.valid) {
    throw new CaseCreationPreconditionError(
      "invalid_last_name",
      "Accepted intake last name is invalid"
    );
  }

  return parsed.value;
};

const requireValidatedBirthDate = (value: string | undefined): string => {
  if (value === undefined) {
    throw new CaseCreationPreconditionError(
      "missing_birth_date",
      "Accepted intake birth date is required"
    );
  }

  const parsed = validateAcceptedBirthDate(value);

  if (!parsed.valid) {
    throw new CaseCreationPreconditionError(
      "invalid_birth_date",
      "Accepted intake birth date is invalid"
    );
  }

  return parsed.value;
};

const requireValidatedCity = (value: string | undefined): string => {
  if (value === undefined) {
    throw new CaseCreationPreconditionError("missing_city", "Accepted intake city is required");
  }

  const parsed = validateAcceptedCity(value);

  if (!parsed.valid) {
    throw new CaseCreationPreconditionError("invalid_city", "Accepted intake city is invalid");
  }

  return parsed.value;
};

const requireValidatedProblemSummary = (value: string | undefined): string => {
  if (value === undefined) {
    throw new CaseCreationPreconditionError(
      "missing_problem_summary",
      "Accepted intake problem summary is required"
    );
  }

  const parsed = validateAcceptedProblemSummary(value);

  if (!parsed.valid) {
    throw new CaseCreationPreconditionError(
      "invalid_problem_summary",
      "Accepted intake problem summary is invalid"
    );
  }

  return parsed.value;
};

const acceptedFieldNames = [
  "firstName",
  "lastName",
  "birthDate",
  "city",
  "problemSummary"
] as const;

export interface CaseCreationService {
  createCaseFromCompletedIntake(subjectId: string): Promise<CreateCaseFromCompletedIntakeResult>;
}

export const createCaseCreationService = ({
  persistence,
  caseReferenceGenerator = defaultCaseReferenceGenerator,
  now = () => new Date().toISOString()
}: CreateCaseCreationServiceOptions): CaseCreationService => ({
  async createCaseFromCompletedIntake(subjectId) {
    return persistence.runInTransaction(async () => {
      const existingDraftCase = await persistence.findDraftCaseBySubjectId(subjectId);

      if (existingDraftCase) {
        const auditEvent = await persistence.appendAuditEvent({
          eventId: `audit-case-create-from-intake-idempotent-hit-${randomUUID()}`,
          eventType: "case_create_from_intake_idempotent_hit",
          entityType: "case",
          entityId: existingDraftCase.caseId,
          occurredAt: now(),
          metadata: {
            source: "completed_intake",
            existingStatus: "draft",
            acceptedFieldNames
          }
        });

        return {
          caseRecord: existingDraftCase,
          auditEvent
        };
      }

      const consentState = await persistence.getConsentState(subjectId);

      if (consentState !== "granted") {
        throw new CaseCreationPreconditionError(
          "consent_not_granted",
          `Consent must be granted before creating a case. Received: ${consentState}`
        );
      }

      const intakeSnapshot = await persistence.getIntakeSnapshot(subjectId);

      if (intakeSnapshot?.state !== "intake_complete") {
        throw new CaseCreationPreconditionError(
          "intake_not_complete",
          "Intake must be complete before creating a case"
        );
      }

      const firstName = requireValidatedFirstName(intakeSnapshot.fields.firstName);
      const lastName = requireValidatedLastName(intakeSnapshot.fields.lastName);
      const birthDate = requireValidatedBirthDate(intakeSnapshot.fields.birthDate);
      const city = requireValidatedCity(intakeSnapshot.fields.city);
      const problemSummary = requireValidatedProblemSummary(intakeSnapshot.fields.problemSummary);
      const name = buildAcceptedDisplayName({
        firstName,
        lastName
      });
      const createdAt = now();
      const caseInput: CreateCaseInput = {
        caseId: caseReferenceGenerator.generate({
          subjectId,
          createdAt,
          firstName,
          lastName,
          problemSummary
        }),
        subjectId,
        status: "draft",
        name,
        problemSummary,
        createdAt,
        updatedAt: createdAt
      };

      return persistence.createCaseWithAudit({
        case: caseInput,
        auditEvent: {
          eventId: `audit-case-created-from-intake-${caseInput.caseId}`,
          eventType: "case_created_from_intake",
          entityType: "case",
          entityId: caseInput.caseId,
          occurredAt: createdAt,
          metadata: {
            source: "completed_intake",
            consentState: "granted",
            intakeState: "intake_complete",
            acceptedFieldNames,
            birthDate,
            city
          }
        }
      });
    });
  }
});

export const createDeterministicCaseReferenceGenerator = (): CaseReferenceGenerator =>
  defaultCaseReferenceGenerator;
