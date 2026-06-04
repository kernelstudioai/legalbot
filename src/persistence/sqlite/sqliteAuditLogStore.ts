import type { DatabaseSync } from "node:sqlite";
import type { AuditEventRecord, AuditLogStore } from "../auditLogStore.ts";

export class SqliteAuditLogStore implements AuditLogStore {
  constructor(private readonly database: DatabaseSync) {}

  async append(event: AuditEventRecord): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO audit_events (
            event_id,
            event_type,
            entity_type,
            entity_id,
            occurred_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.eventId,
        event.eventType,
        event.entityType,
        event.entityId,
        event.occurredAt,
        event.metadata ? JSON.stringify(event.metadata) : null
      );
  }
}
