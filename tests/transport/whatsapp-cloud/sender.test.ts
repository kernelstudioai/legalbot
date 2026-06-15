import { describe, expect, it, vi } from "vitest";
import {
  buildWhatsAppCloudTextMessagePayload,
  createWhatsAppCloudSender
} from "../../../src/transport/whatsapp-cloud";

describe("whatsapp cloud sender", () => {
  it("builds the expected outbound text payload", () => {
    expect(
      buildWhatsAppCloudTextMessagePayload({
        to: "393331112222",
        body: "Messaggio di prova"
      })
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "393331112222",
      type: "text",
      text: {
        body: "Messaggio di prova",
        preview_url: false
      }
    });
  });

  it("constructs a graph api request through the injected http client", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      bodyText: '{"messages":[{"id":"wamid.outbound-1"}]}'
    });
    const sender = createWhatsAppCloudSender({
      apiVersion: "v22.0",
      phoneNumberId: "1234567890",
      accessToken: "access-token",
      httpClient: {
        post
      }
    });

    await sender.sendText("393331112222", "Messaggio di prova");

    expect(post).toHaveBeenCalledWith(
      "https://graph.facebook.com/v22.0/1234567890/messages",
      {
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "393331112222",
          type: "text",
          text: {
            body: "Messaggio di prova",
            preview_url: false
          }
        })
      }
    );
  });
});
