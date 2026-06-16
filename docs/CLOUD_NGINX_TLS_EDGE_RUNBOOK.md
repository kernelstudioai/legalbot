# M41 Cloud nginx/TLS Edge Dry-Run

## Scope

This runbook prepares a public HTTPS nginx edge for the Cloud webhook runtime already
bound to `127.0.0.1:3002`.

- Dry-run only.
- Do not register the webhook on Meta yet.
- Do not expose or test with real Meta callbacks.
- Do not print `.env`, tokens, app secrets, raw webhook bodies, or full phone numbers.

Use `docs/templates/nginx-whatsapp-cloud-edge.conf` as the operator template.

## Prerequisites

- VPS checkout is on the intended commit and `git status --short` is clean or understood.
- `legalbot-whatsapp-cloud.service` is already installed and operator-managed through
  Docker Compose.
- `npm run ops:preflight:cloud` returns sanitized JSON with `status="ready"` and
  `blockers=[]`.
- `OPS_POST_START_MODE=docker npm run ops:post-start:cloud` returns sanitized JSON with
  `status="healthy"` and `diagnosis.code="app_ready"`.
- `npm run docker:cloud:diagnose` returns sanitized JSON with `status="healthy"`.
- Loopback replay is already proven locally: signed replay `200`, unsigned replay `401`.
- nginx is already installed by the operator.

## DNS, Firewall, And TLS Assumptions

- DNS for the chosen public hostname points to the VPS public IP.
- Public firewall allows inbound `80/tcp` and `443/tcp` only as needed for TLS and
  HTTPS.
- Public firewall does not expose port `3002`.
- The runtime stays published only on `127.0.0.1:3002`.
- TLS certificate issuance and renewal are operator-managed outside this repo.
- The nginx server block uses placeholder certificate paths only; replace them with the
  operator-managed certificate files on the VPS.

## Public And Private Endpoint Policy

- Publicly proxied path: `/webhooks/whatsapp/cloud` only.
- Local-only app probes: `/health`, `/ready`, and `/status` stay on
  `http://127.0.0.1:3002`.
- Optional protected nginx-only edge probe: `/_edge/healthz`.
- Do not proxy `/status` publicly by default.
- Do not publish any replay-only bypass header from public traffic.

## nginx Template Behavior

The template:

- proxies only `GET` and `POST` for `/webhooks/whatsapp/cloud`
- proxies to `http://127.0.0.1:3002/webhooks/whatsapp/cloud`
- strips `X-Legalbot-Cloud-Replay` at the public edge
- sets `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Host`, and
  `X-Forwarded-Proto`
- keeps `client_max_body_size 256k`
- uses conservative `proxy_connect_timeout 5s`, `proxy_send_timeout 15s`, and
  `proxy_read_timeout 15s`
- avoids request-body logging
- returns `404` for unrelated public paths

## Logging And Redaction Guidance

- Do not add `$request_body` to nginx logs.
- Keep access logging limited to method, URI, status, upstream status, remote address,
  request id, and timing.
- Keep error logs at `warn` or tighter during dry-run unless active debugging is needed.
- Do not paste raw nginx access logs, raw webhook bodies, or env values into tickets or
  chat.
- If a dry-run fails, capture HTTP status codes and high-level timestamps only.

## Exact M41 VPS Operator Commands

Copy the template into an operator-managed nginx site path, then adjust only the public
hostname and certificate file paths:

```bash
cd ~/legalbot
sudo install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo cp docs/templates/nginx-whatsapp-cloud-edge.conf /etc/nginx/sites-available/legalbot-whatsapp-cloud-edge.conf
sudo ln -sfn /etc/nginx/sites-available/legalbot-whatsapp-cloud-edge.conf /etc/nginx/sites-enabled/legalbot-whatsapp-cloud-edge.conf
sudo nginx -t
```

If `sudo nginx -t` passes, reload nginx:

```bash
sudo systemctl reload nginx
```

Confirm the local runtime still stays healthy before edge probing:

```bash
curl -fsS http://127.0.0.1:3002/health
curl -fsS http://127.0.0.1:3002/ready
curl -fsS http://127.0.0.1:3002/status
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Set a non-secret hostname variable for the dry-run:

```bash
export M41_EDGE_DOMAIN=example.com
```

Protected edge health probe. Use this only if the operator kept `/_edge/healthz`
protected in nginx as shown by the template:

```bash
curl --fail --silent --show-error --resolve "${M41_EDGE_DOMAIN}:443:127.0.0.1" "https://${M41_EDGE_DOMAIN}/_edge/healthz"
```

Public edge probe with no signature. Expect `401`:

```bash
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  --resolve "${M41_EDGE_DOMAIN}:443:127.0.0.1" \
  -X POST "https://${M41_EDGE_DOMAIN}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Public edge probe with an invalid signature. Expect `401`:

```bash
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  --resolve "${M41_EDGE_DOMAIN}:443:127.0.0.1" \
  -X POST "https://${M41_EDGE_DOMAIN}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Replay-header leakage probe. Even if the client sends `X-Legalbot-Cloud-Replay: 1`,
the public edge must strip it before proxying. Expect `401`:

```bash
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  --resolve "${M41_EDGE_DOMAIN}:443:127.0.0.1" \
  -X POST "https://${M41_EDGE_DOMAIN}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  -H "X-Legalbot-Cloud-Replay: 1" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Controlled signed dry-run through nginx. Run this only from an operator shell where
`WHATSAPP_CLOUD_APP_SECRET` is already exported out of band. The command does not print
the secret and uses a local host mapping instead of live DNS:

```bash
signature="$(node --input-type=module -e "import { createHmac } from 'node:crypto'; import { readFileSync } from 'node:fs'; const rawBody = readFileSync('tests/fixtures/whatsapp-cloud/valid-text.json', 'utf8'); process.stdout.write('sha256=' + createHmac('sha256', process.env.WHATSAPP_CLOUD_APP_SECRET ?? '').update(rawBody).digest('hex'))")"
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  --resolve "${M41_EDGE_DOMAIN}:443:127.0.0.1" \
  -X POST "https://${M41_EDGE_DOMAIN}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: ${signature}" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
unset signature
```

Expected controlled signed result: `200`.

## Dry-Run Validation Checklist

1. `sudo nginx -t` succeeds before reload.
2. Local runtime remains healthy on loopback after nginx reload.
3. `/_edge/healthz` returns `204` or equivalent success only from the protected operator
   path.
4. Public HTTPS edge returns `401` for missing signatures.
5. Public HTTPS edge returns `401` for invalid signatures.
6. Public HTTPS edge still returns `401` when a client attempts to inject
   `X-Legalbot-Cloud-Replay: 1`.
7. Controlled signed operator dry-run returns `200`.
8. `/health`, `/ready`, and `/status` are not publicly proxied.
9. Logs contain no raw webhook bodies, secrets, tokens, or full phone numbers.

## Go/No-Go Before Meta Registration

Go only if all items below are true:

- nginx config validates cleanly.
- nginx reload succeeds.
- loopback runtime health stays healthy after the reload.
- the only public webhook path is `/webhooks/whatsapp/cloud`.
- `/status` is not publicly proxied.
- public edge strips `X-Legalbot-Cloud-Replay`.
- missing and invalid signatures are rejected with `401` through the edge.
- the controlled signed dry-run reaches `200`.
- logs stay sanitized.

No-go if any item below is observed:

- `sudo nginx -t` fails
- nginx reload fails
- local `/health`, `/ready`, or `/status` becomes unhealthy
- public traffic reaches a replay-only path or replay header bypass
- `/status` is reachable publicly
- unsigned or invalidly signed requests are accepted
- logs contain raw bodies, secrets, or full phone numbers

## Rollback

If the dry-run fails, remove the public edge config and return to loopback-only service:

```bash
sudo rm -f /etc/nginx/sites-enabled/legalbot-whatsapp-cloud-edge.conf
sudo nginx -t
sudo systemctl reload nginx
curl -fsS http://127.0.0.1:3002/health
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
```

Rollback is complete only when nginx is back to a valid state and the loopback runtime
still reports healthy.
