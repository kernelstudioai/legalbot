export interface ProcessedMessageRecord {
  messageId: string;
  channel: "whatsapp";
  senderId: string;
  transportChatId: string;
  processedAt: string;
}

export interface MarkProcessedMessageResult {
  inserted: boolean;
}

export interface ProcessedMessageStore {
  has(messageId: string): Promise<boolean>;
  markProcessed(record: ProcessedMessageRecord): Promise<MarkProcessedMessageResult>;
}
