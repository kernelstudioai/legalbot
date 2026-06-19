# M42 Meta Webhook ngrok Evidence Runbook

## Scope

This runbook documents the operator-safe manual path to:

- configure the Meta webhook callback against a temporary ngrok HTTPS origin
- verify the Meta webhook `GET` challenge
- subscribe the app to the relevant WhatsApp webhook field
- capture first real Meta-signed delivery evidence

This runbook does not automate Meta dashboard registration and does not add production
nginx/TLS. Runtime business behavior is the current Cloud product flow: completed
client intake creates a draft practice automatically. Keep all evidence sanitized.

## Safety Rules

- Do not print or paste verify tokens, access tokens, app secrets, raw webhook bodies,
  raw DB rows, or full phone numbers.
- Do not use `X-Legalbot-Cloud-Replay` on the public ngrok URL.
- Do not treat a fake public fixture as success proof for live Meta delivery.
- Treat the ngrok hostname as temporary unless the operator has a reserved stable domain.
- For production ingress, use the real-domain nginx/TLS path from M41.

## Prerequisites

Confirm all items before touching the Meta dashboard:

- Cloud runtime is healthy.
- The ngrok HTTPS URL is active and still targets `http://127.0.0.1:3002`.
- Callback URL is exactly:
  `https://<ngrok-host>/webhooks/whatsapp/cloud`
- The verify token is already configured in the runtime environment.
- The app secret is already configured and signature enforcement is enabled.
- The access token is already configured.
- `LAWYER_PHONE_E164` is configured for operator recognition.
- The correct WhatsApp app and phone number are already selected in the Meta dashboard.

Operator checks:

```bash
cd ~/legalbot
git rev-parse --short HEAD
npm run ops:preflight:cloud
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
curl -fsS http://127.0.0.1:4040/api/tunnels
```

Expected outcomes:

- `ops:preflight:cloud` reports ready.
- `ops:post-start:cloud` reports healthy.
- `docker:cloud:diagnose` reports healthy.
- ngrok local inspection shows the current HTTPS origin and the local target
  `http://127.0.0.1:3002`.

## Callback And Dashboard Setup

Use the Meta dashboard manually. Never record the token values in docs, tickets, or chat.

1. Open the Meta app used for WhatsApp Cloud API.
2. Go to the WhatsApp product webhook configuration page.
3. Paste the callback URL:
   `https://<ngrok-host>/webhooks/whatsapp/cloud`
4. Paste the verify token already loaded by the runtime.
   Do not save the token value anywhere else.
5. Run the Meta callback verification step from the dashboard.
6. After verification succeeds, subscribe the app to the WhatsApp `messages` field.
7. If the dashboard offers granular event selection, keep the subscription limited to the
   relevant WhatsApp message webhook flow for this milestone.

Do not automate these steps from the repo.

## Verification GET Evidence

Success proof for webhook verification is the real Meta `GET` challenge, not a fake
fixture.

Safe evidence commands:

```bash
docker compose --profile cloud logs --tail=120 legalbot-whatsapp-cloud | \
  grep -E "whatsapp_cloud_webhook_verified|whatsapp_cloud_webhook_verification_failed"
```

Optional tunnel confirmation without payload dump:

```bash
curl -fsS http://127.0.0.1:4040/api/tunnels
```

Expected verification evidence:

- Meta dashboard verification succeeds.
- Runtime logs show sanitized `whatsapp_cloud_webhook_verified` evidence if logs are
  available.
- No verify token value is printed.
- No raw request query or raw body is printed.

Verification failure evidence:

- Meta dashboard verification fails.
- Runtime logs may show sanitized `whatsapp_cloud_webhook_verification_failed`.
- This is a no-go until the callback URL, verify token, tunnel target, and runtime
  health are rechecked.

## Signature Guard Checks

Before treating any live delivery as valid evidence, confirm public signature rejection
still works through ngrok.

Missing signature. Expect `401`:

```bash
export M42_NGROK_URL="https://<ngrok-host>"
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  -X POST "${M42_NGROK_URL}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Invalid signature. Expect `401`:

```bash
curl --silent --show-error --output /dev/null --write-out "%{http_code}\n" \
  -X POST "${M42_NGROK_URL}/webhooks/whatsapp/cloud" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json
```

Expected guard evidence:

- public missing signature returns `401`
- public invalid signature returns `401`
- no public probe uses `X-Legalbot-Cloud-Replay`

## Fake Fixture Caveat

The public ngrok path is the real webhook route, not the local replay harness.

- A fake public fixture with a valid signature may still produce a sanitized `500`.
- Sanitized `whatsapp_cloud_message_received` plus sanitized
  `whatsapp_cloud_request_failed` can be acceptable evidence that the signature was
  accepted for the fake fixture.
- That fake public `500` is not success proof for Meta verification or live delivery.
- Do not require `200` from the fake public fixture.
- Do not use the fake public fixture as proof of first real signed Meta delivery.

## First Real Signed Delivery Evidence

After verification succeeds and the `messages` subscription is active, capture the first
real signed webhook event from Meta.

Real inbound remains a live Meta and phone-delivery proof. Local replay and fake public
fixtures do not prove that Meta can deliver a real user message to this runtime.

Prepare safe log evidence:

```bash
docker compose --profile cloud logs --tail=200 legalbot-whatsapp-cloud | \
  grep -E "cloud_actor_resolved|cloud_client_turn_received|cloud_operator_command_received|cloud_operator_command_handled|cloud_operator_command_rejected|whatsapp_cloud_message_received|whatsapp_cloud_output_dispatched|whatsapp_cloud_request_failed|whatsapp_cloud_signature_invalid"
```

Operator procedure:

1. Keep the verified callback and active ngrok tunnel in place.
2. Send one controlled real WhatsApp message to the business number from an operator-held
   test handset. For product evidence, complete the consent, identity, legal issue, and
   attachment skip flow from a non-operator phone and record only that a practice code
   was returned.
3. Wait for the real Meta webhook delivery to hit the runtime.
4. Capture only sanitized runtime evidence.
5. Record the HTTP outcome observed from Meta dashboard tooling if available, without
   pasting payloads or secrets.

Expected first real delivery evidence:

- the runtime receives a real Meta-signed request
- sanitized `whatsapp_cloud_message_received` appears
- sanitized `cloud_actor_resolved` appears
- if outbound dispatch succeeds, sanitized `whatsapp_cloud_output_dispatched` appears
- for a completed client intake, a safe practice code is returned to the client
- if outbound dispatch fails, sanitized `whatsapp_cloud_request_failed` may appear
- any logged message identifier stays sanitized or partial according to current runtime
  behavior
- no secret, raw body, or full phone number is printed

Real success proof for M42 is:

- Meta verification `GET` succeeds
- first real signed Meta event reaches the runtime safely

## Operator Recognition Evidence

Once live inbound delivery is available from the operator-held phone configured in
`LAWYER_PHONE_E164`, send a controlled `status` or `pratiche` message to the business
number.

Safe evidence command:

```bash
docker compose --profile cloud logs --tail=200 legalbot-whatsapp-cloud | \
  grep -E "cloud_actor_resolved|cloud_operator_command_received|cloud_operator_command_handled|whatsapp_cloud_output_dispatched"
```

Expected operator evidence:

- `cloud_actor_resolved` reports `actor=lawyer` or equivalent structured JSON.
- `cloud_operator_command_received` reports `command=status` or
  `command=practice-list`.
- `cloud_operator_command_handled` appears.
- `whatsapp_cloud_output_dispatched` appears if outbound Cloud dispatch succeeds.
- No full phone number, token, raw body, transcript, or raw database row is printed.

From a non-operator phone, send `status`. Expected evidence is client-path only:
`cloud_actor_resolved` with `actor=client` and `cloud_client_turn_received`. It must not
produce `cloud_operator_command_received`.

## Go/No-Go

GO only if all items below are true:

- runtime health checks stay healthy
- ngrok still points to `http://127.0.0.1:3002`
- callback path is exactly `/webhooks/whatsapp/cloud`
- Meta verification succeeds
- public missing signature returns `401`
- public invalid signature returns `401`
- first real signed Meta event reaches the runtime
- no secret, raw body, verify token, access token, app secret, or full phone number is
  leaked

NO-GO if any item below is observed:

- Meta verification fails
- missing or invalid signatures are accepted
- logs leak verify token, access token, app secret, raw body, or full phone numbers
- the ngrok URL changes unexpectedly during the evidence run
- runtime is unhealthy
- any public validation uses `X-Legalbot-Cloud-Replay`
- fake public fixture `500` is treated as success proof

## Cleanup And Rollback

After evidence capture:

1. Disable or delete the temporary Meta callback, or pause the relevant webhook
   subscription in the Meta dashboard.
   In short: pause the relevant webhook subscription when full callback removal is not
   desirable.
2. Stop the ngrok tunnel.
3. Remove the shell variable:

```bash
unset M42_NGROK_URL
```

4. Reconfirm the local Cloud runtime remains healthy:

```bash
curl -fsS http://127.0.0.1:3002/health
OPS_POST_START_MODE=docker npm run ops:post-start:cloud
npm run docker:cloud:diagnose
```

Rollback is complete only when public exposure is removed and the local runtime stays
healthy.

## Evidence Checklist

Record sanitized evidence only:

- current commit
- `npm run ops:preflight:cloud`
- `OPS_POST_START_MODE=docker npm run ops:post-start:cloud`
- `npm run docker:cloud:diagnose`
- current ngrok HTTPS origin
- proof that ngrok still targets `127.0.0.1:3002`
- Meta verification `GET` success
- public missing-signature result `401`
- public invalid-signature result `401`
- first real signed Meta delivery evidence
- confirmation that no public request used `X-Legalbot-Cloud-Replay`
- confirmation that no secrets, raw bodies, or full phone numbers were printed

Do not store tokens, secrets, raw webhook payloads, raw DB rows, or full phone numbers.
