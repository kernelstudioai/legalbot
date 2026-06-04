import { pathToFileURL } from "node:url";
import { loadSmokeRuntimeEnv, type SmokeRuntimeEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import {
  createOpenWaClient,
  createOpenWaConfig,
  toOpenWaStartupMeta,
  type OpenWaConfig
} from "../transport/openwa/client.ts";
import { createOpenWaDispatcher } from "../transport/openwa/dispatcher.ts";
import { registerOpenWaListener } from "../transport/openwa/listener.ts";
import type { OpenWaRuntimeClient } from "../transport/openwa/types.ts";

export interface OpenWaSmokeApp {
  env: SmokeRuntimeEnv;
  stop(reason?: string): Promise<void>;
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
    session_id: startupMeta.session_id
  });

  logger.info("openwa_client_starting", {
    bot_mode: env.BOT_MODE,
    ...startupMeta
  });

  const client = await createClient(config);
  const dispatcher = createOpenWaDispatcher(client);
  await registerOpenWaListener(client, {
    dispatcher,
    logger
  });

  logger.info("openwa_client_ready", {
    bot_mode: env.BOT_MODE,
    session_id: startupMeta.session_id,
    lawyer_phone_configured: env.LAWYER_PHONE_E164.length > 0
  });

  return {
    env,
    async stop(reason = "shutdown") {
      if (typeof client.kill === "function") {
        await client.kill(reason);
      }
    }
  };
};

const installSignalHandlers = (app: OpenWaSmokeApp): void => {
  let stopping = false;

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }

    stopping = true;
    void app.stop(signal).finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

const isDirectExecution = (): boolean => {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false;
};

const main = async (): Promise<void> => {
  const app = await startOpenWaSmokeApp();
  installSignalHandlers(app);
};

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    consoleLogger.error("openwa_smoke_startup_failed", {
      error: error instanceof Error ? error.message : "unknown_error"
    });
    process.exit(1);
  });
}
