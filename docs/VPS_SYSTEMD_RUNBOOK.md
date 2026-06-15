# VPS And systemd Runbook

## Scope

This repository now has two transport tracks:

- OpenWA: legacy and development-only
- WhatsApp Business Cloud API: production direction

This milestone adds the first Cloud runtime foundation, but it does not complete production go-live.

## Current Runtime Shape

Legacy/dev-only runtime:

- Entrypoint: `npm run smoke:openwa`
- Transport: OpenWA through Chromium and WhatsApp Web
- Requires QR/session handling

Cloud foundation runtime:

- Entrypoint: `npm run runtime:cloud`
- Transport: Meta webhook + Graph API text sender
- No Chromium
- No QR
- No browser profile

## Current systemd Status

- `install.sh` and `scripts/provision-systemd.sh` still reflect the existing OpenWA service flow.
- Treat those scripts and the current `legalbot-openwa.service` shape as legacy/dev-only until a dedicated Cloud service unit milestone lands.
- Do not treat the current committed systemd flow as the final Cloud production deployment model.

Legacy preserved references that still matter during the migration:

- Node 22 remains the required runtime.
- Chrome or Chromium is still relevant for the preserved OpenWA smoke path.
- `npm ci --include=dev` remains the expected install command in the current scripts.
- `npm run ops:preflight` and `npm run ops:post-start` remain reusable operator checks.
- `command -v npm` remains part of the current systemd provisioning checks.
- `./scripts/provision-systemd.sh --install` remains the current explicit install entrypoint for the preserved OpenWA unit.
- `legalbot-openwa.service` remains the current documented service name.
- Example preserved legacy `ExecStart=/home/sayan/.nvm/versions/node/v22.22.3/bin/npm run smoke:openwa`
- No multi-bot runtime yet.

## Cloud Deployment Shape

The expected Cloud production shape is:

1. A public HTTPS endpoint receives Meta webhook requests.
2. A reverse proxy or ingress forwards traffic to `WHATSAPP_CLOUD_WEBHOOK_HOST:WHATSAPP_CLOUD_WEBHOOK_PORT`.
3. The app validates the verify token and, when configured, the app-secret signature.
4. The shared business pipeline processes consent and intake.
5. Outbound text replies are sent through the Graph API sender abstraction.

This milestone does not yet provide:

- automated Meta app registration
- reverse-proxy provisioning
- TLS certificate automation
- firewall automation
- a dedicated Cloud systemd unit template

## Minimal Cloud Runtime Env

Required when `WHATSAPP_TRANSPORT=cloud`:

```dotenv
WHATSAPP_TRANSPORT=cloud
WHATSAPP_CLOUD_API_VERSION=vXX.Y
WHATSAPP_CLOUD_PHONE_NUMBER_ID=1234567890
WHATSAPP_CLOUD_VERIFY_TOKEN=replace-me
WHATSAPP_CLOUD_ACCESS_TOKEN=replace-me
```

Recommended:

```dotenv
WHATSAPP_CLOUD_APP_SECRET=replace-me
```

Optional local bind defaults:

```dotenv
WHATSAPP_CLOUD_WEBHOOK_HOST=0.0.0.0
WHATSAPP_CLOUD_WEBHOOK_PORT=3002
```

Keep these values outside version control. Never print env-file contents.

## Operator Commands That Remain Reusable

The business and database operator boundaries remain valid across the transport pivot:

- `npm run business:check`
- `npm run business:backup`
- `npm run case:doctor`
- `npm run db:migrate`
- `npm run db:status`

`ops:preflight` remains preserved in the repo, but the current documented install/systemd flow is still OpenWA-oriented and should be treated as legacy/dev-only until the dedicated Cloud deployment milestone.

## Business Constraints

- No automatic WhatsApp notification is sent to the lawyer.
- No automatic case creation is enabled.
- No attachments or PDFs are enabled.
- No dashboard or multi-bot orchestration is included.

## Pricing Reminder

The current business assumption is that client-initiated intake stays inside the customer service window when possible and primarily uses the service category.
That supports the current low-volume cost assumption, but exact Meta pricing must be verified before launch against the current market and category rate card.
