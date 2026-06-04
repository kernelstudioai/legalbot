import type { AuditEventRecord, AuditLogStore } from "./auditLogStore.ts";
import type { CaseRecord, CaseStore, CreateCaseInput } from "./caseStore.ts";
import type {
  AppendConsentEventInput,
  ConsentEventRecord,
  ConsentState,
  ConsentStateRecord,
  ConsentStore
} from "./consentStore.ts";
import { sanitizePersistenceMetadata } from "./metadataSanitizer.ts";
import type {
  MarkProcessedMessageResult,
  ProcessedMessageRecord,
  ProcessedMessageStore
} from "./processedMessageStore.ts";
import {
  openSqliteDatabase,
  type OpenSqliteDatabaseOptions,
  SqliteAuditLogStore,
  SqliteCaseStore,
  SqliteConsentStore,
  SqliteProcessedMessageStore
} from "./sqlite/index.ts";
import {
  InMemoryAuditLogStore,
  InMemoryCaseStore,
  InMemoryConsentStore,
  InMemoryProcessedMessageStore
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

export interface PersistenceService {
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
  createCase(input: CreateCaseInput): Promise<CaseRecord>;
  getCase(caseId: string): Promise<CaseRecord | null>;
  updateCaseStatus(caseId: string, status: string): Promise<CaseRecord | null>;
}

export interface CreatePersistenceServiceOptions {
  caseStore: CaseStore;
  processedMessageStore: ProcessedMessageStore;
  auditLogStore: AuditLogStore;
  consentStore: ConsentStore;
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
  now = () => new Date().toISOString()
}: CreatePersistenceServiceOptions): PersistenceService => ({
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
    const sanitizedMetadata = sanitizePersistenceMetadata(event.metadata);
    const storedEvent: AuditEventRecord = {
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

  async createCase(input) {
    return caseStore.create(input);
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
  }
});

export const createSqlitePersistenceService = (
  config: OpenSqliteDatabaseOptions
): SqlitePersistenceService => {
  const { database, databasePath } = openSqliteDatabase(config);
  const service = createPersistenceService({
    caseStore: new SqliteCaseStore(database),
    processedMessageStore: new SqliteProcessedMessageStore(database),
    auditLogStore: new SqliteAuditLogStore(database),
    consentStore: new SqliteConsentStore(database)
  });

  return {
    ...service,
    databasePath,
    close() {
      database.close();
    }
  };
};

export const createInMemoryPersistenceService = (): PersistenceService =>
  createPersistenceService({
    caseStore: new InMemoryCaseStore(),
    processedMessageStore: new InMemoryProcessedMessageStore(),
    auditLogStore: new InMemoryAuditLogStore(),
    consentStore: new InMemoryConsentStore()
  });
