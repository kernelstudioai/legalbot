import { loadEnv } from "../config/env.ts";
import { consoleLogger } from "../logging/logger.ts";
import { createNoopDispatcher } from "../transport/openwa/dispatcher.ts";
import { handleOpenWaMessage } from "../transport/openwa/listener.ts";
import type { OpenWaMessage } from "../transport/openwa/types.ts";

export const bootstrapApplication = () => {
  const env = loadEnv();
  const dispatcher = createNoopDispatcher();
  const logger = consoleLogger;

  return {
    env,
    async processMockMessage(message: OpenWaMessage) {
      return handleOpenWaMessage(message, {
        dispatcher,
        logger
      });
    }
  };
};
