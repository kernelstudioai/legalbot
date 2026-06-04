import type { DatabaseSync } from "node:sqlite";
import type {
  MarkProcessedMessageResult,
  ProcessedMessageRecord,
  ProcessedMessageStore
} from "../processedMessageStore.ts";

export class SqliteProcessedMessageStore implements ProcessedMessageStore {
  constructor(private readonly database: DatabaseSync) {}

  async has(messageId: string): Promise<boolean> {
    const row = this.database
      .prepare("SELECT 1 AS present FROM processed_messages WHERE message_id = ?")
      .get(messageId) as { present: number } | undefined;

    return row !== undefined;
  }

  async markProcessed(
    record: ProcessedMessageRecord
  ): Promise<MarkProcessedMessageResult> {
    const result = this.database
      .prepare(
        `
          INSERT INTO processed_messages (
            message_id,
            channel,
            sender_id,
            transport_chat_id,
            processed_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(message_id) DO NOTHING
        `
      )
      .run(
        record.messageId,
        record.channel,
        record.senderId,
        record.transportChatId,
        record.processedAt
      );

    return {
      inserted: result.changes > 0
    };
  }
}
