# M40 Cloud Ops Evidence Pack

## Purpose

Use this pack to make WhatsApp Cloud rollout decisions evidence-backed, repeatable, and
safe for the Docker Compose plus systemd deployment described in
`docs/VPS_SYSTEMD_RUNBOOK.md`.

This procedure is documentation-first and read-only by default. It does not register a
live Meta webhook, does not configure nginx or TLS, does not print `.env`, and does not
dump secrets, raw webhook bodies, raw DB rows, or full phone numbers.

## Safe Output Rules

Always sanitize collected evidence before storing or sharing it.

- Never print `.env` contents or shell-expanded secret values.
- Never print `WHATSAPP_CLOUD_APP_SECRET`, `WHATSAPP_CLOUD_ACCESS_TOKEN`, or
  `WHATSAPP_CLOUD_VERIFY_TOKEN`.
- Never print raw webhook payload bodies.
- Never print full phone numbers. Replace them with `redacted_phone`.
- Never print raw DB rows.
- Never paste full `docker compose logs`, `journalctl`, browser profile paths, QR data,
  WhatsApp session paths, or runtime secrets.
- Store only high-level status lines, structured JSON summaries, exit codes, and
  sanitized command results.

## Evidence Pack Format

Store one pack per rollout decision using either:

- `npm run ops:evidence:cloud -- --format json > m40-evidence.json`
- `npm run ops:evidence:cloud -- --format markdown > m40-evidence.md`

Optional host identifier:

- `npm run ops:evidence:cloud -- --format markdown --host-id vps-prod-01`

The helper is read-only. It captures safe local metadata and emits a template for the
remaining operator evidence fields.

Required fields:

- timestamp
- host identifier only if non-sensitive
- branch and commit
- git status
- Node and npm versions
- Docker and Compose availability
- systemd unit enabled and status
- Compose service running and health state
- preflight result
- post-start result
- Docker diagnose result
- signed replay result
- unsigned replay result
- direct missing, invalid, and valid signature result
- mount ownership and writability summary
- rollback drill status
- restore drill status
- known residual risks
- final go or no-go decision

## Exact M40 Evidence Commands

Run these from the project root on the VPS checkout used for the rollout.

### Baseline

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
git branch --show-current
git rev-parse --short HEAD
git status --short
node --version
npm --version
docker --version
docker compose version
sudo systemctl is-enabled legalbot-whatsapp-cloud.service
sudo systemctl show legalbot-whatsapp-cloud.service --property=ActiveState --property=SubState --property=UnitFileState
docker compose --profile cloud ps legalbot-whatsapp-cloud --format json
```

### Health And Rollout Checks

```bash
npm run ops:preflight:cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

### Replay Checks

Signed replay:

```bash
npm run webhook:replay:cloud -- \
  --signed \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Unsigned replay:

```bash
npm run webhook:replay:cloud -- \
  --fixture tests/fixtures/whatsapp-cloud/valid-text.json \
  --target http://127.0.0.1:3002/webhooks/whatsapp/cloud
```

Direct missing signature:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://127.0.0.1:3002/webhooks/whatsapp/cloud \
  -H "Content-Type: application/json" \
  -H "X-Legalbot-Cloud-Replay: 1" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Direct invalid signature:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://127.0.0.1:3002/webhooks/whatsapp/cloud \
  -H "Content-Type: application/json" \
  -H "X-Legalbot-Cloud-Replay: 1" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Direct valid signature without printing the secret:

```bash
node --experimental-strip-types -e "import { createHmac } from 'node:crypto'; import { readFileSync } from 'node:fs'; const rawBody = readFileSync('tests/fixtures/whatsapp-cloud/valid-text.json', 'utf8'); const signature = 'sha256=' + createHmac('sha256', process.env.WHATSAPP_CLOUD_APP_SECRET ?? '').update(rawBody).digest('hex'); const response = await fetch('http://127.0.0.1:3002/webhooks/whatsapp/cloud', { method: 'POST', headers: { 'content-type': 'application/json', 'x-legalbot-cloud-replay': '1', 'x-hub-signature-256': signature }, body: rawBody }); process.stdout.write(JSON.stringify({ statusCode: response.status, body: await response.text() }));"
```

Expected direct results:

- missing signature: HTTP `401`
- invalid signature: HTTP `401`
- valid signature: HTTP `200` and body `EVENT_REPLAYED`

### Mount Ownership And Writability

```bash
find data backups logs -maxdepth 0 -type d -exec stat -c '%n owner=%U:%G mode=%a' {} \;
find data backups logs -maxdepth 0 -type d -exec test -w {} \; -print
```

### Rollback And Restore Drills

Rollback to `de9d20a`:

```bash
git checkout de9d20a
npm run docker:cloud:build
docker compose --profile cloud up -d --force-recreate legalbot-whatsapp-cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Restore to `815288e`:

```bash
git checkout 815288e
npm run docker:cloud:build
docker compose --profile cloud up -d --force-recreate legalbot-whatsapp-cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
git status --short
```

These drills are operator-invoked and not automated by the helper.

## Go Or No-Go Acceptance Criteria

Choose `go` only when every required check below passes.

- Git state matches the intended rollout branch and commit, and `git status --short` is
  clean or only contains explicitly accepted non-runtime changes.
- Node is `22.x`, `npm` is available, Docker is available, and Docker Compose is
  available.
- `legalbot-whatsapp-cloud.service` is enabled for the intended deployment posture.
- `systemctl show` reports `ActiveState=active` and `SubState=exited`, or another state
  is explicitly explained by the operator with matching container health evidence.
- `docker compose --profile cloud ps legalbot-whatsapp-cloud --format json` shows the
  service running and healthy.
- `npm run ops:preflight:cloud` returns sanitized JSON with `status="ready"` and
  `blockers=[]`.
- `OPS_POST_START_MODE=docker npm run ops:post-start:cloud` returns sanitized JSON with
  `status="healthy"` and `diagnosis.code="app_ready"`.
- `npm run docker:cloud:diagnose` returns sanitized JSON with `status="healthy"`.
- Signed replay returns `200`.
- Unsigned replay returns `401`.
- Direct missing signature returns `401`.
- Direct invalid signature returns `401`.
- Direct valid signature returns `200` with `EVENT_REPLAYED`.
- `data/`, `backups/`, and `logs/` are writable by the runtime user.
- Rollback drill to `de9d20a` has already been validated and recorded as healthy.
- Restore drill to `815288e` has already been validated and recorded as healthy.
- Residual risks are documented and explicitly accepted by the operator.

Choose `no-go` when any required criterion fails or cannot be evidenced safely.

## Rollback Acceptance Criteria

Rollback is accepted only when:

- the target commit is exactly `de9d20a`
- the image is rebuilt for that commit
- the Cloud Compose service is force-recreated
- post-start is healthy
- Docker diagnose is healthy
- signed replay returns `200`
- unsigned replay returns `401`

## Stale-Env Recovery Acceptance Criteria

Treat stale env as recovered only when:

- the operator used a container recreate path, not only `systemctl restart`
- the recreated container now matches the expected behavior
- post-start is healthy
- Docker diagnose is healthy
- signed replay returns `200`
- unsigned replay returns `401`

If behavior does not change after recreate, treat the problem as application or secret
management drift, not a stale-env recovery success.

## Mount Ownership Acceptance Criteria

Mount ownership passes only when:

- `data/`, `backups/`, and `logs/` exist or are creatable by the runtime user
- each directory is writable by the runtime user
- no preflight blocker reports `required_runtime_directories_not_creatable`
- no preflight blocker reports `required_runtime_directories_not_writable`

## systemd `active (exited)` Interpretation

For this rollout, `active (exited)` is expected when the unit is a Compose-managed
oneshot service with `RemainAfterExit=yes`.

Interpret it as healthy only when both of these are also true:

- the Compose service is running and healthy
- post-start and Docker diagnose both report healthy results

Treat `active (exited)` without healthy container evidence as insufficient.

## Suggested Pack Skeleton

Use this shape when you store the final evidence:

```text
timestamp:
host_identifier:
branch:
commit:
git_status:
node_version:
npm_version:
docker_version:
docker_compose_version:
systemd_enabled:
systemd_state:
systemd_interpretation:
compose_service_state:
compose_service_health:
preflight_result:
post_start_result:
docker_diagnose_result:
signed_replay_result:
unsigned_replay_result:
direct_missing_signature_result:
direct_invalid_signature_result:
direct_valid_signature_result:
mount_ownership_summary:
rollback_drill_status:
restore_drill_status:
known_residual_risks:
final_decision:
decision_rationale:
```
