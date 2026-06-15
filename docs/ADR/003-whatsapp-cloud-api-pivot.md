# ADR 003: WhatsApp Cloud API Pivot

- Status: accepted
- Date: 2026-06-15

## Context

The original foundation used OpenWA and WhatsApp Web automation through Chromium.
That transport is no longer acceptable for production use because it depends on:

- Chromium availability and stability
- QR pairing and session persistence
- WhatsApp Web behavior outside our control
- manual recovery when the browser session breaks

The business goal is a low-volume legal-intake flow where the client starts the conversation, intake stays inside the customer service window when possible, and operator review remains manual.

## Decision

Adopt the official WhatsApp Business Cloud API as the production transport direction.

Keep the existing reusable core:

- consent runtime
- intake runtime
- identity extraction boundary
- `BusinessPersistenceService`
- SQLite migrations
- manual case creation boundary
- operator commands

Introduce a new transport boundary under `src/transport/whatsapp-cloud` with:

- inbound webhook verification
- inbound webhook parsing
- inbound text normalization
- text-only outbound sender abstraction

Keep OpenWA in the repository temporarily as a legacy and development-only transport.

## Consequences

Positive:

- removes Chromium and WhatsApp Web from the intended production path
- removes QR-based operational dependency from the intended production path
- preserves the existing domain and persistence boundaries
- keeps testing local by injecting HTTP clients and avoiding live Meta calls

Negative or deferred:

- production go-live still needs reverse proxy, HTTPS, firewall, and public webhook registration work
- delivery and status event handling is still a later milestone
- the current install and systemd scripts remain OpenWA-oriented and are not yet the final Cloud deployment path

## Explicit Non-Goals For This Milestone

- deleting OpenWA immediately
- attachments
- PDF generation
- dashboard or multi-bot orchestration
- n8n integration
- automatic case creation
- automatic lawyer WhatsApp notifications
- LLM-driven conversation control

## Cost And Pricing Assumptions

- WhatsApp API: approximately `0 EUR/month` for the main client-initiated service flow at current low volume
- LLM: approximately `1-5 EUR/month` realistic and `5-10 EUR/month` prudential
- VPS: approximately `5-10 EUR/month` realistic

Exact Meta pricing must be verified before launch against the current market and category rate card.
