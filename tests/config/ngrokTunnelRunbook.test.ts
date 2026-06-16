import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("M41b ngrok tunnel runbook", () => {
  it("documents the temporary public HTTPS dry-run and signature expectations", () => {
    const runbook = readRepoFile("docs/CLOUD_NGROK_TUNNEL_RUNBOOK.md");

    expect(runbook).toContain("Temporary and staging-only");
    expect(runbook).toContain("real domain plus nginx/TLS");
    expect(runbook).toContain("ngrok http http://127.0.0.1:3002");
    expect(runbook).toContain('export M41B_NGROK_URL="https://<ngrok-host>"');
    expect(runbook).toContain("/webhooks/whatsapp/cloud");
    expect(runbook).toContain("127.0.0.1:3002");
    expect(runbook).toContain("missing-signature result: `401`");
    expect(runbook).toContain("invalid-signature result: `401`");
    expect(runbook).toContain("valid-signature result: `200`");
    expect(runbook).toContain("Do not send `X-Legalbot-Cloud-Replay` to the public ngrok URL.");
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
