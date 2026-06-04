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

export interface OpenWaRuntimeClient {
  onMessage(
    listener: (message: OpenWaRawMessage) => Promise<void> | void
  ): Promise<unknown>;
  sendText(to: string, body: string): Promise<unknown>;
  kill?(reason?: string): Promise<boolean>;
}
