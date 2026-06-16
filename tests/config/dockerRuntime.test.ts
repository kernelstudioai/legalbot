import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("docker runtime files", () => {
  it("keeps the direct Node 22 strip-types scripts intact", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["db:migrate"]).toBe(
      "node --experimental-strip-types src/app/dbMigrate.ts"
    );
    expect(packageJson.scripts["db:status"]).toBe(
      "node --experimental-strip-types src/app/dbStatus.ts"
    );
    expect(packageJson.scripts["business:backup"]).toBe(
      "node --experimental-strip-types src/app/businessBackup.ts"
    );
    expect(packageJson.scripts["business:check"]).toBe(
      "node --experimental-strip-types src/app/businessCheck.ts"
    );
    expect(packageJson.scripts["case:doctor"]).toBe(
      "node --experimental-strip-types src/app/caseDoctor.ts"
    );
    expect(packageJson.scripts["intake:list-ready"]).toBe(
      "node --experimental-strip-types src/app/intakeListReady.ts"
    );
    expect(packageJson.scripts["smoke:openwa"]).toBe(
      "node --experimental-strip-types src/app/openwaSmoke.ts"
    );
    expect(packageJson.scripts["docker:build"]).toBe("docker compose build");
    expect(packageJson.scripts["docker:diagnose"]).toBe(
      "node --experimental-strip-types src/app/dockerDiagnose.ts"
    );
    expect(packageJson.scripts["docker:cloud:up"]).toBe(
      "docker compose --profile cloud up -d legalbot-whatsapp-cloud"
    );
    expect(packageJson.scripts["docker:cloud:down"]).toBe(
      "docker compose --profile cloud stop legalbot-whatsapp-cloud"
    );
    expect(packageJson.scripts["docker:cloud:ps"]).toBe(
      "docker compose --profile cloud ps legalbot-whatsapp-cloud"
    );
    expect(packageJson.scripts["docker:cloud:diagnose"]).toBe(
      "node --experimental-strip-types src/app/dockerDiagnose.ts --transport cloud"
    );
    expect(packageJson.scripts["ops:preflight"]).toBe(
      "node --experimental-strip-types src/app/opsPreflight.ts"
    );
    expect(packageJson.scripts["ops:preflight:cloud"]).toBe(
      "node --experimental-strip-types src/app/opsPreflight.ts --transport cloud"
    );
    expect(packageJson.scripts["ops:post-start"]).toBe(
      "node --experimental-strip-types src/app/opsPostStart.ts"
    );
    expect(packageJson.scripts["ops:post-start:cloud"]).toBe(
      "node --experimental-strip-types src/app/opsPostStart.ts --transport cloud"
    );
    expect(packageJson.scripts["start:whatsapp-cloud"]).toBe(
      "node --experimental-strip-types src/app/whatsappCloudRuntime.ts"
    );
    expect(packageJson.scripts["runtime:cloud"]).toBe(
      "node --experimental-strip-types src/app/whatsappCloudRuntime.ts"
    );
    expect(packageJson.scripts["webhook:replay:cloud"]).toBe(
      "node --experimental-strip-types src/app/whatsappCloudWebhookReplay.ts"
    );
    expect(packageJson.scripts["docker:up"]).toBe("docker compose up -d");
    expect(packageJson.scripts["docker:down"]).toBe("docker compose down");
    expect(packageJson.scripts["docker:status"]).toBe("docker compose ps");
  });

  it("keeps runtime artifacts and env files out of Docker build context", () => {
    const dockerignore = readRepoFile(".dockerignore");

    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain("data/");
    expect(dockerignore).toContain("openwa-session/");
    expect(dockerignore).toContain("tmp/");
    expect(dockerignore).toContain("logs/");
    expect(dockerignore).toContain(".chromium/");
    expect(dockerignore).toContain("chrome-profile/");
    expect(dockerignore).toContain("user-data/");
    expect(readRepoFile(".gitignore")).toContain("backups/");
    expect(dockerignore).toContain("*.sqlite");
    expect(dockerignore).toContain("*.db");
  });

  it("uses a Docker healthcheck that validates the local status server only", () => {
    const compose = readRepoFile("compose.yaml");

    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("http://127.0.0.1:3001/health");
    expect(compose).not.toContain("http://127.0.0.1:3001/ready");
    expect(compose).toContain("- node");
    expect(compose).toContain('OPENWA_STATUS_SERVER_HOST: 0.0.0.0');
    expect(compose).toContain('- "127.0.0.1:3001:3001"');
  });

  it("uses minimal operator input in compose without hardcoded secrets", () => {
    const compose = readRepoFile("compose.yaml");
    const dockerfile = readRepoFile("Dockerfile");

    expect(compose).toContain("env_file:");
    expect(compose).toContain("- .env");
    expect(compose).toContain("./data:/app/data");
    expect(compose).toContain("legalbot-openwa-session:/app/openwa-session");
    expect(compose).toContain("OPENWA_BROWSER_EXECUTABLE_PATH: /usr/bin/chromium");
    expect(compose).toContain('OPENWA_HEADLESS: "true"');
    expect(compose).toContain("OPENWA_STATUS_SERVER_HOST: 0.0.0.0");
    expect(compose).not.toMatch(/\+[1-9]\d{7,14}/);
    expect(dockerfile).not.toContain("COPY .env");
  });

  it("defines a loopback-only Cloud Compose service without OpenWA session state", () => {
    const compose = readRepoFile("compose.yaml");
    const cloudService = compose.split("  legalbot-whatsapp-cloud:")[1]?.split("\nvolumes:")[0];

    expect(cloudService).toBeDefined();
    expect(cloudService).toContain("- cloud");
    expect(cloudService).toContain("target: cloud-runtime");
    expect(cloudService).toContain('command: ["npm", "run", "start:whatsapp-cloud"]');
    expect(cloudService).toContain("env_file:");
    expect(cloudService).toContain("- .env");
    expect(cloudService).toContain('WHATSAPP_CLOUD_WEBHOOK_HOST: 0.0.0.0');
    expect(cloudService).toContain('- "127.0.0.1:3002:3002"');
    expect(cloudService).toContain("http://127.0.0.1:3002/health");
    expect(cloudService).toContain("restart: unless-stopped");
    expect(cloudService).toContain("./data:/app/data");
    expect(cloudService).toContain("./backups:/app/backups");
    expect(cloudService).toContain("./logs:/app/logs");
    expect(cloudService).not.toContain("openwa-session");
    expect(cloudService).not.toContain("sessions/");
    expect(cloudService).not.toMatch(/\+[1-9]\d{7,14}/);
    expect(compose.split("  legalbot:")[1]?.split("  legalbot-whatsapp-cloud:")[0]).not.toContain(
      "target: cloud-runtime"
    );
    expect(readRepoFile("Dockerfile")).toContain("FROM runtime-base AS cloud-runtime");
    expect(readRepoFile("Dockerfile")).toContain("FROM runtime-base AS openwa-runtime");
  });

  it("documents the operator boundary for Docker and live runtime", () => {
    const dockerDoc = readRepoFile("docs/DOCKER.md");
    const runbook = readRepoFile("docs/LIVE_E2E_RUNBOOK.md");
    const persistenceDoc = readRepoFile("docs/PERSISTENCE.md");
    const securityDoc = readRepoFile("docs/SECURITY.md");
    const vpsRunbook = readRepoFile("docs/VPS_SYSTEMD_RUNBOOK.md");

    expect(dockerDoc).toContain("No automatic case creation.");
    expect(dockerDoc).toContain("No transcript or raw message-body persistence.");
    expect(dockerDoc).toContain("OpenWA launches Chromium with `--no-sandbox` and `--disable-setuid-sandbox`.");
    expect(dockerDoc).toContain("LegalBot removes only Chromium `Singleton*` profile lock files before OpenWA launch.");
    expect(dockerDoc).toContain("node --version");
    expect(dockerDoc).toContain("which chromium");
    expect(dockerDoc).toContain("chromium --version");
    expect(dockerDoc).toContain("ldd /usr/lib/chromium/chromium");
    expect(dockerDoc).toContain("`/health` means the process and status server are alive.");
    expect(dockerDoc).toContain("`/ready` may stay 503 until QR pairing or session authentication completes.");
    expect(dockerDoc).toContain("OPS_POST_START_MODE=docker npm run ops:post-start");
    expect(dockerDoc).toContain("npm run docker:diagnose");
    expect(dockerDoc).toContain("host access can fail even when in-container probes succeed.");
    expect(runbook).toContain("No automatic case creation.");
    expect(runbook).toContain("No transcript or raw message-body persistence.");
    expect(runbook).toContain("Docker health is based on `/health`, not `/ready`.");
    expect(runbook).toContain("npm run business:check");
    expect(persistenceDoc).toContain("npm run business:backup");
    expect(persistenceDoc).toContain("npm run business:check");
    expect(persistenceDoc).toContain("npm run ops:preflight");
    expect(persistenceDoc).toContain("npm run ops:post-start");
    expect(persistenceDoc).toContain("backups/ remains git-ignored");
    expect(securityDoc).toContain("Backups may contain personal data.");
    expect(securityDoc).toContain("Backups must not be committed.");
    expect(vpsRunbook).toContain("npm run ops:preflight:cloud");
    expect(vpsRunbook).toContain("npm run ops:post-start:cloud");
    expect(vpsRunbook).toContain("npm run webhook:replay:cloud");
    expect(vpsRunbook).toContain("cd ~/legalbot");
    expect(vpsRunbook).toContain("docker compose config --quiet");
    expect(vpsRunbook).toContain("npm run docker:cloud:up");
    expect(vpsRunbook).toContain("npm run docker:cloud:ps");
    expect(vpsRunbook).toContain("npm run docker:cloud:diagnose");
    expect(vpsRunbook).toContain("docker --version");
    expect(vpsRunbook).toContain("docker compose version");
    expect(vpsRunbook).toContain("docker compose --profile cloud config --services");
    expect(vpsRunbook).toContain("sudo systemctl enable legalbot-whatsapp-cloud.service");
    expect(vpsRunbook).toContain("sudo systemctl start legalbot-whatsapp-cloud.service");
    expect(vpsRunbook).toContain("sudo systemctl restart legalbot-whatsapp-cloud.service");
    expect(vpsRunbook).toContain("sudo systemctl stop legalbot-whatsapp-cloud.service");
    expect(vpsRunbook).toContain("127.0.0.1:3002");
    expect(vpsRunbook).toContain("tests/fixtures/whatsapp-cloud/valid-text.json");
    expect(vpsRunbook).toContain("sudo journalctl -u legalbot-whatsapp-cloud.service -n 120 --no-pager");
    expect(vpsRunbook).toContain("./scripts/provision-systemd.sh");
    expect(vpsRunbook).toContain("https://example.com/webhooks/whatsapp/cloud");
    expect(vpsRunbook).toContain('proxy_set_header X-Legalbot-Cloud-Replay ""');
    expect(vpsRunbook).toContain("sudo systemctl stop legalbot-whatsapp-cloud.service || true");
    expect(vpsRunbook).toContain("git checkout de9d20a");
    expect(vpsRunbook).toContain("git status --short");
    expect(vpsRunbook).toContain(
      "ExecStart=<docker> compose --profile cloud up -d --wait legalbot-whatsapp-cloud"
    );
    expect(vpsRunbook).toContain("Stale container env");
    expect(vpsRunbook).toContain("Data dir ownership mismatch");
    expect(vpsRunbook).toContain("Fixture missing in image/container");
    expect(vpsRunbook).toContain("Missing Cloud env");
    expect(vpsRunbook).toContain("systemd does not embed credentials");
    expect(vpsRunbook).not.toMatch(/ExecStart=.*npm run start:whatsapp-cloud/);
    expect(vpsRunbook).toContain("legalbot-whatsapp-cloud.service");
    expect(vpsRunbook).toContain("No multi-bot runtime");
    expect(securityDoc).toContain("Systemd unit files must not contain secrets.");
    expect(securityDoc).toContain("must never print env-file contents or copy `.env` into `/etc` automatically");
  });
});
