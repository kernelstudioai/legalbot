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
npm run docker:build
```

Start:

```bash
npm run docker:up
```

Logs:

```bash
npm run docker:logs
```

Status:

```bash
npm run docker:status
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/ready
curl http://127.0.0.1:3001/status
```

Stop:

```bash
npm run docker:down
```

## Persistence And Session State

- `./data` is bind-mounted to `/app/data`, so the default SQLite file persists across container restarts.
- `/app/openwa-session` is stored in the named volume `legalbot-openwa-session`.
- The container runs `npm run db:migrate` before `npm run smoke:openwa`.
- Runtime, browser, session, and database artifacts remain untracked by git.

## QR And Pairing Caveats

- The container can expose the status server before WhatsApp pairing is complete.
- `/ready` may stay non-ready until the OpenWA client finishes startup and pairing.
- The session volume preserves pairing state across restarts.

## Mac And Linux Notes

- Local direct runs can rely on a host Chrome or Chromium install and may not need `OPENWA_BROWSER_EXECUTABLE_PATH`.
- Docker uses the image-installed `/usr/bin/chromium` path explicitly to avoid host-browser drift.
- The published port is bound to `127.0.0.1:3001` on the host.
