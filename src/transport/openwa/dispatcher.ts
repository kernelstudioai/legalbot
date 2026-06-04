import type { OutputPlanType } from "../../contracts";
import type { OpenWaDispatchResult } from "./types";

export interface OpenWaDispatcher {
  dispatch(plan: OutputPlanType): Promise<OpenWaDispatchResult>;
}

export const createNoopDispatcher = (): OpenWaDispatcher => ({
  async dispatch(plan) {
    return {
      delivered: plan.messages.length > 0,
      messageCount: plan.messages.length
    };
  }
});
