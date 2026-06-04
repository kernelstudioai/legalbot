# Security

## Data Handling

- Do not read `.env`, secrets, tokens, browser sessions, or WhatsApp session files during foundation work.
- Sanitize free-text inbound content before logging or downstream planning.
- Keep transport metadata minimal and typed.
- Keep OpenWA runtime state under the ignored `openwa-session/` path.
- Use `.env.example` placeholders only; load real runtime values from process environment at startup.

## Architecture Controls

- Transport code is isolated under `src/transport/openwa`.
- Domain decisions occur in dedicated pipeline modules, not in listener callbacks.
- Persistence is abstracted behind interfaces so storage concerns can be audited before implementation.
- Dispatcher only sends text actions from `OutputPlan`.

## Current Gaps

- Authentication, encryption at rest, and retention policies are not implemented in this phase.
- SQLite is not yet connected.
