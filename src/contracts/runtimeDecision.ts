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
    "intake_ask_identity",
    "intake_clarify_identity",
    "intake_ask_problem_summary",
    "intake_complete_ack",
    "intake_invalid_response"
  ]),
  rationale: z.string().min(1),
  messageOverride: z.string().min(1).optional()
});

export type RuntimeDecision = z.infer<typeof RuntimeDecision>;
