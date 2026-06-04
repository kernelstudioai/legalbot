import { describe, expect, it, vi } from "vitest";
import {
  runClientRuntime,
  type ClientConsentPersistence,
  type ClientIntakePersistence
} from "../../src/runtime/client/clientRuntime";
import type { ClientIntakeRecord } from "../../src/runtime/client/intake";
import type { IntakeSnapshot } from "../../src/persistence";

const createEnvelope = (body: string) => ({
  messageId: "wamid.client-1",
  channel: "whatsapp" as const,
  senderId: "15551234567@c.us",
  senderDisplayName: "Prospective Client",
  body,
  receivedAt: "2026-06-04T12:00:00.000Z",
  transportMetadata: {
    chatId: "15551234567@c.us",
    fromMe: false
  }
});

const createConsentPersistence = (
  consentState: "unknown" | "requested" | "granted" | "denied"
): ClientConsentPersistence & {
  setConsentState: ReturnType<typeof vi.fn>;
  appendConsentEvent: ReturnType<typeof vi.fn>;
} => ({
  getConsentState: vi.fn().mockResolvedValue(consentState),
  setConsentState: vi.fn().mockResolvedValue(undefined),
  appendConsentEvent: vi.fn().mockResolvedValue(undefined)
});

const toSnapshot = (intakeRecord: ClientIntakeRecord | null): IntakeSnapshot | null =>
  intakeRecord
    ? {
        subjectId: intakeRecord.subjectId,
        state: intakeRecord.state,
        updatedAt: intakeRecord.updatedAt,
        fields: {
          ...(intakeRecord.name ? { name: intakeRecord.name } : {}),
          ...(intakeRecord.problemSummary
            ? {
                problemSummary: intakeRecord.problemSummary
              }
            : {})
        }
      }
    : null;

const createIntakePersistence = (
  intakeRecord: ClientIntakeRecord | null = null
): ClientIntakePersistence & {
  getIntakeState: ReturnType<typeof vi.fn>;
  getIntakeSnapshot: ReturnType<typeof vi.fn>;
  setIntakeState: ReturnType<typeof vi.fn>;
  setIntakeField: ReturnType<typeof vi.fn>;
  appendIntakeEvent: ReturnType<typeof vi.fn>;
} => ({
  getIntakeState: vi.fn().mockResolvedValue(intakeRecord?.state ?? "not_started"),
  getIntakeSnapshot: vi.fn().mockResolvedValue(toSnapshot(intakeRecord)),
  setIntakeState: vi.fn().mockImplementation(async (subjectId, state, metadata) => ({
    record: {
      subjectId,
      state,
      updatedAt: metadata?.updatedAt ?? "2026-06-04T12:00:00.000Z"
    }
  })),
  setIntakeField: vi.fn().mockImplementation(async (subjectId, fieldName, value, metadata) => ({
    record: {
      subjectId,
      fieldName,
      value,
      updatedAt: metadata?.updatedAt ?? "2026-06-04T12:00:00.000Z"
    }
  })),
  appendIntakeEvent: vi.fn().mockResolvedValue(undefined)
});

describe("client runtime wiring", () => {
  it("requests consent from unknown state and persists requested without body metadata", async () => {
    const consentPersistence = createConsentPersistence("unknown");

    const result = await runClientRuntime({
      envelope: createEnvelope("Vorrei assistenza"),
      consentPersistence
    });

    expect(result.subjectId).toBe("15551234567@c.us");
    expect(result.runtimeDecision.action).toBe("request_consent");
    expect(consentPersistence.setConsentState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "requested",
      {
        metadata: {
          channel: "whatsapp",
          messageId: "wamid.client-1",
          subjectIdSource: "transport.chatId",
          runtime: "client"
        }
      }
    );
    expect(consentPersistence.appendConsentEvent).not.toHaveBeenCalled();
  });

  it("starts intake after explicit consent grant and persists only intake state", async () => {
    const consentPersistence = createConsentPersistence("requested");
    const intakePersistence = createIntakePersistence();

    const result = await runClientRuntime({
      envelope: createEnvelope("Acconsento al trattamento dei miei dati personali."),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_ask_name");
    expect(consentPersistence.setConsentState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "granted",
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          body: expect.anything(),
          text: expect.anything(),
          content: expect.anything()
        })
      })
    );
    expect(consentPersistence.appendConsentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: "15551234567@c.us",
        state: "granted",
        eventType: "consent_granted",
        metadata: {
          channel: "whatsapp",
          messageId: "wamid.client-1",
          subjectIdSource: "transport.chatId",
          runtime: "client"
        }
      })
    );
    expect(intakePersistence.setIntakeState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "asking_name",
      expect.objectContaining({
        updatedAt: expect.any(String),
        metadata: {
          channel: "whatsapp",
          messageId: "wamid.client-1",
          subjectIdSource: "transport.chatId",
          runtime: "client"
        }
      })
    );
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });

  it("persists denied consent and never starts intake", async () => {
    const consentPersistence = createConsentPersistence("requested");
    const intakePersistence = createIntakePersistence();

    const result = await runClientRuntime({
      envelope: createEnvelope("Non acconsento al trattamento dei miei dati personali."),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("consent_denied_close");
    expect(consentPersistence.setConsentState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "denied",
      expect.any(Object)
    );
    expect(consentPersistence.appendConsentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: "15551234567@c.us",
        state: "denied",
        eventType: "consent_denied"
      })
    );
    expect(intakePersistence.setIntakeState).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });

  it("keeps requested consent open on ambiguous replies without granting", async () => {
    const consentPersistence = createConsentPersistence("requested");
    const intakePersistence = createIntakePersistence();

    const result = await runClientRuntime({
      envelope: createEnvelope("si"),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("consent_clarification");
    expect(consentPersistence.setConsentState).not.toHaveBeenCalled();
    expect(consentPersistence.appendConsentEvent).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeState).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });

  it("starts intake by asking for the client name when consent is already granted", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence();

    const result = await runClientRuntime({
      envelope: createEnvelope("Vorrei raccontare il mio caso"),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_ask_name");
    expect(consentPersistence.setConsentState).not.toHaveBeenCalled();
    expect(consentPersistence.appendConsentEvent).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "asking_name",
      expect.objectContaining({
        updatedAt: expect.any(String)
      })
    );
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });

  it("returns the safe closed response when consent is already denied", async () => {
    const consentPersistence = createConsentPersistence("denied");
    const intakePersistence = createIntakePersistence();

    const result = await runClientRuntime({
      envelope: createEnvelope("Posso spiegare meglio?"),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("consent_denied_close");
    expect(consentPersistence.setConsentState).not.toHaveBeenCalled();
    expect(consentPersistence.appendConsentEvent).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeState).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });

  it("accepts a valid name as a structured field and advances to the problem summary", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence({
      subjectId: "15551234567@c.us",
      state: "asking_name",
      updatedAt: "2026-06-04T12:01:00.000Z"
    });

    const result = await runClientRuntime({
      envelope: createEnvelope("Mario Rossi"),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_ask_problem_summary");
    expect(intakePersistence.setIntakeState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "asking_problem_summary",
      expect.objectContaining({
        updatedAt: expect.any(String)
      })
    );
    expect(intakePersistence.setIntakeField).toHaveBeenCalledWith(
      "15551234567@c.us",
      "name",
      "Mario Rossi",
      expect.objectContaining({
        updatedAt: expect.any(String),
        metadata: expect.not.objectContaining({
          body: expect.anything(),
          text: expect.anything(),
          content: expect.anything()
        })
      })
    );
  });

  it("returns intake_invalid_response for empty or overly long names", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence({
      subjectId: "15551234567@c.us",
      state: "asking_name",
      updatedAt: "2026-06-04T12:01:00.000Z"
    });

    const emptyResult = await runClientRuntime({
      envelope: createEnvelope("   "),
      consentPersistence,
      intakePersistence
    });
    const longResult = await runClientRuntime({
      envelope: createEnvelope("x".repeat(81)),
      consentPersistence,
      intakePersistence
    });

    expect(emptyResult.runtimeDecision.action).toBe("intake_invalid_response");
    expect(longResult.runtimeDecision.action).toBe("intake_invalid_response");
    expect(intakePersistence.setIntakeState).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });

  it("accepts a valid problem summary and completes intake without storing the raw inbound body", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence({
      subjectId: "15551234567@c.us",
      state: "asking_problem_summary",
      updatedAt: "2026-06-04T12:02:00.000Z",
      name: "Mario Rossi"
    });

    const result = await runClientRuntime({
      envelope: createEnvelope("Licenziamento improvviso e richiesta di chiarimenti contrattuali"),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_complete_ack");
    expect(intakePersistence.setIntakeState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "intake_complete",
      expect.objectContaining({
        updatedAt: expect.any(String)
      })
    );
    expect(intakePersistence.setIntakeField).toHaveBeenCalledWith(
      "15551234567@c.us",
      "problemSummary",
      "Licenziamento improvviso e richiesta di chiarimenti contrattuali",
      expect.objectContaining({
        updatedAt: expect.any(String),
        metadata: expect.not.objectContaining({
          body: expect.anything(),
          rawBody: expect.anything(),
          inboundText: expect.anything(),
          text: expect.anything()
        })
      })
    );
  });

  it("returns intake_invalid_response for overly long problem summaries", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence({
      subjectId: "15551234567@c.us",
      state: "asking_problem_summary",
      updatedAt: "2026-06-04T12:02:00.000Z",
      name: "Mario Rossi"
    });

    const result = await runClientRuntime({
      envelope: createEnvelope("x".repeat(501)),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_invalid_response");
    expect(intakePersistence.setIntakeState).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });
});
