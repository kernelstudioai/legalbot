# VPS And systemd Runbook

## Scope

This runbook defines the operator workflow for a future Linux VPS deployment of the current single-bot OpenWA runtime.

- `install.sh` now provides a guided single-bot VPS preparation flow.
- `scripts/provision-systemd.sh` provides explicit optional systemd provisioning for a single bot.
- No systemd unit is installed automatically by `install.sh`.
- No dashboard yet.
- No multi-bot runtime yet.
- No automatic case creation.
- No transcript, raw message-body, attachment, or PDF persistence.

## Target Shape

- Target host: Linux VPS
- Runtime: Node 22
- Browser: Chrome or Chromium available on the host
- Database: SQLite at `data/legalbot.sqlite` by default
- OpenWA session state: persisted under the ignored `openwa-session/` path
- Operator commands: `npm run ops:preflight` before start and `npm run ops:post-start` after start

## Minimal Operator Input

The only required operator-specific runtime value remains:

```dotenv
LAWYER_PHONE_E164=+15551234567
```

Safe defaults still come from `src/config/env.ts`. For VPS/systemd operation, set `DATABASE_MIGRATIONS_ENABLED` explicitly to `true` or `false` in the external env file so the migration policy is not implicit.

Do not store the real env file in the repo, and do not print or inspect its contents during operator checks.

## Real Linux Validation Status

- Windows and Git Bash validation from earlier milestones is no longer treated as sufficient evidence for Linux apply mode.
- This milestone adds a real Linux validation checklist and an explicit systemd provisioner, but this repository snapshot was not executed on an actual Linux VPS from this Codex session.
- Treat the Linux/VPS apply flow as documented and statically validated until an operator runs it on a Linux host.

## Real Linux Validation Checklist

Run these on a real Linux VPS or Linux VM when available:

```bash
./install.sh --dry-run
./install.sh
npm run ops:preflight
./scripts/provision-systemd.sh --dry-run
./scripts/provision-systemd.sh --install --project-root /srv/legalbot --env-file /etc/legalbot/legalbot.env --service-user legalbot
systemctl status legalbot-openwa.service
```

Only if the operator explicitly wants reversibility testing:

```bash
./scripts/provision-systemd.sh --uninstall --project-root /srv/legalbot --env-file /etc/legalbot/legalbot.env --service-user legalbot
```

Do not start or enable the service during validation unless the operator explicitly approves that step.

## Guided Installer

Preview the installer without changing files:

```bash
./install.sh --dry-run
```

Apply the guided install flow:

```bash
./install.sh
```

The installer is conservative and idempotent. It:

- runs on Linux only
- requires Node 22 and `npm`
- checks for Chrome or Chromium and prints install guidance if neither is present
- verifies the project directory is writable
- creates `data/`, `backups/`, `openwa-session/`, and `logs/` when missing
- creates `.env` only when it is missing, using a prompt for `LAWYER_PHONE_E164` plus safe non-secret defaults
- never prints existing `.env` contents or secret values
- asks before appending missing `.env` keys when `.env` already exists
- runs `npm ci`
- runs `npm run db:migrate`
- runs `npm run ops:preflight`
- asks before starting `npm run smoke:openwa`
- asks before previewing `./scripts/provision-systemd.sh --dry-run`

The installer does not:

- install a real systemd service by itself
- enable multi-bot orchestration
- delete `data/`, `backups/`, `openwa-session/`, `logs/`, or SQLite files
- print QR data, session data, `.env` contents, or full phone numbers
- replace the post-start operator workflow

## install.sh Apply Mode Checklist

Before running `./install.sh` in apply mode on Linux:

- confirm Node 22 is installed
- confirm Chrome or Chromium is available or installable
- confirm the operator is ready to provide `LAWYER_PHONE_E164` if `.env` is absent
- confirm `.env` lives outside version control and will not be printed
- confirm `data/`, `backups/`, `openwa-session/`, and `logs/` should be preserved if already present
- confirm no bot start should happen unless the operator answers yes
- confirm no systemd install should happen unless the operator later runs `scripts/provision-systemd.sh`

If Chrome or Chromium is still missing after installation, install it before starting the bot and rerun `npm run ops:preflight` when needed.

## Preflight Before Start

Run this before starting or restarting the bot:

```bash
npm run ops:preflight
```

`ops:preflight` prints sanitized JSON only and exits `0` only when startup is considered safe. It checks:

- Node major version is 22
- `LAWYER_PHONE_E164` is configured
- `DATABASE_URL` resolves through the shared env loader
- `DATABASE_MIGRATIONS_ENABLED` is explicit
- `BUSINESS_PERSISTENCE_ENABLED=true`
- SQLite migration status is fully applied
- `npm run business:check` is healthy
- `npm run case:doctor` is healthy
- `data/`, `backups/`, `openwa-session/`, `tmp/`, and `logs/` remain git-ignored

The JSON output is sanitized by policy and must not include secrets, QR content, session paths, message bodies, transcripts, raw rows, or full phone numbers.

Example sanitized shape:

```json
{
  "status": "ready",
  "runtimeEnv": {
    "minimalRequiredEnv": ["LAWYER_PHONE_E164"],
    "databaseMigrationsExplicit": true,
    "businessPersistenceEnabled": true
  },
  "migrations": {
    "appliedMigrationCount": 11,
    "pendingMigrationCount": 0
  },
  "blockers": []
}
```

## Start Flow

Current direct runtime start:

```bash
npm run smoke:openwa
```

Recommended safe sequence:

1. `npm run business:backup`
2. `npm run ops:preflight`
3. `npm run smoke:openwa`
4. `npm run ops:post-start`

Run `business:backup` only when the operator intentionally wants a snapshot. Backups may contain personal data, stay under the ignored `backups/` path, and must be handled with explicit retention and deletion discipline.

## Post-Start Verification

Run this after the process starts:

```bash
npm run ops:post-start
```

When the local status server is enabled, the command checks `/health`, `/ready`, and `/status` and prints sanitized JSON only.

Expected diagnosis codes:

- `app_ready`
- `app_not_ready_auth_missing`
- `host_port_mapping_issue`

For Docker-mode troubleshooting, `OPS_POST_START_MODE=docker npm run ops:post-start` reuses the same sanitized probe model as `npm run docker:diagnose` and may also report:

- `container_not_running`
- `container_unhealthy`

Exit policy:

- `app_ready` exits `0`
- `app_not_ready_auth_missing` exits nonzero in this milestone so the operator must confirm pairing/auth
- transport unreachable or unhealthy states exit nonzero

Example sanitized shape:

```json
{
  "status": "warning",
  "mode": "direct",
  "diagnosis": {
    "code": "app_not_ready_auth_missing",
    "summary": "The app is alive, but WhatsApp authentication or QR pairing is still pending."
  }
}
```

## Stop And Restart

Safe operator flow:

1. Stop the runtime cleanly through the service manager or terminal signal.
2. Preserve `openwa-session/` and `data/`.
3. Optionally run `npm run business:backup`.
4. Run `npm run ops:preflight`.
5. Start the runtime again.
6. Run `npm run ops:post-start`.

Do not delete `openwa-session/`, browser profile state, or SQLite files as part of routine restarts.

## Optional systemd Provisioning

The systemd provisioner is separate from `install.sh` and is single-bot only. It creates or removes the documented `legalbot-openwa.service` unit, never prints `.env` contents, and never deletes runtime data, backups, sessions, logs, or database files.

Usage:

```bash
./scripts/provision-systemd.sh --dry-run --project-root /srv/legalbot --env-file /etc/legalbot/legalbot.env --service-user legalbot
./scripts/provision-systemd.sh --status --project-root /srv/legalbot --env-file /etc/legalbot/legalbot.env --service-user legalbot
sudo ./scripts/provision-systemd.sh --install --project-root /srv/legalbot --env-file /etc/legalbot/legalbot.env --service-user legalbot
sudo ./scripts/provision-systemd.sh --uninstall --project-root /srv/legalbot --env-file /etc/legalbot/legalbot.env --service-user legalbot
```

Behavior by mode:

- `--dry-run` prints the planned service-unit configuration and shows whether start or enable would remain off by default.
- `--install` writes or refreshes `/etc/systemd/system/legalbot-openwa.service` and runs `systemctl daemon-reload`.
- `--uninstall` removes only the unit file and reloads systemd metadata.
- `--status` reports whether the unit file exists and shows `systemctl status legalbot-openwa.service` when systemd knows the service.

Explicit service activation remains opt-in:

- `--install` alone does not start the service.
- `--install` alone does not enable the service.
- `--install --start` starts the service only when the operator explicitly requests it.
- `--install --enable` enables the service only when the operator explicitly requests it.

## Session Persistence Expectations

- Restarting the process should preserve the WhatsApp session as long as `openwa-session/` remains intact.
- Restarting the process should preserve SQLite business state as long as `data/` remains intact.
- A first-time or reset session may leave `/ready` at HTTP 503 until QR pairing completes.
- The status surface can be healthy before WhatsApp authentication is complete.

## Documented systemd Unit

This is the unit that `scripts/provision-systemd.sh --install` writes after explicit operator action.

```ini
[Unit]
Description=LegalBot OpenWA Smoke Runtime
After=network.target

[Service]
Type=simple
User=legalbot
WorkingDirectory=/srv/legalbot
EnvironmentFile=/etc/legalbot/legalbot.env
ExecStart=/usr/bin/npm run smoke:openwa
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Operator notes:

- Keep the VPS on Node 22.
- Keep Chrome or Chromium installed and available to OpenWA.
- Keep the env file outside the repo.
- Keep secrets only in the env file, never in the unit.
- Run `npm run ops:preflight` before `systemctl start` or `systemctl restart`.
- Run `npm run ops:post-start` after the service reaches active state.

## Safe Start, Stop, And Restart Commands

Run preflight before any start or restart:

```bash
npm run ops:preflight
sudo systemctl start legalbot-openwa.service
sudo systemctl stop legalbot-openwa.service
sudo systemctl restart legalbot-openwa.service
systemctl status legalbot-openwa.service
journalctl -u legalbot-openwa.service -n 100 --no-pager
```

After a successful start or restart:

```bash
npm run ops:post-start
```

QR pairing expectations:

- first-time startup may require QR pairing before `/ready` reports success
- pairing progress may appear in service logs, but QR contents must not be copied into docs or reports
- preserve `openwa-session/` if you want session reuse across restarts

## Post-Install Commands

After `./install.sh` completes, the operator flow remains:

1. `npm run business:backup` when an intentional snapshot is needed
2. `npm run smoke:openwa` when the operator explicitly wants to start the runtime
3. `npm run ops:post-start` after the runtime is up
4. `./scripts/provision-systemd.sh --dry-run` when the operator wants to review systemd provisioning
5. `OPS_POST_START_MODE=docker npm run ops:post-start` only for Docker-mode troubleshooting

## Current Limits

- No dashboard operator surface yet.
- No multi-bot process model yet.
- No automated backup retention, restore verification, or encryption at rest yet.
- No real Linux VPS execution evidence was captured from this Codex session.
