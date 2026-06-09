import type { DatabaseSync } from "node:sqlite";

export interface SqliteMigration {
  id: string;
  sql?: string;
  run?: (database: DatabaseSync) => void;
}

const requiredCaseColumns = [
  "case_id",
  "subject_id",
  "status",
  "name",
  "problem_summary",
  "created_at",
  "updated_at"
] as const;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const createCasesTableSql = (tableName: string): string => `
  CREATE TABLE ${quoteIdentifier(tableName)} (
    case_id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL,
    status TEXT NOT NULL,
    name TEXT NOT NULL,
    problem_summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const tableExists = (database: DatabaseSync, tableName: string): boolean => {
  const row = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
    )
    .get(tableName) as { name: string } | undefined;

  return row?.name === tableName;
};

const getTableColumns = (database: DatabaseSync, tableName: string): string[] => {
  const rows = database
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
};

const getTableDefinition = (database: DatabaseSync, tableName: string): string | null => {
  const row = database
    .prepare(
      `
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
    )
    .get(tableName) as { sql: string | null } | undefined;

  return row?.sql ?? null;
};

const selectTextExpression = (
  availableColumns: string[],
  candidates: string[],
  fallbackSql: string
): string => {
  const matchedColumn = candidates.find((candidate) => availableColumns.includes(candidate));

  if (!matchedColumn) {
    return fallbackSql;
  }

  return `COALESCE(CAST(${quoteIdentifier(matchedColumn)} AS TEXT), ${fallbackSql})`;
};

const normalizeCasesTable = (database: DatabaseSync): void => {
  if (!tableExists(database, "cases")) {
    database.exec(createCasesTableSql("cases"));
    return;
  }

  const existingColumns = getTableColumns(database, "cases");
  const alreadyNormalized =
    existingColumns.length === requiredCaseColumns.length &&
    requiredCaseColumns.every((columnName) => existingColumns.includes(columnName));

  if (alreadyNormalized) {
    return;
  }

  database.exec("ALTER TABLE cases RENAME TO cases__m17_legacy;");
  database.exec(createCasesTableSql("cases__m17_new"));

  const legacyColumns = getTableColumns(database, "cases__m17_legacy");
  const createdAtExpression = selectTextExpression(
    legacyColumns,
    ["created_at", "createdAt"],
    "CURRENT_TIMESTAMP"
  );

  database.exec(`
    INSERT INTO cases__m17_new (
      case_id,
      subject_id,
      status,
      name,
      problem_summary,
      created_at,
      updated_at
    )
    SELECT
      ${selectTextExpression(legacyColumns, ["case_id", "caseId", "reference"], "printf('LEGACY-CASE-%d', rowid)")},
      ${selectTextExpression(legacyColumns, ["subject_id", "subjectId"], "'legacy-subject'")},
      ${selectTextExpression(legacyColumns, ["status"], "'draft'")},
      ${selectTextExpression(legacyColumns, ["name", "client_name", "clientName"], "''")},
      ${selectTextExpression(legacyColumns, ["problem_summary", "problemSummary", "summary"], "''")},
      ${createdAtExpression},
      ${selectTextExpression(legacyColumns, ["updated_at", "updatedAt"], createdAtExpression)}
    FROM cases__m17_legacy;
  `);

  database.exec("DROP TABLE cases__m17_legacy;");
  database.exec("ALTER TABLE cases__m17_new RENAME TO cases;");
};

const remediateDuplicateDraftCases = (database: DatabaseSync): void => {
  database.exec(`
    WITH ranked_drafts AS (
      SELECT
        case_id,
        ROW_NUMBER() OVER (
          PARTITION BY subject_id
          ORDER BY created_at ASC, case_id ASC
        ) AS draft_rank
      FROM cases
      WHERE status = 'draft'
    )
    UPDATE cases
    SET status = 'duplicate_archived'
    WHERE status = 'draft'
      AND case_id IN (
        SELECT case_id
        FROM ranked_drafts
        WHERE draft_rank > 1
      );
  `);
};

const createDraftCaseUniquenessIndex = (database: DatabaseSync): void => {
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS cases_one_draft_per_subject_id
    ON cases(subject_id)
    WHERE status = 'draft';
  `);
};

const normalizeLegacyNameField = (
  database: DatabaseSync,
  subjectId: string,
  rawName: string
): void => {
  const trimmed = rawName.trim().replace(/\s+/g, " ");

  if (trimmed.length === 0) {
    return;
  }

  const parts = trimmed.split(" ");
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");

  if (!firstName) {
    return;
  }

  database
    .prepare(
      `
        INSERT INTO intake_fields__m26_new (
          subject_id,
          field_name,
          field_value,
          updated_at,
          metadata_json
        )
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL)
      `
    )
    .run(subjectId, "firstName", firstName);

  if (lastName.length > 0) {
    database
      .prepare(
        `
          INSERT INTO intake_fields__m26_new (
            subject_id,
            field_name,
            field_value,
            updated_at,
            metadata_json
          )
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL)
        `
      )
      .run(subjectId, "lastName", lastName);
  }
};

const normalizeIntakeSchema = (database: DatabaseSync): void => {
  if (!tableExists(database, "intake_states")) {
    return;
  }

  const intakeStatesDefinition = getTableDefinition(database, "intake_states");
  const intakeFieldsDefinition = getTableDefinition(database, "intake_fields");
  const intakeEventsDefinition = getTableDefinition(database, "intake_events");
  const alreadyNormalized =
    intakeStatesDefinition?.includes("asking_identity") === true &&
    intakeFieldsDefinition?.includes("firstName") === true &&
    intakeEventsDefinition?.includes("firstName") === true;

  if (alreadyNormalized) {
    return;
  }

  database.exec("ALTER TABLE intake_states RENAME TO intake_states__m26_legacy;");
  database.exec(`
    CREATE TABLE intake_states__m26_new (
      subject_id TEXT PRIMARY KEY,
      intake_state TEXT NOT NULL CHECK (intake_state IN ('not_started', 'asking_identity', 'asking_problem_summary', 'intake_complete')),
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );
  `);

  database.exec(`
    INSERT INTO intake_states__m26_new (
      subject_id,
      intake_state,
      updated_at,
      metadata_json
    )
    SELECT
      subject_id,
      CASE intake_state
        WHEN 'asking_name' THEN 'asking_identity'
        WHEN 'intake_complete' THEN 'asking_identity'
        ELSE intake_state
      END,
      updated_at,
      metadata_json
    FROM intake_states__m26_legacy;
  `);
  database.exec("DROP TABLE intake_states__m26_legacy;");
  database.exec("ALTER TABLE intake_states__m26_new RENAME TO intake_states;");

  if (tableExists(database, "intake_fields")) {
    database.exec("ALTER TABLE intake_fields RENAME TO intake_fields__m26_legacy;");
    database.exec(`
      CREATE TABLE intake_fields__m26_new (
        subject_id TEXT NOT NULL,
        field_name TEXT NOT NULL CHECK (field_name IN ('firstName', 'lastName', 'birthDate', 'city', 'problemSummary')),
        field_value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (subject_id, field_name)
      );
    `);

    const legacyRows = database
      .prepare(
        `
          SELECT subject_id, field_name, field_value, updated_at, metadata_json
          FROM intake_fields__m26_legacy
          ORDER BY subject_id ASC, field_name ASC
        `
      )
      .all() as Array<{
      subject_id: string;
      field_name: string;
      field_value: string;
      updated_at: string;
      metadata_json: string | null;
    }>;

    for (const row of legacyRows) {
      if (row.field_name === "problemSummary") {
        database
          .prepare(
            `
              INSERT INTO intake_fields__m26_new (
                subject_id,
                field_name,
                field_value,
                updated_at,
                metadata_json
              )
              VALUES (?, ?, ?, ?, ?)
            `
          )
          .run(
            row.subject_id,
            row.field_name,
            row.field_value,
            row.updated_at,
            row.metadata_json
          );
        continue;
      }

      if (row.field_name === "name") {
        normalizeLegacyNameField(database, row.subject_id, row.field_value);
      }
    }

    database.exec("DROP TABLE intake_fields__m26_legacy;");
    database.exec("ALTER TABLE intake_fields__m26_new RENAME TO intake_fields;");
  }

  if (tableExists(database, "intake_events")) {
    database.exec("ALTER TABLE intake_events RENAME TO intake_events__m26_legacy;");
    database.exec(`
      CREATE TABLE intake_events__m26_new (
        event_id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        intake_state TEXT CHECK (intake_state IN ('not_started', 'asking_identity', 'asking_problem_summary', 'intake_complete')),
        field_name TEXT CHECK (field_name IN ('firstName', 'lastName', 'birthDate', 'city', 'problemSummary')),
        occurred_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `);

    database.exec(`
      INSERT INTO intake_events__m26_new (
        event_id,
        subject_id,
        event_type,
        intake_state,
        field_name,
        occurred_at,
        metadata_json
      )
      SELECT
        event_id,
        subject_id,
        event_type,
        CASE intake_state
          WHEN 'asking_name' THEN 'asking_identity'
          WHEN 'intake_complete' THEN 'asking_identity'
          ELSE intake_state
        END,
        CASE field_name
          WHEN 'problemSummary' THEN 'problemSummary'
          ELSE NULL
        END,
        occurred_at,
        metadata_json
      FROM intake_events__m26_legacy;
    `);

    database.exec("DROP TABLE intake_events__m26_legacy;");
    database.exec("ALTER TABLE intake_events__m26_new RENAME TO intake_events;");
  }
};

const enforceDraftCaseUniqueness = (database: DatabaseSync): void => {
  database.exec("BEGIN IMMEDIATE;");

  try {
    remediateDuplicateDraftCases(database);
    createDraftCaseUniquenessIndex(database);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
};

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
        intake_state TEXT NOT NULL CHECK (intake_state IN ('not_started', 'asking_identity', 'asking_problem_summary', 'intake_complete')),
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
        field_name TEXT NOT NULL CHECK (field_name IN ('firstName', 'lastName', 'birthDate', 'city', 'problemSummary')),
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
        intake_state TEXT CHECK (intake_state IN ('not_started', 'asking_identity', 'asking_problem_summary', 'intake_complete')),
        field_name TEXT CHECK (field_name IN ('firstName', 'lastName', 'birthDate', 'city', 'problemSummary')),
        occurred_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `
  },
  {
    id: "0009_harden_cases_schema",
    run(database) {
      normalizeCasesTable(database);
    }
  },
  {
    id: "0010_enforce_draft_case_uniqueness",
    run(database) {
      enforceDraftCaseUniqueness(database);
    }
  },
  {
    id: "0011_normalize_intake_schema_for_identity_fields",
    run(database) {
      normalizeIntakeSchema(database);
    }
  }
];
