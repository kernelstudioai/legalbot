# Persistence

## Scope

M7 adds a persistence skeleton only. It introduces storage interfaces, an explicit SQLite migration runner, and SQLite store skeletons without wiring database writes into the live OpenWA listener.

## Interfaces

- `CaseStore`: minimal create/get/update support for case metadata only.
- `ProcessedMessageStore`: duplicate-detection markers keyed by transport message id.
- `AuditLogStore`: append-only audit events with optional JSON metadata.

## SQLite Foundation

- `DATABASE_URL` defaults to `file:./data/legalbot.sqlite`.
- `DATABASE_MIGRATIONS_ENABLED` defaults to `true`.
- The SQLite migration runner is explicit and testable through `runSqliteMigrations(...)` and `SqliteMigrationRunner`.
- Current tables:
  - `cases`
  - `processed_messages`
  - `audit_events`
  - `schema_migrations`

## Data Boundaries

- `data/` stays ignored by git, and runtime/session/browser/database artifacts must not be committed.
- No WhatsApp message bodies are persisted in M7.
- No database writes occur in live message handling yet.
- No persistence is introduced before future privacy and consent gates for legal intake.

## File Location And Backups

- The default database file location is [data/legalbot.sqlite](/C:/Users/Jacopo/Documents/legalbot/data/legalbot.sqlite) when persistence is explicitly opened outside tests.
- Test coverage uses temp directories so database files are created only under ephemeral test paths.
- Backups are an operator concern for later milestones. M7 does not add automated backup or retention jobs, so any future production use must define backup frequency, encryption, and restore verification before enabling real writes.

## Migration Control

- When `DATABASE_MIGRATIONS_ENABLED=true`, an explicit migration run can create or update the SQLite schema.
- When `DATABASE_MIGRATIONS_ENABLED=false`, callers can skip schema changes while still deciding separately whether to open SQLite at all.
- The migration boundary is intentionally separate from OpenWA startup so transport smoke behavior remains unchanged.
