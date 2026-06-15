import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runWhatsAppCloudWebhookReplay } from "../../src/app/whatsappCloudWebhookReplay.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");

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

describe("whatsapp cloud webhook replay command", () => {
  it("accepts the documented fixture path and target arguments", async () => {
    const stdout = createStdout();
    const post = vi.fn().mockResolvedValue({
      ok: true,
      status: 200
    });

    const summary = await runWhatsAppCloudWebhookReplay({
      args: [
        "--fixture",
        "tests/fixtures/whatsapp-cloud/valid-text.json",
        "--target",
        "http://127.0.0.1:3002/webhooks/whatsapp/cloud"
      ],
      cwd: repoRoot,
      envSource: {
        NODE_ENV: "development"
      },
      httpClient: {
        post
      },
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(post).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/webhooks/whatsapp/cloud",
      expect.any(Object)
    );
    expect(stdout.output).not.toContain("Synthetic webhook replay text.");
  });

  it("prints sanitized help successfully without exposing environment values", async () => {
    const stdout = createStdout();
    const appSecret = "help-secret-must-not-print";
    const accessToken = "help-access-token-must-not-print";

    const summary = await runWhatsAppCloudWebhookReplay({
      args: ["--help"],
      cwd: repoRoot,
      envSource: {
        WHATSAPP_CLOUD_APP_SECRET: appSecret,
        WHATSAPP_CLOUD_ACCESS_TOKEN: accessToken,
        WHATSAPP_CLOUD_WEBHOOK_PORT: "3999"
      },
      httpClient: {
        post: vi.fn()
      },
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(stdout.output).toContain("Usage:");
    expect(stdout.output).toContain("--fixture <path>");
    expect(stdout.output).toContain("--target <loopback-http-url>");
    expect(stdout.output).not.toContain(appSecret);
    expect(stdout.output).not.toContain(accessToken);
    expect(stdout.output).not.toContain("3999");
  });

  it.each([
    ["valid-text.json", 1, 0, 0, false],
    ["unsupported-message.json", 0, 0, 1, false],
    ["status-event.json", 0, 1, 0, false],
    ["invalid-malformed.json", 0, 0, 0, true]
  ])(
    "loads and summarizes %s without printing raw fixture text",
    async (
      fixture,
      normalizedTextMessageCount,
      statusEventCount,
      unsupportedMessageCount,
      malformed
    ) => {
      const stdout = createStdout();
      const post = vi.fn().mockResolvedValue({
        ok: !malformed,
        status: malformed ? 400 : 200
      });

      const summary = await runWhatsAppCloudWebhookReplay({
        args: ["--fixture", fixture],
        cwd: repoRoot,
        envSource: {
          NODE_ENV: "development"
        },
        httpClient: {
          post
        },
        stdout
      });

      expect(summary.report.eventSummary).toEqual({
        malformed,
        normalizedTextMessageCount,
        statusEventCount,
        unsupportedMessageCount
      });
      expect(post).toHaveBeenCalledTimes(1);
      expect(stdout.output).not.toContain("Synthetic webhook replay text.");
      expect(stdout.output).not.toContain("12025550101");
      expect(stdout.output).not.toContain("Test Client");
    }
  );

  it("computes X-Hub-Signature-256 over the exact raw fixture body", async () => {
    const stdout = createStdout();
    const post = vi.fn().mockResolvedValue({
      ok: true,
      status: 200
    });
    const appSecret = "fake-app-secret-replay";
    const accessToken = "fake-access-token-replay";
    const verifyToken = "fake-verify-token-replay";
    const rawBody = readFileSync(
      path.join(repoRoot, "tests/fixtures/whatsapp-cloud/valid-text.json"),
      "utf8"
    );
    const expectedSignature = `sha256=${createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex")}`;

    await runWhatsAppCloudWebhookReplay({
      args: ["--fixture", "valid-text.json", "--signed"],
      cwd: repoRoot,
      envSource: {
        NODE_ENV: "development",
        WHATSAPP_CLOUD_APP_SECRET: appSecret,
        WHATSAPP_CLOUD_ACCESS_TOKEN: accessToken,
        WHATSAPP_CLOUD_VERIFY_TOKEN: verifyToken
      },
      httpClient: {
        post
      },
      stdout
    });

    const [, options] = post.mock.calls[0] as [
      string,
      {
        body: string;
        headers: Record<string, string>;
      }
    ];
    expect(options.body).toBe(rawBody);
    expect(options.headers["x-hub-signature-256"]).toBe(expectedSignature);
    expect(options.headers["x-legalbot-cloud-replay"]).toBe("1");
    expect(stdout.output).not.toContain(appSecret);
    expect(stdout.output).not.toContain(accessToken);
    expect(stdout.output).not.toContain(verifyToken);
    expect(stdout.output).not.toContain(rawBody);
  });

  it("allows unsigned replay only outside production", async () => {
    await expect(
      runWhatsAppCloudWebhookReplay({
        args: ["--fixture", "valid-text.json"],
        cwd: repoRoot,
        envSource: {
          NODE_ENV: "production"
        },
        httpClient: {
          post: vi.fn()
        }
      })
    ).rejects.toThrow("unsigned_replay_not_allowed_in_production");
  });

  it("fails signed replay clearly when the app secret is missing", async () => {
    await expect(
      runWhatsAppCloudWebhookReplay({
        args: ["--fixture", "valid-text.json", "--signed"],
        cwd: repoRoot,
        envSource: {
          NODE_ENV: "development"
        },
        httpClient: {
          post: vi.fn()
        }
      })
    ).rejects.toThrow("signed_replay_requires_app_secret");
  });

  it("rejects path traversal before posting or loading fixture content", async () => {
    const post = vi.fn();

    await expect(
      runWhatsAppCloudWebhookReplay({
        args: [
          "--fixture",
          "../.env",
          "--target",
          "http://127.0.0.1:3002/webhooks/whatsapp/cloud"
        ],
        cwd: repoRoot,
        envSource: {
          NODE_ENV: "development"
        },
        httpClient: {
          post
        }
      })
    ).rejects.toThrow("fixture_outside_safe_directory");

    expect(post).not.toHaveBeenCalled();
  });

  it("rejects non-loopback targets", async () => {
    const post = vi.fn();

    await expect(
      runWhatsAppCloudWebhookReplay({
        args: [
          "--fixture",
          "valid-text.json",
          "--target",
          "https://example.com/webhooks/whatsapp/cloud"
        ],
        cwd: repoRoot,
        envSource: {
          NODE_ENV: "development"
        },
        httpClient: {
          post
        }
      })
    ).rejects.toThrow("local_cloud_webhook_url_required");

    expect(post).not.toHaveBeenCalled();
  });

  it("returns a sanitized connection failure after accepting valid arguments", async () => {
    const stdout = createStdout();

    await expect(
      runWhatsAppCloudWebhookReplay({
        args: [
          "--fixture",
          "tests/fixtures/whatsapp-cloud/valid-text.json",
          "--target",
          "http://127.0.0.1:3002/webhooks/whatsapp/cloud"
        ],
        cwd: repoRoot,
        envSource: {
          NODE_ENV: "development"
        },
        httpClient: {
          post: vi.fn().mockRejectedValue(new Error("private connection detail"))
        },
        stdout
      })
    ).rejects.toThrow("replay_connection_failed");

    expect(stdout.output).not.toContain("private connection detail");
  });
});
