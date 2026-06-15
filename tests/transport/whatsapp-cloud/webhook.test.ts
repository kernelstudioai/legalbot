import { describe, expect, it } from "vitest";
import {
  parseWhatsAppCloudWebhookPayload,
  verifyWhatsAppCloudWebhook
} from "../../../src/transport/whatsapp-cloud";

describe("whatsapp cloud webhook helpers", () => {
  it("accepts a valid verification challenge and rejects invalid tokens", () => {
    expect(
      verifyWhatsAppCloudWebhook(
        {
          "hub.mode": "subscribe",
          "hub.verify_token": "expected-token",
          "hub.challenge": "challenge-value"
        },
        "expected-token"
      )
    ).toEqual({
      statusCode: 200,
      body: "challenge-value",
      verified: true
    });

    expect(
      verifyWhatsAppCloudWebhook(
        {
          "hub.mode": "subscribe",
          "hub.verify_token": "wrong-token",
          "hub.challenge": "challenge-value"
        },
        "expected-token"
      )
    ).toEqual({
      statusCode: 403,
      body: "Forbidden",
      verified: false
    });
  });

  it("normalizes inbound text messages into the shared pipeline shape", () => {
    const result = parseWhatsAppCloudWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [
                  {
                    wa_id: "393331112222",
                    profile: {
                      name: "Mario Rossi"
                    }
                  }
                ],
                messages: [
                  {
                    id: "wamid.cloud-1",
                    from: "393331112222",
                    timestamp: "1718049600",
                    type: "text",
                    text: {
                      body: "Buongiorno"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(result.statusEventCount).toBe(0);
    expect(result.unsupportedMessageCount).toBe(0);
    expect(result.messages).toEqual([
      {
        id: "wamid.cloud-1",
        from: "393331112222",
        chatId: "393331112222",
        body: "Buongiorno",
        fromMe: false,
        timestamp: 1718049600000,
        transport: "whatsapp_cloud",
        sender: {
          pushname: "Mario Rossi"
        }
      }
    ]);
  });

  it("ignores unsupported message types and status events safely", () => {
    const result = parseWhatsAppCloudWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.cloud-image-1",
                    from: "393331112222",
                    timestamp: "1718049600",
                    type: "image"
                  }
                ],
                statuses: [
                  {
                    id: "wamid.cloud-image-1",
                    status: "delivered"
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(result.messages).toEqual([]);
    expect(result.statusEventCount).toBe(1);
    expect(result.unsupportedMessageCount).toBe(1);
  });
});
