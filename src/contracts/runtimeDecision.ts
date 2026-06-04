import { z } from "zod";

export const RuntimeDecision = z.object({
  actor: z.enum(["client", "lawyer", "shared"]),
  action: z.enum(["acknowledge", "queue-review", "ignore"]),
  rationale: z.string().min(1)
});

export type RuntimeDecision = z.infer<typeof RuntimeDecision>;
