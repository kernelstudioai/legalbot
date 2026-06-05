export interface SqliteMigration {
  id: string;
  sql: string;
}

export const sqliteMigrations: SqliteMigration[] = [
  {
    id: "0001_create_cases",
    sql: `
      CREATE TABLE IF NOT EXISTS cases (
        case_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        status TEXT NOT NULL,
        name TEXT NOT NULL,
        problem_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    id: "0002_create_processed_messages",
    sql: `
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        transport_chat_id TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );
    `
  },
  {
    id: "0003_create_audit_events",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `
  },
  {
    id: "0004_create_consent_states",
    sql: `
      CREATE TABLE IF NOT EXISTS consent_states (
        subject_id TEXT PRIMARY KEY,
        consent_state TEXT NOT NULL CHECK (consent_state IN ('unknown', 'requested', 'granted', 'denied')),
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `
  },
  {
    id: "0005_create_consent_events",
    sql: `
      CREATE TABLE IF NOT EXISTS consent_events (
        event_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        consent_state TEXT NOT NULL CHECK (consent_state IN ('unknown', 'requested', 'granted', 'denied')),
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `
  },
  {
    id: "0006_create_intake_states",
    sql: `
      CREATE TABLE IF NOT EXISTS intake_states (
        subject_id TEXT PRIMARY KEY,
        intake_state TEXT NOT NULL CHECK (intake_state IN ('not_started', 'asking_name', 'asking_problem_summary', 'intake_complete')),
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `
  },
  {
    id: "0007_create_intake_fields",
    sql: `
      CREATE TABLE IF NOT EXISTS intake_fields (
        subject_id TEXT NOT NULL,
        field_name TEXT NOT NULL CHECK (field_name IN ('name', 'problemSummary')),
        field_value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (subject_id, field_name)
      );
    `
  },
  {
    id: "0008_create_intake_events",
    sql: `
      CREATE TABLE IF NOT EXISTS intake_events (
        event_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        intake_state TEXT CHECK (intake_state IN ('not_started', 'asking_name', 'asking_problem_summary', 'intake_complete')),
        field_name TEXT CHECK (field_name IN ('name', 'problemSummary')),
        occurred_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `
  }
];
