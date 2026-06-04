import type { Logger } from "../../logging/logger.ts";
import type { OpenWaDispatcher } from "./dispatcher.ts";
import type { OpenWaMessage, OpenWaRawMessage, OpenWaRuntimeClient } from "./types.ts";
import { runInboundPipeline } from "../../app/pipeline.ts";

export interface OpenWaListenerDependencies {
  dispatcher: OpenWaDispatcher;
  logger: Logger;
}

export const mapOpenWaMessage = (rawMessage: OpenWaRawMessage): OpenWaMessage => {
  const pushname = rawMessage.sender?.pushname ?? rawMessage.notifyName;

  return {
    id: rawMessage.id,
    from: rawMessage.from,
    chatId: rawMessage.chatId,
    body: rawMessage.body,
    ...(pushname
      ? {
          sender: {
            pushname
          }
        }
      : {}),
    fromMe: rawMessage.fromMe,
    timestamp: rawMessage.timestamp
  };
};

export const handleOpenWaMessage = async (
  rawMessage: OpenWaRawMessage,
  dependencies: OpenWaListenerDependencies
) => {
  dependencies.logger.info("openwa_message_received", {
    messageId: rawMessage.id,
    from: rawMessage.from,
    chatId: rawMessage.chatId,
    fromMe: rawMessage.fromMe
  });

  const pipelineResult = runInboundPipeline(mapOpenWaMessage(rawMessage));

  try {
    const dispatchResult = await dependencies.dispatcher.dispatch(pipelineResult.outputPlan);

    dependencies.logger.info("openwa_output_dispatched", {
      messageId: rawMessage.id,
      outputCount: pipelineResult.outputPlan.messages.length,
      dispatchedCount: dispatchResult.messageCount,
      unsupportedCount: dispatchResult.unsupportedCount
    });

    return {
      ...pipelineResult,
      dispatchResult
    };
  } catch (error) {
    dependencies.logger.error("openwa_dispatch_failed", {
      messageId: rawMessage.id,
      error: error instanceof Error ? error.message : "unknown_error"
    });

    throw error;
  }
};

export const registerOpenWaListener = async (
  client: Pick<OpenWaRuntimeClient, "onMessage">,
  dependencies: OpenWaListenerDependencies
) =>
  client.onMessage(async (rawMessage) => {
    await handleOpenWaMessage(rawMessage, dependencies);
  });
