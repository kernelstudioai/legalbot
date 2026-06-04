export interface AuditEventRecord {
  eventId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogStore {
  append(event: AuditEventRecord): Promise<void>;
}
