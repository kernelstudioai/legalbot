import { pathToFileURL } from "node:url";
import { loadSmokeRuntimeEnv, type SmokeRuntimeEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import {
  createOpenWaClient,
  createOpenWaConfig,
  toOpenWaStartupMeta,
  type OpenWaConfig
} from "../transport/openwa/client.ts";
import {
  createOpenWaSupervisor,
  type OpenWaSupervisorHealth
} from "../transport/openwa/supervisor.ts";
import type { OpenWaRuntimeClient } from "../transport/openwa/types.ts";

export interface OpenWaSmokeApp {
  env: SmokeRuntimeEnv;
  getHealth(): OpenWaSupervisorHealth;
  stop(reason?: string): Promise<void>;
}

export interface SignalProcessLike {
  on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code?: number): void;
}

export interface StartOpenWaSmokeAppOptions {
  envSource?: NodeJS.ProcessEnv;
  logger?: Logger;
  createClient?: (config: OpenWaConfig) => Promise<OpenWaRuntimeClient>;
}

const createDefaultClient = async (
  config: OpenWaConfig
): Promise<OpenWaRuntimeClient> =>
  createOpenWaClient(config);

const createSmokeOpenWaConfig = (env: SmokeRuntimeEnv): OpenWaConfig =>
  createOpenWaConfig({
    sessionId: env.OPENWA_SESSION_ID,
    headless: env.OPENWA_HEADLESS,
    ...(env.OPENWA_AUTH_TIMEOUT_SECONDS !== undefined
      ? { authTimeout: env.OPENWA_AUTH_TIMEOUT_SECONDS }
      : {}),
    ...(env.OPENWA_QR_TIMEOUT_SECONDS !== undefined
      ? { qrTimeout: env.OPENWA_QR_TIMEOUT_SECONDS }
      : {}),
    ...(env.OPENWA_BROWSER_EXECUTABLE_PATH
      ? { browserExecutablePath: env.OPENWA_BROWSER_EXECUTABLE_PATH }
      : {})
  });

export const startOpenWaSmokeApp = async ({
  envSource = process.env,
  logger = consoleLogger,
  createClient = createDefaultClient
}: StartOpenWaSmokeAppOptions = {}): Promise<OpenWaSmokeApp> => {
  const env = loadSmokeRuntimeEnv(envSource);
  const config = createSmokeOpenWaConfig(env);
  const startupMeta = toOpenWaStartupMeta(config);

  logger.info("openwa_smoke_preflight", {
    node_version: process.version,
    platform: process.platform,
    openwa_browser_executable_path_set: startupMeta.openwa_browser_executable_path_set,
    openwa_use_chrome: startupMeta.openwa_use_chrome,
    openwa_headless: startupMeta.openwa_headless,
    session_id: startupMeta.session_id,
    openwa_startup_max_attempts: env.OPENWA_STARTUP_MAX_ATTEMPTS,
    openwa_startup_retry_delay_seconds: env.OPENWA_STARTUP_RETRY_DELAY_SECONDS
  });

  logger.info("openwa_client_starting", {
    bot_mode: env.BOT_MODE,
    ...startupMeta,
    openwa_startup_max_attempts: env.OPENWA_STARTUP_MAX_ATTEMPTS,
    openwa_startup_retry_delay_seconds: env.OPENWA_STARTUP_RETRY_DELAY_SECONDS
  });

  const supervisor = createOpenWaSupervisor({
    config,
    logger,
    createClient,
    startupMaxAttempts: env.OPENWA_STARTUP_MAX_ATTEMPTS,
    startupRetryDelaySeconds: env.OPENWA_STARTUP_RETRY_DELAY_SECONDS
  });
  const client = await supervisor.start();

  logger.info("openwa_client_ready", {
    bot_mode: env.BOT_MODE,
    session_id: startupMeta.session_id,
    lawyer_phone_configured: env.LAWYER_PHONE_E164.length > 0
  });

  let shutdownPromise: Promise<void> | undefined;
  const clientCleanupAvailable = typeof client.kill === "function";

  return {
    env,
    getHealth() {
      return supervisor.getHealth();
    },
    async stop(reason = "shutdown") {
      if (shutdownPromise) {
        return shutdownPromise;
      }

      shutdownPromise = (async () => {
        logger.info("openwa_shutdown_starting", {
          reason,
          client_cleanup_available: clientCleanupAvailable
        });

        try {
          await supervisor.stop(reason);

          logger.info("openwa_shutdown_complete", {
            reason,
            client_cleanup_available: clientCleanupAvailable
          });
        } catch (error) {
          logger.error("openwa_shutdown_failed", {
            reason,
            client_cleanup_available: clientCleanupAvailable,
            error: error instanceof Error ? error.message : "unknown_error"
          });

          throw error;
        }
      })();

      return shutdownPromise;
    }
  };
};

export const installOpenWaSignalHandlers = (
  app: OpenWaSmokeApp,
  processLike: SignalProcessLike = process
): void => {
  let stopping = false;

  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }

    stopping = true;
    try {
      await app.stop(signal);
      processLike.exit(0);
    } catch {
      processLike.exit(1);
    }
  };

  processLike.on("SIGINT", (signal) => {
    void stop(signal);
  });
  processLike.on("SIGTERM", (signal) => {
    void stop(signal);
  });
};

const isDirectExecution = (): boolean => {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false;
};

const main = async (): Promise<void> => {
  const app = await startOpenWaSmokeApp();
  installOpenWaSignalHandlers(app);
};

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    consoleLogger.error("openwa_smoke_startup_failed", {
      error: error instanceof Error ? error.message : "unknown_error"
    });
    process.exit(1);
  });
}
