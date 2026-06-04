# Persistence

## Scope

M9 keeps persistence bootstrap and runtime persistence detached from live OpenWA message handling. It adds a `PersistenceService` application boundary on top of the M7 store interfaces and M8 operator DB commands without wiring database writes into the current smoke listener.

## Interfaces

- `CaseStore`: minimal create/get/update support for case metadata only.
- `ProcessedMessageStore`: duplicate-detection markers keyed by transport message id.
- `AuditLogStore`: append-only audit events with optional JSON metadata.
- `PersistenceService`: the only application boundary that future intake/runtime code should use when it needs persistence.

## Persistence Service Boundary

- `src/persistence/persistenceService.ts` composes `CaseStore`, `ProcessedMessageStore`, and `AuditLogStore`.
- Supported service methods:
  - `isMessageProcessed(messageId)`
  - `markMessageProcessed(messageId, metadata)`
  - `appendAuditEvent(event)`
  - `createCase(input)`
  - `getCase(caseId)`
  - `updateCaseStatus(caseId, status)`
- `createSqlitePersistenceService(config)` opens a SQLite-backed service against an explicit `file:` database path.
- `createInMemoryPersistenceService()` provides a process-local service for tests and non-SQLite callers.
- The service sanitizes processed-message metadata and audit payloads by stripping body/content/text fields before they can cross the boundary.

## SQLite Foundation

- `DATABASE_URL` defaults to `file:./data/legalbot.sqlite`.
- `DATABASE_MIGRATIONS_ENABLED` defaults to `true`.
- Operators can run `npm run db:migrate` to apply the committed SQLite schema explicitly.
- Operators can run `npm run db:status` to inspect applied and pending migration ids without dumping table contents.
- The SQLite migration runner is explicit and testable through `runSqliteMigrations(...)`, `getSqliteMigrationStatus(...)`, and `SqliteMigrationRunner`.
- Current tables:
  - `cases`
  - `processed_messages`
  - `audit_events`
  - `schema_migrations`

## Data Boundaries

- `data/` stays ignored by git, and runtime/session/browser/database artifacts must not be committed.
- No WhatsApp message bodies are persisted.
- Processed-message metadata and audit payloads must not include `messageBody`, `body`, `content`, or `text` fields by default.
- No database writes occur in live message handling yet.
- No live WhatsApp persistence is enabled yet, and no persistence is introduced before future privacy and consent gates for legal intake.
- Any future runtime usage of `PersistenceService` still requires an explicit consent/intake gate before live message content or legal-intake state is written.

## File Location And Backups

- The default database file location is [data/legalbot.sqlite](/C:/Users/Jacopo/Documents/legalbot/data/legalbot.sqlite) when persistence is explicitly opened outside tests.
- Test coverage uses temp directories so database files are created only under ephemeral test paths.
- `data/` remains git-ignored because it may contain local SQLite files created by `npm run db:migrate` or `npm run db:status`.
- Backups remain an operator concern. M8 does not add automated backup or retention jobs, so any future production use must define backup frequency, encryption, and restore verification before enabling real writes.

## Migration Control

- When `DATABASE_MIGRATIONS_ENABLED=true`, `npm run db:migrate` creates parent directories as needed and applies the committed migration list.
- When `DATABASE_MIGRATIONS_ENABLED=false`, `npm run db:migrate` reports pending migrations and skips schema changes.
- `npm run db:status` reports applied and pending migration ids and counts without reading or printing table contents.
- The migration boundary is intentionally separate from OpenWA startup so transport smoke behavior remains unchanged.
- `createSqlitePersistenceService(...)` expects a database path that has already been prepared through the explicit migration boundary or an equivalent test setup.
