import { loadEnv } from "../config/env";
import { consoleLogger } from "../logging/logger";
import { createNoopDispatcher } from "../transport/openwa/dispatcher";
import { handleOpenWaMessage } from "../transport/openwa/listener";
import type { OpenWaMessage } from "../transport/openwa/types";

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
