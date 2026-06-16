# VPS Docker Compose And systemd Runbook

## Deployment Decision

The WhatsApp Cloud production target is Docker Compose. Direct
`npm run start:whatsapp-cloud` is local debugging only. If systemd is used, it manages
the Compose service and never runs the Node/npm Cloud process directly.

OpenWA remains available as a legacy/development-only service. No multi-bot runtime,
attachments, PDFs, automatic case creation, automatic lawyer WhatsApp notifications,
dashboard, or LLM integration is enabled.

For M40 rollout evidence collection, use `docs/CLOUD_OPS_EVIDENCE_PACK.md` as the
authoritative evidence template, command list, sanitization rule set, and go/no-go
criteria.

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

The generated unit uses:

- `WorkingDirectory` set to the existing project root.
- `ExecStart=<docker> compose --profile cloud up -d --wait legalbot-whatsapp-cloud`.
- `ExecStop=<docker> compose --profile cloud stop legalbot-whatsapp-cloud`.
- `Type=oneshot` with `RemainAfterExit=yes`.
- no `EnvironmentFile`, token, secret, or npm command.

Preflight before any start or restart:

```bash
cd ~/legalbot
docker --version
docker compose version
docker compose --profile cloud config --services
npm run ops:preflight:cloud
```

## M39 Evidence Checklist

Record one sanitized evidence set before rollback, after rollback to `de9d20a`, and
after the forward restore to the original commit.

Checklist:

- `git rev-parse --short HEAD`
- `git branch --show-current`
- `sudo systemctl status legalbot-whatsapp-cloud.service --no-pager`
- `docker compose --profile cloud ps legalbot-whatsapp-cloud`
- `curl -fsS http://127.0.0.1:3002/health`
- `curl -fsS http://127.0.0.1:3002/ready || true`
- `curl -fsS http://127.0.0.1:3002/status`
- `npm run ops:preflight:cloud`
- `OPS_POST_START_MODE=docker npm run ops:post-start:cloud`
- `npm run docker:cloud:diagnose`
- signed replay returns `200`
- unsigned replay returns `401`

Store only sanitized JSON outputs and high-level command results. Do not store `.env`,
raw webhook bodies, raw DB rows, full phone numbers, or unfiltered container logs.

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

Health, readiness, and status:

```bash
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3002/ready || true
curl -fsS http://127.0.0.1:3002/status
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Safe logs:

```bash
sudo journalctl -u legalbot-whatsapp-cloud.service -n 120 --no-pager
docker compose --profile cloud logs --tail=120 legalbot-whatsapp-cloud
docker compose --profile cloud ps legalbot-whatsapp-cloud
```

Replay harness:

```bash
npm run webhook:replay:cloud -- \
  --signed \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud

npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Expected replay results:

- signed replay: HTTP `200`
- unsigned replay: HTTP `401`

## M39 Restart, Rebuild, And Recreate Decision Tree

Use the smallest safe action that matches the operator symptom.

1. `systemctl status` shows `active (exited)` and `docker compose ... ps` shows the
   container `Up` and healthy:
   this is expected for the oneshot Compose unit. Treat container health and the
   sanitized app probes as the source of truth.
2. Code changed in git, Dockerfile changed, package files changed, or the target commit
   changed:
   run `npm run docker:cloud:build`, then `sudo systemctl restart legalbot-whatsapp-cloud.service`,
   then rerun the evidence checklist.
3. `.env` changed, runtime env changed, or evidence suggests the container reused old
   env:
   a plain service restart is not enough. Stop the service, force a recreate, then rerun
   the evidence checklist.
4. `ops:preflight:cloud` reports `required_runtime_directories_not_writable`:
   fix host ownership or permissions on `data/`, `backups/`, or `logs/` before any
   restart or recreate.
5. Signed replay fails with non-`200`:
   treat this as webhook signature enforcement failure and do not continue to live
   traffic validation.
6. Unsigned replay is accepted:
   treat this as signature enforcement regression and stop operator validation until
   fixed.

## M39 Rollback Drill To `de9d20a`

This drill is manual by design. Do not automate rollback without explicit operator
confirmation.

```bash
cd ~/legalbot
current_commit="$(git rev-parse --short HEAD)"
git branch --show-current
git rev-parse --short HEAD
npm run ops:preflight:cloud
sudo systemctl stop legalbot-whatsapp-cloud.service
git checkout de9d20a
npm run docker:cloud:build
docker compose --profile cloud up -d --force-recreate legalbot-whatsapp-cloud
sudo systemctl start legalbot-whatsapp-cloud.service
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
npm run webhook:replay:cloud -- \
  --signed \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Record that the signed replay returned `200` and the unsigned replay returned `401`
before restoring forward.

## M39 Forward Restore To The Original Commit

Return to the exact commit recorded before rollback. If the branch moved while the drill
was running, use the recorded commit instead of `main`.

```bash
cd ~/legalbot
sudo systemctl stop legalbot-whatsapp-cloud.service
git checkout "$current_commit"
npm run docker:cloud:build
docker compose --profile cloud up -d --force-recreate legalbot-whatsapp-cloud
sudo systemctl start legalbot-whatsapp-cloud.service
npm run ops:preflight:cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
npm run webhook:replay:cloud -- \
  --signed \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
git status --short
```

The forward restore is complete only after preflight, post-start, diagnose, signed
replay, and unsigned replay all match the expected healthy M39 evidence.

## M39 Stale-Env Recovery Drill

This drill proves that Docker container env requires recreate, not only restart.
Never print env values during the drill.

Evidence of stale env usually looks like this:

- operator updated `.env` out of band
- `sudo systemctl restart legalbot-whatsapp-cloud.service` completed
- behavior did not change as expected
- `OPS_POST_START_MODE=docker npm run ops:post-start:cloud` or
  `npm run docker:cloud:diagnose` still shows the old outcome

Recovery steps:

```bash
cd ~/legalbot
npm run ops:preflight:cloud
sudo systemctl stop legalbot-whatsapp-cloud.service
docker compose --profile cloud up -d --build --force-recreate legalbot-whatsapp-cloud
sudo systemctl start legalbot-whatsapp-cloud.service
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
npm run webhook:replay:cloud -- \
  --signed \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

If preflight reports directory write failures, stop and fix ownership first. If replay
still fails after recreate, treat it as an application or secret-management issue rather
than a stale-env issue.

## Common Failures

- `systemctl` is `active (exited)` but the container is healthy: this is expected for
  the oneshot Compose unit and is not a failure by itself.
- Stale container env: `sudo systemctl restart legalbot-whatsapp-cloud.service` can
  restart the existing container without refreshing env-backed configuration. Use the
  stale-env recovery drill and force a recreate.
- Container reused after code change: `docker compose --profile cloud up -d` without a
  rebuild can leave the older image in place. Rebuild, then restart or recreate.
- Data dir ownership mismatch: if `ops:preflight:cloud` reports non-writable runtime
  directories, fix host ownership or permissions on `data/`, `backups/`, and `logs/`
  before restarting.
- Fixture missing in image/container: if replay validation fails after a successful
  health check, confirm `tests/fixtures/whatsapp-cloud/valid-text.json` exists in the
  checkout used for the operator commands and rerun `npm test`.
- Missing Cloud env: if `ops:preflight:cloud` reports
  `cloud_api_version_missing`, `cloud_phone_number_id_missing`,
  `cloud_verify_token_missing`, `cloud_access_token_missing`, or
  `cloud_app_secret_required_in_production`, fix the env file out of band and rerun
  preflight. Do not print the env file to diagnose it.

## nginx Boundary

nginx or an equivalent TLS reverse proxy is the only public listener.

- Public webhook URL example: `https://example.com/webhooks/whatsapp/cloud`
- Runtime target: `http://127.0.0.1:3002/webhooks/whatsapp/cloud`
- Public traffic must not forward `X-Legalbot-Cloud-Replay`
- `/health`, `/ready`, and `/status` must remain local-only

Use `docs/CLOUD_NGINX_TLS_EDGE_RUNBOOK.md` and
`docs/templates/nginx-whatsapp-cloud-edge.conf` for the M41 operator dry-run,
protected edge-health probe, syntax validation, rollback, and go/no-go criteria before
Meta registration.
