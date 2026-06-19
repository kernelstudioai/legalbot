# WhatsApp Cloud API

## Decision

OpenWA is no longer acceptable as the production transport.
It depends on Chromium, QR/session persistence, WhatsApp Web behavior, and manual recovery.

The production target is now the official WhatsApp Business Cloud API through Meta Graph API.
OpenWA remains in the repo temporarily only as a legacy and development-only transport.

## Runtime Commands

- Production Compose start: `npm run docker:cloud:up`
- Production Compose stop: `npm run docker:cloud:down`
- Production Compose status: `npm run docker:cloud:ps`
- Production Docker diagnosis: `npm run docker:cloud:diagnose`
- Local-debug-only entrypoint: `npm run start:whatsapp-cloud`
- Preserved compatibility alias: `npm run runtime:cloud`
- Cloud preflight: `npm run ops:preflight:cloud`
- Cloud post-start: `npm run ops:post-start:cloud`
- Local webhook replay: `npm run webhook:replay:cloud -- --fixture tests/fixtures/whatsapp-cloud/valid-text.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud`
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

- `LAWYER_PHONE_E164`
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
The Cloud webhook server defaults to `127.0.0.1:3002`; a public bind must be an
explicit deployment decision.

### Fake Local Loopback Values

These values are fake placeholders for local or controlled VPS loopback validation
only. Never use them in production:

```dotenv
WHATSAPP_TRANSPORT=cloud
LAWYER_PHONE_E164=+<operator-e164-phone>
WHATSAPP_CLOUD_API_VERSION=v21.0
WHATSAPP_CLOUD_PHONE_NUMBER_ID=000000000000000
WHATSAPP_CLOUD_VERIFY_TOKEN=local-dev-verify-token
WHATSAPP_CLOUD_ACCESS_TOKEN=local-dev-access-token
WHATSAPP_CLOUD_APP_SECRET=local-dev-app-secret
WHATSAPP_CLOUD_WEBHOOK_HOST=127.0.0.1
WHATSAPP_CLOUD_WEBHOOK_PORT=3002
DATABASE_URL=file:./data/legalbot.sqlite
DATABASE_MIGRATIONS_ENABLED=true
```

Keep the real `.env` outside version control. Do not print it. The repository
`.env.example` contains the same fake Cloud loopback example.

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
5. The sender `wa_id` is compared to `LAWYER_PHONE_E164` after both are normalized
   to digits-only comparable phone values.
6. Unsupported message types are ignored safely.
7. The shared consent, intake, routing, and output-plan pipeline handles business logic.
8. Outbound text replies are sent through the Cloud sender abstraction.

When configured, `WHATSAPP_CLOUD_APP_SECRET` is used to validate `X-Hub-Signature-256` before payload processing.
In production, that app-secret signature verification is mandatory.

## Cloud Product Slice

Actor recognition:

- `LAWYER_PHONE_E164` is the supported operator phone env name.
- A configured operator is recognized only when the Cloud sender `wa_id` matches the
  normalized E.164 value.
- Message wording alone never routes a sender to the operator branch.
- Runtime logs use sanitized events such as `cloud_actor_resolved`,
  `cloud_operator_command_received`, `cloud_operator_command_handled`,
  `cloud_operator_command_rejected`, and `cloud_client_turn_received`.

Client flow over Cloud:

1. First client text asks for explicit privacy consent.
2. `Acconsento` starts the minimal intake.
3. The client provides name, surname, birth date, and city in one message.
4. The client provides the legal issue / reason for contacting the lawyer.
5. The bot asks for attachments. The client can send a supported Cloud media message or
   write `Salta`.
6. Once the attachment step is completed or skipped, the bot automatically creates a
   `draft` practice and replies with the practice code.

Practice codes are allocated as `AA001` through `AA999`, then `AB001` through
`ZZ999`. Codes are persistent and are not derived from conversation ids. A client can
own multiple practices.

Supported Cloud operator commands from the configured operator number:

- `help` / `aiuto`
- `status` / `stato`
- `pratiche`
- `pratiche oggi`
- `pratiche ultimi 7 giorni`
- `pratica AA001`

`status` returns only sanitized runtime readiness, persistence enabled state, and
migration counts when available. Practice list replies include only practice code,
masked client name, city, created time, and status. Practice detail replies include
structured client, legal issue, attachment metadata, and timestamp blocks. They never
include raw webhook bodies, raw database rows, provider tokens, media URLs, app secrets,
verify tokens, or full phone numbers.

AI is only a controlled normalization/summarization seam. It may normalize identity
fields when deterministic parsing fails and may produce a cleaned legal-issue summary
without adding facts. It is disabled/stubbed unless an implementation is explicitly
configured, must validate schema output before persistence, must not provide legal
advice, and must not process attachments. Future provider configuration should use
dedicated environment keys such as `AI_NORMALIZATION_PROVIDER`, `AI_NORMALIZATION_MODEL`,
and a provider-specific API key; do not print those values.

## Operator Runbook

Set the operator phone out of band in `.env` before Cloud preflight:

```bash
LAWYER_PHONE_E164=+<operator-e164-phone>
```

Load the runtime environment without printing values:

```bash
set -a
. ./.env
set +a
```

Run local checks from the repo root:

```bash
npm run typecheck
npm test
npx vitest run tests/app/whatsappCloudProductSlice.test.ts tests/app/whatsappCloudWebhookReplay.test.ts
npm run ops:preflight:cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Expected sanitized logs during live Cloud messages include:

- `cloud_actor_resolved`
- `cloud_client_turn_received`
- `cloud_operator_command_received`
- `cloud_operator_command_handled`
- `cloud_operator_command_rejected`
- `whatsapp_cloud_output_dispatched`

Once a phone and live Meta delivery are available, capture evidence by sending a
controlled operator `status` or `pratiche` command from the configured phone and one
client consent/intake-to-practice flow from a non-operator phone. Record only sanitized
log event names, practice code presence, and HTTP status evidence. Do not store tokens,
raw webhook bodies, full phone numbers, transcripts, or raw database rows.

## Local Webhook Replay

The replay command posts fake fixtures from `tests/fixtures/whatsapp-cloud/` to the
loopback Cloud webhook URL. It refuses non-loopback targets and never calls Meta APIs.
The runtime recognizes loopback replay requests, validates the payload and optional
signature, summarizes event counts, and skips the business pipeline, persistence
dispatch, and outbound sender. Development mode permits an unsigned loopback replay
even when a fake app secret is configured. A supplied bad signature is still rejected.
Production mode requires a valid signature.

Unsigned local/development replay:

```bash
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Signed replay:

```bash
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud \
  --signed
```

Run `npm run webhook:replay:cloud -- --help` for sanitized usage. The help path does
not load fixtures or print environment values.

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

## Controlled Foreground Loopback Validation

This direct Node workflow is local debugging only. It is not the preferred production
deployment and must not be used as the Cloud systemd `ExecStart`.

After loading fake local values without printing them, start the runtime:

```bash
cd ~/legalbot
git pull
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22
npm run typecheck
npm test
set -a
. ./.env
set +a
npm run ops:preflight:cloud
npm run start:whatsapp-cloud
```

In a second shell from `~/legalbot`, load the same environment and run:

```bash
set -a
. ./.env
set +a
curl -sS http://127.0.0.1:3002/health
curl -sS http://127.0.0.1:3002/ready
curl -sS http://127.0.0.1:3002/status
npm run webhook:replay:cloud -- --fixture tests/fixtures/whatsapp-cloud/valid-text.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
npm run webhook:replay:cloud -- --fixture tests/fixtures/whatsapp-cloud/unsupported-message.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
npm run webhook:replay:cloud -- --fixture tests/fixtures/whatsapp-cloud/status-event.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
npm run webhook:replay:cloud -- --fixture tests/fixtures/whatsapp-cloud/invalid-malformed.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud || true
npm run webhook:replay:cloud -- --signed --fixture tests/fixtures/whatsapp-cloud/valid-text.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Stop the foreground runtime with `Ctrl-C`. The runtime closes its HTTP server and
persistence handle before exiting. This workflow does not call Meta or register a
public webhook. Replay validation stops before the business pipeline, outbound
dispatch, practice creation, or lawyer notification.

## Deployment Shape

The production shape is:

1. Docker Compose runs `legalbot-whatsapp-cloud` with `.env` loaded through `env_file`.
2. The host publishes only `127.0.0.1:3002:3002`.
3. nginx receives public HTTPS traffic and proxies to `127.0.0.1:3002`.
4. The app validates the verify token and the app-secret signature.
5. systemd may manage Docker Compose, but it must not run Node/npm directly.

The Cloud container has a Node-based `/health` check and mounts only `data`, `backups`,
and `logs`. It does not mount OpenWA sessions or browser profiles. Operators must
never paste or log `.env`.

The detailed VPS and systemd procedure lives in `docs/VPS_SYSTEMD_RUNBOOK.md`.
For a temporary HTTPS validation path before real-domain nginx/TLS is ready, use
`docs/CLOUD_NGROK_TUNNEL_RUNBOOK.md`. The ngrok path is staging-only unless a stable
reserved domain is configured.
For the manual Meta webhook verification and first real signed delivery evidence path,
use `docs/META_WEBHOOK_NGROK_EVIDENCE_RUNBOOK.md`.

## Business Assumptions

- The client starts the WhatsApp conversation.
- Client-initiated service flow should stay inside the customer service window when possible.
- That operating model keeps the WhatsApp API cost near zero for the intended intake flow.
- No automatic WhatsApp notification is sent to the lawyer when a new case is opened.
- Lawyer review remains operator-command-driven now.
- Practices are created automatically after completed client intake; the lawyer does
  not manually create intake/practice records.
- AI is not the main conversation engine and is not legal advice.

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
- Attachments are metadata-only unless a future media download/storage milestone is
  implemented.
- No PDF generation.
- No appointment flow.
- No legal advice.
- No automatic lawyer WhatsApp notifications.
