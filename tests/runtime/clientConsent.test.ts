import { describe, expect, it } from "vitest";
import {
  canPersistClientContent,
  consentMessageTemplates,
  parseConsentDecision,
  resolveConsentRuntimeDecision
} from "../../src/runtime/client/consent";

describe("client consent runtime", () => {
  it("requests consent from an unknown state", () => {
    const result = resolveConsentRuntimeDecision({
      consentState: "unknown"
    });

    expect(result.consentState).toBe("requested");
    expect(result.runtimeDecision.action).toBe("request_consent");
    expect(result.messageTemplate).toBe(consentMessageTemplates.request_consent);
  });

  it("grants consent only for strict explicit consent text", () => {
    const result = resolveConsentRuntimeDecision({
      consentState: "requested",
      inboundText: "Acconsento al trattamento dei miei dati personali."
    });

    expect(parseConsentDecision("Acconsento al trattamento dei miei dati personali.")).toBe(
      "granted"
    );
    expect(result.consentState).toBe("granted");
    expect(result.runtimeDecision.action).toBe("consent_granted_ack");
  });

  it("denies and closes only for strict explicit denial text", () => {
    const result = resolveConsentRuntimeDecision({
      consentState: "requested",
      inboundText: "Non acconsento al trattamento dei miei dati personali."
    });

    expect(parseConsentDecision("Non acconsento al trattamento dei miei dati personali.")).toBe(
      "denied"
    );
    expect(result.consentState).toBe("denied");
    expect(result.runtimeDecision.action).toBe("consent_denied_close");
  });

  it("asks for clarification on ambiguous positive-like text", () => {
    const result = resolveConsentRuntimeDecision({
      consentState: "requested",
      inboundText: "si"
    });

    expect(parseConsentDecision("ok")).toBe("unknown");
    expect(parseConsentDecision("va bene")).toBe("unknown");
    expect(parseConsentDecision("procedi")).toBe("unknown");
    expect(parseConsentDecision("sì")).toBe("unknown");
    expect(result.consentState).toBe("requested");
    expect(result.runtimeDecision.action).toBe("consent_clarification");
  });

  it("allows persistence only when consent is granted", () => {
    expect(canPersistClientContent("unknown")).toBe(false);
    expect(canPersistClientContent("requested")).toBe(false);
    expect(canPersistClientContent("denied")).toBe(false);
    expect(canPersistClientContent("granted")).toBe(true);
  });

  it("keeps denied consent closed for persistence", () => {
    const result = resolveConsentRuntimeDecision({
      consentState: "denied"
    });

    expect(result.runtimeDecision.action).toBe("consent_denied_close");
    expect(canPersistClientContent(result.consentState)).toBe(false);
  });

  it("returns a granted consent acknowledgement for already-granted state", () => {
    const result = resolveConsentRuntimeDecision({
      consentState: "granted"
    });

    expect(result.runtimeDecision.action).toBe("consent_granted_ack");
    expect(result.messageTemplate).toBe(consentMessageTemplates.consent_granted_ack);
  });

  it("keeps consent templates free from legal advice language", () => {
    for (const template of Object.values(consentMessageTemplates)) {
      expect(template.toLowerCase()).not.toContain("consiglio legale");
      expect(template.toLowerCase()).not.toContain("legal advice");
    }
  });
});
