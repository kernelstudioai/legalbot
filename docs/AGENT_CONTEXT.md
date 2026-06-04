# Agent Context

## Purpose

This repository hosts the foundation for a WhatsApp legal-intake bot built on OpenWA.
This is the only default startup context.

## Startup Boundary

`README.md` must not be used as startup context.

## Architectural Rules

- Preserve the pipeline order:
  `raw OpenWA message -> normalizeInbound -> resolveRouting -> decideNextAction -> buildOutputPlan -> OpenWA dispatcher`.
- OpenWA listener files may orchestrate transport events, but must not contain domain logic.
- Runtime-specific logic belongs under `src/runtime/*`.
- Persistence remains stubbed behind interfaces until a dedicated implementation phase.
- The smoke entrypoint lives in `src/app/openwaSmoke.ts`, while OpenWA-specific wiring stays under `src/transport/openwa`.

## Safety Rules

- Never inspect or commit secrets or WhatsApp session state.
- Keep public docs durable and concise.
- Keep `.env`, `sessions/`, `openwa-session/`, `data/`, `logs/`, and browser profile state ignored.
