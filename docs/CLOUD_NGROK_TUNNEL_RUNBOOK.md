# M41b Cloud ngrok HTTPS Tunnel Dry-Run

## Scope

This runbook provides a temporary HTTPS validation path for the WhatsApp Cloud webhook
runtime already bound to `127.0.0.1:3002`.

For the manual Meta webhook verification and first real signed delivery evidence flow
that builds on this tunnel, use `docs/META_WEBHOOK_NGROK_EVIDENCE_RUNBOOK.md`.

- Temporary and staging-only unless the operator has a stable reserved ngrok domain.
- The production target remains a real domain plus nginx/TLS as documented in
  `docs/CLOUD_NGINX_TLS_EDGE_RUNBOOK.md`.
- Do not register the Meta webhook automatically.
- Do not print `.env`, ngrok authtoken values, access tokens, verify tokens, app
  secrets, raw webhook bodies, raw DB rows, or full phone numbers.
- Keep logs and evidence sanitized.

## Why ngrok Is Different

- The ngrok URL is public while the tunnel is running.
- ngrok forwards public traffic directly to the runtime.
- The public ngrok path is not the local replay harness.
- Local replay stays loopback-only, can use the replay header, and stops before pipeline
  dispatch or outbound Cloud API calls.
- Public ngrok requests hit the real webhook route, run normal signature enforcement,
  and may continue into normal dispatch.
- Unlike the nginx edge, ngrok does not strip `X-Legalbot-Cloud-Replay`.
- Do not use `X-Legalbot-Cloud-Replay` against the public ngrok URL.
- The replay header is local-only because it bypasses the normal public delivery path
  and would be unsafe evidence if sent through a public tunnel.

## Prerequisites

- Cloud runtime is already healthy on `127.0.0.1:3002`.
- `ngrok` is installed on the operator host.
- The operator configured the ngrok authtoken out of band.
- The VPS or workstation is already on the intended commit.
- The operator understands that this is a dry-run only and not the final production
  ingress shape.

## Local Runtime Readiness Checks

Run these checks before starting any public tunnel:

```bash
cd ~/legalbot
npm run ops:preflight:cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Expected local outcomes:

- `ops:preflight:cloud` reports ready status.
- `ops:post-start:cloud` reports healthy status.
- `docker:cloud:diagnose` reports healthy status.

If any local check fails, stop here and return to loopback-only troubleshooting.

## Start The Tunnel

Start ngrok in a dedicated shell:

```bash
ngrok http http://127.0.0.1:3002
```

Copy the assigned public HTTPS origin and export it without a trailing slash:

```bash
export M41B_NGROK_URL="https://<ngrok-host>"
```

The callback URL used for manual Meta setup is:

```text
https://<ngrok-host>/webhooks/whatsapp/cloud
```

## Public ngrok Validation

Keep the two validation paths separate:

- local replay harness: loopback-only, optional signed replay, expected signed `200`,
  and no outbound Meta call
- public ngrok path: real public webhook route, expected `401` for missing or invalid
  signatures, and fake signed fixtures may continue into normal dispatch

The public validation path must exercise the real webhook route:

- target path: `/webhooks/whatsapp/cloud`
- runtime target: `127.0.0.1:3002`
- expected missing-signature result: `401`
- expected invalid-signature result: `401`
- expected fake valid-signature result: accepted signature, with runtime evidence or a
  sanitized `500`

Missing signature. Expect `401`:

```bash
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  -X POST "${M41B_NGROK_URL}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Invalid signature. Expect `401`:

```bash
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  -X POST "${M41B_NGROK_URL}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Valid signature. Run this only from an operator shell where
`WHATSAPP_CLOUD_APP_SECRET` is already exported out of band. The command must not echo
the secret:

```bash
signature="$(node --input-type=module -e "import { createHmac } from 'node:crypto'; import { readFileSync } from 'node:fs'; const rawBody = readFileSync('tests/fixtures/whatsapp-cloud/valid-text.json', 'utf8'); process.stdout.write('sha256=' + createHmac('sha256', process.env.WHATSAPP_CLOUD_APP_SECRET ?? '').update(rawBody).digest('hex'))")"
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  -X POST "${M41B_NGROK_URL}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: ${signature}" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
unset signature
```

Expected fake valid-signature outcome:

- the signature is accepted if the runtime logs show sanitized
  `whatsapp_cloud_message_received` followed by sanitized
  `whatsapp_cloud_request_failed`
- the HTTP response may be `500` because the fake fixture can reach normal outbound
  Cloud API dispatch and fail with a sanitized upstream `401`
- do not require `200` for a fake public fixture over ngrok

This is expected because the public ngrok path does not use the local replay bypass.
With a valid signature, the fake fixture is treated as a real inbound webhook event and
can reach normal outbound dispatch with fake identifiers or credentials.

Inspect sanitized container evidence after the valid signed request:

```bash
docker compose --profile cloud logs --tail=120 legalbot-whatsapp-cloud | \
  grep -E "whatsapp_cloud_message_received|whatsapp_cloud_request_failed|401|500"
```

Expected evidence is limited to sanitized runtime markers. Do not store raw payloads,
tokens, secrets, or full phone numbers.

Public `200` success should be validated by:

- the Meta verification `GET` challenge against the public callback URL
- later real Meta-signed webhook deliveries

Do not use the fake public message fixture as proof of end-to-end `200`.

## Replay-Header Warning

- Do not send `X-Legalbot-Cloud-Replay` to the public ngrok URL.
- Do not reuse loopback replay commands against `${M41B_NGROK_URL}`.
- ngrok forwards public traffic directly to the runtime, unlike nginx which strips the
  replay header at the edge.
- The replay header is reserved for loopback-only validation because it bypasses normal
  public webhook handling and would make the public tunnel evidence unsafe.
- If public validation must be repeated, use the missing, invalid, and valid signature
  commands in this runbook only.

## Manual Meta Setup Notes

- Callback URL format:
  `https://<ngrok-host>/webhooks/whatsapp/cloud`
- The verify token must match the operator-managed env or config already loaded by the
  runtime.
- Do not paste verify tokens, access tokens, or app secrets into docs, logs, tickets,
  or chat.
- Treat the ngrok hostname as temporary unless a stable reserved domain is configured.
- Do not treat a temporary ngrok hostname as final production infrastructure.

## Stop And Cleanup

1. Stop ngrok with `Ctrl-C` in the ngrok shell.
2. Remove the shell variable:

```bash
unset M41B_NGROK_URL
```

3. Confirm the runtime still remains local-only and healthy:

```bash
curl -fsS http://127.0.0.1:3002/health
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
```

4. If a temporary Meta callback was entered for the dry-run, remove or disable it out of
   band after testing.

## Rollback To Local-Only State

Rollback is simply the removal of public exposure:

1. Stop the ngrok process.
2. `unset M41B_NGROK_URL`.
3. Re-run local health checks:

```bash
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3002/ready || true
curl -fsS http://127.0.0.1:3002/status
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Rollback is complete only when the tunnel is stopped and loopback health remains
healthy.

## Go/No-Go Criteria

Go only if all items below are true:

- local runtime readiness checks are healthy before starting ngrok
- the ngrok target remains `http://127.0.0.1:3002`
- the public callback path is exactly `/webhooks/whatsapp/cloud`
- missing signatures return `401`
- invalid signatures return `401`
- the fake valid signed fixture reaches the runtime and produces sanitized accepted
  evidence, including `whatsapp_cloud_message_received` followed by sanitized dispatch
  failure, or the HTTP response is a sanitized `500` caused by outbound Cloud API
  failure
- no public validation uses `X-Legalbot-Cloud-Replay`
- logs and evidence stay sanitized
- the operator understands this remains temporary and staging-only

No-go if any item below is observed:

- local health is not healthy before tunneling
- ngrok points anywhere other than `127.0.0.1:3002`
- a public request with missing or invalid signature is accepted
- replay-header bypass is attempted on the public ngrok URL
- raw webhook bodies, secrets, tokens, raw DB rows, or full phone numbers appear in
  logs or evidence
- the valid signed fake fixture does not reach sanitized runtime handling
- the operator starts treating the temporary ngrok URL as final production ingress
- the runtime is unreachable through the tunnel

## Evidence Checklist

Record sanitized evidence only:

- current commit and branch
- `npm run ops:preflight:cloud`
- `OPS_POST_START_MODE=docker npm run ops:post-start:cloud`
- `npm run docker:cloud:diagnose`
- ngrok HTTPS hostname used for the dry-run
- missing-signature public result `401`
- invalid-signature public result `401`
- valid-signature public result and sanitized log outcome
- confirmation that `X-Legalbot-Cloud-Replay` was not used publicly
- confirmation that logs remained sanitized
- confirmation that ngrok was stopped and the host returned to local-only state

Do not store or paste raw webhook bodies, secrets, tokens, raw DB rows, or full phone
numbers in the evidence set.
