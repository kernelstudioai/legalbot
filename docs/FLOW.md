# Flow

## Pipeline

1. OpenWA emits a raw WhatsApp message.
2. `src/transport/openwa/listener.ts` logs `openwa_message_received`, ignores self-authored and duplicate events at the transport boundary, then maps eligible raw payloads into the existing transport input shape and calls `runInboundPipeline`.
3. `normalizeInbound` maps transport data into `CanonicalEnvelope`.
4. `resolveRouting` decides which runtime should own the message.
5. `decideNextAction` produces a runtime decision. For `client` routing it now delegates to `src/runtime/client/clientRuntime.ts`, which can read and update consent state through an injected consent-only persistence adapter.
6. `buildOutputPlan` prepares outbound transport work.
7. OpenWA dispatcher sends text actions only, then logs `openwa_output_dispatched` or `openwa_dispatch_failed` without crashing the listener callback path.
8. OpenWA transport remains transport-only: listener code can accept an injected pipeline runner, but it does not import SQLite stores or perform consent writes directly.

## Current Behavior

- Routing is placeholder logic based on a minimal inbound shape.
- The consent/privacy boundary is implemented as an isolated client runtime module with `unknown`, `requested`, `granted`, and `denied` states plus strict explicit-consent parsing.
- M13 wires that consent state into the live client runtime path only.
- When consent is `unknown`, the client runtime returns `request_consent` and upgrades stored consent to `requested` when a consent persistence adapter is available.
- When consent is `requested`, only strict explicit grant or denial phrases change state. Grant persists `granted`, appends a consent event, and returns `consent_granted_ack`. Denial persists `denied`, appends a consent event, and returns `consent_denied_close`. Ambiguous replies return `consent_clarification` and do not grant consent.
- When consent is already `granted`, the runtime returns a safe `intake_not_implemented` placeholder. It does not persist message bodies, legal facts, or create cases.
- When consent is already `denied`, the runtime returns a safe no-processing close response.
- Before consent is `granted`, the runtime may request consent or clarification, but it must not persist message transcripts, message bodies, legal facts, or create cases.
- Consent persistence remains separate from M10 technical dedupe and technical audit writes.
- Consent subject identity is derived narrowly from the canonical sender/chat id and used only as `subjectId`. Consent metadata stores durable routing facts such as `messageId`, channel, runtime, and source markers, not full phone numbers.
- Dispatcher is a thin transport boundary around `client.sendText`.
- OpenWA startup emits `openwa_client_starting`, drives the supervisor through `starting -> ready|degraded`, and exposes readiness through `getHealth()`.
- Bounded startup retry is controlled by `OPENWA_STARTUP_MAX_ATTEMPTS` and `OPENWA_STARTUP_RETRY_DELAY_SECONDS`.
- After readiness, transport liveness uses a read-only heartbeat loop controlled by `OPENWA_LIVENESS_INTERVAL_SECONDS` and `OPENWA_LIVENESS_FAILURE_THRESHOLD`.
- Shutdown emits `openwa_shutdown_starting`, `openwa_shutdown_complete`, and `openwa_shutdown_failed`.
