# Flow

## Pipeline

1. OpenWA emits a raw WhatsApp message.
2. `src/transport/openwa/listener.ts` logs `openwa_message_received`, ignores self-authored and duplicate events at the transport boundary, then maps eligible raw payloads into the existing transport input shape and calls `runInboundPipeline`.
3. `normalizeInbound` maps transport data into `CanonicalEnvelope`.
4. `resolveRouting` decides which runtime should own the message.
5. `decideNextAction` produces a runtime decision.
6. `buildOutputPlan` prepares outbound transport work.
7. OpenWA dispatcher sends text actions only, then logs `openwa_output_dispatched` or `openwa_dispatch_failed` without crashing the listener callback path.

## Current Behavior

- Routing is placeholder logic based on a minimal inbound shape.
- Runtime decisions are intentionally stubbed.
- Dispatcher is a thin transport boundary around `client.sendText`.
- OpenWA startup emits `openwa_client_starting`, drives the supervisor through `starting -> ready|degraded`, and exposes readiness through `getHealth()`.
- Bounded startup retry is controlled by `OPENWA_STARTUP_MAX_ATTEMPTS` and `OPENWA_STARTUP_RETRY_DELAY_SECONDS`.
- Shutdown emits `openwa_shutdown_starting`, `openwa_shutdown_complete`, and `openwa_shutdown_failed`.
