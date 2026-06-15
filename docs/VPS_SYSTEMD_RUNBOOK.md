# VPS And systemd Runbook

## Scope

This repository now has two transport tracks:

- OpenWA: legacy and development-only
- WhatsApp Business Cloud API: production target

This milestone makes the Cloud runtime operationally deployable on a VPS.
It does not remove OpenWA yet.

## Current Runtime Shape

Legacy/dev-only runtime:

- Entrypoint: `npm run smoke:openwa`
- Transport: OpenWA through Chromium and WhatsApp Web
- Requires QR/session handling

Cloud production-target runtime:

- Entrypoint: `npm run start:whatsapp-cloud`
- Compatibility alias: `npm run runtime:cloud`
- Transport: Meta webhook + Graph API text sender
- No Chromium
- No QR
- No browser profile

## Shared Host Prerequisites

- Node 22
- `npm ci --include=dev`
- explicit env file managed outside version control
- firewall access only for the public reverse proxy port and local operator SSH access

Legacy OpenWA-only note that still matters during migration:

- Chrome or Chromium is still required for `npm run smoke:openwa`
- Example preserved legacy `ExecStart=/home/sayan/.nvm/versions/node/v22.22.3/bin/npm run smoke:openwa`

Cloud target note:

- Example Cloud `ExecStart=/home/deploy/.nvm/versions/node/v22.22.3/bin/npm run start:whatsapp-cloud`

## Minimal Cloud Runtime Env

Required when `WHATSAPP_TRANSPORT=cloud`:

```dotenv
WHATSAPP_TRANSPORT=cloud
WHATSAPP_CLOUD_API_VERSION=vXX.Y
WHATSAPP_CLOUD_PHONE_NUMBER_ID=1234567890
WHATSAPP_CLOUD_VERIFY_TOKEN=replace-me
WHATSAPP_CLOUD_ACCESS_TOKEN=replace-me
```

Required in production:

```dotenv
WHATSAPP_CLOUD_APP_SECRET=replace-me
```

Optional local bind defaults:

```dotenv
WHATSAPP_CLOUD_WEBHOOK_HOST=0.0.0.0
WHATSAPP_CLOUD_WEBHOOK_PORT=3002
```

Keep these values outside version control.
Never print env-file contents.

## Preflight And Post-Start

OpenWA legacy/dev-only checks:

- `npm run ops:preflight`
- `npm run ops:post-start`

Cloud production-target checks:

- `npm run ops:preflight:cloud`
- `npm run ops:post-start:cloud`

Both command families stay local-only.
They do not call live Meta APIs.

## systemd Provisioning

`scripts/provision-systemd.sh` now supports both transports.

Important defaults:

- `command -v npm` remains the npm discovery fallback
- `EnvironmentFile=` is used, but the file contents are never printed
- the service stays stopped unless `--start` is passed
- the service stays disabled unless `--enable` is passed
- no auto-start by default
- no auto-enable by default

Legacy/dev-only OpenWA example:

```bash
./scripts/provision-systemd.sh --install
```

Cloud production-target example:

```bash
./scripts/provision-systemd.sh \
  --install \
  --transport cloud \
  --service-name legalbot-whatsapp-cloud.service \
  --exec-script start:whatsapp-cloud
```

Dry-run the Cloud unit before installing it:

```bash
./scripts/provision-systemd.sh \
  --dry-run \
  --transport cloud \
  --service-name legalbot-whatsapp-cloud.service \
  --exec-script start:whatsapp-cloud
```

Expected service names:

- `legalbot-openwa.service`
- `legalbot-whatsapp-cloud.service`

## Reverse Proxy And TLS

Meta webhook delivery requires a public HTTPS endpoint.
Terminate TLS at nginx or an equivalent reverse proxy and forward only to the local Cloud bind port.

Example nginx server block:

```nginx
server {
    listen 443 ssl http2;
    server_name webhook.example.invalid;

    ssl_certificate /etc/letsencrypt/live/webhook.example.invalid/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/webhook.example.invalid/privkey.pem;

    location /webhooks/whatsapp/cloud {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /health {
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:3002/health;
    }

    location /ready {
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:3002/ready;
    }
}
```

Webhook verification URL example:

```text
https://webhook.example.invalid/webhooks/whatsapp/cloud
```

Firewall notes:

- Allow inbound `443/tcp` to the reverse proxy.
- Keep `WHATSAPP_CLOUD_WEBHOOK_PORT` bound to localhost or private interfaces unless infrastructure requires otherwise.
- Do not expose `/health`, `/ready`, or `/status` publicly.

## Safe Log Review

Use commands that inspect service state without printing env contents:

```bash
systemctl status legalbot-whatsapp-cloud.service --no-pager
journalctl -u legalbot-whatsapp-cloud.service -n 100 --no-pager
journalctl -u legalbot-whatsapp-cloud.service --since "15 minutes ago" --no-pager
```

Do not grep or echo tokens.
Do not print QR data, session artifacts, or browser-profile paths.

## Business Constraints

- No automatic WhatsApp notification is sent to the lawyer.
- Lawyer reviews remain operator-tool-driven now and dashboard-driven later.
- No automatic case creation is enabled.
- No attachments or PDFs are enabled.
- No multi-bot runtime yet.

## Pricing Reminder

The intended business model is still client-initiated service flow inside the customer service window whenever possible.
That keeps WhatsApp cost near zero for the main intake flow.
Exact Meta pricing must be verified before launch against the current market and category rate card.
