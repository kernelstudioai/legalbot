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

const createEnvelopeWithSubject = ({
  body,
  senderId,
  chatId
}: {
  body: string;
  senderId: string;
  chatId: string;
}) => ({
  ...createEnvelope(body),
  senderId,
  transportMetadata: {
    chatId,
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
          ...(intakeRecord.firstName ? { firstName: intakeRecord.firstName } : {}),
          ...(intakeRecord.lastName ? { lastName: intakeRecord.lastName } : {}),
          ...(intakeRecord.birthDate ? { birthDate: intakeRecord.birthDate } : {}),
          ...(intakeRecord.city ? { city: intakeRecord.city } : {}),
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

  it("accepts the short consent command and asks identity in one message", async () => {
    const consentPersistence = createConsentPersistence("requested");
    const intakePersistence = createIntakePersistence();

    const result = await runClientRuntime({
      envelope: createEnvelope("Acconsento"),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_ask_identity");
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
    expect(intakePersistence.setIntakeState).toHaveBeenCalledWith(
      "15551234567@c.us",
      "asking_identity",
      expect.objectContaining({
        updatedAt: expect.any(String)
      })
    );
    expect(intakePersistence.setIntakeField).not.toHaveBeenCalled();
  });

  it("persists consent granted even when the inbound grant arrives from unknown state", async () => {
    const consentPersistence = createConsentPersistence("unknown");
    const intakePersistence = createIntakePersistence();

    await runClientRuntime({
      envelope: createEnvelope("Acconsento"),
      consentPersistence,
      intakePersistence
    });

    expect(consentPersistence.setConsentState).toHaveBeenNthCalledWith(
      1,
      "15551234567@c.us",
      "granted",
      expect.any(Object)
    );
    expect(consentPersistence.appendConsentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: "15551234567@c.us",
        state: "granted",
        eventType: "consent_granted"
      })
    );
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
    expect(intakePersistence.setIntakeState).not.toHaveBeenCalled();
  });

  it("extracts messy identity input into structured fields or asks formal clarification", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence({
      subjectId: "15551234567@c.us",
      state: "asking_identity",
      updatedAt: "2026-06-04T12:01:00.000Z"
    });

    const result = await runClientRuntime({
      envelope: createEnvelope("mi chiamo mario rossi, sono nato il 1/1/1980 e vivo a roma"),
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
      "firstName",
      "Mario",
      expect.any(Object)
    );
    expect(intakePersistence.setIntakeField).toHaveBeenCalledWith(
      "15551234567@c.us",
      "lastName",
      "Rossi",
      expect.any(Object)
    );
    expect(intakePersistence.setIntakeField).toHaveBeenCalledWith(
      "15551234567@c.us",
      "birthDate",
      "01/01/1980",
      expect.any(Object)
    );
    expect(intakePersistence.setIntakeField).toHaveBeenCalledWith(
      "15551234567@c.us",
      "city",
      "Roma",
      expect.any(Object)
    );
  });

  it("uses the same transport chat subject for consent and intake persistence", async () => {
    const consentPersistence = createConsentPersistence("requested");
    const intakePersistence = createIntakePersistence();

    const result = await runClientRuntime({
      envelope: createEnvelopeWithSubject({
        body: "Acconsento",
        senderId: "participant-42@c.us",
        chatId: "thread-42@c.us"
      }),
      consentPersistence,
      intakePersistence
    });

    expect(result.subjectId).toBe("thread-42@c.us");
    expect(consentPersistence.setConsentState).toHaveBeenCalledWith(
      "thread-42@c.us",
      "granted",
      expect.any(Object)
    );
    expect(intakePersistence.setIntakeState).toHaveBeenCalledWith(
      "thread-42@c.us",
      "asking_identity",
      expect.any(Object)
    );
  });

  it("asks formal clarification when identity is incomplete", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence({
      subjectId: "15551234567@c.us",
      state: "asking_identity",
      updatedAt: "2026-06-04T12:01:00.000Z"
    });

    const result = await runClientRuntime({
      envelope: createEnvelope("mario rossi"),
      consentPersistence,
      intakePersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_clarify_identity");
    expect(result.runtimeDecision.messageOverride).toContain("- data di nascita");
    expect(result.runtimeDecision.messageOverride).toContain("- città");
    expect(intakePersistence.setIntakeState).not.toHaveBeenCalled();
    expect(intakePersistence.setIntakeField).toHaveBeenCalledWith(
      "15551234567@c.us",
      "firstName",
      "Mario",
      expect.any(Object)
    );
  });

  it("accepts a valid problem summary and completes intake without storing the raw inbound body", async () => {
    const consentPersistence = createConsentPersistence("granted");
    const intakePersistence = createIntakePersistence({
      subjectId: "15551234567@c.us",
      state: "asking_problem_summary",
      updatedAt: "2026-06-04T12:02:00.000Z",
      firstName: "Mario",
      lastName: "Rossi",
      birthDate: "01/01/1980",
      city: "Roma"
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
        metadata: expect.not.objectContaining({
          body: expect.anything(),
          rawBody: expect.anything(),
          inboundText: expect.anything(),
          text: expect.anything()
        })
      })
    );
  });
});
