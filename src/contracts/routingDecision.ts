import { z } from "zod";

export const RoutingDecision = z.object({
  targetRuntime: z.enum(["client", "lawyer", "shared", "drop"]),
  reason: z.string().min(1),
  labels: z.array(z.string())
});

export type RoutingDecision = z.infer<typeof RoutingDecision>;
