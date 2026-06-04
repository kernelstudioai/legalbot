# AGENTS

## Startup Context

- Use `docs/AGENT_CONTEXT.md` for repo startup context.
- Treat `README.md` as public reference, not as operating context.

## Boundaries

- Keep OpenWA transport code inside `src/transport/openwa`.
- Keep domain pipeline logic outside OpenWA listener files.
- Do not read `.env`, secrets, WhatsApp session data, or browser session files unless the user explicitly asks.

## Current Foundation

- This repo is a TypeScript Node.js 22 foundation for a WhatsApp legal-intake bot.
- Persistence is interface-only in this phase.
- No attachments, PDF handling, LLM usage, or external SaaS integrations in this phase.
