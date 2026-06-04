# Persistence

## Scope

M10 adds optional technical runtime persistence for the OpenWA smoke runtime. It remains opt-in, keeps transport dedupe process-local first, and stores only restart-safe processed-message markers plus sanitized technical audit events.

M12 adds a consent-state persistence boundary only. It stores the current consent state plus sanitized consent metadata and append-only consent events. It still does not persist message transcripts, message bodies, legal facts, or full legal-intake records.

M13 wires that consent-state boundary into the live client runtime path without enabling intake persistence. The runtime may read consent state, upsert `requested` / `granted` / `denied`, and append consent events, but it still must not persist message bodies, legal facts, or create cases.

## Interfaces

- `CaseStore`: minimal create/get/update support for case metadata only.
- `ConsentStore`: current consent-state lookup, consent-state upsert, and append-only consent event history.
- `ProcessedMessageStore`: duplicate-detection markers keyed by transport message id.
- `AuditLogStore`: append-only audit events with optional JSON metadata.
- `PersistenceService`: the only application boundary that future intake/runtime code should use when it needs persistence.

## Persistence Service Boundary

- `src/persistence/persistenceService.ts` composes `CaseStore`, `ConsentStore`, `ProcessedMessageStore`, and `AuditLogStore`.
- Supported service methods:
  - `isMessageProcessed(messageId)`
  - `markMessageProcessed(messageId, metadata)`
  - `appendAuditEvent(event)`
  - `getConsentState(subjectId)`
  - `setConsentState(subjectId, state, metadata)`
  - `appendConsentEvent(event)`
  - `createCase(input)`
  - `getCase(caseId)`
  - `updateCaseStatus(caseId, status)`
- `createSqlitePersistenceService(config)` opens a SQLite-backed service against an explicit `file:` database path.
- `createInMemoryPersistenceService()` provides a process-local service for tests and non-SQLite callers.
- The service sanitizes processed-message metadata, audit payloads, and consent metadata before they can cross the boundary.
- The OpenWA smoke runtime can inject an existing `PersistenceService` or create a SQLite-backed one only when `TECHNICAL_PERSISTENCE_ENABLED=true`.
- Consent runtime wiring uses a narrower consent-only adapter in the application layer so M13 client consent writes stay separate from M10 technical dedupe and audit wiring.

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
  - `consent_states`
  - `consent_events`
  - `processed_messages`
  - `audit_events`
  - `schema_migrations`

## Data Boundaries

- `data/` stays ignored by git, and runtime/session/browser/database artifacts must not be committed.
- No WhatsApp message bodies are persisted.
- OpenWA runtime dedupe persists only processed `messageId` markers plus redacted technical metadata needed by the current store contract.
- Technical audit events are sanitized before persistence and must not include message bodies, legal facts, full phone numbers, browser paths, session paths, tokens, or QR data.
- Consent-state persistence stores only:
  - a generic `subjectId`
  - the consent state (`unknown`, `requested`, `granted`, or `denied`)
  - timestamps
  - sanitized metadata with forbidden content fields removed and phone numbers, tokens, and browser/session/QR paths redacted
- In the live runtime path, `subjectId` is derived narrowly from the canonical sender/chat id and used only for state lookup and updates. Consent metadata stores channel, message id, runtime, and subject-id source markers, not the full phone number.
- Consent-state persistence does not store transcripts, message bodies, legal facts, or case records.
- Live WhatsApp runtime writes never create or update cases in M10.
- M13 live consent wiring never stores inbound message body text in consent state metadata or consent events.
- Any future intake writes through `PersistenceService` still require explicit `granted` consent before live message content or legal-intake state is written.

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
- Client consent runtime behavior is separate:
  - optional application-layer consent persistence injection can read current consent state before the client runtime decides the response
  - `unknown` -> output `request_consent`, optionally persist `requested`
  - `requested` + explicit grant -> persist `granted`, append `consent_granted`, output `consent_granted_ack`
  - `requested` + explicit denial -> persist `denied`, append `consent_denied`, output `consent_denied_close`
  - `requested` + ambiguous reply -> output `consent_clarification` without granting consent
  - `granted` -> output a safe `intake_not_implemented` placeholder
  - `denied` -> output the safe no-processing close response
- M13 does not create cases, store legal facts, or persist message bodies even when consent is granted.
