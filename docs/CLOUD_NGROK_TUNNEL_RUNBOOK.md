# M41b Cloud ngrok HTTPS Tunnel Dry-Run

## Scope

This runbook provides a temporary HTTPS validation path for the WhatsApp Cloud webhook
runtime already bound to `127.0.0.1:3002`.

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
- Unlike the nginx edge, ngrok does not strip `X-Legalbot-Cloud-Replay`.
- Do not use `X-Legalbot-Cloud-Replay` against the public ngrok URL.
- Use the replay header only for loopback-only validation paths documented elsewhere.

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

The public validation path must exercise the real webhook route:

- target path: `/webhooks/whatsapp/cloud`
- runtime target: `127.0.0.1:3002`
- expected missing-signature result: `401`
- expected invalid-signature result: `401`
- expected valid-signature result: `200`

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

Expected valid-signature result: `200`.

## Replay-Header Warning

- Do not send `X-Legalbot-Cloud-Replay` to the public ngrok URL.
- Do not reuse loopback replay commands against `${M41B_NGROK_URL}`.
- ngrok forwards public traffic directly to the runtime, unlike nginx which strips the
  replay header at the edge.
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
- valid signatures return `200`
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
- the operator starts treating the temporary ngrok URL as final production ingress

## Evidence Checklist

Record sanitized evidence only:

- current commit and branch
- `npm run ops:preflight:cloud`
- `OPS_POST_START_MODE=docker npm run ops:post-start:cloud`
- `npm run docker:cloud:diagnose`
- ngrok HTTPS hostname used for the dry-run
- missing-signature public result `401`
- invalid-signature public result `401`
- valid-signature public result `200`
- confirmation that `X-Legalbot-Cloud-Replay` was not used publicly
- confirmation that logs remained sanitized
- confirmation that ngrok was stopped and the host returned to local-only state

Do not store or paste raw webhook bodies, secrets, tokens, raw DB rows, or full phone
numbers in the evidence set.
