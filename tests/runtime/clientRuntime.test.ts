import { describe, expect, it, vi } from "vitest";
import { runClientRuntime, type ClientConsentPersistence } from "../../src/runtime/client/clientRuntime";

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

  it("persists granted consent and appends a sanitized consent event", async () => {
    const consentPersistence = createConsentPersistence("requested");

    const result = await runClientRuntime({
      envelope: createEnvelope("Acconsento al trattamento dei miei dati personali."),
      consentPersistence
    });

    expect(result.runtimeDecision.action).toBe("consent_granted_ack");
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
  });

  it("persists denied consent and appends a sanitized consent event", async () => {
    const consentPersistence = createConsentPersistence("requested");

    const result = await runClientRuntime({
      envelope: createEnvelope("Non acconsento al trattamento dei miei dati personali."),
      consentPersistence
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
  });

  it("keeps requested consent open on ambiguous replies without granting", async () => {
    const consentPersistence = createConsentPersistence("requested");

    const result = await runClientRuntime({
      envelope: createEnvelope("si"),
      consentPersistence
    });

    expect(result.runtimeDecision.action).toBe("consent_clarification");
    expect(consentPersistence.setConsentState).not.toHaveBeenCalled();
    expect(consentPersistence.appendConsentEvent).not.toHaveBeenCalled();
  });

  it("returns the safe placeholder when consent is already granted", async () => {
    const consentPersistence = createConsentPersistence("granted");

    const result = await runClientRuntime({
      envelope: createEnvelope("Vorrei raccontare il mio caso"),
      consentPersistence
    });

    expect(result.runtimeDecision.action).toBe("intake_not_implemented");
    expect(consentPersistence.setConsentState).not.toHaveBeenCalled();
    expect(consentPersistence.appendConsentEvent).not.toHaveBeenCalled();
  });

  it("returns the safe closed response when consent is already denied", async () => {
    const consentPersistence = createConsentPersistence("denied");

    const result = await runClientRuntime({
      envelope: createEnvelope("Posso spiegare meglio?"),
      consentPersistence
    });

    expect(result.runtimeDecision.action).toBe("consent_denied_close");
    expect(consentPersistence.setConsentState).not.toHaveBeenCalled();
    expect(consentPersistence.appendConsentEvent).not.toHaveBeenCalled();
  });
});
