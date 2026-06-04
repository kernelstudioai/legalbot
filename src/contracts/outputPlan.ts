import { z } from "zod";

export const OutputMessage = z.object({
  kind: z.literal("text"),
  to: z.string().min(1),
  body: z.string().min(1)
});

export const OutputPlan = z.object({
  messages: z.array(OutputMessage),
  auditNote: z.string().min(1)
});

export type OutputPlan = z.infer<typeof OutputPlan>;
