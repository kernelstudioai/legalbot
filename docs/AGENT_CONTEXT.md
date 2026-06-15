# Agent Context

## Purpose

This repository is a Node.js 22 + TypeScript foundation for a WhatsApp legal-intake bot.
The production transport direction is now the official WhatsApp Business Cloud API.
OpenWA remains in the repo only as a legacy and development-only transport during the migration.
This is the only default startup context.

## Startup Boundary

`README.md` is public reference only and must not be used as startup context.

## Architectural Rules

- Preserve the shared pipeline order:
  `transport event -> transport normalization -> normalizeInbound -> resolveRouting -> decideNextAction -> buildOutputPlan -> transport dispatch`.
- Keep `src/transport/openwa` transport-only and treat it as legacy/dev-only.
- Keep the new Cloud API transport boundary under `src/transport/whatsapp-cloud`.
- Keep domain and business logic outside transport listener or webhook files.
- Keep runtime-specific orchestration under `src/app/*` and `src/runtime/*`.
- Preserve the existing reusable core:
  - consent runtime
  - intake runtime
  - identity extraction boundary
  - `BusinessPersistenceService`
  - SQLite migrations
  - manual case creation boundary
  - operator commands such as `business:check`, `business:backup`, `case:doctor`, and `ops:preflight`
- Keep case creation manual and operator-triggered only.
- Do not add automatic lawyer WhatsApp notifications, dashboard flows, attachments, PDFs, or external SaaS automation in this phase.

## Runtime Entry Points

- `src/app/openwaSmoke.ts`: OpenWA smoke runtime for legacy/dev-only usage.
- `src/app/whatsappCloudRuntime.ts`: Cloud API webhook runtime skeleton for the production migration path.

## Safety Rules

- Never inspect or print `.env`, tokens, WhatsApp session state, browser profiles, or other secrets.
- Keep `data/`, `backups/`, `openwa-session/`, `sessions/`, `logs/`, `tmp/`, and browser profile state ignored.
- Do not persist raw transcripts beyond the approved consent and intake boundaries.
