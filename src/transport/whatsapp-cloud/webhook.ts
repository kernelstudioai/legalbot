import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TransportInboundMessage } from "../inboundMessage.ts";

export const DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH = "/webhooks/whatsapp/cloud";

const verificationQuerySchema = z.object({
  mode: z.string().optional(),
  verifyToken: z.string().optional(),
  challenge: z.string().optional()
});

const textMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.string().min(1),
  text: z
    .object({
      body: z.string().min(1)
    })
    .optional()
}).passthrough();

const mediaObjectSchema = z
  .object({
    id: z.string().min(1).optional(),
    mime_type: z.string().min(1).optional(),
    filename: z.string().min(1).optional(),
    sha256: z.string().min(1).optional()
  })
  .passthrough();

const webhookPayloadSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z.array(
          z.object({
            field: z.string().optional(),
            value: z
              .object({
                contacts: z
                  .array(
                    z.object({
                      wa_id: z.string().min(1),
                      profile: z
                        .object({
                          name: z.string().min(1).optional()
                        })
                        .optional()
                    })
                  )
                  .optional(),
                messages: z.array(textMessageSchema).optional(),
                statuses: z.array(z.unknown()).optional()
              })
              .passthrough()
          })
        )
      })
    )
    .optional()
});

export interface WebhookVerificationResult {
  body: string;
  statusCode: 200 | 403;
  verified: boolean;
}

export interface ParsedWhatsAppCloudWebhook {
  messages: TransportInboundMessage[];
  statusEventCount: number;
  unsupportedMessageCount: number;
}

const toTimestampMilliseconds = (value: string): number | null => {
  const timestampSeconds = Number(value);

  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
    return null;
  }

  return timestampSeconds * 1000;
};

const toAttachmentMetadata = (
  message: z.infer<typeof textMessageSchema>
): TransportInboundMessage["attachments"] => {
  if (
    message.type !== "audio" &&
    message.type !== "document" &&
    message.type !== "image" &&
    message.type !== "video"
  ) {
    return undefined;
  }

  const media = mediaObjectSchema.safeParse((message as Record<string, unknown>)[message.type]);

  if (!media.success) {
    return undefined;
  }

  return [
    {
      kind: message.type,
      ...(media.data.id ? { providerMediaId: media.data.id } : {}),
      ...(media.data.mime_type ? { mimeType: media.data.mime_type } : {}),
      ...(media.data.filename ? { fileName: media.data.filename } : {}),
      ...(media.data.sha256 ? { sha256: media.data.sha256 } : {})
    }
  ];
};

export const verifyWhatsAppCloudWebhook = (
  query: {
    "hub.mode": string | undefined;
    "hub.verify_token": string | undefined;
    "hub.challenge": string | undefined;
  },
  verifyToken: string
): WebhookVerificationResult => {
  const parsed = verificationQuerySchema.parse({
    mode: query["hub.mode"],
    verifyToken: query["hub.verify_token"],
    challenge: query["hub.challenge"]
  });
  const verified =
    parsed.mode === "subscribe" &&
    parsed.verifyToken === verifyToken &&
    typeof parsed.challenge === "string";

  return {
    statusCode: verified ? 200 : 403,
    body: verified ? parsed.challenge! : "Forbidden",
    verified
  };
};

export const validateWhatsAppCloudSignature = ({
  appSecret,
  rawBody,
  signatureHeader
}: {
  appSecret: string | undefined;
  rawBody: string;
  signatureHeader: string | string[] | undefined;
}): boolean => {
  if (!appSecret) {
    return true;
  }

  const normalizedSignatureHeader =
    Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!normalizedSignatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expectedDigest = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const actualDigest = normalizedSignatureHeader.slice("sha256=".length);

  if (expectedDigest.length !== actualDigest.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expectedDigest), Buffer.from(actualDigest));
};

export const createWhatsAppCloudSignature = ({
  appSecret,
  rawBody
}: {
  appSecret: string;
  rawBody: string;
}): string =>
  `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

export const parseWhatsAppCloudWebhookPayload = (
  payload: unknown
): ParsedWhatsAppCloudWebhook => {
  const parsed = webhookPayloadSchema.parse(payload);
  const messages: TransportInboundMessage[] = [];
  let statusEventCount = 0;
  let unsupportedMessageCount = 0;

  for (const entry of parsed.entry ?? []) {
    for (const change of entry.changes) {
      if (change.field !== "messages") {
        continue;
      }

      const contactNames = new Map(
        (change.value.contacts ?? []).map((contact) => [
          contact.wa_id,
          contact.profile?.name
        ])
      );

      statusEventCount += change.value.statuses?.length ?? 0;

      for (const message of change.value.messages ?? []) {
        const attachments = toAttachmentMetadata(message);

        if (message.type !== "text" && !attachments) {
          unsupportedMessageCount += 1;
          continue;
        }

        const timestamp = toTimestampMilliseconds(message.timestamp);

        if (timestamp === null) {
          unsupportedMessageCount += 1;
          continue;
        }

        const senderDisplayName = contactNames.get(message.from);
        const body = message.type === "text" ? message.text?.body : "[allegato]";

        if (!body) {
          unsupportedMessageCount += 1;
          continue;
        }

        messages.push({
          id: message.id,
          from: message.from,
          chatId: message.from,
          body,
          ...(attachments ? { attachments } : {}),
          fromMe: false,
          timestamp,
          transport: "whatsapp_cloud",
          ...(senderDisplayName
            ? {
                sender: {
                  pushname: senderDisplayName
                }
              }
            : {})
        });
      }
    }
  }

  return {
    messages,
    statusEventCount,
    unsupportedMessageCount
  };
};
