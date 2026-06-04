import { CanonicalEnvelope } from "../contracts";
import type { CanonicalEnvelopeType } from "../contracts";
import { sanitizeInboundBody } from "../security/sanitize";
import type { OpenWaMessage } from "../transport/openwa/types";

export const normalizeInbound = (rawMessage: OpenWaMessage): CanonicalEnvelopeType =>
  CanonicalEnvelope.parse({
    messageId: rawMessage.id,
    channel: "whatsapp",
    senderId: rawMessage.from,
    senderDisplayName: rawMessage.sender?.pushname,
    body: sanitizeInboundBody(rawMessage.body),
    receivedAt: new Date(rawMessage.timestamp).toISOString(),
    transportMetadata: {
      chatId: rawMessage.chatId,
      fromMe: rawMessage.fromMe
    }
  });
