import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { Logger } from "../../src/logging/logger";
import {
  createInMemoryPersistenceService,
  type PersistenceService
} from "../../src/persistence";
import type { OpenWaStatusServer } from "../../src/app/openwaStatusServer";
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

const createPersistenceService = (): PersistenceService => ({
  runInTransaction: async (operation) => operation(),
  isMessageProcessed: vi.fn().mockResolvedValue(false),
  markMessageProcessed: vi.fn().mockResolvedValue({
    inserted: true,
    record: {
      messageId: "wamid.test-1",
      channel: "whatsapp",
      senderId: "[redacted-phone]",
      transportChatId: "[redacted-phone]",
      processedAt: "2026-06-04T12:00:00.000Z"
    }
  }),
  appendAuditEvent: vi.fn().mockImplementation(async (event) => ({
    eventId: event.eventId,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId,
    occurredAt: event.occurredAt ?? "2026-06-04T12:00:00.000Z",
    ...(event.metadata ? { metadata: event.metadata } : {})
  })),
  getConsentState: vi.fn().mockResolvedValue("unknown"),
  setConsentState: vi.fn().mockResolvedValue({
    record: {
      subjectId: "subject-1",
      state: "unknown",
      updatedAt: "2026-06-04T12:00:00.000Z"
    }
  }),
  appendConsentEvent: vi.fn().mockImplementation(async (event) => ({
    eventId: event.eventId,
    subjectId: event.subjectId,
    state: event.state,
    eventType: event.eventType,
    occurredAt: event.occurredAt ?? "2026-06-04T12:00:00.000Z",
    ...(event.metadata ? { metadata: event.metadata } : {})
  })),
  getIntakeState: vi.fn().mockResolvedValue("not_started"),
  setIntakeState: vi.fn().mockImplementation(async (subjectId, state, metadata) => ({
    record: {
      subjectId,
      state,
      updatedAt: metadata?.updatedAt ?? "2026-06-04T12:00:00.000Z"
    }
  })),
  setIntakeField: vi.fn().mockImplementation(async (subjectId, fieldName, value, metadata) => ({
    record: {
      subjectId,
      fieldName,
      value,
      updatedAt: metadata?.updatedAt ?? "2026-06-04T12:00:00.000Z"
    }
  })),
  getIntakeSnapshot: vi.fn().mockResolvedValue(null),
  appendIntakeEvent: vi.fn().mockImplementation(async (event) => ({
    eventId: event.eventId,
    subjectId: event.subjectId,
    eventType: event.eventType,
    occurredAt: event.occurredAt ?? "2026-06-04T12:00:00.000Z",
    ...(event.state ? { state: event.state } : {}),
    ...(event.fieldName ? { fieldName: event.fieldName } : {}),
    ...(event.metadata ? { metadata: event.metadata } : {})
  })),
  createCase: vi.fn(),
  createCaseWithAudit: vi.fn(),
  findDraftCaseBySubjectId: vi.fn().mockResolvedValue(null),
  getCase: vi.fn(),
  updateCaseStatus: vi.fn(),
  allocatePracticeCode: vi.fn().mockResolvedValue("AA001"),
  createPractice: vi.fn(),
  findPracticeByCode: vi.fn().mockResolvedValue(null),
  findPracticeBySourceMessageId: vi.fn().mockResolvedValue(null),
  listPractices: vi.fn().mockResolvedValue([])
});

describe("openwa smoke startup", () => {
  it("enables the status server by default for product-like runs", async () => {
    const logger = createLogger();
    const persistenceService = createPersistenceService();
    const createClient = vi.fn().mockResolvedValue({
      onMessage: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn(),
      kill: vi.fn().mockResolvedValue(true)
    });

    const app = await startOpenWaSmokeApp({
      envSource: {
        OPENWA_HEADLESS: "false",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient,
      persistenceService,
      startStatusServer: async ({ config, logger: statusLogger }) => {
        statusLogger.info("openwa_status_server_starting", {
          host: config.host,
          port: config.port
        });
        statusLogger.info("openwa_status_server_ready", {
          host: config.host,
          port: 3001
        });

        return {
          enabled: true,
          address: {
            host: config.host,
            port: 3001
          },
          stop: vi.fn().mockResolvedValue(undefined)
        };
      }
    });

    expect(app.env.BOT_MODE).toBe("smoke");
    expect(app.env.OPENWA_SESSION_ID).toBe("legalbot-smoke");
    expect(app.env.TECHNICAL_PERSISTENCE_ENABLED).toBe(true);
    expect(app.getStatusServerAddress()).toEqual({
      host: "127.0.0.1",
      port: 3001
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_status_server_ready", {
      host: "127.0.0.1",
      port: 3001
    });

    await app.stop("test_shutdown");
  });

  it("logs sanitized startup diagnostics and passes the resolved OpenWA config", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
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
        OPENWA_LIVENESS_INTERVAL_SECONDS: "45",
        OPENWA_LIVENESS_FAILURE_THRESHOLD: "4",
        OPENWA_RECOVERY_MODE: "restart_client",
        OPENWA_RECOVERY_MAX_ATTEMPTS: "2",
        OPENWA_RECOVERY_RETRY_DELAY_SECONDS: "11",
        OPENWA_STATUS_SERVER_ENABLED: "true",
        OPENWA_STATUS_SERVER_HOST: "127.0.0.1",
        OPENWA_STATUS_SERVER_PORT: "0",
        TECHNICAL_PERSISTENCE_ENABLED: "false",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient,
      persistenceService,
      startStatusServer: async ({ config, logger: statusLogger }) => {
        statusLogger.info("openwa_status_server_starting", {
          host: config.host,
          port: config.port
        });
        statusLogger.info("openwa_status_server_ready", {
          host: config.host,
          port: 4012
        });

        return {
          enabled: true,
          address: {
            host: config.host,
            port: 4012
          },
          stop: vi.fn().mockImplementation(async () => {
            statusLogger.info("openwa_status_server_stopped", {
              host: config.host,
              port: 4012
            });
          })
        };
      }
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
      openwa_liveness_interval_seconds: 45,
      openwa_liveness_failure_threshold: 4,
      openwa_recovery_mode: "restart_client",
      openwa_recovery_max_attempts: 2,
      openwa_recovery_retry_delay_seconds: 11,
      openwa_startup_max_attempts: 2,
      openwa_startup_retry_delay_seconds: 9,
      business_persistence_enabled: true,
      technical_persistence_enabled: false
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
        openwa_liveness_interval_seconds: 45,
        openwa_liveness_failure_threshold: 4,
        openwa_recovery_mode: "restart_client",
        openwa_recovery_max_attempts: 2,
        openwa_recovery_retry_delay_seconds: 11,
        openwa_startup_max_attempts: 2,
        openwa_startup_retry_delay_seconds: 9,
        business_persistence_enabled: true,
        technical_persistence_enabled: false
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
    expect(logger.info).toHaveBeenCalledWith("openwa_status_server_starting", {
      host: "127.0.0.1",
      port: 0
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_status_server_ready", {
      host: "127.0.0.1",
      port: expect.any(Number)
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_client_ready", {
      bot_mode: "smoke",
      session_id: "legalbot-smoke",
      lawyer_phone_configured: true
    });
    expect(app.getStatusServerAddress()).toEqual({
      host: "127.0.0.1",
      port: 4012
    });
    expect(app.getHealth()).toMatchObject({
      state: "ready",
      ready: true,
      startupAttempt: 1,
      startupAttempts: 1,
      startupMaxAttempts: 2,
      startupRetryDelaySeconds: 9,
      remainingStartupAttempts: 1,
      shutdownRequested: false,
      clientActive: true,
      listenerRegistered: true,
      livenessEnabled: true,
      livenessIntervalSeconds: 45,
      livenessFailureThreshold: 4,
      livenessFailureCount: 0,
      recoveryMode: "restart_client",
      recoveryAttempt: 0,
      recoveryMaxAttempts: 2,
      recoveryInProgress: false,
      recoveryRetryDelaySeconds: 11
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
    expect(logger.info).toHaveBeenCalledWith("openwa_status_server_stopped", {
      host: "127.0.0.1",
      port: 4012
    });
    expect(kill).toHaveBeenCalledWith("test_shutdown");
  });

  it("uses the shared persistence service for the live consent and intake flow", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
    const sendText = vi.fn().mockResolvedValue(undefined);
    let onMessageListener:
      | ((message: {
          id: string;
          from: string;
          chatId: string;
          body: string;
          fromMe: boolean;
          timestamp: number;
          notifyName?: string;
        }) => Promise<void> | void)
      | undefined;
    const createClient = vi.fn().mockResolvedValue({
      onMessage: vi.fn().mockImplementation(async (listener) => {
        onMessageListener = listener;
      }),
      sendText,
      kill: vi.fn().mockResolvedValue(true)
    });

    const app = await startOpenWaSmokeApp({
      envSource: {
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_HEADLESS: "false",
        OPENWA_STATUS_SERVER_ENABLED: "false",
        TECHNICAL_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient,
      persistenceService
    });

    const createMessage = (id: string, body: string) => ({
      id,
      from: "15551239999@c.us",
      chatId: "15551239999@c.us",
      body,
      fromMe: false,
      timestamp: Date.parse("2026-06-09T09:00:00.000Z"),
      notifyName: "Client"
    });

    await onMessageListener?.(createMessage("wamid.live-1", "ciao"));
    await onMessageListener?.(createMessage("wamid.live-2", "Acconsento"));
    await onMessageListener?.(createMessage("wamid.live-3", "Mario barone roma 01 01 1976"));

    expect(sendText).toHaveBeenNthCalledWith(
      1,
      "15551239999@c.us",
      expect.stringContaining("- Acconsento")
    );
    expect(sendText).toHaveBeenNthCalledWith(
      2,
      "15551239999@c.us",
      expect.stringContaining("Per iniziare")
    );
    expect(sendText).toHaveBeenNthCalledWith(
      3,
      "15551239999@c.us",
      "La ringrazio. Descriva brevemente il problema per cui desidera assistenza."
    );

    await app.stop("test_shutdown");
  });

  it("installs signal handlers that trigger client cleanup when available", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
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
        OPENWA_LIVENESS_INTERVAL_SECONDS: "30",
        OPENWA_LIVENESS_FAILURE_THRESHOLD: "3",
        OPENWA_RECOVERY_MODE: "manual",
        OPENWA_STATUS_SERVER_ENABLED: "false",
        TECHNICAL_PERSISTENCE_ENABLED: "false",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient,
      persistenceService
    });

    installOpenWaSignalHandlers(app, processLike);

    listeners.get("SIGTERM")?.("SIGTERM");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(processLike.exit).toHaveBeenCalledWith(0);
  });

  it("does not start WhatsApp when the enabled status server cannot bind", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
    const createClient = vi.fn();

    await expect(
      startOpenWaSmokeApp({
        envSource: {
          BOT_MODE: "smoke",
          OPENWA_SESSION_ID: "legalbot-smoke",
          OPENWA_HEADLESS: "false",
          OPENWA_LIVENESS_INTERVAL_SECONDS: "30",
          OPENWA_LIVENESS_FAILURE_THRESHOLD: "3",
          OPENWA_RECOVERY_MODE: "manual",
          OPENWA_STATUS_SERVER_ENABLED: "true",
          OPENWA_STATUS_SERVER_HOST: "127.0.0.1",
          OPENWA_STATUS_SERVER_PORT: "3001",
          TECHNICAL_PERSISTENCE_ENABLED: "false",
          LAWYER_PHONE_E164: "+15551234567"
        },
        logger,
        createClient,
        persistenceService,
        startStatusServer: async ({ config, logger: statusLogger }) => {
          statusLogger.info("openwa_status_server_starting", {
            host: config.host,
            port: config.port
          });
          statusLogger.error("openwa_status_server_failed", {
            host: config.host,
            port: config.port,
            error: "listen EPERM: operation not permitted 127.0.0.1"
          });
          throw new Error("listen EPERM: operation not permitted 127.0.0.1");
        }
      })
    ).rejects.toThrow("listen EPERM: operation not permitted 127.0.0.1");

    expect(createClient).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("openwa_status_server_failed", {
      host: "127.0.0.1",
      port: 3001,
      error: "listen EPERM: operation not permitted 127.0.0.1"
    });
  });

  it("does not open sqlite persistence when technical persistence is disabled", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
    const createClient = vi.fn().mockResolvedValue({
      onMessage: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn(),
      kill: vi.fn().mockResolvedValue(true)
    });
    const createSqlitePersistence = vi.fn();

    const app = await startOpenWaSmokeApp({
      envSource: {
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_HEADLESS: "false",
        OPENWA_STATUS_SERVER_ENABLED: "false",
        TECHNICAL_PERSISTENCE_ENABLED: "false",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient,
      persistenceService,
      createSqlitePersistence
    });

    expect(createSqlitePersistence).not.toHaveBeenCalled();

    await app.stop("test_shutdown");
  });

  it("fails safely when technical persistence is enabled before migrations are applied", async () => {
    const logger = createLogger();
    const createClient = vi.fn();

    await expect(
      startOpenWaSmokeApp({
        cwd: "C:\\Users\\Jacopo\\Documents\\legalbot",
        envSource: {
          BOT_MODE: "smoke",
          OPENWA_SESSION_ID: "legalbot-smoke",
          OPENWA_HEADLESS: "false",
          TECHNICAL_PERSISTENCE_ENABLED: "true",
          DATABASE_URL: "file:./tmp/non-existent-runtime.sqlite",
          LAWYER_PHONE_E164: "+15551234567"
        },
        logger,
        createClient
      })
    ).rejects.toThrow(
      "Technical persistence requires an existing migrated SQLite database. Run npm run db:migrate before enabling TECHNICAL_PERSISTENCE_ENABLED."
    );

    expect(createClient).not.toHaveBeenCalled();
  });

  it("fails safely before startup when business persistence is disabled", async () => {
    const logger = createLogger();
    const createClient = vi.fn();

    await expect(
      startOpenWaSmokeApp({
        envSource: {
          BOT_MODE: "smoke",
          OPENWA_SESSION_ID: "legalbot-smoke",
          OPENWA_HEADLESS: "false",
          BUSINESS_PERSISTENCE_ENABLED: "false",
          TECHNICAL_PERSISTENCE_ENABLED: "false",
          LAWYER_PHONE_E164: "+15551234567"
        },
        logger,
        createClient
      })
    ).rejects.toThrow(
      "Business persistence is required for live client intake. Enable BUSINESS_PERSISTENCE_ENABLED before starting the OpenWA runtime."
    );

    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses an injected persistence service when technical persistence is enabled", async () => {
    const logger = createLogger();
    const persistenceService = createPersistenceService();
    const createClient = vi.fn().mockResolvedValue({
      onMessage: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn(),
      kill: vi.fn().mockResolvedValue(true)
    });
    const createSqlitePersistence = vi.fn();

    const app = await startOpenWaSmokeApp({
      envSource: {
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_HEADLESS: "false",
        OPENWA_STATUS_SERVER_ENABLED: "false",
        TECHNICAL_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567"
      },
      logger,
      createClient,
      persistenceService,
      createSqlitePersistence
    });

    expect(createSqlitePersistence).not.toHaveBeenCalled();
    expect(persistenceService.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "openwa_runtime_started",
        entityId: "legalbot-smoke"
      })
    );

    await app.stop("test_shutdown");

    expect(persistenceService.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "openwa_runtime_stopped",
        entityId: "legalbot-smoke",
        metadata: expect.objectContaining({
          reason: "test_shutdown",
          sessionId: "legalbot-smoke"
        })
      })
    );
  });
});
