# Docker Runtime

## Scope

This Docker setup is the local and product-like baseline for the current single-bot OpenWA runtime.

- Not a final VPS installer.
- No `install.sh` yet.
- No systemd yet.
- No dashboard or multi-bot runtime.
- No automatic case creation.
- No transcript or raw message-body persistence.

## Minimal Operator Input

Keep `.env` minimal:

```dotenv
LAWYER_PHONE_E164=+15551234567
```

The Compose service uses runtime defaults from `src/config/env.ts` and adds only Docker-specific overrides:

- `OPENWA_HEADLESS=true`
- `OPENWA_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`
- `OPENWA_STATUS_SERVER_HOST=0.0.0.0`

## Commands

Build:

```bash
docker compose build
```

Start:

```bash
docker compose up
```

Background start:

```bash
docker compose up -d
```

Logs:

```bash
docker compose logs --tail=200 -f legalbot
```

Status:

```bash
docker compose ps
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/ready
curl http://127.0.0.1:3001/status
```

Stop:

```bash
docker compose down
```

Stop and remove the named OpenWA session volume only when the pairing state must be discarded:

```bash
docker compose down --volumes
```

## Persistence And Session State

- `./data` is bind-mounted to `/app/data`, so the default SQLite file persists across container restarts.
- `/app/openwa-session` is stored in the named volume `legalbot-openwa-session`.
- The container runs `npm run db:migrate` before `npm run smoke:openwa`.
- Runtime, browser, session, and database artifacts remain untracked by git.
- The Compose healthcheck uses the bundled Node runtime to request `http://127.0.0.1:3001/health`, so no extra `curl` or `wget` dependency is required in the image.

## Health And Readiness

- `docker compose up -d` only starts the container in the background. Use `docker compose ps` to inspect the container health state.
- `/health` means the process and status server are alive.
- `/status` returns the current runtime state and should be reachable when the status server is up.
- `/ready` may stay 503 until QR pairing or session authentication completes.
- Docker health is based on `/health`, not `/ready`, so the container can become healthy before WhatsApp is paired.
- During the first pairing flow, the QR code is printed in the container logs.
- The session volume preserves pairing state across restarts.

## Mac And Linux Notes

- Local direct runs can rely on a host Chrome or Chromium install and may not need `OPENWA_BROWSER_EXECUTABLE_PATH`.
- Docker uses the image-installed `/usr/bin/chromium` path explicitly to avoid host-browser drift.
- The published port is bound to `127.0.0.1:3001` on the host.
