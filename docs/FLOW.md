# Flow

## Pipeline

1. OpenWA emits a raw WhatsApp message.
2. `src/transport/openwa/listener.ts` logs `openwa_message_received`, maps the raw payload into the existing transport input shape, and calls `runInboundPipeline`.
3. `normalizeInbound` maps transport data into `CanonicalEnvelope`.
4. `resolveRouting` decides which runtime should own the message.
5. `decideNextAction` produces a runtime decision.
6. `buildOutputPlan` prepares outbound transport work.
7. OpenWA dispatcher sends text actions only, then logs `openwa_output_dispatched` or `openwa_dispatch_failed`.

## Current Behavior

- Routing is placeholder logic based on a minimal inbound shape.
- Runtime decisions are intentionally stubbed.
- Dispatcher is a thin transport boundary around `client.sendText`.
- OpenWA startup emits `openwa_client_starting` and `openwa_client_ready`.
