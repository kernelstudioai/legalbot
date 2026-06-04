import type { Logger } from "../../logging/logger.ts";
import type { PipelineResult } from "../../app/pipeline.ts";
import type { OpenWaDispatcher } from "./dispatcher.ts";
import type {
  OpenWaDispatchResult,
  OpenWaMessage,
  OpenWaRawMessage,
  OpenWaRuntimeClient
} from "./types.ts";
import { runInboundPipeline } from "../../app/pipeline.ts";
import type { OpenWaTechnicalPersistence } from "../../runtime/openwa/technicalPersistence.ts";

export interface OpenWaListenerDependencies {
  dispatcher: OpenWaDispatcher;
  logger: Logger;
  processedMessageIds?: Set<string>;
  technicalPersistence?: OpenWaTechnicalPersistence;
  pipelineRunner?: (message: OpenWaMessage) => Promise<PipelineResult>;
}

export interface OpenWaHandledMessageResult {
  outcome: "ignored_from_self" | "ignored_duplicate" | "processed";
  pipelineResult?: PipelineResult;
  dispatchResult?: OpenWaDispatchResult;
  dispatchError?: string;
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
): Promise<OpenWaHandledMessageResult> => {
  const runTechnicalPersistence = async <T>(
    operation: string,
    task: () => Promise<T>,
    fallbackValue?: T
  ): Promise<T | undefined> => {
    try {
      return await task();
    } catch (error) {
      dependencies.logger.warn("openwa_technical_persistence_failed", {
        operation,
        messageId: rawMessage.id,
        error: error instanceof Error ? error.message : "unknown_error"
      });
      return fallbackValue;
    }
  };

  dependencies.logger.info("openwa_message_received", {
    messageId: rawMessage.id,
    from: rawMessage.from,
    chatId: rawMessage.chatId,
    fromMe: rawMessage.fromMe
  });
  await runTechnicalPersistence("record_message_received", async () =>
    dependencies.technicalPersistence?.recordMessageReceived(rawMessage)
  );

  if (rawMessage.fromMe) {
    dependencies.logger.info("openwa_message_ignored_from_self", {
      messageId: rawMessage.id,
      from: rawMessage.from,
      chatId: rawMessage.chatId
    });

    return {
      outcome: "ignored_from_self"
    };
  }

  if (dependencies.processedMessageIds?.has(rawMessage.id)) {
    dependencies.logger.info("openwa_message_ignored_duplicate", {
      messageId: rawMessage.id,
      from: rawMessage.from,
      chatId: rawMessage.chatId
    });
    await runTechnicalPersistence("record_duplicate_process_local", async () =>
      dependencies.technicalPersistence?.recordMessageIgnoredDuplicate(rawMessage, "process_local")
    );

    return {
      outcome: "ignored_duplicate"
    };
  }

  const alreadyProcessed = await runTechnicalPersistence(
    "check_message_processed",
    async () => dependencies.technicalPersistence?.isMessageProcessed(rawMessage.id),
    false
  );

  if (alreadyProcessed) {
    dependencies.logger.info("openwa_message_ignored_duplicate", {
      messageId: rawMessage.id,
      from: rawMessage.from,
      chatId: rawMessage.chatId
    });
    await runTechnicalPersistence("record_duplicate_persistent", async () =>
      dependencies.technicalPersistence?.recordMessageIgnoredDuplicate(rawMessage, "persistent")
    );

    return {
      outcome: "ignored_duplicate"
    };
  }

  dependencies.processedMessageIds?.add(rawMessage.id);

  const pipelineResult = await (dependencies.pipelineRunner ??
    ((message: OpenWaMessage) => runInboundPipeline(message)))(mapOpenWaMessage(rawMessage));

  try {
    const dispatchResult = await dependencies.dispatcher.dispatch(pipelineResult.outputPlan);

    dependencies.logger.info("openwa_output_dispatched", {
      messageId: rawMessage.id,
      outputCount: pipelineResult.outputPlan.messages.length,
      dispatchedCount: dispatchResult.messageCount,
      unsupportedCount: dispatchResult.unsupportedCount
    });
    await runTechnicalPersistence("mark_message_processed", async () =>
      dependencies.technicalPersistence?.markMessageProcessed(rawMessage)
    );
    await runTechnicalPersistence("record_output_dispatched", async () =>
      dependencies.technicalPersistence?.recordOutputDispatched(rawMessage, dispatchResult)
    );

    return {
      outcome: "processed",
      pipelineResult,
      dispatchResult
    };
  } catch (error) {
    dependencies.logger.error("openwa_dispatch_failed", {
      messageId: rawMessage.id,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    await runTechnicalPersistence("record_dispatch_failed", async () =>
      dependencies.technicalPersistence?.recordDispatchFailed(rawMessage, error)
    );

    return {
      outcome: "processed",
      pipelineResult,
      dispatchError: error instanceof Error ? error.message : "unknown_error"
    };
  }
};

export const registerOpenWaListener = async (
  client: Pick<OpenWaRuntimeClient, "onMessage">,
  dependencies: OpenWaListenerDependencies
) => {
  const processedMessageIds = dependencies.processedMessageIds ?? new Set<string>();

  return client.onMessage(async (rawMessage) => {
    await handleOpenWaMessage(rawMessage, {
      ...dependencies,
      processedMessageIds
    });
  });
};
