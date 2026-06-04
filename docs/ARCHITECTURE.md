# Architecture

## Goal

This project is a Node.js 22 + TypeScript strict foundation for a WhatsApp legal-intake bot using OpenWA as the transport layer.

## Layers

- `src/transport/openwa`: OpenWA-specific adapters, listener wiring, and dispatcher boundaries.
- `src/ingress`: conversion from raw transport payloads into canonical contracts.
- `src/routing`: routing decisions based on canonical envelopes.
- `src/runtime/*`: isolated runtime decision logic for client, lawyer, and shared concerns.
- `src/output`: output plan construction before transport dispatch.
- `src/persistence`: storage interfaces only in this phase.
- `src/security`: sanitization and boundary helpers.
- `src/logging`: logger abstraction.
- `src/app`: application orchestration and bootstrap wiring.

## Current Constraints

- No real intake flow yet.
- No attachments or PDFs.
- No LLM integration.
- No external SaaS integration.
- SQLite remains interface-only.
