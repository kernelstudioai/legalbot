import type { DatabaseSync } from "node:sqlite";
import type {
  IntakeEventRecord,
  IntakeFieldName,
  IntakeFieldRecord,
  IntakeSnapshot,
  IntakeState,
  IntakeStateRecord,
  IntakeStore,
  SetIntakeFieldOptions,
  SetIntakeStateOptions
} from "../intakeStore.ts";

const acceptedIntakeFields = new Set<IntakeFieldName>([
  "firstName",
  "lastName",
  "birthDate",
  "city",
  "problemSummary"
]);

const mapStateRow = (row: {
  subject_id: string;
  intake_state: IntakeState;
  updated_at: string;
  metadata_json: string | null;
}): IntakeStateRecord => ({
  subjectId: row.subject_id,
  state: row.intake_state,
  updatedAt: row.updated_at,
  ...(row.metadata_json ? { metadata: JSON.parse(row.metadata_json) as Record<string, unknown> } : {})
});

export class SqliteIntakeStore implements IntakeStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  async getIntakeState(subjectId: string): Promise<IntakeState> {
    const row = this.database
      .prepare(
        `
          SELECT intake_state
          FROM intake_states
          WHERE subject_id = ?
        `
      )
      .get(subjectId) as { intake_state: IntakeState } | undefined;

    return row?.intake_state ?? "not_started";
  }

  async setIntakeState(
    subjectId: string,
    state: IntakeState,
    options: SetIntakeStateOptions = {}
  ): Promise<IntakeStateRecord> {
    const record: IntakeStateRecord = {
      subjectId,
      state,
      updatedAt: options.updatedAt ?? new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {})
    };

    this.database
      .prepare(
        `
          INSERT INTO intake_states (
            subject_id,
            intake_state,
            updated_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(subject_id) DO UPDATE SET
            intake_state = excluded.intake_state,
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

  async setIntakeField(
    subjectId: string,
    fieldName: IntakeFieldName,
    value: string,
    options: SetIntakeFieldOptions = {}
  ): Promise<IntakeFieldRecord> {
    if (!acceptedIntakeFields.has(fieldName)) {
      throw new Error(`Unsupported intake field: ${fieldName}`);
    }

    const record: IntakeFieldRecord = {
      subjectId,
      fieldName,
      value,
      updatedAt: options.updatedAt ?? new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {})
    };

    this.database
      .prepare(
        `
          INSERT INTO intake_fields (
            subject_id,
            field_name,
            field_value,
            updated_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(subject_id, field_name) DO UPDATE SET
            field_value = excluded.field_value,
            updated_at = excluded.updated_at,
            metadata_json = excluded.metadata_json
        `
      )
      .run(
        record.subjectId,
        record.fieldName,
        record.value,
        record.updatedAt,
        record.metadata ? JSON.stringify(record.metadata) : null
      );

    return record;
  }

  async getIntakeSnapshot(subjectId: string): Promise<IntakeSnapshot | null> {
    const stateRow = this.database
      .prepare(
        `
          SELECT subject_id, intake_state, updated_at, metadata_json
          FROM intake_states
          WHERE subject_id = ?
        `
      )
      .get(subjectId) as
      | {
          subject_id: string;
          intake_state: IntakeState;
          updated_at: string;
          metadata_json: string | null;
        }
      | undefined;
    const fieldRows = this.database
      .prepare(
        `
          SELECT field_name, field_value
          FROM intake_fields
          WHERE subject_id = ?
        `
      )
      .all(subjectId) as Array<{
      field_name: IntakeFieldName;
      field_value: string;
    }>;

    if (!stateRow && fieldRows.length === 0) {
      return null;
    }

    return {
      subjectId,
      state: stateRow?.intake_state ?? "not_started",
      updatedAt: stateRow?.updated_at ?? new Date().toISOString(),
      fields: Object.fromEntries(fieldRows.map((row) => [row.field_name, row.field_value]))
    };
  }

  async appendIntakeEvent(event: IntakeEventRecord): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO intake_events (
            event_id,
            subject_id,
            event_type,
            intake_state,
            field_name,
            occurred_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.eventId,
        event.subjectId,
        event.eventType,
        event.state ?? null,
        event.fieldName ?? null,
        event.occurredAt,
        event.metadata ? JSON.stringify(event.metadata) : null
      );
  }

  async getIntakeStateRecord(subjectId: string): Promise<IntakeStateRecord | null> {
    const row = this.database
      .prepare(
        `
          SELECT subject_id, intake_state, updated_at, metadata_json
          FROM intake_states
          WHERE subject_id = ?
        `
      )
      .get(subjectId) as
      | {
          subject_id: string;
          intake_state: IntakeState;
          updated_at: string;
          metadata_json: string | null;
        }
      | undefined;

    return row ? mapStateRow(row) : null;
  }
}
