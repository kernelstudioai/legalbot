import { describe, expect, it } from "vitest";
import {
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_PROBLEM_SUMMARY_MAX_LENGTH,
  InMemoryClientIntakeStore,
  intakeMessageTemplates,
  resolveClientIntakeRuntimeDecision
} from "../../src/runtime/client/intake";

describe("client intake runtime", () => {
  it("starts intake by asking for the client name after consent is granted", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      consentJustGranted: true,
      inboundText: "Acconsento al trattamento dei miei dati personali."
    });

    expect(result.intakeState).toBe("asking_name");
    expect(result.runtimeDecision.action).toBe("intake_ask_name");
    expect(result.messageTemplate).toBe(intakeMessageTemplates.intake_ask_name);
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "asking_name"
    });
  });

  it("accepts a valid name and advances to the problem summary", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_name",
        updatedAt: "2026-06-04T12:00:00.000Z"
      },
      inboundText: "  Mario   Rossi  "
    });

    expect(result.intakeState).toBe("asking_problem_summary");
    expect(result.runtimeDecision.action).toBe("intake_ask_problem_summary");
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "asking_problem_summary",
      name: "Mario Rossi"
    });
  });

  it("rejects empty and overly long names", () => {
    const emptyResult = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_name",
        updatedAt: "2026-06-04T12:00:00.000Z"
      },
      inboundText: "   "
    });
    const longResult = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_name",
        updatedAt: "2026-06-04T12:00:00.000Z"
      },
      inboundText: "x".repeat(CLIENT_NAME_MAX_LENGTH + 1)
    });

    expect(emptyResult.runtimeDecision.action).toBe("intake_invalid_response");
    expect(longResult.runtimeDecision.action).toBe("intake_invalid_response");
    expect(emptyResult.nextRecord).toBeUndefined();
    expect(longResult.nextRecord).toBeUndefined();
  });

  it("accepts a valid problem summary and completes intake", () => {
    const result = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:01:00.000Z",
        name: "Mario Rossi"
      },
      inboundText: "Problema con il contratto di lavoro e stipendio non pagato."
    });

    expect(result.intakeState).toBe("intake_complete");
    expect(result.runtimeDecision.action).toBe("intake_complete_ack");
    expect(result.nextRecord).toMatchObject({
      subjectId: "client-1",
      state: "intake_complete",
      name: "Mario Rossi",
      problemSummary: "Problema con il contratto di lavoro e stipendio non pagato."
    });
  });

  it("rejects empty and overly long problem summaries", () => {
    const emptyResult = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:01:00.000Z",
        name: "Mario Rossi"
      },
      inboundText: "   "
    });
    const longResult = resolveClientIntakeRuntimeDecision({
      subjectId: "client-1",
      intakeRecord: {
        subjectId: "client-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:01:00.000Z",
        name: "Mario Rossi"
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
      name: "Mario Rossi"
    });
    await store.setIntakeRecord({
      subjectId: "client-1",
      state: "intake_complete",
      name: "Mario Rossi",
      problemSummary: "Sintesi breve del problema"
    });

    await expect(store.getIntakeRecord("client-1")).resolves.toEqual({
      subjectId: "client-1",
      state: "intake_complete",
      updatedAt: expect.any(String),
      name: "Mario Rossi",
      problemSummary: "Sintesi breve del problema"
    });
    expect(store.snapshot()[0]).not.toHaveProperty("body");
    expect(store.snapshot()[0]).not.toHaveProperty("rawBody");
  });
});
