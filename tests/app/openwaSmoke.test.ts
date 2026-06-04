import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger";
import {
  installOpenWaSignalHandlers,
  startOpenWaSmokeApp,
  type SignalProcessLike
} from "../../src/app/openwaSmoke";

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
        OPENWA_STARTUP_MAX_ATTEMPTS: "2",
        OPENWA_STARTUP_RETRY_DELAY_SECONDS: "9",
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
      session_id: "legalbot-smoke",
      openwa_startup_max_attempts: 2,
      openwa_startup_retry_delay_seconds: 9
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
        openwa_auth_timeout_seconds: 180,
        openwa_startup_max_attempts: 2,
        openwa_startup_retry_delay_seconds: 9
      })
    );
    expect(logger.info).toHaveBeenCalledWith("openwa_supervisor_state_changed", {
      previous_state: "starting",
      state: "ready",
      startup_attempt: 1,
      startup_max_attempts: 2
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_supervisor_ready", {
      startup_attempt: 1,
      startup_max_attempts: 2
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_client_ready", {
      bot_mode: "smoke",
      session_id: "legalbot-smoke",
      lawyer_phone_configured: true
    });
    expect(app.getHealth()).toMatchObject({
      state: "ready",
      ready: true,
      startupAttempts: 1,
      startupMaxAttempts: 2,
      startupRetryDelaySeconds: 9,
      remainingStartupAttempts: 1,
      shutdownRequested: false,
      clientActive: true,
      listenerRegistered: true
    });

    await app.stop("test_shutdown");

    expect(logger.info).toHaveBeenCalledWith("openwa_shutdown_starting", {
      reason: "test_shutdown",
      client_cleanup_available: true
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_shutdown_complete", {
      reason: "test_shutdown",
      client_cleanup_available: true
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_supervisor_state_changed", {
      previous_state: "ready",
      state: "shutting_down",
      reason: "test_shutdown"
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_supervisor_state_changed", {
      previous_state: "shutting_down",
      state: "stopped",
      reason: "test_shutdown"
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_supervisor_stopped", {
      reason: "test_shutdown",
      client_cleanup_available: true,
      startup_attempts: 1
    });
    expect(kill).toHaveBeenCalledWith("test_shutdown");
  });

  it("installs signal handlers that trigger client cleanup when available", async () => {
    const logger = createLogger();
    const kill = vi.fn().mockResolvedValue(true);
    const createClient = vi.fn().mockResolvedValue({
      onMessage: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn(),
      kill
    });
    const listeners = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void>();
    const processLike: SignalProcessLike = {
      on: vi.fn((signal, listener) => {
        listeners.set(signal, listener);
      }),
      exit: vi.fn()
    };

    const app = await startOpenWaSmokeApp({
      envSource: {
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_HEADLESS: "false",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient
    });

    installOpenWaSignalHandlers(app, processLike);

    listeners.get("SIGTERM")?.("SIGTERM");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(processLike.exit).toHaveBeenCalledWith(0);
  });
});
