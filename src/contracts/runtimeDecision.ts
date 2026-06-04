import { z } from "zod";

export const RuntimeDecision = z.object({
  actor: z.enum(["client", "lawyer", "shared"]),
  action: z.enum([
    "acknowledge",
    "queue-review",
    "ignore",
    "request_consent",
    "consent_granted_ack",
    "consent_denied_close",
    "consent_clarification",
    "intake_not_implemented"
  ]),
  rationale: z.string().min(1)
});

export type RuntimeDecision = z.infer<typeof RuntimeDecision>;
