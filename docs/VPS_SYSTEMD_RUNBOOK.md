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

## Fake Cloud Loopback Env

The following values are fake placeholders for controlled local/VPS loopback validation
only. They must not be used in production:

```dotenv
WHATSAPP_TRANSPORT=cloud
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

Keep these values outside version control.
Never print env-file contents.
Do not paste `.env` contents into chat, logs, tickets, or command output.
Production requires separately managed real credentials and mandatory app-secret
signature verification.

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

## Foreground Cloud Loopback Validation

Run the following sequence as the VPS operator. Loading `.env` this way does not print it:

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

In a second VPS shell:

```bash
cd ~/legalbot
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22
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
WHATSAPP_CLOUD_APP_SECRET=local-dev-app-secret npm run webhook:replay:cloud -- --signed --fixture tests/fixtures/whatsapp-cloud/valid-text.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Stop the foreground runtime safely with `Ctrl-C`.

Replay-only requests validate parsing and optional signatures, return sanitized counts
and status, and stop before the shared pipeline, persistence dispatch, or Graph API
sender. No live Meta request is made.

## systemd Cloud Loopback Validation

With the fake loopback `.env` loaded, run:

```bash
./scripts/provision-systemd.sh --dry-run --transport cloud --service-name legalbot-whatsapp-cloud.service --exec-script start:whatsapp-cloud --project-root "$PWD"
sudo ./scripts/provision-systemd.sh --install --transport cloud --service-name legalbot-whatsapp-cloud.service --exec-script start:whatsapp-cloud --project-root "$PWD" --user "$USER" --npm-path "$(command -v npm)"
sudo systemctl start legalbot-whatsapp-cloud.service
sudo systemctl status legalbot-whatsapp-cloud.service --no-pager || true
npm run ops:post-start:cloud
sudo journalctl -u legalbot-whatsapp-cloud.service -n 120 --no-pager
sudo systemctl stop legalbot-whatsapp-cloud.service
sudo ./scripts/provision-systemd.sh --uninstall --transport cloud --service-name legalbot-whatsapp-cloud.service --exec-script start:whatsapp-cloud --project-root "$PWD" --user "$USER" --npm-path "$(command -v npm)"
./scripts/provision-systemd.sh --status --transport cloud --service-name legalbot-whatsapp-cloud.service --exec-script start:whatsapp-cloud --project-root "$PWD"
git status --short
```

The provisioner installs the unit stopped and disabled by default. The explicit
`systemctl start` is temporary for validation; the sequence stops and uninstalls the
unit afterward. It does not register a webhook, enable boot-time startup, expose the
loopback port, or call Meta.

## Reverse Proxy And TLS

Meta webhook delivery requires a public HTTPS endpoint.
Terminate TLS at nginx or an equivalent reverse proxy and forward only to the local Cloud bind port.

Example nginx server block:

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    location /webhooks/whatsapp/cloud {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Legalbot-Cloud-Replay "";
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
https://example.com/webhooks/whatsapp/cloud
```

Firewall notes:

- Allow only inbound `80/tcp` and `443/tcp` publicly for HTTP redirect/certificate
  issuance and HTTPS delivery.
- Bind `WHATSAPP_CLOUD_WEBHOOK_PORT` to `127.0.0.1` or otherwise prevent public access.
- Do not expose `/health`, `/ready`, or `/status` publicly.
- Do not place tokens, verify tokens, app secrets, or phone-number IDs in nginx config.
- Clear `X-Legalbot-Cloud-Replay` at the proxy so public callers cannot request replay-only handling.

Public HTTPS is required for Meta webhook verification and delivery. TLS certificate
issuance, DNS, firewall changes, public verification, and live Meta registration are
operator-managed and are not performed by repository commands.

## Safe Log Review

Use commands that inspect service state without printing env contents:

```bash
systemctl status legalbot-whatsapp-cloud.service --no-pager
journalctl -u legalbot-whatsapp-cloud.service -n 100 --no-pager
journalctl -u legalbot-whatsapp-cloud.service --since "15 minutes ago" --no-pager
```

Do not grep or echo tokens.
Do not print QR data, session artifacts, or browser-profile paths.
Do not expose the local app port publicly.

## Rollback

From the checked-out project directory:

```bash
sudo systemctl stop legalbot-whatsapp-cloud.service || true
sudo ./scripts/provision-systemd.sh --uninstall --transport cloud --service-name legalbot-whatsapp-cloud.service --exec-script start:whatsapp-cloud --project-root "$PWD" --user "$USER" --npm-path "$(command -v npm)"
./scripts/provision-systemd.sh --status --transport cloud --service-name legalbot-whatsapp-cloud.service --exec-script start:whatsapp-cloud --project-root "$PWD"
git status --short
```

The rollback removes the systemd unit only. Confirm that `.env`, database files, and
runtime data remain untouched. Do not print their contents.

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
