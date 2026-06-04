# Persistence

## Scope

M8 keeps persistence bootstrap operator-only. It adds explicit database bootstrap and status commands on top of the M7 SQLite skeleton without wiring database writes into the live OpenWA listener.

## Interfaces

- `CaseStore`: minimal create/get/update support for case metadata only.
- `ProcessedMessageStore`: duplicate-detection markers keyed by transport message id.
- `AuditLogStore`: append-only audit events with optional JSON metadata.

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
- No database writes occur in live message handling yet.
- No live WhatsApp persistence is enabled yet, and no persistence is introduced before future privacy and consent gates for legal intake.

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
