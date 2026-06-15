# Architecture

## Goal

This project is a Node.js 22 + TypeScript foundation for a WhatsApp legal-intake bot.
The intended production transport is now the official WhatsApp Business Cloud API.
OpenWA remains in the repo temporarily as a legacy and development-only transport.

## Layers

- `src/transport/openwa`: legacy/dev-only OpenWA adapters
- `src/transport/whatsapp-cloud`: Cloud webhook and outbound sender boundary
- `src/transport/inboundMessage.ts`: shared transport input shape
- `src/ingress`: conversion into canonical contracts
- `src/routing`: runtime routing decisions
- `src/runtime/*`: client, lawyer, and shared runtime logic
- `src/output`: output-plan construction
- `src/persistence`: persistence interfaces, business boundary, SQLite implementations, and migrations
- `src/security`: sanitization and boundary helpers
- `src/logging`: logger abstraction
- `src/app`: runtime entrypoints and operator commands

## Transport Boundaries

### WhatsApp Cloud

- `src/app/whatsappCloudRuntime.ts` starts the webhook server foundation.
- `src/transport/whatsapp-cloud/webhook.ts` handles verification, signature validation, payload parsing, and text-message normalization.
- `src/transport/whatsapp-cloud/sender.ts` constructs Graph API text payloads and sends them through an injected HTTP client.

### OpenWA

- `src/app/openwaSmoke.ts` remains available for smoke and development usage.
- `src/transport/openwa/*` stays transport-only and continues to reuse the shared business pipeline.
- OpenWA is not the intended production transport anymore.

## Preserved Reusable Core

- consent runtime
- intake runtime
- identity extraction boundary
- `BusinessPersistenceService`
- SQLite migrations
- manual case creation boundary
- operator commands such as `business:check`, `business:backup`, `case:doctor`, and `ops:preflight`

## Business Constraints

- No automatic case creation
- No automatic lawyer WhatsApp notifications
- No attachments or PDFs
- No dashboard or multi-bot orchestration in this phase
- LLM usage, when approved later, stays behind the scenes for parsing and normalization only
