import type { ClientConsentPersistence } from "../runtime/client/clientRuntime.ts";
import { loadEnv } from "../config/env.ts";
import { consoleLogger } from "../logging/logger.ts";
import { createNoopDispatcher } from "../transport/openwa/dispatcher.ts";
import { handleOpenWaMessage } from "../transport/openwa/listener.ts";
import type { OpenWaMessage } from "../transport/openwa/types.ts";
import { runInboundPipeline } from "./pipeline.ts";

export interface BootstrapApplicationOptions {
  clientConsentPersistence?: ClientConsentPersistence;
}

export const bootstrapApplication = ({
  clientConsentPersistence
}: BootstrapApplicationOptions = {}) => {
  const env = loadEnv();
  const dispatcher = createNoopDispatcher();
  const logger = consoleLogger;

  return {
    env,
    async processMockMessage(message: OpenWaMessage) {
      return handleOpenWaMessage(message, {
        dispatcher,
        logger,
        pipelineRunner: (pipelineMessage) =>
          runInboundPipeline(pipelineMessage, {
            ...(clientConsentPersistence
              ? {
                  clientConsentPersistence
                }
              : {})
          })
      });
    }
  };
};
