import { z } from "zod";

export const CanonicalEnvelope = z.object({
  messageId: z.string().min(1),
  channel: z.literal("whatsapp"),
  senderId: z.string().min(1),
  senderDisplayName: z.string().min(1).optional(),
  body: z.string().min(1),
  receivedAt: z.string().datetime(),
  transportMetadata: z.object({
    chatId: z.string().min(1),
    fromMe: z.boolean()
  })
});

export type CanonicalEnvelope = z.infer<typeof CanonicalEnvelope>;
