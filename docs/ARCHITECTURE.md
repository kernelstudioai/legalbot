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

## OpenWA Smoke Transport

- `src/app/openwaSmoke.ts` is the executable smoke entrypoint that validates runtime env, starts the OpenWA client, installs signal handlers, and wires transport dependencies.
- Retry the smoke startup with `npm run smoke:openwa` so the documented command stays aligned with the repo script.
- `src/transport/openwa/client.ts` owns OpenWA bootstrap, runtime session path setup, and raw OpenWA message adaptation.
- `src/transport/openwa/listener.ts` only logs receipt, maps raw transport data into the existing pipeline input, runs the pipeline, and hands the resulting `OutputPlan` to the dispatcher.
- `src/transport/openwa/dispatcher.ts` only sends supported text actions and ignores unsupported actions without introducing domain behavior.

## Current Constraints

- No real intake flow yet.
- No attachments or PDFs.
- No LLM integration.
- No external SaaS integration.
- SQLite remains interface-only.
