# WhatsApp Cloud API

## Decision

OpenWA is no longer acceptable as the production transport.
It depends on Chromium, QR/session persistence, WhatsApp Web behavior, and manual recovery.

The production target is now the official WhatsApp Business Cloud API through Meta Graph API.
OpenWA remains in the repo temporarily only as a legacy and development-only transport.

## Runtime Commands

- Cloud runtime entrypoint: `npm run start:whatsapp-cloud`
- Preserved compatibility alias: `npm run runtime:cloud`
- Cloud preflight: `npm run ops:preflight:cloud`
- Cloud post-start: `npm run ops:post-start:cloud`
- Local webhook replay: `npm run webhook:replay:cloud -- --fixture valid-text.json`
- Legacy/dev-only OpenWA smoke runtime: `npm run smoke:openwa`

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

Required in production:

- `WHATSAPP_CLOUD_APP_SECRET`

Additional runtime server settings:

- `WHATSAPP_CLOUD_WEBHOOK_HOST`
- `WHATSAPP_CLOUD_WEBHOOK_PORT`

`WHATSAPP_TRANSPORT=openwa|cloud` is the runtime selector.
Cloud variables are not required unless the Cloud runtime is selected.

## Health Surface

The Cloud runtime exposes local-only operational endpoints on the same HTTP server:

- `GET /health`
- `GET /ready`
- `GET /status`
- `GET /webhooks/whatsapp/cloud`
- `POST /webhooks/whatsapp/cloud`

`/health`, `/ready`, and `/status` are for local operator checks only.
They do not call live Meta APIs.
They return sanitized state and never print access tokens, verify tokens, app secrets, phone-number IDs, or payload bodies.

## Webhook Architecture

- No Chromium.
- No QR scan.
- No browser profile.
- No WhatsApp Web session automation.

Inbound flow:

1. Meta calls the webhook.
2. `GET /webhooks/whatsapp/cloud` performs the verification challenge.
3. `POST /webhooks/whatsapp/cloud` accepts the Cloud webhook payload.
4. Only inbound text messages are normalized into the shared pipeline input shape.
5. Unsupported message types are ignored safely.
6. The shared consent, intake, routing, and output-plan pipeline handles business logic.
7. Outbound text replies are sent through the Cloud sender abstraction.

When configured, `WHATSAPP_CLOUD_APP_SECRET` is used to validate `X-Hub-Signature-256` before payload processing.
In production, that app-secret signature verification is mandatory.

## Local Webhook Replay

The replay command posts fake fixtures from `tests/fixtures/whatsapp-cloud/` to the
loopback Cloud webhook URL. It refuses non-loopback targets and never calls Meta APIs.
The runtime recognizes loopback replay requests, validates the payload and optional
signature, summarizes event counts, and skips the business pipeline and outbound sender.

Unsigned local/development replay:

```bash
npm run webhook:replay:cloud -- --fixture valid-text.json
```

Signed replay:

```bash
npm run webhook:replay:cloud -- --fixture valid-text.json --signed
```

Signed mode computes `X-Hub-Signature-256: sha256=<hmac>` over the exact raw fixture
body using `WHATSAPP_CLOUD_APP_SECRET`. It fails when the secret is unavailable.
Unsigned replay is rejected when `NODE_ENV=production`.

Available fake fixtures:

- `valid-text.json`
- `unsupported-message.json`
- `status-event.json`
- `invalid-malformed.json`

Replay output contains only fixture name, target origin/path, event counts, signature
mode, and HTTP status. It never prints fixture bodies, user text, tokens, or private
configuration.

Local replay, public webhook verification, and live Meta delivery are separate steps:

- Local replay validates parsing and signature behavior without Meta connectivity.
- Public verification is the Meta `GET` challenge against the public HTTPS endpoint.
- Live delivery is actual Meta webhook traffic and remains out of scope for this milestone.

## Deployment Shape

The production shape is:

1. A public HTTPS endpoint receives Meta webhook requests.
2. A reverse proxy forwards traffic to `WHATSAPP_CLOUD_WEBHOOK_HOST:WHATSAPP_CLOUD_WEBHOOK_PORT`.
3. The app validates the verify token and the app-secret signature.
4. The shared business pipeline processes consent and intake.
5. Outbound text replies are sent through the Graph API sender abstraction.

The detailed VPS and systemd procedure lives in `docs/VPS_SYSTEMD_RUNBOOK.md`.

## Business Assumptions

- The client starts the WhatsApp conversation.
- Client-initiated service flow should stay inside the customer service window when possible.
- That operating model keeps the WhatsApp API cost near zero for the intended intake flow.
- No automatic WhatsApp notification is sent to the lawyer when a new case is opened.
- Lawyer review remains operator-command-driven now and dashboard-driven later.
- No automatic case creation is enabled.
- LLM is not the main conversation engine.

## Pricing Model Notes

Official WhatsApp pricing must be treated as a launch-time verification item.

- Meta charges on delivered messages.
- Pricing is charged by recipient and category.
- Service messages are free during the 24-hour customer service window opened by user messages.

For this project's current low-volume intake assumptions:

- WhatsApp API: approximately `0 EUR/month` for the main client-initiated service flow
- VPS: approximately `5-10 EUR/month` realistic
- Exact Meta pricing must be verified before launch against the current market and category rate card

## Current Limits

- No live Meta API calls in tests.
- No dashboard.
- No multi-bot runtime.
- No n8n integration.
- No attachments.
- No PDF generation.
- No automatic lawyer WhatsApp notifications.
