import type { DatabaseSync } from "node:sqlite";
import type {
  ConsentEventRecord,
  ConsentState,
  ConsentStateRecord,
  ConsentStore,
  SetConsentStateOptions
} from "../consentStore.ts";

const mapConsentStateRow = (row: {
  subject_id: string;
  consent_state: ConsentState;
  updated_at: string;
  metadata_json: string | null;
}): ConsentStateRecord => ({
  subjectId: row.subject_id,
  state: row.consent_state,
  updatedAt: row.updated_at,
  ...(row.metadata_json ? { metadata: JSON.parse(row.metadata_json) as Record<string, unknown> } : {})
});

export class SqliteConsentStore implements ConsentStore {
  constructor(private readonly database: DatabaseSync) {}

  async getConsentState(subjectId: string): Promise<ConsentState> {
    const row = this.database
      .prepare(
        `
          SELECT consent_state
          FROM consent_states
          WHERE subject_id = ?
        `
      )
      .get(subjectId) as { consent_state: ConsentState } | undefined;

    return row?.consent_state ?? "unknown";
  }

  async setConsentState(
    subjectId: string,
    state: ConsentState,
    options: SetConsentStateOptions = {}
  ): Promise<ConsentStateRecord> {
    const record: ConsentStateRecord = {
      subjectId,
      state,
      updatedAt: options.updatedAt ?? new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {})
    };

    this.database
      .prepare(
        `
          INSERT INTO consent_states (
            subject_id,
            consent_state,
            updated_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(subject_id) DO UPDATE SET
            consent_state = excluded.consent_state,
            updated_at = excluded.updated_at,
            metadata_json = excluded.metadata_json
        `
      )
      .run(
        record.subjectId,
        record.state,
        record.updatedAt,
        record.metadata ? JSON.stringify(record.metadata) : null
      );

    return record;
  }

  async appendConsentEvent(event: ConsentEventRecord): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO consent_events (
            event_id,
            subject_id,
            consent_state,
            event_type,
            occurred_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.eventId,
        event.subjectId,
        event.state,
        event.eventType,
        event.occurredAt,
        event.metadata ? JSON.stringify(event.metadata) : null
      );
  }
}
