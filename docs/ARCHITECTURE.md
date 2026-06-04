# Architecture

## Goal

This project is a Node.js 22 + TypeScript strict foundation for a WhatsApp legal-intake bot using OpenWA as the transport layer.

## Layers

- `src/transport/openwa`: OpenWA-specific adapters, listener wiring, and dispatcher boundaries.
- `src/ingress`: conversion from raw transport payloads into canonical contracts.
- `src/routing`: routing decisions based on canonical envelopes.
- `src/runtime/*`: isolated runtime decision logic for client, lawyer, and shared concerns.
- `src/output`: output plan construction before transport dispatch.
- `src/persistence`: persistence interfaces, in-memory test doubles, and the SQLite foundation used by explicit migrations and storage skeletons.
- `src/security`: sanitization and boundary helpers.
- `src/logging`: logger abstraction.
- `src/app`: application orchestration, smoke runtime wiring, and operator-facing local status surface.

## OpenWA Smoke Transport

- `src/app/openwaSmoke.ts` is the executable smoke entrypoint that validates runtime env, starts the OpenWA client, installs signal handlers, and wires transport dependencies.
- `src/app/openwaStatusServer.ts` owns the localhost-only read-only operator status surface and sanitizes supervisor health responses before they leave the process.
- Retry the smoke startup with `npm run smoke:openwa` so the documented command stays aligned with the repo script.
- `src/transport/openwa/client.ts` owns OpenWA bootstrap, runtime session path setup, and raw OpenWA message adaptation.
- `src/transport/openwa/supervisor.ts` owns M5 transport supervision state, bounded startup retry, post-ready liveness supervision, bounded recovery policy, readiness reporting, and listener-singleton startup orchestration.
- `src/transport/openwa/liveness.ts` owns the transport-only heartbeat abstraction. It prefers read-only OpenWA client calls and falls back to a no-op heartbeat when no safe read-only API is available.
- `OPENWA_BROWSER_EXECUTABLE_PATH` is an optional smoke-only env override that maps to the OpenWA launch `executablePath` and also enables `useChrome: true` when Windows needs to use a system Chrome binary.
- `src/transport/openwa/listener.ts` only logs receipt, ignores self-authored and duplicate transport messages, maps raw transport data into the existing pipeline input, runs the pipeline, and hands the resulting `OutputPlan` to the dispatcher.
- `src/transport/openwa/dispatcher.ts` only sends supported text actions and ignores unsupported actions without introducing domain behavior.

## Persistence Foundation

- `src/persistence/caseStore.ts`, `src/persistence/processedMessageStore.ts`, and `src/persistence/auditLogStore.ts` define the M7 storage contracts.
- `src/persistence/persistenceService.ts` is the M9 application boundary that composes the store contracts. Future intake/runtime code should depend on this service instead of calling stores directly.
- `src/persistence/testing/inMemoryStores.ts` provides process-local test doubles so domain tests can stay detached from SQLite and OpenWA runtime wiring.
- `src/persistence/sqlite/database.ts` resolves `DATABASE_URL` values that use the `file:` scheme and creates parent directories only when an explicit migration or store-opening path is invoked.
- `src/persistence/sqlite/migrationRunner.ts` is the explicit, testable migration boundary. It creates `schema_migrations`, reports applied versus pending migration ids, applies the committed migration list, and can be skipped when `DATABASE_MIGRATIONS_ENABLED=false`.
- `src/persistence/sqlite/sqliteCaseStore.ts`, `src/persistence/sqlite/sqliteProcessedMessageStore.ts`, and `src/persistence/sqlite/sqliteAuditLogStore.ts` remain storage implementations behind that boundary. They are not wired into the live OpenWA listener yet.
- `src/app/dbMigrate.ts` and `src/app/dbStatus.ts` are operator-only entrypoints for explicit schema bootstrap and status checks. They use the shared env loader, never print table contents, and remain detached from the OpenWA smoke runtime.
- The SQLite schema currently persists minimal case metadata, processed-message dedupe markers, and audit events. It does not persist WhatsApp message bodies, browser/session state, attachments, PDFs, or consent-gated intake data.
- Persistence payload sanitization strips message body/content/text fields before processed-message metadata or audit payloads reach storage, and future live writes still require an explicit consent/intake gate.

## Verified Baseline

- M1 live smoke was verified on macOS with Node `22.22.3`, OpenWA `4.76.0`, system Chrome, `useChrome: true`, `headless: false`, the committed `patch-package` user-agent workaround, a successful QR scan, `openwa_client_ready`, `openwa_message_received`, `openwa_output_dispatched`, and a WhatsApp reply received.

## Runtime Hardening

- M2 adds graceful `SIGINT` and `SIGTERM` shutdown with structured `openwa_shutdown_starting`, `openwa_shutdown_complete`, and `openwa_shutdown_failed` logs.
- M3 adds the transport supervisor state machine `starting`, `ready`, `degraded`, `shutting_down`, and `stopped`.
- M3 adds bounded startup retry with `OPENWA_STARTUP_MAX_ATTEMPTS` and `OPENWA_STARTUP_RETRY_DELAY_SECONDS`.
- M3 adds runtime health reporting through `startOpenWaSmokeApp().getHealth()`.
- M3 adds `openwa_supervisor_state_changed`, `openwa_supervisor_ready`, `openwa_supervisor_degraded`, and `openwa_supervisor_stopped`.
- M4 adds post-ready liveness supervision with `OPENWA_LIVENESS_INTERVAL_SECONDS` and `OPENWA_LIVENESS_FAILURE_THRESHOLD`.
- M4 uses read-only OpenWA client calls for heartbeat checks and never sends a WhatsApp message as part of liveness supervision.
- M4 extends runtime health reporting with liveness counters and liveness timestamps.
- M4 adds `openwa_liveness_check_ok`, `openwa_liveness_check_failed`, `openwa_liveness_degraded`, and `openwa_liveness_recovered`.
- M5 adds recovery policy controls with `OPENWA_RECOVERY_MODE`, `OPENWA_RECOVERY_MAX_ATTEMPTS`, and `OPENWA_RECOVERY_RETRY_DELAY_SECONDS`.
- M5 keeps startup retry and recovery retry separate, never sends a WhatsApp recovery probe, and never deletes session data automatically during recovery.
- M5 adds `openwa_recovery_required`, `openwa_recovery_starting`, `openwa_recovery_attempt_failed`, `openwa_recovery_succeeded`, and `openwa_recovery_exhausted`.
- M6 adds an optional localhost status server with `OPENWA_STATUS_SERVER_ENABLED`, `OPENWA_STATUS_SERVER_HOST`, and `OPENWA_STATUS_SERVER_PORT`.
- M6 keeps the status surface read-only, sourced from `supervisor.getHealth()`, and sanitized so browser paths, phone numbers, message bodies, and private runtime details do not leave the process.
- M6 adds `GET /health`, `GET /ready`, and `GET /status` for operator smoke checks, and it aborts smoke startup if the required enabled status server cannot bind.
- The runtime listener keeps a process-local in-memory `messageId` guard so duplicate OpenWA deliveries do not trigger duplicate placeholder replies during one process lifetime.
- Self-authored transport events are ignored in the OpenWA listener and logged as `openwa_message_ignored_from_self`.
- Duplicate transport events are ignored in the OpenWA listener and logged as `openwa_message_ignored_duplicate`.
- Dispatcher failures stay inside the listener loop, log `openwa_dispatch_failed`, and do not terminate the OpenWA runtime callback path.

## Windows Smoke Troubleshooting

- Use Node 22 LTS before retrying the smoke startup. The repo `engines` policy is `>=22 <23`.
- If `wmic` is missing on Windows 11, install the WMIC optional feature as Administrator with `DISM /Online /Add-Capability /CapabilityName:WMIC~~~~`, then verify with `wmic os get caption`.
- When a Windows machine already has Chrome installed, set `OPENWA_BROWSER_EXECUTABLE_PATH` to the local Chrome executable such as `C:\Program Files\Google\Chrome\Application\chrome.exe` before running `npm run smoke:openwa`.
- When `OPENWA_BROWSER_EXECUTABLE_PATH` is set, the smoke startup passes `executablePath`, `useChrome: true`, `headless: false`, `qrTimeout`, and `authTimeout` into the OpenWA create config. Leaving the executable path unset preserves the existing Puppeteer cache fallback behavior.
- If a smoke run launches Chrome but later times out during OpenWA initialization, inspect the runbook before deleting `openwa-session/_IGNORE_<sessionId>`. Delete it only when the session metadata is stuck across repeated restarts and a fresh QR re-link is intentional. In PowerShell, run `Remove-Item -Recurse -Force .\openwa-session\_IGNORE_<sessionId>`.
- Keep the Chrome window visible during smoke runs and classify what you see before retrying again:
  - QR: the WhatsApp QR code is visible. Scan it from the phone, wait for chats to load, and keep the window open.
  - Blank: the window stays white or never reaches WhatsApp Web. Close Chrome, delete `openwa-session/_IGNORE_<sessionId>`, and retry.
  - Error: Chrome shows a crash page, profile warning, or other browser error. Close Chrome, verify `OPENWA_BROWSER_EXECUTABLE_PATH`, then retry.
  - Loaded: WhatsApp Web finishes loading but OpenWA still times out. Delete `openwa-session/_IGNORE_<sessionId>`, retry once, and capture the startup logs for the next investigation.

## Runbook

- Use Node 22 before running `npm run smoke:openwa` or transport validation commands.
- Do not run `npm audit fix` or `npm audit fix --force` against this foundation.
- Keep `openwa-session/` ignored and never commit runtime, browser, or WhatsApp session state.
- If Chrome shows an outdated browser screen, verify the committed `patch-package` patch under `patches/@open-wa+wa-automate+4.76.0.patch` is applied.
- If the session corrupts, delete only `openwa-session/_IGNORE_<sessionId>` after operator review confirms the session must be discarded.
- Use [OPENWA_SUPERVISION_RUNBOOK.md](/C:/Users/Jacopo/Documents/legalbot/docs/OPENWA_SUPERVISION_RUNBOOK.md) for the M6 supervisor state, liveness, recovery, status surface, health, retry, and shutdown procedures.

## Current Constraints

- No real intake flow yet.
- No attachments or PDFs.
- No LLM integration.
- No external SaaS integration.
- SQLite is available through explicit migrations, store implementations, and the `PersistenceService` boundary, but not through live WhatsApp runtime writes.
