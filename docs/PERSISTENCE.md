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

M21 adds safe error mapping for that SQLite uniqueness rule and an operator-only `npm run case:doctor` remediation report. Duplicate draft writes now fail with a sanitized application error instead of a raw SQLite constraint message, and operators can inspect migration readiness plus case consistency counts without dumping database contents.

M22 adds an operator-only `npm run intake:list-ready` helper plus a durable live E2E runbook. The helper lists only consent-granted completed intakes that already contain all accepted structured fields, prints only sanitized operator-safe `subjectId` tokens plus state metadata, and still does not create cases automatically.

M26 adds a durable identity-extraction boundary. The live runtime still uses a deterministic local provider only, but the extraction interface is now isolated so a future behind-the-scenes AI provider can be inserted without changing OpenWA transport wiring or broad persistence contracts. AI remains internal only, does not provide legal advice, does not decide whether to accept a case, and does not create cases automatically.

M23 makes the single-bot runtime default to SQLite-backed technical persistence plus the local status surface, while keeping the same no-transcript and no-auto-case boundaries and adding a Docker runtime baseline.

M27 splits live business-state persistence from technical runtime persistence explicitly. Consent state, consent events, intake state, accepted intake fields, intake events, and manual case creation now flow through `BusinessPersistenceService`, while restart-safe dedupe and technical runtime audit stay behind the separate technical persistence surface.

M28 adds operator-safe business backup/check tooling. `npm run business:check` reports only aggregate business-state consistency counts, and `npm run business:backup` creates timestamped SQLite backups under the ignored `backups/` directory without dumping rows or secrets.

M29 adds operator-safe VPS/systemd startup workflow commands. `npm run ops:preflight` aggregates Node/runtime/migration/business/case/git-ignore readiness into sanitized JSON before start, and `npm run ops:post-start` aggregates sanitized readiness probes after start without exposing secrets, QR data, session state, transcripts, or raw rows.

## Interfaces

- `CaseStore`: minimal create/get/update support for case records built from accepted structured intake data only.
- `ConsentStore`: current consent-state lookup, consent-state upsert, and append-only consent event history.
- `IntakeStore`: current intake-state lookup, accepted-field upsert, snapshot reads, and append-only intake event history.
- `ProcessedMessageStore`: duplicate-detection markers keyed by transport message id.
- `AuditLogStore`: append-only audit events with optional JSON metadata.
- `PersistenceService`: the only application boundary that future intake/runtime code should use when it needs persistence.
- `BusinessPersistenceService`: the explicit live business-state boundary for consent, intake, operator ready-intake reads, and manual case creation.

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
- `createBusinessPersistenceService(persistence)` narrows a shared persistence implementation to the consent/intake/case business boundary.
- `createSqliteBusinessPersistenceService(config)` exposes the same business boundary plus ready-intake lookup helpers for operator commands.
- The service sanitizes processed-message metadata, audit payloads, consent metadata, and intake metadata before they can cross the boundary.
- The OpenWA smoke runtime can inject an existing shared `PersistenceService`, derive `BusinessPersistenceService` from it, or create one SQLite-backed shared implementation when either business persistence or technical persistence needs durable storage.
- Client runtime wiring uses narrow application-layer adapters so consent-gated intake writes stay separate from M10 technical dedupe and audit wiring.
- `src/domain/cases/caseCreationService.ts` is the explicit application boundary that reads consent and intake through `PersistenceService`, revalidates accepted fields, creates a `draft` case, and appends a sanitized `case_created_from_intake` audit event.
- On repeated manual runs for the same subject, that boundary first looks up an existing `draft` case through `findDraftCaseBySubjectId(subjectId)`. If one exists, it returns the existing case and appends only a sanitized `case_create_from_intake_idempotent_hit` audit event.
- SQLite now enforces the invariant that at most one `draft` case may exist for a given `subjectId`. Historical duplicate drafts are remediated during migration instead of being deleted.
- When a direct SQLite-backed caller still attempts to create or restore a second `draft` case for the same `subjectId`, the persistence boundary maps the partial-index failure to `CaseDraftUniquenessError` with the safe code `draft_case_already_exists`.
- `createCaseWithAudit(...)` is transactional for the bundled SQLite and in-memory persistence implementations so a case row and its audit event commit or roll back together.
- M16 does not wire that service into the live OpenWA listener or intake-completion runtime path yet.
- `src/app/caseCreateFromIntake.ts` is the operator entrypoint for manual case creation. It loads env through the shared loader, requires an already migrated SQLite database, resolves operator-safe `subjectId` tokens through `SqliteBusinessPersistenceService`, and prints only `{ caseId, status, createdAt }`. Repeated runs for the same completed-intake subject return the existing draft case instead of creating another one.
- `src/app/caseDoctor.ts` is the operator entrypoint for persistence consistency checks. It loads env through the shared loader, requires an already migrated SQLite database, checks only migration and case-count aggregates, and never prints raw rows, SQL text, database paths, message bodies, transcripts, secrets, or full phone numbers.
- `src/app/intakeListReady.ts` is the operator entrypoint for completed-intake discovery. It loads env through the shared loader, requires an already migrated SQLite database, reads through `SqliteBusinessPersistenceService`, lists only consent-granted `intake_complete` subjects that already have all accepted intake fields, and prints only `{ subjectId, intakeState, updatedAt, fieldNamesPresent }`.
- The `subjectId` printed by `npm run intake:list-ready` is an operator-safe token accepted by `npm run case:create-from-intake -- --subject <subjectId>`. It does not print the raw phone-derived subject identifier.

## SQLite Foundation

- `DATABASE_URL` defaults to `file:./data/legalbot.sqlite`.
- `DATABASE_MIGRATIONS_ENABLED` defaults to `true`.
- `BUSINESS_PERSISTENCE_ENABLED` defaults to `true`.
- `TECHNICAL_PERSISTENCE_ENABLED` defaults to `true`.
- The minimal required runtime env remains `LAWYER_PHONE_E164`. Business persistence stays enabled by default and does not add a new required operator input.
- Operators can run `npm run db:migrate` to apply the committed SQLite schema explicitly.
- Operators can run `npm run db:status` to inspect applied and pending migration ids without dumping table contents.
- Operators can run `npm run intake:list-ready` only after `npm run db:migrate` has completed for the target `DATABASE_URL`.
- Operators can run `npm run case:create-from-intake -- --subject <subjectId>` only after `npm run db:migrate` has completed for the target `DATABASE_URL`.
- Operators can run `npm run case:doctor` only after `npm run db:migrate` has completed for the target `DATABASE_URL`.
- Operators can run `npm run business:check` only after `npm run db:migrate` has completed for the target `DATABASE_URL`.
- Operators can run `npm run business:backup` only after `npm run db:migrate` has completed for the target `DATABASE_URL`.
- Operators can run `npm run ops:preflight` before `npm run smoke:openwa` to confirm Node 22, explicit migration policy, migration readiness, business/case health, and repo hygiene.
- Operators can run `npm run ops:post-start` after `npm run smoke:openwa` to check the sanitized `/health`, `/ready`, and `/status` surfaces.
- The SQLite migration runner is explicit and testable through `runSqliteMigrations(...)`, `getSqliteMigrationStatus(...)`, and `SqliteMigrationRunner`.
- The local direct smoke runtime defaults to `OPENWA_STATUS_SERVER_ENABLED=true` on `127.0.0.1:3001`.
- The Docker baseline overrides only container-specific values: `OPENWA_STATUS_SERVER_HOST=0.0.0.0`, `OPENWA_HEADLESS=true`, and `OPENWA_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`.
- `0009_harden_cases_schema` safely rebuilds legacy `cases` tables when older SQLite files still use `reference`, camelCase columns, or extra transcript/body columns, and it copies forward only the minimal supported case fields.
- `0010_enforce_draft_case_uniqueness` scans historical `draft` cases by `subjectId`, keeps the earliest `created_at` row as `draft`, marks later duplicates as `duplicate_archived`, and adds the partial unique index `cases_one_draft_per_subject_id` on `cases(subject_id) WHERE status = 'draft'`.
- `0011_normalize_intake_schema_for_identity_fields` upgrades intake state and field storage to the formal single-message identity flow and preserves only supported structured values in the new schema.
- `npm run case:doctor` reports only aggregate counts: applied and pending migration counts, current `draft` case count, unique `draft` subject count, `duplicate_archived` count, duplicate-draft anomaly counts, and whether the committed draft-uniqueness index is present.
- Technical runtime startup never runs migrations. When `TECHNICAL_PERSISTENCE_ENABLED=true`, startup requires `npm run db:migrate` to have been completed already or it fails safely with a clear error.
- Live OpenWA runtime startup also fails safely before accepting client traffic when business persistence is disabled or when the business persistence boundary cannot be constructed.
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
- The Docker baseline bind-mounts `./data` to `/app/data` so the default SQLite file persists across container restarts.
- The Docker baseline stores `openwa-session/` in a separate named volume so session/browser state does not enter the repo.
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
  - `firstName`
  - `lastName`
  - `birthDate`
  - `city`
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
- The M18 manual command still stores only the accepted structured intake fields already present in intake persistence. It does not persist raw bodies, transcripts, rejected values, or secret-bearing metadata.
- M19 keeps manual case creation idempotent by `subjectId` plus existing `draft` case. The idempotent-hit audit event stores only sanitized structured metadata and does not persist transcripts, raw bodies, rejected values, or full phone numbers.
- M20 remediation never stores transcripts, message bodies, or rejected values. It changes only case status metadata inside the existing `cases` table and preserves duplicate rows as `duplicate_archived` instead of deleting them.
- M21 uniqueness-error mapping and `case:doctor` output are sanitized by policy. They must not expose SQL statements, database paths, raw rows, message bodies, transcripts, rejected values, or secrets.
- M22 `intake:list-ready` output is sanitized by policy. It must not expose raw subject ids, full phone numbers, SQL text, database paths, raw rows, message bodies, transcripts, rejected values, or secrets.
- M28 `business:check` and `business:backup` outputs are sanitized by policy. They must not expose full phone numbers, subject ids, raw rows, transcripts, message bodies, QR data, session data, or secrets.
- Live WhatsApp runtime writes never create or update cases automatically.
- M13 live consent wiring never stores inbound message body text in consent state metadata or consent events.
- M15 live intake wiring persists only accepted structured `firstName`, `lastName`, `birthDate`, `city`, and `problemSummary` values plus sanitized metadata after explicit `granted` consent.
- M27 keeps business-state persistence explicit even when technical persistence is disabled. Turning off technical persistence must not disable or bypass consent, intake, or manual case-creation reads.
- M16 case creation requires `granted` consent, `intake_complete`, and valid accepted identity fields plus `problemSummary`. It remains a separate application boundary with its own tests and review.

## File Location And Backups

- The default database file location is `data/legalbot.sqlite` when persistence is explicitly opened outside tests.
- Test coverage uses temp directories so database files are created only under ephemeral test paths.
- `data/` remains git-ignored because it may contain local SQLite files created by `npm run db:migrate` or `npm run db:status`.
- `backups/` remains git-ignored because operator-created business backups may contain personal data copied from the SQLite business database.
- backups/ remains git-ignored.
- `npm run business:backup` creates a timestamped SQLite copy under `backups/` and prints only `{ status, sourceDatabase, backupPath, createdAt, sizeBytes, migrationCount }`.
- `npm run business:check` prints only aggregate migration, consent, intake, completed-intake, and draft-case counts plus sanitized consistency error codes.
- `npm run ops:preflight` prints only sanitized aggregate startup readiness data and never prints `.env` contents, database paths outside the configured relative URL, QR data, session data, raw rows, message bodies, transcripts, or full phone numbers.
- `npm run ops:post-start` prints only sanitized readiness data and never prints QR contents, session paths, browser paths, raw transport errors, message bodies, transcripts, or full phone numbers.
- Backups remain an operator concern. M28 does not add automated backup, encryption, restore verification, or retention jobs, so any future production use must define those controls before enabling real writes.

## Migration Control

- When `DATABASE_MIGRATIONS_ENABLED=true`, `npm run db:migrate` creates parent directories as needed and applies the committed migration list.
- When `DATABASE_MIGRATIONS_ENABLED=false`, `npm run db:migrate` reports pending migrations and skips schema changes.
- `npm run db:status` reports applied and pending migration ids and counts without reading or printing table contents.
- `npm run business:check` exits `0` only when migrations are fully applied and the aggregate business-state checks are healthy. It exits nonzero for pending migrations or consistency anomalies.
- `npm run business:backup` exits `0` only after business persistence is enabled, migrations are fully applied, and the timestamped SQLite backup file is written successfully.
- `npm run intake:list-ready` fails safely when migrations are missing or incomplete, exits `0` on success, exits nonzero on failure, and prints only operator-safe completed-intake metadata.
- `npm run case:doctor` fails safely when migrations are missing or incomplete, exits `0` only when the migrated database is healthy, and exits nonzero when migration readiness or draft-case anomalies require operator action.
- `npm run ops:preflight` exits `0` only when Node 22, runtime env, migration readiness, business/case checks, and git-ignore hygiene are all safe for startup.
- `npm run ops:post-start` exits `0` only when the status surface reports `app_ready`. Pending WhatsApp auth remains nonzero in this milestone.
- `npm run db:migrate`, `npm run db:status`, `npm run business:check`, `npm run business:backup`, `npm run intake:list-ready`, `npm run case:doctor`, `npm run ops:preflight`, and `npm run ops:post-start` remain direct Node 22 `--experimental-strip-types` entrypoints.
- Existing SQLite databases created before M17 can be upgraded in place. The cases-table hardening migration preserves minimal case metadata, normalizes column names to the committed snake_case schema, and drops unsupported legacy columns.
- Existing SQLite databases created before M20 can be upgraded in place. Duplicate `draft` rows are remediated deterministically by `created_at ASC, case_id ASC`, and future duplicate `draft` inserts for the same `subjectId` fail at the SQLite schema boundary.
- The migration boundary is intentionally separate from OpenWA startup so transport smoke behavior stays unchanged when technical persistence is disabled.
- `createSqlitePersistenceService(...)` expects a database path that has already been prepared through the explicit migration boundary or an equivalent test setup.

## OpenWA Runtime Behavior

- `TECHNICAL_PERSISTENCE_ENABLED=false`
  The smoke runtime skips restart-safe technical dedupe and technical audit persistence, but business-state persistence still stays active and required for live client intake.
- `TECHNICAL_PERSISTENCE_ENABLED=true`
  The smoke runtime keeps the existing in-memory duplicate guard as the first line of protection, then checks restart-safe dedupe through `PersistenceService.isMessageProcessed(messageId)` before the pipeline runs.
- `BUSINESS_PERSISTENCE_ENABLED=false`
  Live OpenWA smoke startup fails safely before listener registration. There is no silent fallback to in-memory consent or intake state in client mode.
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
  - `requested` + explicit grant -> persist `granted`, append `consent_granted`, start intake with `intake_ask_identity`
  - `requested` + explicit denial -> persist `denied`, append `consent_denied`, output `consent_denied_close`
  - `requested` + ambiguous reply -> output `consent_clarification` without granting consent
  - `granted` + `not_started` -> persist `asking_identity` and output `intake_ask_identity`
  - `granted` + extractable `asking_identity` reply -> persist `asking_problem_summary`, store only accepted `firstName`, `lastName`, `birthDate`, and `city`, and output `intake_ask_problem_summary`
  - `granted` + incomplete or ambiguous `asking_identity` reply -> persist only safe partial accepted identity fields, output `intake_clarify_identity`, and do not persist the raw rejected text
  - `granted` + valid `asking_problem_summary` reply -> persist `intake_complete`, store only the accepted `problemSummary` field, and output `intake_complete_ack`
  - invalid intake values -> output `intake_invalid_response` without storing the raw reply
  - `denied` -> output the safe no-processing close response
- M16 adds explicit application-side case creation only:
  - read consent state
  - read intake snapshot
  - require `granted` consent and `intake_complete`
  - revalidate accepted identity fields plus `problemSummary`
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
- M21 adds safe operator hardening for the same manual-only boundary:
  - duplicate draft constraint failures map to `draft_case_already_exists`
  - `npm run case:doctor` logs `case_doctor_starting`, `case_doctor_checked`, or `case_doctor_failed`
  - `npm run case:doctor` prints only sanitized aggregate counts plus a remediation summary
  - the live OpenWA runtime still does not create cases automatically
- M22 adds a second operator-only read surface for the same manual boundary:
  - `npm run intake:list-ready` logs `intake_list_ready_starting`, `intake_list_ready_checked`, or `intake_list_ready_failed`
  - `npm run intake:list-ready` prints only operator-safe completed-intake candidates
  - operators must still run `npm run case:create-from-intake` explicitly to create a draft case
- The live OpenWA runtime still does not create cases automatically, store full transcripts, or persist raw message bodies.
