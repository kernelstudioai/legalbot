import type { CanonicalEnvelopeType, OutputPlanType, RuntimeDecisionType } from "../contracts";

export interface ConversationRecord {
  envelope: CanonicalEnvelopeType;
  runtimeDecision: RuntimeDecisionType;
  outputPlan: OutputPlanType;
}

export interface ConversationStore {
  save(record: ConversationRecord): Promise<void>;
  findByMessageId(messageId: string): Promise<ConversationRecord | null>;
}
