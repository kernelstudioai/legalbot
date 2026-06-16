import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("M41 nginx edge runbook", () => {
  it("documents the dry-run boundary and operator commands", () => {
    const runbook = readRepoFile("docs/CLOUD_NGINX_TLS_EDGE_RUNBOOK.md");

    expect(runbook).toContain("Dry-run only.");
    expect(runbook).toContain("Do not register the webhook on Meta yet.");
    expect(runbook).toContain("127.0.0.1:3002");
    expect(runbook).toContain("/webhooks/whatsapp/cloud");
    expect(runbook).toContain("sudo nginx -t");
    expect(runbook).toContain("sudo systemctl reload nginx");
    expect(runbook).toContain("curl -fsS http://127.0.0.1:3002/health");
    expect(runbook).toContain('X-Legalbot-Cloud-Replay: 1');
    expect(runbook).toContain('Expected controlled signed result: `200`.');
    expect(runbook).toContain("Go only if all items below are true:");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_ACCESS_TOKEN=");
    expect(runbook).not.toContain("WHATSAPP_CLOUD_VERIFY_TOKEN=");
    expect(runbook).not.toMatch(/\+[1-9]\d{7,14}/);
  });

  it("ships a public edge template that strips replay and keeps status private", () => {
    const template = readRepoFile("docs/templates/nginx-whatsapp-cloud-edge.conf");

    expect(template).toContain("server_name example.com;");
    expect(template).toContain("ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;");
    expect(template).toContain("client_max_body_size 256k;");
    expect(template).toContain("location = /webhooks/whatsapp/cloud {");
    expect(template).toContain("proxy_pass http://127.0.0.1:3002/webhooks/whatsapp/cloud;");
    expect(template).toContain('proxy_set_header X-Legalbot-Cloud-Replay "";');
    expect(template).toContain("proxy_connect_timeout 5s;");
    expect(template).toContain("proxy_send_timeout 15s;");
    expect(template).toContain("proxy_read_timeout 15s;");
    expect(template).toContain("location = /_edge/healthz {");
    expect(template).toContain("return 404;");
    expect(template).not.toContain("/status");
    expect(template).not.toContain("$request_body");
    expect(template).not.toMatch(/\+[1-9]\d{7,14}/);
  });
});
