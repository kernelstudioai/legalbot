import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runOpsPostStartCommand } from "../../src/app/opsPostStart.ts";
import { startWhatsAppCloudRuntime } from "../../src/app/whatsappCloudRuntime.ts";
import { runWhatsAppCloudWebhookReplay } from "../../src/app/whatsappCloudWebhookReplay.ts";
import {
  createBusinessPersistenceService,
  createInMemoryPersistenceService
} from "../../src/persistence/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const fakeAppSecret = "local-dev-app-secret";

const createFakeCloudEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "development",
  WHATSAPP_TRANSPORT: "cloud",
  BUSINESS_PERSISTENCE_ENABLED: "true",
  DATABASE_MIGRATIONS_ENABLED: "true",
  WHATSAPP_CLOUD_API_VERSION: "v21.0",
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: "000000000000000",
  WHATSAPP_CLOUD_VERIFY_TOKEN: "local-dev-verify-token",
  WHATSAPP_CLOUD_ACCESS_TOKEN: "local-dev-access-token",
  WHATSAPP_CLOUD_APP_SECRET: fakeAppSecret,
  WHATSAPP_CLOUD_WEBHOOK_HOST: "127.0.0.1",
  WHATSAPP_CLOUD_WEBHOOK_PORT: "0"
});

const createStdout = () => {
  let output = "";

  return {
    get output() {
      return output;
    },
    write(chunk: string) {
      output += chunk;
    }
  };
};

describe("whatsapp cloud loopback validation", () => {
  it("uses fake local Cloud values without real-looking credentials", () => {
    const example = readFileSync(path.join(repoRoot, ".env.example"), "utf8");

    expect(example).toContain("WHATSAPP_CLOUD_API_VERSION=v21.0");
    expect(example).toContain("WHATSAPP_CLOUD_PHONE_NUMBER_ID=000000000000000");
    expect(example).toContain("WHATSAPP_CLOUD_VERIFY_TOKEN=local-dev-verify-token");
    expect(example).toContain("WHATSAPP_CLOUD_ACCESS_TOKEN=local-dev-access-token");
    expect(example).toContain("WHATSAPP_CLOUD_APP_SECRET=local-dev-app-secret");
    expect(example).toContain("WHATSAPP_CLOUD_WEBHOOK_HOST=127.0.0.1");
    expect(example).not.toMatch(/\bEAA[A-Za-z0-9]{20,}\b/);
    expect(example).not.toMatch(/\b[1-9]\d{14,}\b/);
  });

  it("validates health, replay, signatures, and post-start without Meta calls", async () => {
    const persistenceService = createInMemoryPersistenceService();
    const graphPost = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const runtime = await startWhatsAppCloudRuntime({
      envSource: createFakeCloudEnv(),
      logger,
      persistenceService,
      businessPersistenceService:
        createBusinessPersistenceService(persistenceService),
      httpClient: {
        post: graphPost
      }
    });

    try {
      const address = runtime.getServerAddress();
      expect(address).toBeDefined();
      const port = address!.port;
      const baseUrl = `http://127.0.0.1:${port}`;
      const target = `${baseUrl}/webhooks/whatsapp/cloud`;

      for (const endpoint of ["/health", "/ready", "/status"]) {
        const response = await fetch(`${baseUrl}${endpoint}`);
        expect(response.status).toBe(200);
        const body = JSON.stringify(await response.json());
        expect(body).not.toContain(fakeAppSecret);
        expect(body).not.toContain("local-dev-access-token");
        expect(body).not.toContain("local-dev-verify-token");
      }

      const expectedReplays = [
        ["valid-text.json", 1, 0, 0, 0],
        ["unsupported-message.json", 0, 0, 1, 0],
        ["status-event.json", 0, 1, 0, 0],
        ["invalid-malformed.json", 0, 0, 0, 1]
      ] as const;

      for (const [
        fixture,
        normalizedTextMessageCount,
        statusEventCount,
        unsupportedMessageCount,
        exitCode
      ] of expectedReplays) {
        const stdout = createStdout();
        const summary = await runWhatsAppCloudWebhookReplay({
          args: ["--fixture", fixture, "--target", target],
          cwd: repoRoot,
          envSource: createFakeCloudEnv(),
          stdout
        });

        expect(summary.exitCode).toBe(exitCode);
        expect(summary.report.eventSummary).toMatchObject({
          normalizedTextMessageCount,
          statusEventCount,
          unsupportedMessageCount
        });
        expect(stdout.output).not.toContain("Synthetic webhook replay text.");
        expect(stdout.output).not.toContain(fakeAppSecret);
      }

      const signed = await runWhatsAppCloudWebhookReplay({
        args: ["--signed", "--fixture", "valid-text.json", "--target", target],
        cwd: repoRoot,
        envSource: createFakeCloudEnv(),
        stdout: createStdout()
      });
      expect(signed.exitCode).toBe(0);

      const wrongSignature = await runWhatsAppCloudWebhookReplay({
        args: ["--signed", "--fixture", "valid-text.json", "--target", target],
        cwd: repoRoot,
        envSource: {
          ...createFakeCloudEnv(),
          WHATSAPP_CLOUD_APP_SECRET: "local-dev-wrong-app-secret"
        },
        stdout: createStdout()
      });
      expect(wrongSignature.exitCode).toBe(1);
      expect(wrongSignature.report.response.statusCode).toBe(401);

      const postStart = await runOpsPostStartCommand({
        envSource: {
          ...createFakeCloudEnv(),
          WHATSAPP_CLOUD_WEBHOOK_PORT: String(port)
        },
        stdout: createStdout()
      });
      expect(postStart.exitCode).toBe(0);
      expect(postStart.report.diagnosis.code).toBe("app_ready");

      expect(graphPost).not.toHaveBeenCalled();
      const serializedLogs = JSON.stringify({
        debug: logger.debug.mock.calls,
        info: logger.info.mock.calls,
        warn: logger.warn.mock.calls,
        error: logger.error.mock.calls
      });
      expect(serializedLogs).not.toContain(fakeAppSecret);
      expect(serializedLogs).not.toContain("local-dev-access-token");
      expect(serializedLogs).not.toContain("Synthetic webhook replay text.");
    } finally {
      await runtime.stop("test_shutdown");
    }
  });
});
