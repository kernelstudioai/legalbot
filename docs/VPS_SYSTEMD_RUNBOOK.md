# VPS Docker Compose And systemd Runbook

## Deployment Decision

The WhatsApp Cloud production target is Docker Compose. Direct
`npm run start:whatsapp-cloud` is local debugging only. If systemd is used, it manages
the Compose service and never runs the Node/npm Cloud process directly.

OpenWA remains available as a legacy/development-only service. No multi-bot runtime,
attachments, PDFs, automatic case creation, automatic lawyer WhatsApp notifications,
dashboard, or LLM integration is enabled.

## Host Boundary

- Install Docker Engine with the Compose plugin.
- Keep the project checkout and `.env` on the VPS outside version control.
- Never paste, print, or log `.env`.
- Compose reads `.env` through `env_file`; systemd does not embed credentials.
- The host publishes the Cloud app only at `127.0.0.1:3002`.
- nginx proxies the public HTTPS webhook path to `http://127.0.0.1:3002`.
- Port `3002` must not be allowed through the public firewall.

## Remove Old Direct Node Unit

From the project root:

```bash
sudo systemctl stop legalbot-whatsapp-cloud.service || true
sudo ./scripts/provision-systemd.sh \
  --uninstall \
  --transport cloud \
  --project-root "$PWD"
```

The uninstall operation stops and disables the unit before removing its unit file. It
does not remove `.env`, databases, bind-mounted directories, backups, or logs.

## Compose Validation

Use fake loopback-only credentials for replay validation. Do not use real Meta
credentials and do not register a public webhook during this procedure.

```bash
cd ~/legalbot
docker compose config --quiet
npm run ops:preflight:cloud
npm run docker:cloud:up
npm run docker:cloud:ps
docker compose --profile cloud logs --tail=100 legalbot-whatsapp-cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Review logs only for startup state. Do not copy raw logs into tickets or chat, and do
not run commands that echo environment variables.

Unsigned replay:

```bash
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Signed replay uses the app secret already loaded from `.env`; do not put it on the
command line:

```bash
npm run webhook:replay:cloud -- \
  --signed \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Replay requests are loopback-only, return sanitized counts, and stop before pipeline
dispatch, persistence changes, outbound sending, or live Meta API calls.

Stop the validation container:

```bash
npm run docker:cloud:down
```

## systemd Compose Unit

The provisioner defaults Cloud deployments to `--deployment compose`. Install leaves
the unit stopped and disabled unless `--start` or `--enable` is explicitly supplied.

Dry-run:

```bash
./scripts/provision-systemd.sh \
  --dry-run \
  --transport cloud \
  --deployment compose \
  --project-root "$PWD"
```

Install:

```bash
sudo ./scripts/provision-systemd.sh \
  --install \
  --transport cloud \
  --deployment compose \
  --project-root "$PWD" \
  --user "$USER" \
  --docker-path "$(command -v docker)"
sudo systemctl enable legalbot-whatsapp-cloud.service
```

Preflight before any start or restart:

```bash
cd ~/legalbot
docker --version
docker compose version
docker compose --profile cloud config --services
npm run ops:preflight:cloud
```

Start and validate:

```bash
sudo systemctl start legalbot-whatsapp-cloud.service
sudo systemctl status legalbot-whatsapp-cloud.service --no-pager || true
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

The generated unit uses:

- `WorkingDirectory` set to the existing project root.
- `ExecStart=<docker> compose --profile cloud up -d --wait legalbot-whatsapp-cloud`.
- `ExecStop=<docker> compose --profile cloud stop legalbot-whatsapp-cloud`.
- `Type=oneshot` with `RemainAfterExit=yes`.
- no `EnvironmentFile`, token, secret, or npm command.

## Operator Commands

Service lifecycle:

```bash
sudo systemctl start legalbot-whatsapp-cloud.service
sudo systemctl stop legalbot-whatsapp-cloud.service
sudo systemctl restart legalbot-whatsapp-cloud.service
sudo systemctl status legalbot-whatsapp-cloud.service --no-pager
./scripts/provision-systemd.sh \
  --status \
  --transport cloud \
  --deployment compose \
  --project-root "$PWD" \
  --docker-path "$(command -v docker)"
```

Safe logs:

```bash
sudo journalctl -u legalbot-whatsapp-cloud.service -n 120 --no-pager
docker compose --profile cloud logs --tail=100 legalbot-whatsapp-cloud
```

Rebuild and redeploy:

```bash
cd ~/legalbot
git fetch --all --tags
git pull --ff-only
npm run docker:cloud:build
npm run ops:preflight:cloud
sudo systemctl restart legalbot-whatsapp-cloud.service
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
```

Rollback to the previous git commit:

```bash
cd ~/legalbot
git log --oneline -n 5
sudo systemctl stop legalbot-whatsapp-cloud.service
git checkout de9d20a
npm run docker:cloud:build
sudo systemctl start legalbot-whatsapp-cloud.service
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
```

Rerun the M37 replay harness:

```bash
cd ~/legalbot
npm run webhook:replay:cloud -- \
  --signed \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
```

Remove the unit cleanly:

```bash
sudo systemctl stop legalbot-whatsapp-cloud.service || true
sudo ./scripts/provision-systemd.sh \
  --uninstall \
  --transport cloud \
  --deployment compose \
  --project-root "$PWD" \
  --user "$USER" \
  --docker-path "$(command -v docker)"
git status --short
```

## Common Failures

- Stale container env: `docker compose --profile cloud up -d` can keep an older container if the image was not rebuilt after env or code changes. Rebuild with `npm run docker:cloud:build` and then `sudo systemctl restart legalbot-whatsapp-cloud.service`.
- Data dir ownership mismatch: if `ops:preflight:cloud` reports non-writable runtime directories, fix host ownership or permissions on `data/`, `backups/`, and `logs/` before restarting.
- Fixture missing in image/container: if replay validation fails after a successful health check, confirm `tests/fixtures/whatsapp-cloud/valid-text.json` exists in the checkout used for the operator commands and rerun `npm test`.
- Missing Cloud env: if `ops:preflight:cloud` reports `cloud_api_version_missing`, `cloud_phone_number_id_missing`, `cloud_verify_token_missing`, `cloud_access_token_missing`, or `cloud_app_secret_required_in_production`, fix the env file out of band and rerun preflight. Do not print the env file to diagnose it.

## nginx Boundary

nginx or an equivalent TLS reverse proxy is the only public listener:

Public webhook URL example: `https://example.com/webhooks/whatsapp/cloud`.

```nginx
location /webhooks/whatsapp/cloud {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Legalbot-Cloud-Replay "";
}
```

Do not expose `/health`, `/ready`, or `/status` publicly. Public DNS, TLS issuance,
firewall changes, Meta verification, and live delivery remain operator-managed and
outside this replay-only validation.
