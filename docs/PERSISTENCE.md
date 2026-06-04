# Persistence

## Scope

M10 adds optional technical runtime persistence for the OpenWA smoke runtime. It remains opt-in, keeps transport dedupe process-local first, and stores only restart-safe processed-message markers plus sanitized technical audit events. It does not add legal-intake persistence.

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
- The OpenWA smoke runtime can inject an existing `PersistenceService` or create a SQLite-backed one only when `TECHNICAL_PERSISTENCE_ENABLED=true`.

## SQLite Foundation

- `DATABASE_URL` defaults to `file:./data/legalbot.sqlite`.
- `DATABASE_MIGRATIONS_ENABLED` defaults to `true`.
- `TECHNICAL_PERSISTENCE_ENABLED` defaults to `false`.
- Operators can run `npm run db:migrate` to apply the committed SQLite schema explicitly.
- Operators can run `npm run db:status` to inspect applied and pending migration ids without dumping table contents.
- The SQLite migration runner is explicit and testable through `runSqliteMigrations(...)`, `getSqliteMigrationStatus(...)`, and `SqliteMigrationRunner`.
- Technical runtime startup never runs migrations. When `TECHNICAL_PERSISTENCE_ENABLED=true`, startup requires `npm run db:migrate` to have been completed already or it fails safely with a clear error.
- Current tables:
  - `cases`
  - `processed_messages`
  - `audit_events`
  - `schema_migrations`

## Data Boundaries

- `data/` stays ignored by git, and runtime/session/browser/database artifacts must not be committed.
- No WhatsApp message bodies are persisted.
- OpenWA runtime dedupe persists only processed `messageId` markers plus redacted technical metadata needed by the current store contract.
- Technical audit events are sanitized before persistence and must not include message bodies, legal facts, full phone numbers, browser paths, session paths, tokens, or QR data.
- Live WhatsApp runtime writes never create or update cases in M10.
- No consent-gated legal-intake persistence is enabled yet.
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
- The migration boundary is intentionally separate from OpenWA startup so transport smoke behavior stays unchanged when technical persistence is disabled.
- `createSqlitePersistenceService(...)` expects a database path that has already been prepared through the explicit migration boundary or an equivalent test setup.

## OpenWA Runtime Behavior

- `TECHNICAL_PERSISTENCE_ENABLED=false`
  The smoke runtime preserves current behavior exactly. It does not open SQLite, run migrations, or call runtime persistence.
- `TECHNICAL_PERSISTENCE_ENABLED=true`
  The smoke runtime keeps the existing in-memory duplicate guard as the first line of protection, then checks restart-safe dedupe through `PersistenceService.isMessageProcessed(messageId)` before the pipeline runs.
- Successful dispatches call `markMessageProcessed(messageId, ...)` after dispatch succeeds.
- Sanitized audit events are appended for:
  - `openwa_runtime_started`
  - `openwa_message_received`
  - `openwa_message_ignored_duplicate`
  - `openwa_output_dispatched`
  - `openwa_dispatch_failed`
  - `openwa_runtime_stopped`
