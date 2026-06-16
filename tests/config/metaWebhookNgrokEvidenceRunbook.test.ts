import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("M42 Meta webhook ngrok evidence runbook", () => {
  it("documents the manual Meta verification and first real signed delivery path safely", () => {
    const runbook = readRepoFile("docs/META_WEBHOOK_NGROK_EVIDENCE_RUNBOOK.md");

    expect(runbook).toContain("/webhooks/whatsapp/cloud");
    expect(runbook).toContain("Meta verification `GET`");
    expect(runbook).toContain("first real signed Meta event reaches the runtime");
    expect(runbook).toContain("messages` field");
    expect(runbook).toContain("public missing signature returns `401`");
    expect(runbook).toContain("public invalid signature returns `401`");
    expect(runbook).toContain("fake public fixture with a valid signature may still produce a sanitized `500`");
    expect(runbook).toContain("not success proof");
    expect(runbook).toContain("Do not use `X-Legalbot-Cloud-Replay` on the public ngrok URL.");
    expect(runbook).toContain("curl -fsS http://127.0.0.1:4040/api/tunnels");
    expect(runbook).toContain("whatsapp_cloud_webhook_verified");
    expect(runbook).toContain("whatsapp_cloud_message_received");
    expect(runbook).toContain("whatsapp_cloud_signature_invalid");
    expect(runbook).toContain("pause the relevant webhook subscription");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_ACCESS_TOKEN=");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_VERIFY_TOKEN=");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_APP_SECRET=");
    expect(runbook).not.toMatch(/\+[1-9]\d{7,14}/);
  });

  it("links the M42 runbook from the primary cloud docs", () => {
    const cloudDoc = readRepoFile("docs/WHATSAPP_CLOUD.md");
    const ngrokRunbook = readRepoFile("docs/CLOUD_NGROK_TUNNEL_RUNBOOK.md");

    expect(cloudDoc).toContain("docs/META_WEBHOOK_NGROK_EVIDENCE_RUNBOOK.md");
    expect(ngrokRunbook).toContain("docs/META_WEBHOOK_NGROK_EVIDENCE_RUNBOOK.md");
  });
});
