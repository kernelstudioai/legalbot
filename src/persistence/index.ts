export type { AuditEventRecord, AuditLogStore } from "./auditLogStore.ts";
export type { CaseRecord, CaseStore, CreateCaseInput, UpdateCaseInput } from "./caseStore.ts";
export type {
  AppendConsentEventInput,
  ConsentEventRecord,
  ConsentState,
  ConsentStateRecord,
  ConsentStore,
  SetConsentStateOptions
} from "./consentStore.ts";
export { consentStates } from "./consentStore.ts";
export { sanitizePersistenceMetadata } from "./metadataSanitizer.ts";
export {
  createInMemoryPersistenceService,
  createPersistenceService,
  createSqlitePersistenceService,
  type CreatePersistenceServiceOptions,
  type MarkMessageProcessedMetadata,
  type PersistenceAuditEventInput,
  type PersistenceConsentStateResult,
  type PersistenceProcessedMessageResult,
  type PersistenceService,
  type SetConsentStateMetadata,
  type SqlitePersistenceService
} from "./persistenceService.ts";
export type {
  MarkProcessedMessageResult,
  ProcessedMessageRecord,
  ProcessedMessageStore
} from "./processedMessageStore.ts";
export {
  InMemoryAuditLogStore,
  InMemoryCaseStore,
  InMemoryConsentStore,
  InMemoryProcessedMessageStore
} from "./testing/inMemoryStores.ts";
