# Flow

## Pipeline

1. OpenWA emits a raw WhatsApp message.
2. `normalizeInbound` maps transport data into `CanonicalEnvelope`.
3. `resolveRouting` decides which runtime should own the message.
4. `decideNextAction` produces a runtime decision.
5. `buildOutputPlan` prepares outbound transport work.
6. OpenWA dispatcher sends the resulting plan.

## Current Behavior

- Routing is placeholder logic based on a minimal inbound shape.
- Runtime decisions are intentionally stubbed.
- Dispatcher is a thin boundary that can be replaced with a real client later.
