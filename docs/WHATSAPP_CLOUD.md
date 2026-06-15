# WhatsApp Cloud API

## Decision

OpenWA is no longer acceptable as the production transport.
It depends on Chromium, QR/session persistence, WhatsApp Web behavior, and manual recovery.

The production direction is now the official WhatsApp Business Cloud API through Meta Graph API.
OpenWA remains in the repo temporarily only as a legacy and development-only transport.

## Current Foundation

- Cloud transport code lives under `src/transport/whatsapp-cloud`.
- The runtime entrypoint is `src/app/whatsappCloudRuntime.ts`.
- The transport boundary now includes:
  - webhook verification
  - webhook event parsing
  - inbound text normalization
  - text-only outbound sender abstraction
- Status and delivery events are intentionally stubbed for a later milestone.

## Runtime Configuration

Required only when `WHATSAPP_TRANSPORT=cloud`:

- `WHATSAPP_CLOUD_API_VERSION`
- `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
- `WHATSAPP_CLOUD_VERIFY_TOKEN`
- `WHATSAPP_CLOUD_ACCESS_TOKEN`

Optional but recommended:

- `WHATSAPP_CLOUD_APP_SECRET`

Additional runtime server settings:

- `WHATSAPP_CLOUD_WEBHOOK_HOST`
- `WHATSAPP_CLOUD_WEBHOOK_PORT`

`WHATSAPP_TRANSPORT=openwa|cloud` is the runtime selector.
Cloud variables are not required unless the Cloud runtime is selected.

## Webhook Architecture

- No Chromium.
- No QR scan.
- No browser profile.
- No WhatsApp Web session automation.

Inbound flow:

1. Meta calls the webhook.
2. `GET` performs the verification challenge.
3. `POST` accepts the Cloud webhook payload.
4. Only inbound text messages are normalized into the shared pipeline input shape.
5. Unsupported message types are ignored safely.
6. The shared consent, intake, routing, and output-plan pipeline handles business logic.
7. Outbound text replies are sent through the Cloud sender abstraction.

When configured, `WHATSAPP_CLOUD_APP_SECRET` is used to validate `X-Hub-Signature-256` before payload processing.

## Business Assumptions

- The client starts the WhatsApp conversation.
- Client-side intake messages should stay inside the customer service window when possible.
- WhatsApp service messages are the intended category for user-initiated support and intake flows.
- No automatic WhatsApp notification is sent to the lawyer when a new case is opened.
- Lawyer and operator review remain command-driven now and dashboard-driven later.
- LLM is not the main conversation engine.
- LLM is limited to behind-the-scenes parsing, extraction, and normalization of free-text input.
- Recaps and case summaries should be generated from structured fields and templates when possible.

## Pricing Model Notes

Official WhatsApp pricing must be treated as a launch-time verification item.

- Meta charges on delivered messages.
- Pricing is charged by recipient and category.
- Categories include marketing, utility, authentication, and service.
- Service messages are free during the 24-hour customer service window opened by user messages.

For this project's current low-volume intake assumptions:

- WhatsApp API: approximately `0 EUR/month` for the main service flow
- LLM: approximately `1-5 EUR/month` realistic
- LLM: approximately `5-10 EUR/month` prudential
- VPS: approximately `5-10 EUR/month` realistic
- Total realistic: approximately `6-17 EUR/month`
- Total prudential: approximately `17-35 EUR/month`

Exact Meta pricing must be verified before launch against the current market and category rate card.

## Current Limits

- No live Meta API calls in tests.
- No production go-live automation yet.
- No dashboard.
- No multi-bot runtime.
- No n8n integration.
- No attachments.
- No PDF generation.
- No automatic case creation.
