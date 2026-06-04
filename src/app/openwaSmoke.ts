import { pathToFileURL } from "node:url";
import { loadSmokeRuntimeEnv, type SmokeRuntimeEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import { createOpenWaClient, createOpenWaConfig } from "../transport/openwa/client.ts";
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
  createClient?: (env: SmokeRuntimeEnv) => Promise<OpenWaRuntimeClient>;
}

const createDefaultClient = async (
  env: SmokeRuntimeEnv
): Promise<OpenWaRuntimeClient> =>
  createOpenWaClient(
    createOpenWaConfig({
      sessionId: env.OPENWA_SESSION_ID,
      ...(env.OPENWA_BROWSER_EXECUTABLE_PATH
        ? { browserExecutablePath: env.OPENWA_BROWSER_EXECUTABLE_PATH }
        : {})
    })
  );

export const startOpenWaSmokeApp = async ({
  envSource = process.env,
  logger = consoleLogger,
  createClient = createDefaultClient
}: StartOpenWaSmokeAppOptions = {}): Promise<OpenWaSmokeApp> => {
  const env = loadSmokeRuntimeEnv(envSource);

  logger.info("openwa_client_starting", {
    botMode: env.BOT_MODE,
    sessionId: env.OPENWA_SESSION_ID
  });

  const client = await createClient(env);
  const dispatcher = createOpenWaDispatcher(client);
  await registerOpenWaListener(client, {
    dispatcher,
    logger
  });

  logger.info("openwa_client_ready", {
    botMode: env.BOT_MODE,
    sessionId: env.OPENWA_SESSION_ID,
    lawyerPhone: env.LAWYER_PHONE_E164
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
    consoleLogger.error("openwa_dispatch_failed", {
      error: error instanceof Error ? error.message : "unknown_error"
    });
    process.exit(1);
  });
}
