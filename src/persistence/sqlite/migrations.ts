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
        channel TEXT NOT NULL,
        client_phone_e164 TEXT NOT NULL,
        status TEXT NOT NULL,
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
  }
];
