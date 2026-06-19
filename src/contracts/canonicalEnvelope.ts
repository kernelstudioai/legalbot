import { z } from "zod";

export const CanonicalEnvelope = z.object({
  messageId: z.string().min(1),
  channel: z.literal("whatsapp"),
  senderId: z.string().min(1),
  senderDisplayName: z.string().min(1).optional(),
  body: z.string().min(1),
  attachments: z
    .array(
      z.object({
        kind: z.enum(["audio", "document", "image", "video"]),
        providerMediaId: z.string().min(1).optional(),
        mimeType: z.string().min(1).optional(),
        fileName: z.string().min(1).optional(),
        sha256: z.string().min(1).optional()
      })
    )
    .optional(),
  receivedAt: z.string().datetime(),
  transportMetadata: z.object({
    chatId: z.string().min(1),
    fromMe: z.boolean(),
    actor: z.enum(["client", "lawyer"]).optional()
  })
});

export type CanonicalEnvelope = z.infer<typeof CanonicalEnvelope>;
