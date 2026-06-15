# Security

## Secret Handling

- Do not read, print, or commit `.env`, access tokens, verify tokens, app secrets, browser profiles, QR payloads, WhatsApp session data, or local runtime artifacts.
- Keep real runtime values in process environment or an external env file. Use `.env.example` placeholders only.
- `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_VERIFY_TOKEN`, and `WHATSAPP_CLOUD_APP_SECRET` must never appear in logs or test output.

## Cloud Webhook Controls

- Cloud transport lives under `src/transport/whatsapp-cloud`.
- Webhook verification is limited to the Meta challenge flow and returns the challenge only when the mode and verify token are valid.
- When `WHATSAPP_CLOUD_APP_SECRET` is configured, the webhook handler validates `X-Hub-Signature-256` before processing the payload.
- Unsupported Cloud message types are ignored safely.
- Delivery and status events are ignored for now and do not trigger business logic.
- Tests use dependency injection and mocks. They must not call live Meta APIs.

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

## Transport Posture

- OpenWA is legacy and development-only. It remains in the repo temporarily, but it is not the intended production transport.
- WhatsApp Cloud is the production direction because it removes Chromium, QR, browser-profile, and WhatsApp Web dependency from the transport layer.
- Outbound Cloud sending is text-only in this phase.
- No automatic lawyer WhatsApp notifications are allowed in this phase.

## Operator Safety

- `business:check`, `business:backup`, `case:doctor`, and `ops:preflight` remain operator-facing and must emit sanitized output only.
- Backups may contain personal data.
- Backups must not be committed.
- Backups must stay ignored and be handled with explicit retention discipline.
- Systemd unit files must not contain secrets.
- `scripts/provision-systemd.sh` must never print env-file contents or copy `.env` into `/etc` automatically.
- Do not commit `data/`, `backups/`, `openwa-session/`, `sessions/`, `logs/`, `tmp/`, database files, QR images, screenshots, or other runtime artifacts.

## Current Gaps

- Full production webhook hardening around reverse proxy, HTTPS termination, firewall rules, and public Meta app registration is not completed in this milestone.
- Authentication beyond the WhatsApp transport boundary, encryption at rest, and retention policies are still out of scope.
