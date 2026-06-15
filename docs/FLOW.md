# Flow

## Shared Pipeline

1. A transport receives an inbound WhatsApp event.
2. The transport normalizes the inbound event into the shared transport input shape.
3. `src/ingress/normalizeInbound.ts` converts that shape into `CanonicalEnvelope`.
4. `src/routing/resolveRouting.ts` decides which runtime should own the message.
5. `src/runtime/shared/decideNextAction.ts` delegates to the client or lawyer runtime.
6. `src/output/buildOutputPlan.ts` produces an outbound text-only `OutputPlan`.
7. The active transport dispatcher or sender delivers supported outbound text messages only.

The domain pipeline remains transport-agnostic.
OpenWA listeners and Cloud webhook handlers orchestrate transport concerns only.

## WhatsApp Cloud Runtime

- `src/app/whatsappCloudRuntime.ts` is the production-target runtime entrypoint.
- Operators start it with `npm run start:whatsapp-cloud`.
- `GET /health`, `GET /ready`, and `GET /status` provide sanitized local health checks on the same port as the webhook server.
- `GET /webhooks/whatsapp/cloud` performs the Meta verification challenge and returns the challenge only when the mode and verify token are valid.
- `POST /webhooks/whatsapp/cloud` parses WhatsApp Cloud webhook payloads, extracts text message events, ignores unsupported message types safely, and ignores status events for now.
- When `WHATSAPP_CLOUD_APP_SECRET` is configured, the webhook handler validates `X-Hub-Signature-256` before processing the payload.
- In production, Cloud signature verification is mandatory.
- Normalized inbound text messages are routed through the same consent, intake, routing, and output-plan pipeline already used by the existing app foundation.
- Outbound replies go through the Cloud sender abstraction, which constructs Meta Graph API text payloads and supports an injected HTTP client for tests.

## OpenWA Runtime

- `src/app/openwaSmoke.ts` and `src/transport/openwa/*` stay in the repo temporarily.
- OpenWA is now legacy and development-only.
- It still uses the same shared routing, consent, intake, and output-plan pipeline.
- It is no longer the intended production transport because it depends on Chromium, QR/session persistence, WhatsApp Web behavior, and manual recovery.

## Operator Workflow

- `npm run ops:preflight` remains the preserved OpenWA-oriented readiness command.
- `npm run ops:preflight:cloud` validates Cloud runtime env, migration posture, and repo hygiene without printing secrets.
- `npm run ops:post-start` checks the sanitized OpenWA status surface after startup.
- `npm run ops:post-start:cloud` checks the local Cloud health surface after startup without calling live Meta APIs.

## Current Client Runtime Behavior

- Consent stays explicit and isolated under `src/runtime/client/consent.ts`.
- Intake stays isolated under `src/runtime/client/intake.ts`.
- Accepted fields remain:
  - `firstName`
  - `lastName`
  - `birthDate`
  - `city`
  - `problemSummary`
- Only accepted structured fields are persisted after consent is granted.
- Raw transcripts and rejected values are not persisted.

## Case Handling

- Manual case creation stays outside the live transport path.
- `case:create-from-intake`, `business:check`, `business:backup`, `case:doctor`, and `ops:preflight` remain reusable operator commands.
- No live transport path creates a case automatically.
- No automatic WhatsApp notification is sent to the lawyer when a new case is opened.
- Lawyer reviews remain operator-command-driven now and dashboard-driven later.

## LLM Boundary

- LLM usage is not the main conversation engine.
- Future LLM usage is limited to behind-the-scenes parsing, extraction, and normalization of free-text user input.
- Recaps and case summaries should be generated from structured fields and templates whenever possible.
