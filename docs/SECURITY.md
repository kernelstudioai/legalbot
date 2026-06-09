# Security

## Data Handling

- Do not read `.env`, secrets, tokens, browser sessions, or WhatsApp session files during foundation work.
- `./install.sh` may load `.env` only to pass existing values into `npm run db:migrate` and `npm run ops:preflight`. It must never print `.env` contents, secret values, QR payloads, browser profile paths, session paths, or full phone numbers while doing so.
- `./install.sh` may create `.env` only when it is missing, using a guided prompt for `LAWYER_PHONE_E164` plus non-secret runtime defaults. If `.env` already exists, the installer must ask before appending missing keys and must not display the file contents.
- Systemd env files must stay outside the repo, for example under `/etc/legalbot/legalbot.env`.
- Systemd unit files must not contain secrets. Keep secrets only in the external env file referenced by `EnvironmentFile=`.
- Sanitize free-text inbound content before logging or downstream planning.
- Keep transport metadata minimal and typed.
- Keep OpenWA runtime state under the ignored `openwa-session/` path.
- Use `.env.example` placeholders only; load real runtime values from process environment at startup.
- Treat client-content persistence as consent-gated: no transcript storage, message-body storage, legal-fact storage, or case creation before explicit `granted` consent.
- Intake remains consent-gated and stores only accepted structured `firstName`, `lastName`, `birthDate`, `city`, and `problemSummary` fields in this phase.
- Keep M10 technical dedupe markers and sanitized audit events separate from any future consent-gated client content persistence.
- Keep business-state persistence explicit and separate from technical dedupe or audit toggles. Live client runtime startup must fail safely instead of silently falling back to in-memory consent or intake state.
- M13 runtime consent wiring still stores only consent state plus sanitized metadata; it must strip `messageBody`, `body`, `content`, and `text`, and must not retain full phone numbers, tokens, or browser/session/QR paths.
- M15 intake persistence remains consent-gated. It must not persist raw message bodies or full transcripts, and it may retain only explicitly accepted structured intake fields after `granted` consent.
- M16 and M17 case creation remain explicit application boundaries only. They may create a `draft` case only from `granted` consent, an `intake_complete` snapshot, and revalidated accepted identity fields plus `problemSummary`, and the bundled persistence implementations now commit the case row plus sanitized audit append transactionally.
- M18 exposes only a manual operator command for that same boundary. It must require an already migrated SQLite database, must emit only sanitized result fields (`caseId`, `status`, `createdAt`), and must not print message bodies, transcripts, secrets, or database dumps.
- M19 makes repeated manual case-creation attempts idempotent by `subjectId` plus existing `draft` case. An idempotent hit may append only sanitized structured metadata, must not persist raw body or transcript content, and still must not enable any automatic live OpenWA case creation.
- M20 adds schema-level enforcement for the same manual-only boundary. The SQLite migration may remediate duplicate historical `draft` rows only by changing later duplicates to `duplicate_archived`; it must not dump table contents, persist transcripts, or enable automatic live OpenWA case creation.
- M21 adds sanitized operator hardening for that same boundary. SQLite duplicate-draft violations must map to a safe application error, and `npm run case:doctor` must report only migration and case-count aggregates plus remediation guidance, never SQL text, database paths, raw rows, message bodies, transcripts, or secrets.
- M28 adds operator backup/check tooling. `npm run business:check` must print only aggregate counts and sanitized consistency codes, and `npm run business:backup` must not print secrets, raw rows, full phone numbers, subject ids, transcripts, or message bodies.
- M29 adds startup/post-start operator checks. `npm run ops:preflight` and `npm run ops:post-start` must print sanitized JSON only and must not expose `.env` contents, QR data, session data, browser profile paths, raw message bodies, transcripts, raw rows, or full phone numbers.
- Consent persistence uses a generic `subjectId` string and does not require phone-number semantics.
- Live OpenWA transport stays transport-only even though the application layer can now inject consent and intake persistence into the client runtime.

## Architecture Controls

- Transport code is isolated under `src/transport/openwa`.
- Domain decisions occur in dedicated pipeline modules, not in listener callbacks.
- Persistence is abstracted behind `PersistenceService` and `BusinessPersistenceService` so storage concerns can be audited before implementation and so technical runtime persistence cannot disable consent/intake/case state accidentally.
- Dispatcher only sends text actions from `OutputPlan`.
- The consent parser must accept only strict explicit yes/no phrases and must treat vague replies such as `ok`, `va bene`, `si`, and `procedi` as non-consent that requires clarification.
- The client runtime may persist only consent state transitions and append-only consent events. It must not persist inbound message bodies, legal facts, or create case records.
- The intake runtime must stay under `src/runtime/client` and remain transport-agnostic. It may collect only validated structured fields, must reject empty or overly long values, and must not create live cases or provide legal advice.
- Intake persistence may store only accepted `firstName`, `lastName`, `birthDate`, `city`, and `problemSummary` values plus sanitized metadata. It must reject unknown field names, strip `messageBody`, `body`, `content`, and `text`, and redact full phone numbers, tokens, and browser/session/QR paths.
- Any future AI-backed extraction must remain internal only. It may normalize, clarify, and summarize for operator review, but it must not provide legal advice, make legal assessments, or accept or reject cases automatically.
- The case-creation boundary must stay outside `src/transport/openwa`. It must use only accepted structured intake fields, must append sanitized audit metadata, and must not persist raw message bodies, transcripts, rejected values, or full phone-number metadata.
- The manual case-creation command must stay outside `src/transport/openwa`, must remain idempotent for repeated operator runs on the same subject, and must not be wired into listener callbacks, intake completion, or any automatic OpenWA runtime behavior.
- The case-doctor command must stay outside `src/transport/openwa`, must require previously applied migrations, and must inspect only aggregate case consistency counts plus index presence.
- The SQLite cases-table hardening migration may copy forward only minimal case fields and must drop legacy transcript/body columns instead of preserving them under new names.
- The SQLite draft-case uniqueness migration must keep only the earliest `draft` row per `subjectId`, archive later duplicates without deleting rows, and allow non-`draft` history for the same subject.
- Raw SQLite uniqueness messages must not leak through the application boundary for duplicate `draft` cases.
- Backups may contain personal data.
- Backups must not be committed.
- Operators must handle backups with explicit retention, storage, and deletion discipline because this phase does not add encryption at rest or automated retention controls.
- `ops:preflight` must treat missing Node 22, pending migrations, disabled business persistence, or missing git-ignore coverage for runtime artifact directories as blocking operator failures.
- `ops:post-start` may report that the process is alive while WhatsApp auth is still pending, but it must not expose QR payloads or sensitive error text while doing so.
- `./install.sh` must not install a real systemd service by itself, must not start the bot without explicit operator approval in the prompt flow, and must not remove runtime data, backup, session, log, or database files.
- `scripts/provision-systemd.sh` must remain single-bot only, must require explicit `--install` or `--uninstall` operator action for systemd mutation, and must not start or enable the service unless the operator explicitly passes `--start` or `--enable`.
- `scripts/provision-systemd.sh` uninstall must remove only the unit file and must leave env files, runtime data, backups, sessions, logs, and database files untouched.
- Live OpenWA listener and client-intake runtime code must not call case creation automatically in M16 or M17.
- Rejected intake replies and ambiguous consent replies must not be persisted.
- The `subjectId` for consent state is the canonical sender/chat id. Any stored metadata must avoid restating the full phone number and must remain sanitized through the persistence boundary.

## Current Gaps

- Authentication, encryption at rest, and retention policies are not implemented in this phase.
- Transcript persistence and legal-advice generation remain out of scope. Case creation still exists only as an explicit tested application boundary plus operator commands with transactional persistence support, an idempotency guard, a SQLite uniqueness constraint, and a sanitized doctor report, and it is still not wired into the live OpenWA runtime.
