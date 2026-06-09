import { describe, expect, it, vi } from "vitest";
import { createCaseCreationService } from "../../../src/domain/cases/caseCreationService.ts";
import type {
  AuditEventRecord,
  AuditLogStore,
  CaseRecord,
  CaseStore,
  CreateCaseInput,
  UpdateCaseInput
} from "../../../src/persistence/index.ts";
import {
  InMemoryConsentStore,
  InMemoryIntakeStore,
  InMemoryProcessedMessageStore,
  createPersistenceService
} from "../../../src/persistence/index.ts";

class CapturingCaseStore implements CaseStore {
  readonly createdInputs: CreateCaseInput[] = [];
  private readonly records = new Map<string, CaseRecord>();

  async create(input: CreateCaseInput): Promise<CaseRecord> {
    this.createdInputs.push(input);

    const record: CaseRecord = {
      caseId: input.caseId,
      subjectId: input.subjectId,
      status: input.status ?? "draft",
      name: input.name,
      problemSummary: input.problemSummary,
      createdAt: input.createdAt ?? "2026-06-05T08:00:00.000Z",
      updatedAt: input.updatedAt ?? input.createdAt ?? "2026-06-05T08:00:00.000Z"
    };

    this.records.set(record.caseId, record);
    return record;
  }

  async findDraftBySubjectId(subjectId: string): Promise<CaseRecord | null> {
    return (
      [...this.records.values()].find(
        (record) => record.subjectId === subjectId && record.status === "draft"
      ) ?? null
    );
  }

  async getById(caseId: string): Promise<CaseRecord | null> {
    return this.records.get(caseId) ?? null;
  }

  async update(_input: UpdateCaseInput): Promise<CaseRecord | null> {
    return null;
  }
}

class CapturingAuditLogStore implements AuditLogStore {
  readonly events: AuditEventRecord[] = [];

  async append(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }
}

const buildHarness = async (
  options: {
    consentState?: "unknown" | "requested" | "granted" | "denied";
    intakeState?: "not_started" | "asking_identity" | "asking_problem_summary" | "intake_complete";
    firstName?: string | undefined;
    lastName?: string | undefined;
    birthDate?: string | undefined;
    city?: string | undefined;
    problemSummary?: string | undefined;
  } = {}
) => {
  const caseStore = new CapturingCaseStore();
  const auditLogStore = new CapturingAuditLogStore();
  const persistence = createPersistenceService({
    caseStore,
    processedMessageStore: new InMemoryProcessedMessageStore(),
    auditLogStore,
    consentStore: new InMemoryConsentStore(),
    intakeStore: new InMemoryIntakeStore()
  });
  const generateReference = vi.fn(() => "CASE-20260605-TEST0001");
  const service = createCaseCreationService({
    persistence,
    caseReferenceGenerator: {
      generate: generateReference
    },
    now: () => "2026-06-05T08:00:00.000Z"
  });
  const subjectId = "subject-123";

  await persistence.setConsentState(subjectId, options.consentState ?? "granted", {
    updatedAt: "2026-06-05T07:58:00.000Z"
  });
  await persistence.setIntakeState(subjectId, options.intakeState ?? "intake_complete", {
    updatedAt: "2026-06-05T07:59:00.000Z"
  });

  const firstName = Object.prototype.hasOwnProperty.call(options, "firstName")
    ? options.firstName
    : "Mario";
  const lastName = Object.prototype.hasOwnProperty.call(options, "lastName")
    ? options.lastName
    : "Rossi";
  const birthDate = Object.prototype.hasOwnProperty.call(options, "birthDate")
    ? options.birthDate
    : "01/01/1980";
  const city = Object.prototype.hasOwnProperty.call(options, "city") ? options.city : "Roma";
  const problemSummary = Object.prototype.hasOwnProperty.call(options, "problemSummary")
    ? options.problemSummary
    : "Sintesi breve del problema";

  if (firstName !== undefined) {
    await persistence.setIntakeField(subjectId, "firstName", firstName, {
      updatedAt: "2026-06-05T07:59:10.000Z"
    });
  }

  if (lastName !== undefined) {
    await persistence.setIntakeField(subjectId, "lastName", lastName, {
      updatedAt: "2026-06-05T07:59:15.000Z"
    });
  }

  if (birthDate !== undefined) {
    await persistence.setIntakeField(subjectId, "birthDate", birthDate, {
      updatedAt: "2026-06-05T07:59:20.000Z"
    });
  }

  if (city !== undefined) {
    await persistence.setIntakeField(subjectId, "city", city, {
      updatedAt: "2026-06-05T07:59:25.000Z"
    });
  }

  if (problemSummary !== undefined) {
    await persistence.setIntakeField(subjectId, "problemSummary", problemSummary, {
      updatedAt: "2026-06-05T07:59:30.000Z"
    });
  }

  return {
    auditLogStore,
    caseStore,
    generateReference,
    service,
    subjectId
  };
};

describe("case creation service boundary", () => {
  it.each(["unknown", "requested", "denied"] as const)(
    "fails when consent is %s",
    async (consentState) => {
      const { service, subjectId } = await buildHarness({
        consentState
      });

      await expect(service.createCaseFromCompletedIntake(subjectId)).rejects.toMatchObject({
        name: "CaseCreationPreconditionError",
        code: "consent_not_granted"
      });
    }
  );

  it("fails when intake is not complete", async () => {
    const { service, subjectId } = await buildHarness({
      intakeState: "asking_problem_summary"
    });

    await expect(service.createCaseFromCompletedIntake(subjectId)).rejects.toMatchObject({
      name: "CaseCreationPreconditionError",
      code: "intake_not_complete"
    });
  });

  it.each([
    {
      code: "missing_first_name" as const,
      options: {
        firstName: undefined
      }
    },
    {
      code: "missing_last_name" as const,
      options: {
        lastName: undefined
      }
    },
    {
      code: "missing_birth_date" as const,
      options: {
        birthDate: undefined
      }
    },
    {
      code: "missing_city" as const,
      options: {
        city: undefined
      }
    },
    {
      code: "missing_problem_summary" as const,
      options: {
        problemSummary: undefined
      }
    }
  ])("fails when a required field is missing", async ({ code, options }) => {
    const { service, subjectId } = await buildHarness(options);

    await expect(service.createCaseFromCompletedIntake(subjectId)).rejects.toMatchObject({
      name: "CaseCreationPreconditionError",
      code
    });
  });

  it.each([
    {
      code: "invalid_first_name" as const,
      options: {
        firstName: "x".repeat(81)
      }
    },
    {
      code: "invalid_last_name" as const,
      options: {
        lastName: "x".repeat(81)
      }
    },
    {
      code: "invalid_birth_date" as const,
      options: {
        birthDate: "1980-01-01"
      }
    },
    {
      code: "invalid_city" as const,
      options: {
        city: "Roma 123"
      }
    },
    {
      code: "invalid_problem_summary" as const,
      options: {
        problemSummary: "   "
      }
    }
  ])("fails when structured fields are invalid", async ({ code, options }) => {
    const { service, subjectId } = await buildHarness(options);

    await expect(service.createCaseFromCompletedIntake(subjectId)).rejects.toMatchObject({
      name: "CaseCreationPreconditionError",
      code
    });
  });

  it("creates a case when consent is granted and intake is complete", async () => {
    const { service, subjectId } = await buildHarness();

    await expect(service.createCaseFromCompletedIntake(subjectId)).resolves.toEqual({
      caseRecord: {
        caseId: "CASE-20260605-TEST0001",
        subjectId: "subject-123",
        status: "draft",
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z"
      },
      auditEvent: {
        eventId: "audit-case-created-from-intake-CASE-20260605-TEST0001",
        eventType: "case_created_from_intake",
        entityType: "case",
        entityId: "CASE-20260605-TEST0001",
        occurredAt: "2026-06-05T08:00:00.000Z",
        metadata: {
          source: "completed_intake",
          consentState: "granted",
          intakeState: "intake_complete",
          acceptedFieldNames: ["firstName", "lastName", "birthDate", "city", "problemSummary"],
          birthDate: "01/01/1980",
          city: "Roma"
        }
      }
    });
  });

  it("appends a sanitized audit event", async () => {
    const { auditLogStore, service, subjectId } = await buildHarness();

    await service.createCaseFromCompletedIntake(subjectId);

    expect(auditLogStore.events).toEqual([
      {
        eventId: "audit-case-created-from-intake-CASE-20260605-TEST0001",
        eventType: "case_created_from_intake",
        entityType: "case",
        entityId: "CASE-20260605-TEST0001",
        occurredAt: "2026-06-05T08:00:00.000Z",
        metadata: {
          source: "completed_intake",
          consentState: "granted",
          intakeState: "intake_complete",
          acceptedFieldNames: ["firstName", "lastName", "birthDate", "city", "problemSummary"],
          birthDate: "01/01/1980",
          city: "Roma"
        }
      }
    ]);
  });

  it("uses the injected deterministic case reference generator", async () => {
    const { generateReference, service, subjectId } = await buildHarness();

    await service.createCaseFromCompletedIntake(subjectId);

    expect(generateReference).toHaveBeenCalledWith({
      subjectId: "subject-123",
      createdAt: "2026-06-05T08:00:00.000Z",
      firstName: "Mario",
      lastName: "Rossi",
      problemSummary: "Sintesi breve del problema"
    });
  });

  it("returns the existing draft case on repeated creation attempts", async () => {
    const { service, subjectId } = await buildHarness();

    const firstResult = await service.createCaseFromCompletedIntake(subjectId);
    const secondResult = await service.createCaseFromCompletedIntake(subjectId);

    expect(secondResult.caseRecord.caseId).toBe(firstResult.caseRecord.caseId);
    expect(secondResult.auditEvent.metadata).toEqual({
      source: "completed_intake",
      existingStatus: "draft",
      acceptedFieldNames: ["firstName", "lastName", "birthDate", "city", "problemSummary"]
    });
  });
});
