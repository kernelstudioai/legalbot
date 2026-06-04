import type { Logger } from "../../logging/logger";
import type { OpenWaDispatcher } from "./dispatcher";
import type { OpenWaMessage } from "./types";
import { runInboundPipeline } from "../../app/pipeline";

export interface OpenWaListenerDependencies {
  dispatcher: OpenWaDispatcher;
  logger: Logger;
}

export const handleOpenWaMessage = async (
  rawMessage: OpenWaMessage,
  dependencies: OpenWaListenerDependencies
) => {
  dependencies.logger.info("Received OpenWA message", {
    messageId: rawMessage.id
  });

  const pipelineResult = runInboundPipeline(rawMessage);
  const dispatchResult = await dependencies.dispatcher.dispatch(pipelineResult.outputPlan);

  dependencies.logger.info("Dispatched OpenWA output plan", {
    dispatchResult
  });

  return {
    ...pipelineResult,
    dispatchResult
  };
};
