# Persistence

## Scope

M10 adds optional technical runtime persistence for the OpenWA smoke runtime. It remains opt-in, keeps transport dedupe process-local first, and stores only restart-safe processed-message markers plus sanitized technical audit events.

M12 adds a consent-state persistence boundary only. It stores the current consent state plus sanitized consent metadata and append-only consent events. It still does not persist message transcripts, message bodies, legal facts, or full legal-intake records.

M13 wires that consent-state boundary into the live client runtime path without enabling intake persistence. The runtime may read consent state, upsert `requested` / `granted` / `denied`, and append consent events, but it still must not persist message bodies, legal facts, or create cases.

M14 adds a client-intake state machine.

M15 adds consent-gated intake persistence for state plus accepted structured fields only. It still does not persist raw message bodies, full transcripts, rejected replies, legal facts, attachments, or case records.

M16 adds a separate application case-creation boundary. It can create a minimal case record only from `granted` consent plus an `intake_complete` snapshot with valid accepted structured fields.

M17 hardens the SQLite `cases` schema for legacy databases and adds a transactional `createCaseWithAudit(...)` persistence boundary for case creation plus audit append.

M18 adds an explicit operator-only command, `npm run case:create-from-intake -- --subject <subjectId>`, that invokes the existing case-creation boundary manually after migrations are already applied.

M19 makes that manual case-creation path idempotent for repeated runs on the same `subjectId`. When a `draft` case already exists for the subject, the boundary returns the existing case, appends a sanitized `case_create_from_intake_idempotent_hit` audit event, and does not create a duplicate row.

M20 hardens SQLite historical databases. Migration `0010_enforce_draft_case_uniqueness` remediates duplicate `draft` rows by `subjectId`, keeps the earliest draft row, marks later duplicates as `duplicate_archived`, and enforces one `draft` case per subject with a partial unique index.

## Interfaces

- `CaseStore`: minimal create/get/update support for case records built from accepted structured intake data only.
- `ConsentStore`: current consent-state lookup, consent-state upsert, and append-only consent event history.
- `IntakeStore`: current intake-state lookup, accepted-field upsert, snapshot reads, and append-only intake event history.
- `ProcessedMessageStore`: duplicate-detection markers keyed by transport message id.
- `AuditLogStore`: append-only audit events with optional JSON metadata.
- `PersistenceService`: the only application boundary that future intake/runtime code should use when it needs persistence.

## Persistence Service Boundary

- `src/persistence/persistenceService.ts` composes `CaseStore`, `ConsentStore`, `IntakeStore`, `ProcessedMessageStore`, and `AuditLogStore`.
- Supported service methods:
  - `isMessageProcessed(messageId)`
  - `markMessageProcessed(messageId, metadata)`
  - `appendAuditEvent(event)`
  - `getConsentState(subjectId)`
  - `setConsentState(subjectId, state, metadata)`
  - `appendConsentEvent(event)`
  - `getIntakeState(subjectId)`
  - `setIntakeState(subjectId, state, metadata)`
  - `setIntakeField(subjectId, fieldName, value, metadata)`
  - `getIntakeSnapshot(subjectId)`
  - `appendIntakeEvent(event)`
  - `createCase(input)`
  - `createCaseWithAudit({ case, auditEvent })`
  - `findDraftCaseBySubjectId(subjectId)`
  - `getCase(caseId)`
  - `updateCaseStatus(caseId, status)`
- `createSqlitePersistenceService(config)` opens a SQLite-backed service against an explicit `file:` database path.
- `createInMemoryPersistenceService()` provides a process-local service for tests and non-SQLite callers.
- The service sanitizes processed-message metadata, audit payloads, consent metadata, and intake metadata before they can cross the boundary.
- The OpenWA smoke runtime can inject an existing `PersistenceService` or create a SQLite-backed one only when `TECHNICAL_PERSISTENCE_ENABLED=true`.
- Client runtime wiring uses narrow application-layer adapters so consent-gated intake writes stay separate from M10 technical dedupe and audit wiring.
- `src/domain/cases/caseCreationService.ts` is the explicit application boundary that reads consent and intake through `PersistenceService`, revalidates accepted fields, creates a `draft` case, and appends a sanitized `case_created_from_intake` audit event.
- On repeated manual runs for the same subject, that boundary first looks up an existing `draft` case through `findDraftCaseBySubjectId(subjectId)`. If one exists, it returns the existing case and appends only a sanitized `case_create_from_intake_idempotent_hit` audit event.
- SQLite now enforces the invariant that at most one `draft` case may exist for a given `subjectId`. Historical duplicate drafts are remediated during migration instead of being deleted.
- `createCaseWithAudit(...)` is transactional for the bundled SQLite and in-memory persistence implementations so a case row and its audit event commit or roll back together.
- M16 does not wire that service into the live OpenWA listener or intake-completion runtime path yet.
- `src/app/caseCreateFromIntake.ts` is the operator entrypoint for manual case creation. It loads env through the shared loader, requires an already migrated SQLite database, accepts `--subject <subjectId>`, and prints only `{ caseId, status, createdAt }`. Repeated runs for the same completed-intake subject return the existing draft case instead of creating another one.

## SQLite Foundation

- `DATABASE_URL` defaults to `file:./data/legalbot.sqlite`.
- `DATABASE_MIGRATIONS_ENABLED` defaults to `true`.
- `TECHNICAL_PERSISTENCE_ENABLED` defaults to `false`.
- Operators can run `npm run db:migrate` to apply the committed SQLite schema explicitly.
- Operators can run `npm run db:status` to inspect applied and pending migration ids without dumping table contents.
- Operators can run `npm run case:create-from-intake -- --subject <subjectId>` only after `npm run db:migrate` has completed for the target `DATABASE_URL`.
- The SQLite migration runner is explicit and testable through `runSqliteMigrations(...)`, `getSqliteMigrationStatus(...)`, and `SqliteMigrationRunner`.
- `0009_harden_cases_schema` safely rebuilds legacy `cases` tables when older SQLite files still use `reference`, camelCase columns, or extra transcript/body columns, and it copies forward only the minimal supported case fields.
- `0010_enforce_draft_case_uniqueness` scans historical `draft` cases by `subjectId`, keeps the earliest `created_at` row as `draft`, marks later duplicates as `duplicate_archived`, and adds the partial unique index `cases_one_draft_per_subject_id` on `cases(subject_id) WHERE status = 'draft'`.
- Technical runtime startup never runs migrations. When `TECHNICAL_PERSISTENCE_ENABLED=true`, startup requires `npm run db:migrate` to have been completed already or it fails safely with a clear error.
- Current tables:
  - `cases`
  - `consent_states`
  - `consent_events`
  - `intake_states`
  - `intake_fields`
  - `intake_events`
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
- Intake persistence is consent-gated. Before consent is `granted`, runtime intake persistence must not write state, fields, or intake events.
- Intake persistence stores only:
  - `name`
  - `problemSummary`
- Intake persistence stores state transitions separately from accepted structured fields and may append intake events without duplicating raw message content.
- Intake persistence must not store raw inbound bodies, invalid replies, rejected values, full transcripts, attachments, or live case records.
- Case records created through M16 and M17 store only:
  - `caseId`
  - `subjectId`
  - `status`
  - `name`
  - `problemSummary`
  - `createdAt`
  - `updatedAt`
- The M17 schema-hardening migration copies forward only those case fields and removes legacy `rawBody`, `body`, `transcript`, or other extra columns from the SQLite `cases` table.
- Case creation does not store full phone-number metadata, raw message bodies, transcripts, rejected values, attachments, or legal advice content.
- The M18 manual command still stores only the accepted structured `name` and `problemSummary` fields already present in intake persistence. It does not persist raw bodies, transcripts, rejected values, or secret-bearing metadata.
- M19 keeps manual case creation idempotent by `subjectId` plus existing `draft` case. The idempotent-hit audit event stores only sanitized structured metadata and does not persist transcripts, raw bodies, rejected values, or full phone numbers.
- M20 remediation never stores transcripts, message bodies, or rejected values. It changes only case status metadata inside the existing `cases` table and preserves duplicate rows as `duplicate_archived` instead of deleting them.
- Live WhatsApp runtime writes never create or update cases automatically.
- M13 live consent wiring never stores inbound message body text in consent state metadata or consent events.
- M15 live intake wiring persists only accepted structured `name` and `problemSummary` values plus sanitized metadata after explicit `granted` consent.
- M16 case creation requires `granted` consent, `intake_complete`, and valid accepted `name` plus `problemSummary` fields. It remains a separate application boundary with its own tests and review.

## File Location And Backups

- The default database file location is [data/legalbot.sqlite](/C:/Users/Jacopo/Documents/legalbot/data/legalbot.sqlite) when persistence is explicitly opened outside tests.
- Test coverage uses temp directories so database files are created only under ephemeral test paths.
- `data/` remains git-ignored because it may contain local SQLite files created by `npm run db:migrate` or `npm run db:status`.
- Backups remain an operator concern. M8 does not add automated backup or retention jobs, so any future production use must define backup frequency, encryption, and restore verification before enabling real writes.

## Migration Control

- When `DATABASE_MIGRATIONS_ENABLED=true`, `npm run db:migrate` creates parent directories as needed and applies the committed migration list.
- When `DATABASE_MIGRATIONS_ENABLED=false`, `npm run db:migrate` reports pending migrations and skips schema changes.
- `npm run db:status` reports applied and pending migration ids and counts without reading or printing table contents.
- `npm run db:migrate` and `npm run db:status` remain direct Node 22 `--experimental-strip-types` entrypoints.
- Existing SQLite databases created before M17 can be upgraded in place. The cases-table hardening migration preserves minimal case metadata, normalizes column names to the committed snake_case schema, and drops unsupported legacy columns.
- Existing SQLite databases created before M20 can be upgraded in place. Duplicate `draft` rows are remediated deterministically by `created_at ASC, case_id ASC`, and future duplicate `draft` inserts for the same `subjectId` fail at the SQLite schema boundary.
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
  - `requested` + explicit grant -> persist `granted`, append `consent_granted`, start intake with `intake_ask_name`
  - `requested` + explicit denial -> persist `denied`, append `consent_denied`, output `consent_denied_close`
  - `requested` + ambiguous reply -> output `consent_clarification` without granting consent
  - `granted` + `not_started` -> persist `asking_name` and output `intake_ask_name`
  - `granted` + valid `asking_name` reply -> persist `asking_problem_summary`, store only the accepted `name` field, and output `intake_ask_problem_summary`
  - `granted` + valid `asking_problem_summary` reply -> persist `intake_complete`, store only the accepted `problemSummary` field, and output `intake_complete_ack`
  - invalid intake values -> output `intake_invalid_response` without storing the raw reply
  - `denied` -> output the safe no-processing close response
- M16 adds explicit application-side case creation only:
  - read consent state
  - read intake snapshot
  - require `granted` consent and `intake_complete`
  - revalidate accepted `name` and `problemSummary`
  - create a minimal `draft` case
  - append sanitized `case_created_from_intake`
  - commit both writes inside one persistence transaction when the bundled SQLite or in-memory persistence implementation is used
- M18 exposes that same boundary through an operator-only command:
  - `npm run case:create-from-intake -- --subject <subjectId>`
  - fail safely when migrations are missing or incomplete
  - print and log only sanitized case creation output (`caseId`, `status`, `createdAt`)
- M19 adds an idempotency guard to that manual-only path:
  - first run creates one `draft` case plus `case_created_from_intake`
  - repeated runs on the same subject return the existing `draft` case
  - repeated runs append only sanitized `case_create_from_intake_idempotent_hit`
- M20 adds SQLite enforcement for the same invariant:
  - one `draft` case per `subjectId`
  - earliest historical draft is preserved during remediation
  - later historical drafts become `duplicate_archived`
  - non-`draft` rows for the same subject remain allowed
- The live OpenWA runtime still does not create cases automatically, store full transcripts, or persist raw message bodies.
