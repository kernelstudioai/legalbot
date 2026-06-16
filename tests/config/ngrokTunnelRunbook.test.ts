import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("M41b ngrok tunnel runbook", () => {
  it("documents the temporary public HTTPS dry-run and public signature expectations", () => {
    const runbook = readRepoFile("docs/CLOUD_NGROK_TUNNEL_RUNBOOK.md");

    expect(runbook).toContain("Temporary and staging-only");
    expect(runbook).toContain("real domain plus nginx/TLS");
    expect(runbook).toContain("ngrok http http://127.0.0.1:3002");
    expect(runbook).toContain('export M41B_NGROK_URL="https://<ngrok-host>"');
    expect(runbook).toContain("/webhooks/whatsapp/cloud");
    expect(runbook).toContain("127.0.0.1:3002");
    expect(runbook).toContain("missing-signature result: `401`");
    expect(runbook).toContain("invalid-signature result: `401`");
    expect(runbook).toContain("local replay harness: loopback-only, optional signed replay");
    expect(runbook).toContain("expected signed `200`");
    expect(runbook).toContain("public ngrok path: real public webhook route");
    expect(runbook).toContain("do not require `200` for a fake public fixture over ngrok");
    expect(runbook).toContain("HTTP response may be `500`");
    expect(runbook).toContain("whatsapp_cloud_message_received");
    expect(runbook).toContain("whatsapp_cloud_request_failed");
    expect(runbook).toContain("Meta verification `GET` challenge");
    expect(runbook).toContain("Do not send `X-Legalbot-Cloud-Replay` to the public ngrok URL.");
    expect(runbook).toContain("The replay header is local-only because it bypasses the normal public delivery path");
    expect(runbook).toContain("docker compose --profile cloud logs --tail=120 legalbot-whatsapp-cloud | \\");
    expect(runbook).toContain('grep -E "whatsapp_cloud_message_received|whatsapp_cloud_request_failed|401|500"');
    expect(runbook).toContain("verify token must match the operator-managed env or config");
    expect(runbook).toContain("unset M41B_NGROK_URL");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_ACCESS_TOKEN=");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_VERIFY_TOKEN=");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_APP_SECRET=");
    expect(runbook).not.toMatch(/\+[1-9]\d{7,14}/);
  });

  it("links the ngrok runbook from the primary cloud operator docs", () => {
    const vpsRunbook = readRepoFile("docs/VPS_SYSTEMD_RUNBOOK.md");
    const cloudDoc = readRepoFile("docs/WHATSAPP_CLOUD.md");

    expect(vpsRunbook).toContain("docs/CLOUD_NGROK_TUNNEL_RUNBOOK.md");
    expect(vpsRunbook).toContain("Treat ngrok as staging-only");
    expect(cloudDoc).toContain("docs/CLOUD_NGROK_TUNNEL_RUNBOOK.md");
  });
});
