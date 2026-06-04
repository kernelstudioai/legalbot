import { describe, expect, it } from "vitest";
import {
  CanonicalEnvelope,
  OutputPlan,
  RoutingDecision,
  RuntimeDecision
} from "../../src/contracts";

describe("contracts", () => {
  it("parses valid contract objects", () => {
    expect(
      CanonicalEnvelope.parse({
        messageId: "msg-1",
        channel: "whatsapp",
        senderId: "12345@c.us",
        body: "Need legal help",
        receivedAt: "2026-06-04T12:00:00.000Z",
        transportMetadata: {
          chatId: "12345@c.us",
          fromMe: false
        }
      })
    ).toBeTruthy();

    expect(
      RoutingDecision.parse({
        targetRuntime: "client",
        reason: "default route",
        labels: ["default"]
      })
    ).toBeTruthy();

    expect(
      RuntimeDecision.parse({
        actor: "client",
        action: "acknowledge",
        rationale: "placeholder"
      })
    ).toBeTruthy();

    expect(
      OutputPlan.parse({
        messages: [
          {
            kind: "text",
            to: "12345@c.us",
            body: "Placeholder response"
          }
        ],
        auditNote: "built"
      })
    ).toBeTruthy();
  });

  it("rejects an invalid canonical envelope", () => {
    expect(() =>
      CanonicalEnvelope.parse({
        messageId: "",
        channel: "whatsapp",
        senderId: "12345@c.us",
        body: "",
        receivedAt: "not-a-date",
        transportMetadata: {
          chatId: "",
          fromMe: false
        }
      })
    ).toThrow();
  });
});
