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
}
