import type {
  AuditEventRecord,
  AuditLogStore,
  CaseRecord,
  CaseStore,
  ConsentEventRecord,
  ConsentState,
  ConsentStateRecord,
  ConsentStore,
  CreateCaseInput,
  IntakeEventRecord,
  IntakeFieldName,
  IntakeFieldRecord,
  IntakeSnapshot,
  IntakeState,
  IntakeStateRecord,
  IntakeStore,
  MarkProcessedMessageResult,
  ProcessedMessageRecord,
  ProcessedMessageStore,
  SetConsentStateOptions,
  SetIntakeFieldOptions,
  SetIntakeStateOptions,
  UpdateCaseInput
} from "../index.ts";

const defaultCaseStatus = "draft";

export class InMemoryCaseStore implements CaseStore {
  private readonly cases = new Map<string, CaseRecord>();

  async create(input: CreateCaseInput): Promise<CaseRecord> {
    const record: CaseRecord = {
      caseId: input.caseId,
      subjectId: input.subjectId,
      status: input.status ?? defaultCaseStatus,
      name: input.name,
      problemSummary: input.problemSummary,
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

export class InMemoryConsentStore implements ConsentStore {
  private readonly consentStates = new Map<string, ConsentStateRecord>();
  private readonly consentEvents: ConsentEventRecord[] = [];

  async getConsentState(subjectId: string): Promise<ConsentState> {
    return this.consentStates.get(subjectId)?.state ?? "unknown";
  }

  async setConsentState(
    subjectId: string,
    state: ConsentState,
    options: SetConsentStateOptions = {}
  ): Promise<ConsentStateRecord> {
    const record: ConsentStateRecord = {
      subjectId,
      state,
      updatedAt: options.updatedAt ?? new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {})
    };

    this.consentStates.set(subjectId, record);
    return record;
  }

  async appendConsentEvent(event: ConsentEventRecord): Promise<void> {
    this.consentEvents.push(event);
  }

  snapshotStates(): ConsentStateRecord[] {
    return [...this.consentStates.values()];
  }

  snapshotEvents(): ConsentEventRecord[] {
    return [...this.consentEvents];
  }
}

const acceptedIntakeFields = new Set<IntakeFieldName>(["name", "problemSummary"]);

export class InMemoryIntakeStore implements IntakeStore {
  private readonly intakeStates = new Map<string, IntakeStateRecord>();
  private readonly intakeFields = new Map<string, Map<IntakeFieldName, IntakeFieldRecord>>();
  private readonly intakeEvents: IntakeEventRecord[] = [];

  async getIntakeState(subjectId: string): Promise<IntakeState> {
    return this.intakeStates.get(subjectId)?.state ?? "not_started";
  }

  async setIntakeState(
    subjectId: string,
    state: IntakeState,
    options: SetIntakeStateOptions = {}
  ): Promise<IntakeStateRecord> {
    const record: IntakeStateRecord = {
      subjectId,
      state,
      updatedAt: options.updatedAt ?? new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {})
    };

    this.intakeStates.set(subjectId, record);
    return record;
  }

  async setIntakeField(
    subjectId: string,
    fieldName: IntakeFieldName,
    value: string,
    options: SetIntakeFieldOptions = {}
  ): Promise<IntakeFieldRecord> {
    if (!acceptedIntakeFields.has(fieldName)) {
      throw new Error(`Unsupported intake field: ${fieldName}`);
    }

    const record: IntakeFieldRecord = {
      subjectId,
      fieldName,
      value,
      updatedAt: options.updatedAt ?? new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {})
    };

    const subjectFields = this.intakeFields.get(subjectId) ?? new Map<IntakeFieldName, IntakeFieldRecord>();
    subjectFields.set(fieldName, record);
    this.intakeFields.set(subjectId, subjectFields);
    return record;
  }

  async getIntakeSnapshot(subjectId: string): Promise<IntakeSnapshot | null> {
    const stateRecord = this.intakeStates.get(subjectId);
    const fieldRecords = this.intakeFields.get(subjectId);

    if (!stateRecord && !fieldRecords) {
      return null;
    }

    return {
      subjectId,
      state: stateRecord?.state ?? "not_started",
      updatedAt: stateRecord?.updatedAt ?? new Date().toISOString(),
      fields: fieldRecords
        ? Object.fromEntries(
            [...fieldRecords.entries()].map(([fieldName, record]) => [fieldName, record.value])
          )
        : {}
    };
  }

  async appendIntakeEvent(event: IntakeEventRecord): Promise<void> {
    this.intakeEvents.push(event);
  }

  snapshotStates(): IntakeStateRecord[] {
    return [...this.intakeStates.values()];
  }

  snapshotFields(): IntakeFieldRecord[] {
    return [...this.intakeFields.values()].flatMap((fields) => [...fields.values()]);
  }

  snapshotEvents(): IntakeEventRecord[] {
    return [...this.intakeEvents];
  }
}
