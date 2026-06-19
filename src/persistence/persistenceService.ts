import type { AuditEventRecord, AuditLogStore } from "./auditLogStore.ts";
import type { CaseRecord, CaseStatus, CaseStore, CreateCaseInput } from "./caseStore.ts";
import type {
  AppendConsentEventInput,
  ConsentEventRecord,
  ConsentState,
  ConsentStateRecord,
  ConsentStore
} from "./consentStore.ts";
import type {
  AppendIntakeEventInput,
  IntakeEventRecord,
  IntakeFieldName,
  IntakeFieldRecord,
  IntakeSnapshot,
  IntakeState,
  IntakeStateRecord,
  IntakeStore
} from "./intakeStore.ts";
import { sanitizePersistenceMetadata } from "./metadataSanitizer.ts";
import type {
  MarkProcessedMessageResult,
  ProcessedMessageRecord,
  ProcessedMessageStore
} from "./processedMessageStore.ts";
import type {
  CreatePracticeInput,
  PracticeListFilter,
  PracticeRecord,
  PracticeStore
} from "./practiceStore.ts";
import {
  openSqliteDatabase,
  createSqliteTransactionRunner,
  type OpenSqliteDatabaseOptions,
  SqliteAuditLogStore,
  SqliteCaseStore,
  SqliteConsentStore,
  SqliteIntakeStore,
  SqlitePracticeStore,
  SqliteProcessedMessageStore
} from "./sqlite/index.ts";
import {
  InMemoryAuditLogStore,
  InMemoryCaseStore,
  InMemoryConsentStore,
  InMemoryIntakeStore,
  InMemoryPracticeStore,
  InMemoryProcessedMessageStore,
  createInMemoryPersistenceTransactionRunner
} from "./testing/inMemoryStores.ts";

const defaultChannel = "whatsapp" as const;

export interface MarkMessageProcessedMetadata {
  senderId: string;
  transportChatId: string;
  channel?: "whatsapp";
  processedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PersistenceProcessedMessageResult extends MarkProcessedMessageResult {
  record: ProcessedMessageRecord;
  sanitizedMetadata?: Record<string, unknown>;
}

export interface PersistenceAuditEventInput {
  eventId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface SetConsentStateMetadata {
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PersistenceConsentStateResult {
  record: ConsentStateRecord;
  sanitizedMetadata?: Record<string, unknown>;
}

export interface SetIntakeStateMetadata {
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PersistenceIntakeStateResult {
  record: IntakeStateRecord;
  sanitizedMetadata?: Record<string, unknown>;
}

export interface SetIntakeFieldMetadata {
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PersistenceIntakeFieldResult {
  record: IntakeFieldRecord;
  sanitizedMetadata?: Record<string, unknown>;
}

export interface PersistenceIntakeSnapshotResult {
  snapshot: IntakeSnapshot | null;
}

export interface PersistenceIntakeEventResult {
  event: IntakeEventRecord;
  sanitizedMetadata?: Record<string, unknown>;
}

export interface PersistenceCreateCaseWithAuditInput {
  case: CreateCaseInput;
  auditEvent: PersistenceAuditEventInput;
}

export interface PersistenceCreateCaseWithAuditResult {
  caseRecord: CaseRecord;
  auditEvent: AuditEventRecord;
}

export interface PersistenceCreatePracticeResult {
  practiceRecord: PracticeRecord;
}

export interface PersistenceTransactionRunner {
  runInTransaction<T>(operation: () => Promise<T>): Promise<T>;
}

export interface PersistenceService {
  runInTransaction<T>(operation: () => Promise<T>): Promise<T>;
  isMessageProcessed(messageId: string): Promise<boolean>;
  markMessageProcessed(
    messageId: string,
    metadata: MarkMessageProcessedMetadata
  ): Promise<PersistenceProcessedMessageResult>;
  appendAuditEvent(event: PersistenceAuditEventInput): Promise<AuditEventRecord>;
  getConsentState(subjectId: string): Promise<ConsentState>;
  setConsentState(
    subjectId: string,
    state: ConsentState,
    metadata?: SetConsentStateMetadata
  ): Promise<PersistenceConsentStateResult>;
  appendConsentEvent(event: AppendConsentEventInput): Promise<ConsentEventRecord>;
  getIntakeState(subjectId: string): Promise<IntakeState>;
  setIntakeState(
    subjectId: string,
    state: IntakeState,
    metadata?: SetIntakeStateMetadata
  ): Promise<PersistenceIntakeStateResult>;
  setIntakeField(
    subjectId: string,
    fieldName: IntakeFieldName,
    value: string,
    metadata?: SetIntakeFieldMetadata
  ): Promise<PersistenceIntakeFieldResult>;
  getIntakeSnapshot(subjectId: string): Promise<IntakeSnapshot | null>;
  appendIntakeEvent(event: AppendIntakeEventInput): Promise<PersistenceIntakeEventResult>;
  createCase(input: CreateCaseInput): Promise<CaseRecord>;
  createCaseWithAudit(
    input: PersistenceCreateCaseWithAuditInput
  ): Promise<PersistenceCreateCaseWithAuditResult>;
  findDraftCaseBySubjectId(subjectId: string): Promise<CaseRecord | null>;
  getCase(caseId: string): Promise<CaseRecord | null>;
  updateCaseStatus(caseId: string, status: CaseStatus): Promise<CaseRecord | null>;
  allocatePracticeCode(): Promise<string>;
  createPractice(input: CreatePracticeInput): Promise<PracticeRecord>;
  findPracticeByCode(practiceCode: string): Promise<PracticeRecord | null>;
  findPracticeBySourceMessageId(sourceMessageId: string): Promise<PracticeRecord | null>;
  listPractices(filter?: PracticeListFilter): Promise<PracticeRecord[]>;
}

export interface CreatePersistenceServiceOptions {
  caseStore: CaseStore;
  processedMessageStore: ProcessedMessageStore;
  auditLogStore: AuditLogStore;
  consentStore: ConsentStore;
  intakeStore: IntakeStore;
  practiceStore?: PracticeStore;
  transactionRunner?: PersistenceTransactionRunner;
  now?: () => string;
}

export interface SqlitePersistenceService extends PersistenceService {
  readonly databasePath: string;
  close(): void;
}

export const createPersistenceService = ({
  caseStore,
  processedMessageStore,
  auditLogStore,
  consentStore,
  intakeStore,
  practiceStore,
  transactionRunner,
  now = () => new Date().toISOString()
}: CreatePersistenceServiceOptions): PersistenceService => {
  const requirePracticeStore = (): PracticeStore => {
    if (!practiceStore) {
      throw new Error("Practice persistence is not available.");
    }

    return practiceStore;
  };

  const toStoredAuditEvent = (event: PersistenceAuditEventInput): AuditEventRecord => {
    const sanitizedMetadata = sanitizePersistenceMetadata(event.metadata);

    return {
      eventId: event.eventId,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      occurredAt: event.occurredAt ?? now(),
      ...(sanitizedMetadata
        ? {
            metadata: sanitizedMetadata
          }
        : {})
    };
  };

  const createCaseWithAudit = async (
    input: PersistenceCreateCaseWithAuditInput
  ): Promise<PersistenceCreateCaseWithAuditResult> => {
    const caseRecord = await caseStore.create(input.case);
    const auditEvent = toStoredAuditEvent(input.auditEvent);

    await auditLogStore.append(auditEvent);

    return {
      caseRecord,
      auditEvent
    };
  };

  return {
    async runInTransaction(operation) {
      if (transactionRunner) {
        return transactionRunner.runInTransaction(operation);
      }

      return operation();
    },

    async isMessageProcessed(messageId) {
      return processedMessageStore.has(messageId);
    },

    async markMessageProcessed(messageId, metadata) {
      const record: ProcessedMessageRecord = {
        messageId,
        channel: metadata.channel ?? defaultChannel,
        senderId: metadata.senderId,
        transportChatId: metadata.transportChatId,
        processedAt: metadata.processedAt ?? now()
      };
      const sanitizedMetadata = sanitizePersistenceMetadata(metadata.metadata);
      const result = await processedMessageStore.markProcessed(record);

      return sanitizedMetadata
        ? { ...result, record, sanitizedMetadata }
        : { ...result, record };
    },

    async appendAuditEvent(event) {
      const storedEvent = toStoredAuditEvent(event);

      await auditLogStore.append(storedEvent);
      return storedEvent;
    },

    async getConsentState(subjectId) {
      return consentStore.getConsentState(subjectId);
    },

    async setConsentState(subjectId, state, metadata) {
      const sanitizedMetadata = sanitizePersistenceMetadata(metadata?.metadata);
      const record = await consentStore.setConsentState(subjectId, state, {
        updatedAt: metadata?.updatedAt ?? now(),
        ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {})
      });

      return sanitizedMetadata ? { record, sanitizedMetadata } : { record };
    },

    async appendConsentEvent(event) {
      const sanitizedMetadata = sanitizePersistenceMetadata(event.metadata);
      const storedEvent: ConsentEventRecord = {
        eventId: event.eventId,
        subjectId: event.subjectId,
        state: event.state,
        eventType: event.eventType,
        occurredAt: event.occurredAt ?? now(),
        ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {})
      };

      await consentStore.appendConsentEvent(storedEvent);
      return storedEvent;
    },

    async getIntakeState(subjectId) {
      return intakeStore.getIntakeState(subjectId);
    },

    async setIntakeState(subjectId, state, metadata) {
      const sanitizedMetadata = sanitizePersistenceMetadata(metadata?.metadata);
      const record = await intakeStore.setIntakeState(subjectId, state, {
        updatedAt: metadata?.updatedAt ?? now(),
        ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {})
      });

      return sanitizedMetadata ? { record, sanitizedMetadata } : { record };
    },

    async setIntakeField(subjectId, fieldName, value, metadata) {
      const sanitizedMetadata = sanitizePersistenceMetadata(metadata?.metadata);
      const record = await intakeStore.setIntakeField(subjectId, fieldName, value, {
        updatedAt: metadata?.updatedAt ?? now(),
        ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {})
      });

      return sanitizedMetadata ? { record, sanitizedMetadata } : { record };
    },

    async getIntakeSnapshot(subjectId) {
      return intakeStore.getIntakeSnapshot(subjectId);
    },

    async appendIntakeEvent(event) {
      const sanitizedMetadata = sanitizePersistenceMetadata(event.metadata);
      const storedEvent: IntakeEventRecord = {
        eventId: event.eventId,
        subjectId: event.subjectId,
        eventType: event.eventType,
        occurredAt: event.occurredAt ?? now(),
        ...(event.state ? { state: event.state } : {}),
        ...(event.fieldName ? { fieldName: event.fieldName } : {}),
        ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {})
      };

      await intakeStore.appendIntakeEvent(storedEvent);
      return sanitizedMetadata ? { event: storedEvent, sanitizedMetadata } : { event: storedEvent };
    },

    async createCase(input) {
      return caseStore.create(input);
    },

    async createCaseWithAudit(input) {
      return this.runInTransaction(() => createCaseWithAudit(input));
    },

    async findDraftCaseBySubjectId(subjectId) {
      return caseStore.findDraftBySubjectId(subjectId);
    },

    async getCase(caseId) {
      return caseStore.getById(caseId);
    },

    async updateCaseStatus(caseId, status) {
      return caseStore.update({
        caseId,
        status,
        updatedAt: now()
      });
    },

    async allocatePracticeCode() {
      return requirePracticeStore().allocateNextPracticeCode();
    },

    async createPractice(input) {
      return requirePracticeStore().create(input);
    },

    async findPracticeByCode(practiceCode) {
      return requirePracticeStore().findByPracticeCode(practiceCode);
    },

    async findPracticeBySourceMessageId(sourceMessageId) {
      return requirePracticeStore().findBySourceMessageId(sourceMessageId);
    },

    async listPractices(filter) {
      return requirePracticeStore().list(filter);
    }
  };
};

export const createSqlitePersistenceService = (
  config: OpenSqliteDatabaseOptions
): SqlitePersistenceService => {
  const { database, databasePath } = openSqliteDatabase(config);
  const service = createPersistenceService({
    caseStore: new SqliteCaseStore(database),
    processedMessageStore: new SqliteProcessedMessageStore(database),
    auditLogStore: new SqliteAuditLogStore(database),
    consentStore: new SqliteConsentStore(database),
    intakeStore: new SqliteIntakeStore(database),
    practiceStore: new SqlitePracticeStore(database),
    transactionRunner: createSqliteTransactionRunner(database)
  });

  return {
    ...service,
    databasePath,
    close() {
      database.close();
    }
  };
};

export const createInMemoryPersistenceService = (): PersistenceService => {
  const caseStore = new InMemoryCaseStore();
  const processedMessageStore = new InMemoryProcessedMessageStore();
  const auditLogStore = new InMemoryAuditLogStore();
  const consentStore = new InMemoryConsentStore();
  const intakeStore = new InMemoryIntakeStore();
  const practiceStore = new InMemoryPracticeStore();

  return createPersistenceService({
    caseStore,
    processedMessageStore,
    auditLogStore,
    consentStore,
    intakeStore,
    practiceStore,
    transactionRunner: createInMemoryPersistenceTransactionRunner({
      caseStore,
      processedMessageStore,
      auditLogStore,
      consentStore,
      intakeStore,
      practiceStore
    })
  });
};
