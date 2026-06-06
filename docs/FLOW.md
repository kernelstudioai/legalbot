# Flow

## Pipeline

1. OpenWA emits a raw WhatsApp message.
2. `src/transport/openwa/listener.ts` logs `openwa_message_received`, ignores self-authored and duplicate events at the transport boundary, then maps eligible raw payloads into the existing transport input shape and calls `runInboundPipeline`.
3. `normalizeInbound` maps transport data into `CanonicalEnvelope`.
4. `resolveRouting` decides which runtime should own the message.
5. `decideNextAction` produces a runtime decision. For `client` routing it now delegates to `src/runtime/client/clientRuntime.ts`, which can read and update consent state through an injected consent adapter and can advance a separate injected intake persistence adapter.
6. `buildOutputPlan` prepares outbound transport work.
7. OpenWA dispatcher sends text actions only, then logs `openwa_output_dispatched` or `openwa_dispatch_failed` without crashing the listener callback path.
8. OpenWA transport remains transport-only: listener code can accept an injected pipeline runner, but it does not import SQLite stores or perform consent writes directly.

## Current Behavior

- Routing is placeholder logic based on a minimal inbound shape.
- The consent/privacy boundary is implemented as an isolated client runtime module with `unknown`, `requested`, `granted`, and `denied` states plus strict explicit-consent parsing.
- M13 wires that consent state into the live client runtime path only.
- M14 adds the intake state machine under `src/runtime/client/intake.ts`.
- M15 adds consent-gated intake persistence under `src/persistence/*` and keeps SQLite wiring behind `PersistenceService`.
- M16 adds an explicit application-only case-creation boundary under `src/domain/cases/caseCreationService.ts`.
- When consent is `unknown`, the client runtime returns `request_consent` and upgrades stored consent to `requested` when a consent persistence adapter is available.
- When consent is `requested`, only strict explicit grant or denial phrases change state. Grant persists `granted`, appends a consent event, and immediately starts intake with `intake_ask_name`. Denial persists `denied`, appends a consent event, and returns `consent_denied_close`. Ambiguous replies return `consent_clarification` and do not grant consent.
- When consent is already `granted`, the runtime enters the intake state machine:
  - `not_started` -> `asking_name` with `intake_ask_name`
  - `asking_name` + valid structured name -> `asking_problem_summary` with `intake_ask_problem_summary`
  - `asking_name` + empty or too-long value -> `intake_invalid_response`
  - `asking_problem_summary` + valid short structured summary -> `intake_complete` with `intake_complete_ack`
  - `asking_problem_summary` + empty or too-long value -> `intake_invalid_response`
- Intake persistence is allowed only after consent is `granted`.
- Intake stores only explicitly accepted structured fields after consent is granted:
  - `name`
  - `problemSummary`
- The runtime persists intake state transitions separately from accepted fields and appends sanitized intake events without storing raw message text.
- Invalid intake replies are rejected in-memory and are not persisted.
- If no dedicated intake persistence is injected, the intake skeleton can still remain in process-local injected memory only.
- When consent is already `denied`, the runtime returns a safe no-processing close response.
- Before consent is `granted`, the runtime may request consent or clarification, but it must not persist message transcripts, message bodies, legal facts, or create cases.
- Consent persistence remains separate from M10 technical dedupe and technical audit writes.
- Intake state remains separate from both consent-state persistence and technical persistence, and OpenWA listener files stay transport-only.
- Consent subject identity is derived narrowly from the canonical sender/chat id and used only as `subjectId`. Consent metadata stores durable routing facts such as `messageId`, channel, runtime, and source markers, not full phone numbers.
- Case creation is not part of the live OpenWA runtime path yet. M16 requires an explicit application call to `createCaseFromCompletedIntake(subjectId)` after consent is `granted` and intake state is `intake_complete`.
- M18 keeps that boundary manual and operator-only through `npm run case:create-from-intake -- --subject <subjectId>`. It is not triggered by intake completion, OpenWA listeners, or any live runtime path.
- The case-creation boundary revalidates accepted structured `name` and `problemSummary` fields, creates a minimal `draft` case record, and appends a sanitized `case_created_from_intake` audit event.
- M19 makes repeated manual runs idempotent by subject. If a `draft` case already exists for the same `subjectId`, the boundary returns that existing case, appends `case_create_from_intake_idempotent_hit`, and does not create a duplicate draft.
- The case-creation boundary uses only accepted structured intake fields. It does not persist transcripts, raw message bodies, rejected values, attachments, or legal advice.
- Dispatcher is a thin transport boundary around `client.sendText`.
- OpenWA startup emits `openwa_client_starting`, drives the supervisor through `starting -> ready|degraded`, and exposes readiness through `getHealth()`.
- Bounded startup retry is controlled by `OPENWA_STARTUP_MAX_ATTEMPTS` and `OPENWA_STARTUP_RETRY_DELAY_SECONDS`.
- After readiness, transport liveness uses a read-only heartbeat loop controlled by `OPENWA_LIVENESS_INTERVAL_SECONDS` and `OPENWA_LIVENESS_FAILURE_THRESHOLD`.
- Shutdown emits `openwa_shutdown_starting`, `openwa_shutdown_complete`, and `openwa_shutdown_failed`.
- M22 adds the operator-only helper `npm run intake:list-ready`. It lists only consent-granted `intake_complete` records with both accepted intake fields present, emits operator-safe `subjectId` tokens instead of raw phone-derived identifiers, and still does not create cases automatically.
- No live OpenWA flow path creates a legal case automatically in this milestone. Case creation exists only as an explicit operator command and application boundary, remains idempotent for repeated manual runs, and is not triggered from listener or intake-completion runtime code.
