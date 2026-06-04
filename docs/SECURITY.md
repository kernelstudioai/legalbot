# Security

## Data Handling

- Do not read `.env`, secrets, tokens, browser sessions, or WhatsApp session files during foundation work.
- Sanitize free-text inbound content before logging or downstream planning.
- Keep transport metadata minimal and typed.
- Keep OpenWA runtime state under the ignored `openwa-session/` path.
- Use `.env.example` placeholders only; load real runtime values from process environment at startup.
- Treat client-content persistence as consent-gated: no transcript storage, message-body storage, legal-fact storage, or case creation before explicit `granted` consent.
- M14 intake remains consent-gated and accepts only two structured fields in this phase: client name and a short problem summary.
- Keep M10 technical dedupe markers and sanitized audit events separate from any future consent-gated client content persistence.
- M13 runtime consent wiring still stores only consent state plus sanitized metadata; it must strip `messageBody`, `body`, `content`, and `text`, and must not retain full phone numbers, tokens, or browser/session/QR paths.
- M14 must not persist raw message bodies or full transcripts. Only explicitly accepted structured intake fields may be retained after `granted` consent, and the current foundation keeps those fields in injected in-memory runtime state unless a future dedicated persistence boundary is added.
- Consent persistence uses a generic `subjectId` string and does not require phone-number semantics.
- Live OpenWA transport stays transport-only even though the application layer can now inject consent persistence into the client runtime.

## Architecture Controls

- Transport code is isolated under `src/transport/openwa`.
- Domain decisions occur in dedicated pipeline modules, not in listener callbacks.
- Persistence is abstracted behind interfaces so storage concerns can be audited before implementation.
- Dispatcher only sends text actions from `OutputPlan`.
- The consent parser must accept only strict explicit yes/no phrases and must treat vague replies such as `ok`, `va bene`, `si`, and `procedi` as non-consent that requires clarification.
- The client runtime may persist only consent state transitions and append-only consent events. It must not persist inbound message bodies, legal facts, or create case records.
- The intake runtime must stay under `src/runtime/client` and remain transport-agnostic. It may collect only validated structured fields, must reject empty or overly long values, and must not create live cases or provide legal advice.
- The `subjectId` for consent state is the canonical sender/chat id. Any stored metadata must avoid restating the full phone number and must remain sanitized through the persistence boundary.

## Current Gaps

- Authentication, encryption at rest, and retention policies are not implemented in this phase.
- Live intake persistence, transcript persistence, case creation, and legal-advice generation remain out of scope until a future consent-gated milestone.
