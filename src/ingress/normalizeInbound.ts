import { CanonicalEnvelope } from "../contracts/index.ts";
import type { CanonicalEnvelopeType } from "../contracts/index.ts";
import { sanitizeInboundBody } from "../security/sanitize.ts";
import type { TransportInboundMessage } from "../transport/inboundMessage.ts";

export const normalizeInbound = (
  rawMessage: TransportInboundMessage
): CanonicalEnvelopeType =>
  CanonicalEnvelope.parse({
    messageId: rawMessage.id,
    channel: "whatsapp",
    senderId: rawMessage.from,
    senderDisplayName: rawMessage.sender?.pushname,
    body: sanitizeInboundBody(rawMessage.body),
    receivedAt: new Date(rawMessage.timestamp).toISOString(),
    transportMetadata: {
      chatId: rawMessage.chatId,
      fromMe: rawMessage.fromMe,
      ...(rawMessage.actor ? { actor: rawMessage.actor } : {})
    }
  });
