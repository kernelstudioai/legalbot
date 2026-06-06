# Live Single-Bot E2E Runbook

## Scope

This runbook is for the current single-bot OpenWA runtime only.

- No dashboard yet.
- No `install.sh` yet.
- No multi-bot flow.
- No automatic case creation.
- No attachments or PDF handling.
- No transcript or raw message-body persistence.

Case creation remains operator-only after a completed intake.

## Preconditions

- Use Node `22.x`.
- Keep runtime, browser, session, and database artifacts local and untracked.
- Use explicit environment variables for runtime commands. Do not rely on automatic migration during OpenWA startup.
- If `TECHNICAL_PERSISTENCE_ENABLED=true`, run the database commands first against the same `DATABASE_URL`.

## Manual Flow

1. Use Node 22.

   ```bash
   node -v
   ```

2. Run migrations.

   ```bash
   DATABASE_URL="file:./tmp/legalbot-live.sqlite" DATABASE_MIGRATIONS_ENABLED="true" npm run db:migrate
   ```

3. Check migration status.

   ```bash
   DATABASE_URL="file:./tmp/legalbot-live.sqlite" DATABASE_MIGRATIONS_ENABLED="true" npm run db:status
   ```

4. Run the case consistency check.

   ```bash
   DATABASE_URL="file:./tmp/legalbot-live.sqlite" DATABASE_MIGRATIONS_ENABLED="true" npm run case:doctor
   ```

5. Start the OpenWA smoke runtime with technical persistence enabled.

   ```bash
   BOT_MODE="smoke" \
   OPENWA_SESSION_ID="<single-bot-session-id>" \
   LAWYER_PHONE_E164="<operator-phone-e164>" \
   OPENWA_STATUS_SERVER_ENABLED="true" \
   OPENWA_STATUS_SERVER_HOST="127.0.0.1" \
   OPENWA_STATUS_SERVER_PORT="3001" \
   TECHNICAL_PERSISTENCE_ENABLED="true" \
   DATABASE_URL="file:./tmp/legalbot-live.sqlite" \
   DATABASE_MIGRATIONS_ENABLED="true" \
   npm run smoke:openwa
   ```

6. Check the local operator status surface.

   ```bash
   curl http://127.0.0.1:3001/health
   curl http://127.0.0.1:3001/ready
   curl http://127.0.0.1:3001/status
   ```

7. Send the first WhatsApp message from the client phone to the single bot.

8. Grant explicit consent with an allowed positive consent phrase.

9. Provide a valid client name when the bot asks for it.

10. Provide a valid short problem summary when the bot asks for it.

11. List completed intake candidates safely.

   ```bash
   DATABASE_URL="file:./tmp/legalbot-live.sqlite" DATABASE_MIGRATIONS_ENABLED="true" npm run intake:list-ready
   ```

   The command prints only:

   - `subjectId`
   - `intakeState`
   - `updatedAt`
   - `fieldNamesPresent`

   `subjectId` is an operator-safe token for the completed intake. The command does not print raw message bodies, transcripts, secrets, raw rows, or full phone numbers.

12. Run manual case creation with the `subjectId` returned by step 11.

   ```bash
   DATABASE_URL="file:./tmp/legalbot-live.sqlite" DATABASE_MIGRATIONS_ENABLED="true" npm run case:create-from-intake -- --subject <subjectId-from-intake-list-ready>
   ```

13. Run the case consistency check again.

   ```bash
   DATABASE_URL="file:./tmp/legalbot-live.sqlite" DATABASE_MIGRATIONS_ENABLED="true" npm run case:doctor
   ```

## Expected Operator Boundary

- Live OpenWA messages may advance consent and intake state only.
- `npm run intake:list-ready` is the operator read surface for completed single-bot intakes.
- `npm run case:create-from-intake` is still the only case-draft creation path.
- The runtime never creates cases automatically on intake completion.
- The runtime and operator commands do not persist or print raw transcripts or raw inbound message bodies.
