import type {
  AuditEventRecord,
  AuditLogStore,
  CaseRecord,
  CaseStore,
  CreateCaseInput,
  MarkProcessedMessageResult,
  ProcessedMessageRecord,
  ProcessedMessageStore,
  UpdateCaseInput
} from "../index.ts";

const defaultCaseChannel = "whatsapp" as const;
const defaultCaseStatus = "pending";

export class InMemoryCaseStore implements CaseStore {
  private readonly cases = new Map<string, CaseRecord>();

  async create(input: CreateCaseInput): Promise<CaseRecord> {
    const record: CaseRecord = {
      caseId: input.caseId,
      channel: input.channel ?? defaultCaseChannel,
      clientPhoneE164: input.clientPhoneE164,
      status: input.status ?? defaultCaseStatus,
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? input.createdAt ?? new Date().toISOString()
    };
    this.cases.set(record.caseId, record);
    return record;
  }

  async getById(caseId: string): Promise<CaseRecord | null> {
    return this.cases.get(caseId) ?? null;
  }

  async update(input: UpdateCaseInput): Promise<CaseRecord | null> {
    const existing = this.cases.get(input.caseId);

    if (!existing) {
      return null;
    }

    const updated: CaseRecord = {
      ...existing,
      status: input.status ?? existing.status,
      updatedAt: input.updatedAt
    };
    this.cases.set(updated.caseId, updated);
    return updated;
  }
}

export class InMemoryProcessedMessageStore implements ProcessedMessageStore {
  private readonly processedMessages = new Map<string, ProcessedMessageRecord>();

  async has(messageId: string): Promise<boolean> {
    return this.processedMessages.has(messageId);
  }

  async markProcessed(
    record: ProcessedMessageRecord
  ): Promise<MarkProcessedMessageResult> {
    if (this.processedMessages.has(record.messageId)) {
      return { inserted: false };
    }

    this.processedMessages.set(record.messageId, record);
    return { inserted: true };
  }
}

export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly events: AuditEventRecord[] = [];

  async append(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }

  snapshot(): AuditEventRecord[] {
    return [...this.events];
  }
}
