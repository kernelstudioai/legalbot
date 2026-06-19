import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_PROBLEM_SUMMARY_MAX_LENGTH,
  InMemoryClientIntakeStore,
  intakeMessageTemplates,
  resolveClientIntakeRuntimeDecision
} from "../../src/runtime/client/intake";

describe("client intake runtime", () => {
  it("starts intake by asking for structured identity after consent is granted", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      consentJustGranted: true,
      inboundText: "Acconsento"
    });

    expect(result.intakeState).toBe("asking_identity");
    expect(result.runtimeDecision.action).toBe("intake_ask_identity");
    expect(result.messageTemplate).toBe(intakeMessageTemplates.intake_ask_identity);
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "asking_identity"
    });
  });

  it("extracts messy identity input and advances to the problem summary", () => {
    const normalizeIdentity = vi.fn();
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_identity",
        updatedAt: "2026-06-04T12:00:00.000Z"
      },
      inboundText: "mi chiamo mario rossi, sono nato il 1/1/1980 e vivo a roma",
      aiNormalizationProvider: {
        normalizeIdentity,
        summarizeLegalIssue: vi.fn()
      }
    });

    expect(result.intakeState).toBe("asking_problem_summary");
    expect(normalizeIdentity).not.toHaveBeenCalled();
    expect(result.runtimeDecision.action).toBe("intake_ask_problem_summary");
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "asking_problem_summary",
      firstName: "Mario",
      lastName: "Rossi",
      birthDate: "01/01/1980",
      city: "Roma"
    });
  });

  it("accepts the live lowercase identity format with a spaced birth date", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_identity",
        updatedAt: "2026-06-09T09:00:00.000Z"
      },
      inboundText: "Mario barone roma 01 01 1976"
    });

    expect(result.intakeState).toBe("asking_problem_summary");
    expect(result.runtimeDecision.action).toBe("intake_ask_problem_summary");
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "asking_problem_summary",
      firstName: "Mario",
      lastName: "Barone",
      birthDate: "01/01/1976",
      city: "Roma"
    });
  });

  it("asks for formal clarification when identity extraction is incomplete", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_identity",
        updatedAt: "2026-06-04T12:00:00.000Z"
      },
      inboundText: "mario rossi"
    });

    expect(result.runtimeDecision.action).toBe("intake_clarify_identity");
    expect(result.messageTemplate).toContain("- data di nascita");
    expect(result.messageTemplate).toContain("- città");
    expect(result.nextRecord).toMatchObject({
      firstName: "Mario",
      lastName: "Rossi"
    });
  });

  it("validates fake AI identity output before accepting fields", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_identity",
        updatedAt: "2026-06-04T12:00:00.000Z"
      },
      inboundText: "12345",
      aiNormalizationProvider: {
        normalizeIdentity: vi.fn(() => ({
          acceptedFields: {
            firstName: "Mario123",
            lastName: "Rossi",
            birthDate: "1980-01-01",
            city: "Roma"
          },
          missingFields: []
        })),
        summarizeLegalIssue: vi.fn()
      }
    });

    expect(result.runtimeDecision.action).toBe("intake_clarify_identity");
    expect(result.nextRecord).toMatchObject({
      lastName: "Rossi",
      city: "Roma"
    });
    expect(result.nextRecord).not.toHaveProperty("firstName");
    expect(result.nextRecord).not.toHaveProperty("birthDate");
  });

  it("accepts a valid problem summary and advances to attachments", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:01:00.000Z",
        firstName: "Mario",
        lastName: "Rossi",
        birthDate: "01/01/1980",
        city: "Roma"
      },
      inboundText: "Problema con il contratto di lavoro e stipendio non pagato."
    });

    expect(result.intakeState).toBe("asking_attachments");
    expect(result.runtimeDecision.action).toBe("intake_ask_attachments");
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "asking_attachments",
      firstName: "Mario",
      lastName: "Rossi",
      birthDate: "01/01/1980",
      city: "Roma",
      problemSummary: "Problema con il contratto di lavoro e stipendio non pagato."
    });
  });

  it("completes intake when attachments are skipped", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_attachments",
        updatedAt: "2026-06-04T12:02:00.000Z",
        firstName: "Mario",
        lastName: "Rossi",
        birthDate: "01/01/1980",
        city: "Roma",
        problemSummary: "Problema con il contratto di lavoro e stipendio non pagato."
      },
      inboundText: "Salta",
      now: () => "2026-06-04T12:03:00.000Z"
    });

    expect(result.intakeState).toBe("intake_complete");
    expect(result.runtimeDecision.action).toBe("intake_complete_ack");
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "intake_complete",
      attachmentMetadata: "[]"
    });
  });

  it("rejects empty and overly long problem summaries", () => {
    const emptyResult = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:01:00.000Z",
        firstName: "Mario",
        lastName: "Rossi",
        birthDate: "01/01/1980",
        city: "Roma"
      },
      inboundText: "   "
    });
    const longResult = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:01:00.000Z",
        firstName: "Mario",
        lastName: "Rossi",
        birthDate: "01/01/1980",
        city: "Roma"
      },
      inboundText: "x".repeat(CLIENT_PROBLEM_SUMMARY_MAX_LENGTH + 1)
    });

    expect(emptyResult.runtimeDecision.action).toBe("intake_invalid_response");
    expect(longResult.runtimeDecision.action).toBe("intake_invalid_response");
  });

  it("stores only accepted structured fields in the in-memory intake store", async () => {
    const store = new InMemoryClientIntakeStore();

    await store.setIntakeRecord({
      subjectId: "client-1",
      state: "asking_problem_summary",
      firstName: "Mario",
      lastName: "Rossi",
      birthDate: "01/01/1980",
      city: "Roma"
    });
    await store.setIntakeRecord({
      subjectId: "client-1",
      state: "intake_complete",
      firstName: "Mario",
      lastName: "Rossi",
      birthDate: "01/01/1980",
      city: "Roma",
      problemSummary: "Sintesi breve del problema"
    });

    await expect(store.getIntakeRecord("client-1")).resolves.toEqual({
      subjectId: "client-1",
      state: "intake_complete",
      updatedAt: expect.any(String),
      firstName: "Mario",
      lastName: "Rossi",
      birthDate: "01/01/1980",
      city: "Roma",
      problemSummary: "Sintesi breve del problema"
    });
    expect(store.snapshot()[0]).not.toHaveProperty("body");
    expect(store.snapshot()[0]).not.toHaveProperty("rawBody");
  });

  it("keeps intake templates in formal Italian register", () => {
    for (const template of Object.values(intakeMessageTemplates)) {
      expect(template).not.toContain(" tua ");
      expect(template).not.toContain(" tu ");
      expect(template).not.toContain("Rispondi");
    }
  });
});
