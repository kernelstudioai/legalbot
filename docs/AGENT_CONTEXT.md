# Agent Context

## Purpose

This repository hosts the foundation for a WhatsApp legal-intake bot built on OpenWA.

## Architectural Rules

- Preserve the pipeline order:
  `raw OpenWA message -> normalizeInbound -> resolveRouting -> decideNextAction -> buildOutputPlan -> OpenWA dispatcher`.
- OpenWA listener files may orchestrate transport events, but must not contain domain logic.
- Runtime-specific logic belongs under `src/runtime/*`.
- Persistence remains stubbed behind interfaces until a dedicated implementation phase.

## Safety Rules

- Never inspect or commit secrets or WhatsApp session state.
- Keep public docs durable and concise.
