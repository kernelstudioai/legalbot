# Security

## Data Handling

- Do not read `.env`, secrets, tokens, browser sessions, or WhatsApp session files during foundation work.
- Sanitize free-text inbound content before logging or downstream planning.
- Keep transport metadata minimal and typed.
- Keep OpenWA runtime state under the ignored `openwa-session/` path.
- Use `.env.example` placeholders only; load real runtime values from process environment at startup.
- Treat client-content persistence as consent-gated: no transcript storage, message-body storage, legal-fact storage, or case creation before explicit `granted` consent.
- Keep M10 technical dedupe markers and sanitized audit events separate from any future consent-gated client content persistence.
- M12 consent persistence stores only consent state plus sanitized metadata; it must strip `messageBody`, `body`, `content`, and `text`, and must not retain full phone numbers, tokens, or browser/session/QR paths.
- Consent persistence uses a generic `subjectId` string and does not require phone-number semantics.
- Live OpenWA transport is not wired to consent persistence yet.

## Architecture Controls

- Transport code is isolated under `src/transport/openwa`.
- Domain decisions occur in dedicated pipeline modules, not in listener callbacks.
- Persistence is abstracted behind interfaces so storage concerns can be audited before implementation.
- Dispatcher only sends text actions from `OutputPlan`.
- The consent parser must accept only strict explicit yes/no phrases and must treat vague replies such as `ok`, `va bene`, `sì`, and `procedi` as non-consent that requires clarification.

## Current Gaps

- Authentication, encryption at rest, and retention policies are not implemented in this phase.
- Live intake persistence, transcript persistence, and case creation remain out of scope until a future consent-gated milestone.
