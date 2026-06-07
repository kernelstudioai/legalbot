# Live Single-Bot E2E Runbook

## Scope

This runbook covers the current single-bot OpenWA runtime only.

- No `install.sh` yet.
- No systemd yet.
- No dashboard yet.
- No multi-bot flow.
- No automatic case creation.
- No attachments or PDF handling.
- No transcript or raw message-body persistence.

Case creation remains operator-only after a completed intake.

## Minimal `.env`

The only required operator-specific runtime value is:

```dotenv
LAWYER_PHONE_E164=+15551234567
```

Safe defaults come from `src/config/env.ts`, including:

- `BOT_MODE=smoke`
- `OPENWA_SESSION_ID=legalbot-smoke`
- `OPENWA_STATUS_SERVER_ENABLED=true`
- `OPENWA_STATUS_SERVER_HOST=127.0.0.1`
- `OPENWA_STATUS_SERVER_PORT=3001`
- `TECHNICAL_PERSISTENCE_ENABLED=true`
- `DATABASE_URL=file:./data/legalbot.sqlite`
- `DATABASE_MIGRATIONS_ENABLED=true`

Set `OPENWA_BROWSER_EXECUTABLE_PATH` only when the local machine cannot safely discover Chrome or Chromium.

## Local Direct Run

1. Use Node 22.

   ```bash
   node -v
   ```

2. Apply migrations for the default or overridden `DATABASE_URL`.

   ```bash
   npm run db:migrate
   ```

3. Check migration status.

   ```bash
   npm run db:status
   ```

4. Run the case consistency check.

   ```bash
   npm run case:doctor
   ```

5. Start the OpenWA smoke runtime.

   ```bash
   npm run smoke:openwa
   ```

6. Check the local status surface.

   ```bash
   curl http://127.0.0.1:3001/health
   curl http://127.0.0.1:3001/ready
   curl http://127.0.0.1:3001/status
   ```

7. Send the first WhatsApp message from the client phone to the bot.

8. Grant explicit consent with an allowed positive consent phrase.

9. Provide a valid client name when the bot asks for it.

10. Provide a valid short problem summary when the bot asks for it.

11. List completed intake candidates.

   ```bash
   npm run intake:list-ready
   ```

   The command prints only:

   - `subjectId`
   - `intakeState`
   - `updatedAt`
   - `fieldNamesPresent`

12. Create a draft case manually from the returned `subjectId`.

   ```bash
   npm run case:create-from-intake -- --subject <subjectId-from-intake-list-ready>
   ```

13. Re-run the case consistency check.

   ```bash
   npm run case:doctor
   ```

## Docker Runtime

The Docker baseline is for local and product-like development only. It is not the final VPS installer.

1. Keep the same minimal `.env` with `LAWYER_PHONE_E164`.

2. Build the image.

   ```bash
   npm run docker:build
   ```

3. Start the container.

   ```bash
   docker compose up -d
   ```

   The Compose service runs `npm run db:migrate` before `npm run smoke:openwa`, mounts `./data` to `/app/data`, mounts `/app/openwa-session` to a named volume, and overrides only Docker-specific runtime values:

   - `OPENWA_HEADLESS=true`
   - `OPENWA_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`
   - `OPENWA_STATUS_SERVER_HOST=0.0.0.0`

4. Inspect the container health.

   ```bash
   docker compose ps
   ```

   Docker health is based on `/health`, not `/ready`.

5. Inspect logs for startup and first-pairing state.

   ```bash
   docker compose logs --tail=200 -f legalbot
   ```

   The first pairing flow prints the QR in the logs. OpenWA is not ready until that QR is scanned or an existing authenticated session is restored.

6. Check the host status surface.

   ```bash
   curl http://127.0.0.1:3001/health
   curl http://127.0.0.1:3001/ready
   curl http://127.0.0.1:3001/status
   ```

   Expected sequence before pairing completes:

   - `/health` returns HTTP 200 once the process and status server are alive.
   - `/status` returns HTTP 200 with a startup state while OpenWA is still pairing.
   - `/ready` may return HTTP 503 until QR pairing or restored authentication completes.

7. Stop the container.

   ```bash
   docker compose down
   ```

   Use `docker compose down --volumes` only when the named OpenWA session volume must be removed on purpose.

## Operator Boundary

- Live OpenWA messages may advance consent and intake state only.
- `npm run intake:list-ready` is the operator read surface for completed intakes.
- `npm run case:create-from-intake` is still the only case-draft creation path.
- The runtime never creates cases automatically on intake completion.
- The runtime and operator commands do not persist or print raw transcripts or raw inbound message bodies.
