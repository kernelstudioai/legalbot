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

export interface OpenWaMessage {
  id: string;
  from: string;
  chatId: string;
  body: string;
  sender?: {
    pushname?: string;
  };
  fromMe: boolean;
  timestamp: number;
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
