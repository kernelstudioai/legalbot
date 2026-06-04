import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger";
import { startOpenWaSmokeApp } from "../../src/app/openwaSmoke";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

describe("openwa smoke startup", () => {
  it("logs sanitized startup diagnostics and passes the resolved OpenWA config", async () => {
    const logger = createLogger();
    const kill = vi.fn().mockResolvedValue(true);
    const createClient = vi.fn().mockResolvedValue({
      onMessage: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn(),
      kill
    });

    const app = await startOpenWaSmokeApp({
      envSource: {
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_BROWSER_EXECUTABLE_PATH:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        OPENWA_HEADLESS: "false",
        OPENWA_QR_TIMEOUT_SECONDS: "240",
        OPENWA_AUTH_TIMEOUT_SECONDS: "180",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "legalbot-smoke",
        headless: false,
        authTimeout: 180,
        qrTimeout: 240,
        browserExecutablePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        useChrome: true
      })
    );
    expect(logger.info).toHaveBeenCalledWith("openwa_smoke_preflight", {
      node_version: process.version,
      platform: process.platform,
      openwa_browser_executable_path_set: true,
      openwa_use_chrome: true,
      openwa_headless: false,
      session_id: "legalbot-smoke"
    });
    expect(logger.info).toHaveBeenCalledWith(
      "openwa_client_starting",
      expect.objectContaining({
        bot_mode: "smoke",
        session_id: "legalbot-smoke",
        session_data_path: "openwa-session",
        openwa_browser_executable_path_set: true,
        openwa_use_chrome: true,
        openwa_headless: false,
        openwa_qr_timeout_seconds: 240,
        openwa_auth_timeout_seconds: 180
      })
    );
    expect(logger.info).toHaveBeenCalledWith("openwa_client_ready", {
      bot_mode: "smoke",
      session_id: "legalbot-smoke",
      lawyer_phone_configured: true
    });

    await app.stop("test_shutdown");

    expect(kill).toHaveBeenCalledWith("test_shutdown");
  });
});
