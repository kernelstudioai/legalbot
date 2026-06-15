import type { TransportInboundMessage } from "../inboundMessage.ts";

export interface OpenWaRawMessage {
  id: string;
  from: string;
  chatId: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  notifyName?: string;
  sender?: {
    pushname?: string;
  };
}

export interface OpenWaMessage extends TransportInboundMessage {
  transport?: "openwa";
}

export interface OpenWaDispatchResult {
  delivered: boolean;
  messageCount: number;
  unsupportedCount: number;
}

export interface OpenWaLivenessCheckMeta {
  mode: "read_only" | "noop";
  connected?: boolean;
  connectionState?: string;
  warningCode?: string;
  warningMessage?: string;
}

export type OpenWaLivenessCheck = () => Promise<OpenWaLivenessCheckMeta>;

export interface OpenWaRuntimeClient {
  onMessage(
    listener: (message: OpenWaRawMessage) => Promise<void> | void
  ): Promise<unknown>;
  sendText(to: string, body: string): Promise<unknown>;
  checkLiveness?(): Promise<OpenWaLivenessCheckMeta>;
  kill?(reason?: string): Promise<boolean>;
}
