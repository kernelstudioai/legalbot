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

OpenWA launches Chromium with `--no-sandbox` and `--disable-setuid-sandbox`.
This avoids Chromium sandbox failures in Docker but weakens Chromium's process isolation, so keep this Compose service single-purpose, local-bound, and isolated from untrusted workloads.

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
OPS_POST_START_MODE=docker npm run ops:post-start
npm run docker:diagnose
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
- LegalBot removes only Chromium `Singleton*` profile lock files before OpenWA launch. This clears stale browser locks left by a previous crashed container without deleting WhatsApp auth/session data.

## Health And Readiness

- `docker compose up -d` only starts the container in the background. Use `docker compose ps` to inspect the container health state.
- Expected startup sequence:
  `npm run db:migrate` completes, the status server binds, Chromium launches, the QR is printed for first-time pairing, `/health` returns 200, `/status` returns 200, and `/ready` stays 503 until QR pairing or restored auth completes.
- `/health` means the process and status server are alive.
- `/status` returns the current runtime state and should be reachable when the status server is up.
- `/ready` may stay 503 until QR pairing or session authentication completes.
- Docker health is based on `/health`, not `/ready`, so the container can become healthy before WhatsApp is paired.
- `npm run docker:diagnose` compares host probes against in-container probes and prints a sanitized JSON summary instead of raw logs or session details.
- `OPS_POST_START_MODE=docker npm run ops:post-start` reuses the same Docker-oriented diagnosis model when operators want one post-start command across direct and containerized flows.
- `npm run docker:diagnose` is intended to distinguish:
  - container not running
  - container unhealthy
  - app healthy inside the container but host port unreachable
  - app not ready because WhatsApp auth is still pending
  - app ready
- Host access can fail even when in-container probes succeed. That usually points to a host port mapping issue or a Docker Desktop/network problem rather than an application-readiness problem.
- host access can fail even when in-container probes succeed.
- During the first pairing flow, the QR code is printed in the container logs.
- The session volume preserves pairing state across restarts.

## Host Vs In-Container Checks

- Host checks target `http://127.0.0.1:3001/{health,ready,status}` and validate the published loopback port.
- In-container checks use `docker compose exec -T legalbot` and validate the status server from inside the running service.
- If `/health` is 200 in-container but host probes fail, inspect the published port and Docker Desktop networking before changing application code.
- If `/health` is 200 and `/ready` is 503 both on host and in-container, the process is alive but WhatsApp pairing or restored auth is still incomplete.
- The named `legalbot-openwa-session` volume preserves authenticated session state across `docker compose down` and `docker compose up -d` restarts unless it is removed intentionally with `docker compose down --volumes`.

## Chromium Diagnostics

Run these checks inside the image or container when Chromium fails to launch:

```bash
docker run --rm --entrypoint sh legalbot-legalbot -lc 'node --version'
docker run --rm --entrypoint sh legalbot-legalbot -lc 'which chromium'
docker run --rm --entrypoint sh legalbot-legalbot -lc 'chromium --version'
docker run --rm --entrypoint sh legalbot-legalbot -lc 'ldd /usr/lib/chromium/chromium'
docker run --rm --entrypoint sh legalbot-legalbot -lc 'id && stat -c "%U:%G %a %n" /app /app/data /app/openwa-session'
```

If Chromium exits with `No usable sandbox!`, confirm the effective OpenWA/Puppeteer launch args include `--no-sandbox` and `--disable-setuid-sandbox`.
If Chromium reports that the profile is already in use by another Chromium process, check for stale `SingletonCookie`, `SingletonLock`, or `SingletonSocket` files under the OpenWA browser profile directory.

For an isolated Chromium-only probe, use:

```bash
docker run --rm --entrypoint sh legalbot-legalbot -lc 'chromium --headless --disable-gpu --no-sandbox --dump-dom about:blank'
```

This should print a minimal HTML document. If it fails before OpenWA starts, inspect `docker compose logs --tail=200 legalbot` before changing application code.

## Mac And Linux Notes

- Local direct runs can rely on a host Chrome or Chromium install and may not need `OPENWA_BROWSER_EXECUTABLE_PATH`.
- Docker uses the image-installed `/usr/bin/chromium` path explicitly to avoid host-browser drift.
- The published port is bound to `127.0.0.1:3001` on the host.
