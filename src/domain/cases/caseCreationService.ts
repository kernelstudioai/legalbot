import { createHash } from "node:crypto";
import type { AuditEventRecord, CaseRecord, CreateCaseInput, PersistenceService } from "../../persistence/index.ts";
import {
  validateAcceptedClientName,
  validateAcceptedProblemSummary
} from "../intake/acceptedFields.ts";

export type CaseCreationPersistence = Pick<
  PersistenceService,
  "createCaseWithAudit" | "getConsentState" | "getIntakeSnapshot"
>;

export interface CaseReferenceGeneratorInput {
  subjectId: string;
  createdAt: string;
  name: string;
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
  constructor(
    readonly code:
      | "consent_not_granted"
      | "intake_not_complete"
      | "missing_name"
      | "missing_problem_summary"
      | "invalid_name"
      | "invalid_problem_summary",
    message: string
  ) {
    super(message);
    this.name = "CaseCreationPreconditionError";
  }
}

const defaultCaseReferenceGenerator: CaseReferenceGenerator = {
  generate({ subjectId, createdAt, name, problemSummary }) {
    const datePart = createdAt.slice(0, 10).replaceAll("-", "");
    const digest = createHash("sha256")
      .update(`${subjectId}|${createdAt}|${name}|${problemSummary}`)
      .digest("hex")
      .slice(0, 10)
      .toUpperCase();

    return `CASE-${datePart}-${digest}`;
  }
};

const requireValidatedName = (value: string | undefined): string => {
  if (value === undefined) {
    throw new CaseCreationPreconditionError("missing_name", "Accepted intake name is required");
  }

  const parsed = validateAcceptedClientName(value);

  if (!parsed.valid) {
    throw new CaseCreationPreconditionError("invalid_name", "Accepted intake name is invalid");
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

export interface CaseCreationService {
  createCaseFromCompletedIntake(subjectId: string): Promise<CreateCaseFromCompletedIntakeResult>;
}

export const createCaseCreationService = ({
  persistence,
  caseReferenceGenerator = defaultCaseReferenceGenerator,
  now = () => new Date().toISOString()
}: CreateCaseCreationServiceOptions): CaseCreationService => ({
  async createCaseFromCompletedIntake(subjectId) {
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

    const name = requireValidatedName(intakeSnapshot.fields.name);
    const problemSummary = requireValidatedProblemSummary(intakeSnapshot.fields.problemSummary);
    const createdAt = now();
    const caseInput: CreateCaseInput = {
      caseId: caseReferenceGenerator.generate({
        subjectId,
        createdAt,
        name,
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
          acceptedFieldNames: ["name", "problemSummary"]
        }
      }
    });
  }
});

export const createDeterministicCaseReferenceGenerator = (): CaseReferenceGenerator =>
  defaultCaseReferenceGenerator;
