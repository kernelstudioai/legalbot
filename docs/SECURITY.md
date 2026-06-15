# Security

## Secret Handling

- Do not read, print, or commit `.env`, access tokens, verify tokens, app secrets, browser profiles, QR payloads, WhatsApp session data, or local runtime artifacts.
- Keep real runtime values in process environment or an external env file. Use `.env.example` placeholders only.
- `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_VERIFY_TOKEN`, and `WHATSAPP_CLOUD_APP_SECRET` must never appear in logs or test output.
- `scripts/provision-systemd.sh` must never print env-file contents or copy `.env` into `/etc` automatically.

## Cloud Webhook Controls

- Cloud transport lives under `src/transport/whatsapp-cloud`.
- Webhook verification is limited to the Meta challenge flow and returns the challenge only when the mode and verify token are valid.
- When `WHATSAPP_CLOUD_APP_SECRET` is configured, the webhook handler validates `X-Hub-Signature-256` before processing the payload.
- When `NODE_ENV=production`, `WHATSAPP_CLOUD_APP_SECRET` is required and signature verification is enforced.
- `/health`, `/ready`, and `/status` are sanitized local operator surfaces only.
- Unsupported Cloud message types are ignored safely.
- Delivery and status events are ignored for now and do not trigger business logic.
- Tests use dependency injection and mocks. They must not call live Meta APIs.
- Local replay accepts fixture files only from `tests/fixtures/whatsapp-cloud/`, refuses
  non-loopback target URLs, and suppresses pipeline dispatch and outbound Cloud sending.
- Replay help is static and sanitized; it does not load fixtures or print environment values.
- Unsigned replay is development/test-only. Production replay requires a valid signature.
- Reverse proxies must clear `X-Legalbot-Cloud-Replay` from public requests.

## Logging And Payload Minimization

- Access token, verify token, app secret, and phone-number ID must never be logged.
- Webhook payload logs must stay minimized to counts, message IDs, and sanitized state only.
- Raw webhook bodies, full transcript text, and full transport errors must not be printed in operator commands.
- Replay output must contain event counts and HTTP status only, never raw fixture bodies.

## Persistence Boundary

- Keep domain and business logic outside transport files.
- Keep business-state persistence explicit behind `BusinessPersistenceService`.
- Keep technical dedupe markers separate from consent, intake, and case state.
- Before consent is granted, do not persist transcripts, message bodies, legal facts, or create cases.
- After consent is granted, persist only accepted structured intake fields:
  - `firstName`
  - `lastName`
  - `birthDate`
  - `city`
  - `problemSummary`
- Do not persist raw transcripts, rejected values, attachments, PDFs, or browser/session state.
- No raw transcript persistence is allowed outside approved business persistence boundaries.

## Transport Posture

- OpenWA is legacy and development-only. It remains in the repo temporarily, but it is not the intended production transport.
- WhatsApp Cloud is the production target because it removes Chromium, QR, browser-profile, and WhatsApp Web dependency from the transport layer.
- Outbound Cloud sending is text-only in this phase.
- No automatic lawyer WhatsApp notifications are allowed in this phase.

## Operator Safety

- `business:check`, `business:backup`, `case:doctor`, `ops:preflight`, `ops:preflight:cloud`, `ops:post-start`, and `ops:post-start:cloud` remain operator-facing and must emit sanitized output only.
- Backups may contain personal data.
- Backups must not be committed.
- Backups must stay ignored and be handled with explicit retention discipline.
- Systemd unit files must not contain secrets.
- The local Cloud application port must not be exposed publicly; only the TLS reverse
  proxy should accept public webhook traffic.
- Do not commit `data/`, `backups/`, `openwa-session/`, `sessions/`, `logs/`, `tmp/`, database files, QR images, screenshots, or other runtime artifacts.

## Current Gaps

- Reverse proxy, HTTPS termination, firewall changes, and public Meta app registration still require operator-managed infrastructure.
- Local replay does not prove public DNS, TLS, Meta verification, or live delivery.
- Authentication beyond the WhatsApp transport boundary, encryption at rest, and retention policies are still out of scope.
