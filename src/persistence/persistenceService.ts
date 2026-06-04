import type { AuditEventRecord, AuditLogStore } from "./auditLogStore.ts";
import type { CaseRecord, CaseStore, CreateCaseInput } from "./caseStore.ts";
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
  SqliteProcessedMessageStore
} from "./sqlite/index.ts";
import {
  InMemoryAuditLogStore,
  InMemoryCaseStore,
  InMemoryProcessedMessageStore
} from "./testing/inMemoryStores.ts";

const defaultChannel = "whatsapp" as const;
const forbiddenContentKeys = new Set(["body", "content", "messagebody", "message_body", "text"]);

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

export interface PersistenceService {
  isMessageProcessed(messageId: string): Promise<boolean>;
  markMessageProcessed(
    messageId: string,
    metadata: MarkMessageProcessedMetadata
  ): Promise<PersistenceProcessedMessageResult>;
  appendAuditEvent(event: PersistenceAuditEventInput): Promise<AuditEventRecord>;
  createCase(input: CreateCaseInput): Promise<CaseRecord>;
  getCase(caseId: string): Promise<CaseRecord | null>;
  updateCaseStatus(caseId: string, status: string): Promise<CaseRecord | null>;
}

export interface CreatePersistenceServiceOptions {
  caseStore: CaseStore;
  processedMessageStore: ProcessedMessageStore;
  auditLogStore: AuditLogStore;
  now?: () => string;
}

export interface SqlitePersistenceService extends PersistenceService {
  readonly databasePath: string;
  close(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitizedEntries = Object.entries(value).flatMap(([key, entryValue]) => {
    if (forbiddenContentKeys.has(key.toLowerCase())) {
      return [];
    }

    return [[key, sanitizeValue(entryValue)]];
  });

  return Object.fromEntries(sanitizedEntries);
};

const sanitizeMetadata = (
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!metadata) {
    return undefined;
  }

  const sanitized = sanitizeValue(metadata);

  if (!isRecord(sanitized) || Object.keys(sanitized).length === 0) {
    return undefined;
  }

  return sanitized;
};

export const createPersistenceService = ({
  caseStore,
  processedMessageStore,
  auditLogStore,
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
    const sanitizedMetadata = sanitizeMetadata(metadata.metadata);
    const result = await processedMessageStore.markProcessed(record);

    return sanitizedMetadata
      ? { ...result, record, sanitizedMetadata }
      : { ...result, record };
  },

  async appendAuditEvent(event) {
    const sanitizedMetadata = sanitizeMetadata(event.metadata);
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
    auditLogStore: new SqliteAuditLogStore(database)
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
    auditLogStore: new InMemoryAuditLogStore()
  });
