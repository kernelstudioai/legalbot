import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createCaseCreationService
} from "../../../src/domain/cases/caseCreationService.ts";
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
  intakeState?: "not_started" | "asking_name" | "asking_problem_summary" | "intake_complete";
  name?: string | undefined;
  problemSummary?: string | undefined;
} = {}
) => {
  const consentState = options.consentState ?? "granted";
  const intakeState = options.intakeState ?? "intake_complete";
  const name = Object.prototype.hasOwnProperty.call(options, "name")
    ? options.name
    : "Mario Rossi";
  const problemSummary = Object.prototype.hasOwnProperty.call(options, "problemSummary")
    ? options.problemSummary
    : "Sintesi breve del problema";
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

  await persistence.setConsentState(subjectId, consentState, {
    updatedAt: "2026-06-05T07:58:00.000Z"
  });
  await persistence.setIntakeState(subjectId, intakeState, {
    updatedAt: "2026-06-05T07:59:00.000Z"
  });

  if (name !== undefined) {
    await persistence.setIntakeField(subjectId, "name", name, {
      updatedAt: "2026-06-05T07:59:10.000Z"
    });
  }

  if (problemSummary !== undefined) {
    await persistence.setIntakeField(subjectId, "problemSummary", problemSummary, {
      updatedAt: "2026-06-05T07:59:20.000Z"
    });
  }

  return {
    auditLogStore,
    caseStore,
    generateReference,
    persistence,
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

  it("fails when name is missing", async () => {
    const { service, subjectId } = await buildHarness({
      name: undefined
    });

    await expect(service.createCaseFromCompletedIntake(subjectId)).rejects.toMatchObject({
      name: "CaseCreationPreconditionError",
      code: "missing_name"
    });
  });

  it("fails when problem summary is missing", async () => {
    const { service, subjectId } = await buildHarness({
      problemSummary: undefined
    });

    await expect(service.createCaseFromCompletedIntake(subjectId)).rejects.toMatchObject({
      name: "CaseCreationPreconditionError",
      code: "missing_problem_summary"
    });
  });

  it.each([
    {
      code: "invalid_name" as const,
      name: "x".repeat(81),
      problemSummary: "Sintesi valida"
    },
    {
      code: "invalid_problem_summary" as const,
      name: "Mario Rossi",
      problemSummary: "   "
    }
  ])("fails when structured fields are invalid", async ({ code, name, problemSummary }) => {
    const { service, subjectId } = await buildHarness({
      name,
      problemSummary
    });

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
          acceptedFieldNames: ["name", "problemSummary"]
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
          acceptedFieldNames: ["name", "problemSummary"]
        }
      }
    ]);
    expect(auditLogStore.events[0]?.metadata).not.toHaveProperty("body");
    expect(auditLogStore.events[0]?.metadata).not.toHaveProperty("transcript");
  });

  it("uses the injected deterministic case reference generator", async () => {
    const { generateReference, service, subjectId } = await buildHarness();

    await service.createCaseFromCompletedIntake(subjectId);

    expect(generateReference).toHaveBeenCalledTimes(1);
    expect(generateReference).toHaveBeenCalledWith({
      subjectId: "subject-123",
      createdAt: "2026-06-05T08:00:00.000Z",
      name: "Mario Rossi",
      problemSummary: "Sintesi breve del problema"
    });
  });

  it("returns the existing draft case on repeated calls and appends an idempotent audit event", async () => {
    const { auditLogStore, caseStore, generateReference, service, subjectId } = await buildHarness();

    const firstResult = await service.createCaseFromCompletedIntake(subjectId);
    const secondResult = await service.createCaseFromCompletedIntake(subjectId);

    expect(secondResult.caseRecord).toEqual(firstResult.caseRecord);
    expect(caseStore.createdInputs).toHaveLength(1);
    expect(generateReference).toHaveBeenCalledTimes(1);
    expect(auditLogStore.events).toHaveLength(2);
    expect(auditLogStore.events[1]).toMatchObject({
      eventType: "case_create_from_intake_idempotent_hit",
      entityType: "case",
      entityId: "CASE-20260605-TEST0001",
      occurredAt: "2026-06-05T08:00:00.000Z",
      metadata: {
        source: "completed_intake",
        existingStatus: "draft",
        acceptedFieldNames: ["name", "problemSummary"]
      }
    });
    expect(auditLogStore.events[1]?.metadata).not.toHaveProperty("body");
    expect(auditLogStore.events[1]?.metadata).not.toHaveProperty("transcript");
  });

  it("does not persist raw body or transcript fields", async () => {
    const { caseStore, service, subjectId } = await buildHarness();

    await service.createCaseFromCompletedIntake(subjectId);

    expect(caseStore.createdInputs).toEqual([
      {
        caseId: "CASE-20260605-TEST0001",
        subjectId: "subject-123",
        status: "draft",
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z"
      }
    ]);
    expect(caseStore.createdInputs[0]).not.toHaveProperty("body");
    expect(caseStore.createdInputs[0]).not.toHaveProperty("rawBody");
    expect(caseStore.createdInputs[0]).not.toHaveProperty("transcript");
  });

  it("does not run from the OpenWA listener or live client runtime", () => {
    const listenerSource = readFileSync(
      new URL("../../../src/transport/openwa/listener.ts", import.meta.url),
      "utf8"
    );
    const clientRuntimeSource = readFileSync(
      new URL("../../../src/runtime/client/clientRuntime.ts", import.meta.url),
      "utf8"
    );

    expect(listenerSource).not.toContain("createCaseFromCompletedIntake");
    expect(listenerSource).not.toContain("caseCreationService");
    expect(clientRuntimeSource).not.toContain("createCaseFromCompletedIntake");
    expect(clientRuntimeSource).not.toContain("caseCreationService");
  });
});
