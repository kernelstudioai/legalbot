import { describe, expect, it } from "vitest";
import { buildOutputPlan } from "../../src/output/buildOutputPlan";

describe("buildOutputPlan", () => {
  it("uses consent templates for consent runtime actions", () => {
    const plan = buildOutputPlan({
      envelope: {
        messageId: "msg-1",
        channel: "whatsapp",
        senderId: "client-123@c.us",
        body: "Acconsento al trattamento dei miei dati personali",
        receivedAt: "2026-06-04T12:00:00.000Z",
        transportMetadata: {
          chatId: "client-123@c.us",
          fromMe: false
        }
      },
      routingDecision: {
        targetRuntime: "client",
        reason: "consent gate",
        labels: ["consent"]
      },
      runtimeDecision: {
        actor: "client",
        action: "request_consent",
        rationale: "consent gate"
      }
    });

    expect(plan.messages).toEqual([
      {
        kind: "text",
        to: "client-123@c.us",
        body: expect.stringContaining("Acconsento al trattamento dei miei dati personali")
      }
    ]);
  });

  it("uses intake templates for consent-gated intake actions", () => {
    const plan = buildOutputPlan({
      envelope: {
        messageId: "msg-2",
        channel: "whatsapp",
        senderId: "client-123@c.us",
        body: "Vorrei aprire una pratica",
        receivedAt: "2026-06-04T12:05:00.000Z",
        transportMetadata: {
          chatId: "client-123@c.us",
          fromMe: false
        }
      },
      routingDecision: {
        targetRuntime: "client",
        reason: "consent granted",
        labels: ["consent"]
      },
      runtimeDecision: {
        actor: "client",
        action: "intake_ask_name",
        rationale: "consent granted"
      }
    });

    expect(plan.messages[0]?.body).toContain("nome e cognome");
  });
});
