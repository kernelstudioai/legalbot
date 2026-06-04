import type { OutputPlanType } from "../../contracts/index.ts";
import type { OpenWaDispatchResult, OpenWaRuntimeClient } from "./types.ts";

export interface OpenWaDispatcher {
  dispatch(plan: OutputPlanType): Promise<OpenWaDispatchResult>;
}

export const createOpenWaDispatcher = (
  client: Pick<OpenWaRuntimeClient, "sendText">
): OpenWaDispatcher => ({
  async dispatch(plan) {
    let messageCount = 0;
    let unsupportedCount = 0;

    for (const message of plan.messages as Array<{
      kind: string;
      to: string;
      body?: string;
    }>) {
      if (message.kind !== "text" || typeof message.body !== "string") {
        unsupportedCount += 1;
        continue;
      }

      await client.sendText(message.to, message.body);
      messageCount += 1;
    }

    return {
      delivered: messageCount > 0,
      messageCount,
      unsupportedCount
    };
  }
});

export const createNoopDispatcher = (): OpenWaDispatcher => ({
  async dispatch(plan) {
    return {
      delivered: plan.messages.length > 0,
      messageCount: plan.messages.length,
      unsupportedCount: 0
    };
  }
});
