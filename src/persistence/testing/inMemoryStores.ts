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
import type { PersistenceTransactionRunner } from "../persistenceService.ts";

const defaultCaseStatus = "draft";
const cloneValue = <T>(value: T): T => structuredClone(value);
const cloneMap = <K, V>(input: Map<K, V>): Map<K, V> =>
  new Map([...input.entries()].map(([key, value]) => [key, cloneValue(value)] as const));

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

  createSnapshot(): Map<string, CaseRecord> {
    return cloneMap(this.cases);
  }

  restoreSnapshot(snapshot: Map<string, CaseRecord>): void {
    this.cases.clear();

    for (const [caseId, record] of snapshot.entries()) {
      this.cases.set(caseId, cloneValue(record));
    }
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

  createSnapshot(): Map<string, ProcessedMessageRecord> {
    return cloneMap(this.processedMessages);
  }

  restoreSnapshot(snapshot: Map<string, ProcessedMessageRecord>): void {
    this.processedMessages.clear();

    for (const [messageId, record] of snapshot.entries()) {
      this.processedMessages.set(messageId, cloneValue(record));
    }
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

  createSnapshot(): AuditEventRecord[] {
    return cloneValue(this.events);
  }

  restoreSnapshot(snapshot: AuditEventRecord[]): void {
    this.events.splice(0, this.events.length, ...cloneValue(snapshot));
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

  createSnapshot(): {
    consentStates: Map<string, ConsentStateRecord>;
    consentEvents: ConsentEventRecord[];
  } {
    return {
      consentStates: cloneMap(this.consentStates),
      consentEvents: cloneValue(this.consentEvents)
    };
  }

  restoreSnapshot(snapshot: {
    consentStates: Map<string, ConsentStateRecord>;
    consentEvents: ConsentEventRecord[];
  }): void {
    this.consentStates.clear();

    for (const [subjectId, record] of snapshot.consentStates.entries()) {
      this.consentStates.set(subjectId, cloneValue(record));
    }

    this.consentEvents.splice(0, this.consentEvents.length, ...cloneValue(snapshot.consentEvents));
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

  createSnapshot(): {
    intakeStates: Map<string, IntakeStateRecord>;
    intakeFields: Map<string, Map<IntakeFieldName, IntakeFieldRecord>>;
    intakeEvents: IntakeEventRecord[];
  } {
    return {
      intakeStates: cloneMap(this.intakeStates),
      intakeFields: new Map(
        [...this.intakeFields.entries()].map(([subjectId, fields]) => [subjectId, cloneMap(fields)] as const)
      ),
      intakeEvents: cloneValue(this.intakeEvents)
    };
  }

  restoreSnapshot(snapshot: {
    intakeStates: Map<string, IntakeStateRecord>;
    intakeFields: Map<string, Map<IntakeFieldName, IntakeFieldRecord>>;
    intakeEvents: IntakeEventRecord[];
  }): void {
    this.intakeStates.clear();

    for (const [subjectId, record] of snapshot.intakeStates.entries()) {
      this.intakeStates.set(subjectId, cloneValue(record));
    }

    this.intakeFields.clear();

    for (const [subjectId, fields] of snapshot.intakeFields.entries()) {
      this.intakeFields.set(subjectId, cloneMap(fields));
    }

    this.intakeEvents.splice(0, this.intakeEvents.length, ...cloneValue(snapshot.intakeEvents));
  }
}

export interface InMemoryPersistenceStoreBundle {
  caseStore: InMemoryCaseStore;
  processedMessageStore: InMemoryProcessedMessageStore;
  auditLogStore: InMemoryAuditLogStore;
  consentStore: InMemoryConsentStore;
  intakeStore: InMemoryIntakeStore;
}

export const createInMemoryPersistenceTransactionRunner = ({
  caseStore,
  processedMessageStore,
  auditLogStore,
  consentStore,
  intakeStore
}: InMemoryPersistenceStoreBundle): PersistenceTransactionRunner => ({
  async runInTransaction(operation) {
    const snapshot = {
      caseStore: caseStore.createSnapshot(),
      processedMessageStore: processedMessageStore.createSnapshot(),
      auditLogStore: auditLogStore.createSnapshot(),
      consentStore: consentStore.createSnapshot(),
      intakeStore: intakeStore.createSnapshot()
    };

    try {
      return await operation();
    } catch (error) {
      caseStore.restoreSnapshot(snapshot.caseStore);
      processedMessageStore.restoreSnapshot(snapshot.processedMessageStore);
      auditLogStore.restoreSnapshot(snapshot.auditLogStore);
      consentStore.restoreSnapshot(snapshot.consentStore);
      intakeStore.restoreSnapshot(snapshot.intakeStore);
      throw error;
    }
  }
});
