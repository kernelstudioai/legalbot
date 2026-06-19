import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openSqliteDatabase,
  runSqliteMigrations,
  SqliteAuditLogStore,
  SqliteCaseStore,
  SqliteConsentStore,
  SqliteIntakeStore,
  SqlitePracticeStore,
  SqliteProcessedMessageStore
} from "../../src/persistence/sqlite/index.ts";

const tempDirectories: string[] = [];
const allMigrationIds = [
  "0001_create_cases",
  "0002_create_processed_messages",
  "0003_create_audit_events",
  "0004_create_consent_states",
  "0005_create_consent_events",
  "0006_create_intake_states",
  "0007_create_intake_fields",
  "0008_create_intake_events",
  "0009_harden_cases_schema",
  "0010_enforce_draft_case_uniqueness",
  "0011_normalize_intake_schema_for_identity_fields",
  "0012_create_practice_registry"
] as const;
const migrationIdsThrough0008 = allMigrationIds.slice(0, 8);
const migrationIdsThrough0009 = allMigrationIds.slice(0, 9);

const createTempDatabaseConfig = () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-persistence-"));
  tempDirectories.push(tempDir);

  return {
    tempDir,
    databaseUrl: "file:./legalbot.test.sqlite"
  };
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("sqlite persistence foundation", () => {
  it("creates the expected tables through the explicit migration runner", () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();

    const migrationResult = runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    expect(migrationResult.skipped).toBe(false);
    expect(migrationResult.appliedMigrationIds).toEqual(allMigrationIds);
    expect(migrationResult.pendingMigrationIds).toEqual([]);
    expect(migrationResult.databasePath.startsWith(tempDir)).toBe(true);
    expect(existsSync(migrationResult.databasePath)).toBe(true);

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const tableNames = (
        database
          .prepare(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table'
              ORDER BY name ASC
            `
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);

      expect(tableNames).toEqual([
        "audit_events",
        "cases",
        "consent_events",
        "consent_states",
        "intake_events",
        "intake_fields",
        "intake_states",
        "practice_sequence",
        "practices",
        "processed_messages",
        "schema_migrations"
      ]);
    } finally {
      database.close();
    }
  });

  it("upgrades a legacy cases schema and drops transcript-style columns", () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      database.exec(`
        CREATE TABLE schema_migrations (
          migration_id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE cases (
          reference TEXT PRIMARY KEY,
          subjectId TEXT NOT NULL,
          status TEXT NOT NULL,
          name TEXT NOT NULL,
          problemSummary TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          transcript TEXT,
          rawBody TEXT
        );

        INSERT INTO cases (
          reference,
          subjectId,
          status,
          name,
          problemSummary,
          createdAt,
          updatedAt,
          transcript,
          rawBody
        )
        VALUES (
          'CASE-LEGACY-1',
          'subject-legacy-1',
          'draft',
          'Mario Rossi',
          'Sintesi legacy del problema',
          '2026-06-04T09:30:00.000Z',
          '2026-06-04T09:30:00.000Z',
          'raw transcript',
          'raw body'
        );
      `);

      const insertMigration = database.prepare(`
        INSERT INTO schema_migrations (migration_id, applied_at)
        VALUES (?, ?)
      `);

      for (const migrationId of migrationIdsThrough0008) {
        insertMigration.run(migrationId, "2026-06-04T09:00:00.000Z");
      }
    } finally {
      database.close();
    }

    const migrationResult = runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

      expect(migrationResult.appliedMigrationIds).toEqual([
        "0009_harden_cases_schema",
        "0010_enforce_draft_case_uniqueness",
        "0011_normalize_intake_schema_for_identity_fields",
        "0012_create_practice_registry"
      ]);
    expect(migrationResult.pendingMigrationIds).toEqual([]);

    const { database: migratedDatabase } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const caseColumns = (
        migratedDatabase
          .prepare("PRAGMA table_info(cases)")
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      const migratedRow = migratedDatabase
        .prepare(
          `
            SELECT
              case_id,
              subject_id,
              status,
              name,
              problem_summary,
              created_at,
              updated_at
            FROM cases
            WHERE case_id = ?
          `
        )
        .get("CASE-LEGACY-1") as
        | {
            case_id: string;
            subject_id: string;
            status: string;
            name: string;
            problem_summary: string;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      expect(caseColumns).toEqual([
        "case_id",
        "subject_id",
        "status",
        "name",
        "problem_summary",
        "created_at",
        "updated_at"
      ]);
      expect(migratedRow).toEqual({
        case_id: "CASE-LEGACY-1",
        subject_id: "subject-legacy-1",
        status: "draft",
        name: "Mario Rossi",
        problem_summary: "Sintesi legacy del problema",
        created_at: "2026-06-04T09:30:00.000Z",
        updated_at: "2026-06-04T09:30:00.000Z"
      });

      const draftUniquenessIndex = migratedDatabase
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'index' AND name = 'cases_one_draft_per_subject_id'
          `
        )
        .get() as { sql: string } | undefined;

      expect(draftUniquenessIndex?.sql).toContain("WHERE status = 'draft'");
    } finally {
      migratedDatabase.close();
    }
  });

  it("remediates duplicate draft rows and preserves the earliest draft per subject", () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      database.exec(`
        CREATE TABLE schema_migrations (
          migration_id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE cases (
          case_id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL,
          status TEXT NOT NULL,
          name TEXT NOT NULL,
          problem_summary TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO cases (
          case_id,
          subject_id,
          status,
          name,
          problem_summary,
          created_at,
          updated_at
        )
        VALUES
          ('CASE-DRAFT-1', 'subject-dup', 'draft', 'Mario Rossi', 'Prima bozza', '2026-06-05T08:00:00.000Z', '2026-06-05T08:00:00.000Z'),
          ('CASE-DRAFT-2', 'subject-dup', 'draft', 'Mario Rossi', 'Seconda bozza', '2026-06-05T08:05:00.000Z', '2026-06-05T08:05:00.000Z'),
          ('CASE-DRAFT-3', 'subject-dup', 'draft', 'Mario Rossi', 'Terza bozza', '2026-06-05T08:10:00.000Z', '2026-06-05T08:10:00.000Z'),
          ('CASE-REVIEW-1', 'subject-dup', 'review_pending', 'Mario Rossi', 'Storico non draft', '2026-06-05T08:15:00.000Z', '2026-06-05T08:15:00.000Z'),
          ('CASE-DRAFT-OTHER', 'subject-other', 'draft', 'Giulia Bianchi', 'Bozza separata', '2026-06-05T08:20:00.000Z', '2026-06-05T08:20:00.000Z');
      `);

      const insertMigration = database.prepare(`
        INSERT INTO schema_migrations (migration_id, applied_at)
        VALUES (?, ?)
      `);

      for (const migrationId of migrationIdsThrough0009) {
        insertMigration.run(migrationId, "2026-06-05T07:55:00.000Z");
      }
    } finally {
      database.close();
    }

    const migrationResult = runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    expect(migrationResult.appliedMigrationIds).toEqual([
      "0010_enforce_draft_case_uniqueness",
      "0011_normalize_intake_schema_for_identity_fields",
      "0012_create_practice_registry"
    ]);
    expect(migrationResult.pendingMigrationIds).toEqual([]);

    const { database: migratedDatabase } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const duplicateSubjectRows = migratedDatabase
        .prepare(
          `
            SELECT case_id, status, created_at
            FROM cases
            WHERE subject_id = ?
            ORDER BY created_at ASC, case_id ASC
          `
        )
        .all("subject-dup") as Array<{
        case_id: string;
        status: string;
        created_at: string;
      }>;

      const draftCounts = migratedDatabase
        .prepare(
          `
            SELECT
              subject_id,
              COUNT(*) AS draft_count
            FROM cases
            WHERE status = 'draft'
            GROUP BY subject_id
            ORDER BY subject_id ASC
          `
        )
        .all() as Array<{
        subject_id: string;
        draft_count: number;
      }>;

      expect(duplicateSubjectRows).toEqual([
        {
          case_id: "CASE-DRAFT-1",
          status: "draft",
          created_at: "2026-06-05T08:00:00.000Z"
        },
        {
          case_id: "CASE-DRAFT-2",
          status: "duplicate_archived",
          created_at: "2026-06-05T08:05:00.000Z"
        },
        {
          case_id: "CASE-DRAFT-3",
          status: "duplicate_archived",
          created_at: "2026-06-05T08:10:00.000Z"
        },
        {
          case_id: "CASE-REVIEW-1",
          status: "review_pending",
          created_at: "2026-06-05T08:15:00.000Z"
        }
      ]);
      expect(draftCounts).toEqual([
        {
          subject_id: "subject-dup",
          draft_count: 1
        },
        {
          subject_id: "subject-other",
          draft_count: 1
        }
      ]);
    } finally {
      migratedDatabase.close();
    }
  });

  it("prevents future duplicate drafts while allowing non-draft rows for the same subject", () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    runSqliteMigrations({ databaseUrl, cwd: tempDir, enabled: true });

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const insertCase = database.prepare(`
        INSERT INTO cases (
          case_id,
          subject_id,
          status,
          name,
          problem_summary,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertCase.run(
        "CASE-DRAFT-PRIMARY",
        "subject-constraint",
        "draft",
        "Mario Rossi",
        "Bozza primaria",
        "2026-06-05T09:00:00.000Z",
        "2026-06-05T09:00:00.000Z"
      );

      expect(() =>
        insertCase.run(
          "CASE-DRAFT-DUPLICATE",
          "subject-constraint",
          "draft",
          "Mario Rossi",
          "Bozza duplicata",
          "2026-06-05T09:05:00.000Z",
          "2026-06-05T09:05:00.000Z"
        )
      ).toThrow(/UNIQUE constraint failed: cases\.subject_id/);

      expect(() =>
        insertCase.run(
          "CASE-DUPLICATE-ARCHIVED",
          "subject-constraint",
          "duplicate_archived",
          "Mario Rossi",
          "Storico archiviato",
          "2026-06-05T09:10:00.000Z",
          "2026-06-05T09:10:00.000Z"
        )
      ).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("stores processed messages idempotently without message bodies", async () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    runSqliteMigrations({ databaseUrl, cwd: tempDir, enabled: true });

    const { database, databasePath } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const store = new SqliteProcessedMessageStore(database);
      const message = {
        messageId: "wamid.test-processed-1",
        channel: "whatsapp" as const,
        senderId: "client-123@c.us",
        transportChatId: "client-123@c.us",
        processedAt: "2026-06-04T10:00:00.000Z"
      };

      expect(databasePath.startsWith(tempDir)).toBe(true);
      expect(await store.has(message.messageId)).toBe(false);
      expect(await store.markProcessed(message)).toEqual({ inserted: true });
      expect(await store.has(message.messageId)).toBe(true);
      expect(await store.markProcessed(message)).toEqual({ inserted: false });

      const row = database
        .prepare(
          `
            SELECT
              message_id,
              channel,
              sender_id,
              transport_chat_id,
              processed_at
            FROM processed_messages
            WHERE message_id = ?
          `
        )
        .get(message.messageId) as
        | {
            message_id: string;
            channel: string;
            sender_id: string;
            transport_chat_id: string;
            processed_at: string;
          }
        | undefined;

      expect(row).toEqual({
        message_id: "wamid.test-processed-1",
        channel: "whatsapp",
        sender_id: "client-123@c.us",
        transport_chat_id: "client-123@c.us",
        processed_at: "2026-06-04T10:00:00.000Z"
      });
    } finally {
      database.close();
    }
  });

  it("allocates and stores practice codes persistently", async () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    runSqliteMigrations({ databaseUrl, cwd: tempDir, enabled: true });

    const firstConnection = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const store = new SqlitePracticeStore(firstConnection.database);

      expect(await store.allocateNextPracticeCode()).toBe("AA001");
      await store.create({
        practiceCode: "AA001",
        subjectId: "393331119999",
        status: "draft",
        clientFirstName: "Mario",
        clientLastName: "Rossi",
        birthDate: "01/01/1980",
        city: "Roma",
        subjectRef: "subject:test",
        legalIssueText: "Sintesi breve del problema",
        attachmentMetadata: [],
        sourceMessageId: "wamid.practice-1",
        createdAt: "2026-06-05T09:00:00.000Z",
        updatedAt: "2026-06-05T09:00:00.000Z"
      });
      expect(await store.allocateNextPracticeCode()).toBe("AA002");
    } finally {
      firstConnection.database.close();
    }

    const secondConnection = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const store = new SqlitePracticeStore(secondConnection.database);

      expect(await store.allocateNextPracticeCode()).toBe("AA003");
      await expect(store.findByPracticeCode("AA001")).resolves.toMatchObject({
        practiceCode: "AA001",
        subjectId: "393331119999"
      });
    } finally {
      secondConnection.database.close();
    }
  });

  it("appends audit events", async () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    runSqliteMigrations({ databaseUrl, cwd: tempDir, enabled: true });

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const store = new SqliteAuditLogStore(database);

      await store.append({
        eventId: "audit-1",
        eventType: "case_created",
        entityType: "case",
        entityId: "case-1",
        occurredAt: "2026-06-04T10:05:00.000Z",
        metadata: {
          source: "test"
        }
      });

      const row = database
        .prepare(
          `
            SELECT
              event_id,
              event_type,
              entity_type,
              entity_id,
              occurred_at,
              metadata_json
            FROM audit_events
            WHERE event_id = ?
          `
        )
        .get("audit-1") as
        | {
            event_id: string;
            event_type: string;
            entity_type: string;
            entity_id: string;
            occurred_at: string;
            metadata_json: string | null;
          }
        | undefined;

      expect(row).toEqual({
        event_id: "audit-1",
        event_type: "case_created",
        entity_type: "case",
        entity_id: "case-1",
        occurred_at: "2026-06-04T10:05:00.000Z",
        metadata_json: JSON.stringify({ source: "test" })
      });
    } finally {
      database.close();
    }
  });

  it("stores consent state snapshots and consent events", async () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    runSqliteMigrations({ databaseUrl, cwd: tempDir, enabled: true });

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const store = new SqliteConsentStore(database);

      expect(await store.getConsentState("subject-1")).toBe("unknown");

      const stateRecord = await store.setConsentState("subject-1", "granted", {
        updatedAt: "2026-06-04T10:06:00.000Z",
        metadata: {
          source: "test"
        }
      });

      expect(stateRecord).toEqual({
        subjectId: "subject-1",
        state: "granted",
        updatedAt: "2026-06-04T10:06:00.000Z",
        metadata: {
          source: "test"
        }
      });
      expect(await store.getConsentState("subject-1")).toBe("granted");

      await store.appendConsentEvent({
        eventId: "consent-event-1",
        subjectId: "subject-1",
        state: "granted",
        eventType: "consent_granted",
        occurredAt: "2026-06-04T10:07:00.000Z",
        metadata: {
          source: "test"
        }
      });

      const stateRow = database
        .prepare(
          `
            SELECT
              subject_id,
              consent_state,
              updated_at,
              metadata_json
            FROM consent_states
            WHERE subject_id = ?
          `
        )
        .get("subject-1") as
        | {
            subject_id: string;
            consent_state: string;
            updated_at: string;
            metadata_json: string | null;
          }
        | undefined;

      const eventRow = database
        .prepare(
          `
            SELECT
              event_id,
              subject_id,
              consent_state,
              event_type,
              occurred_at,
              metadata_json
            FROM consent_events
            WHERE event_id = ?
          `
        )
        .get("consent-event-1") as
        | {
            event_id: string;
            subject_id: string;
            consent_state: string;
            event_type: string;
            occurred_at: string;
            metadata_json: string | null;
          }
        | undefined;

      expect(stateRow).toEqual({
        subject_id: "subject-1",
        consent_state: "granted",
        updated_at: "2026-06-04T10:06:00.000Z",
        metadata_json: JSON.stringify({ source: "test" })
      });
      expect(eventRow).toEqual({
        event_id: "consent-event-1",
        subject_id: "subject-1",
        consent_state: "granted",
        event_type: "consent_granted",
        occurred_at: "2026-06-04T10:07:00.000Z",
        metadata_json: JSON.stringify({ source: "test" })
      });
    } finally {
      database.close();
    }
  });

  it("stores intake state snapshots, accepted fields, and intake events", async () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    runSqliteMigrations({ databaseUrl, cwd: tempDir, enabled: true });

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const store = new SqliteIntakeStore(database);

      expect(await store.getIntakeState("subject-1")).toBe("not_started");
      expect(await store.getIntakeSnapshot("subject-1")).toBeNull();

      const stateRecord = await store.setIntakeState("subject-1", "asking_problem_summary", {
        updatedAt: "2026-06-04T10:08:00.000Z",
        metadata: {
          source: "test"
        }
      });
      const nameRecord = await store.setIntakeField("subject-1", "firstName", "Mario", {
        updatedAt: "2026-06-04T10:08:30.000Z",
        metadata: {
          source: "test"
        }
      });
      const summaryRecord = await store.setIntakeField(
        "subject-1",
        "problemSummary",
        "Sintesi breve del problema",
        {
          updatedAt: "2026-06-04T10:09:00.000Z",
          metadata: {
            source: "test"
          }
        }
      );

      expect(stateRecord).toEqual({
        subjectId: "subject-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T10:08:00.000Z",
        metadata: {
          source: "test"
        }
      });
      expect(nameRecord).toEqual({
        subjectId: "subject-1",
        fieldName: "firstName",
        value: "Mario",
        updatedAt: "2026-06-04T10:08:30.000Z",
        metadata: {
          source: "test"
        }
      });
      expect(summaryRecord).toEqual({
        subjectId: "subject-1",
        fieldName: "problemSummary",
        value: "Sintesi breve del problema",
        updatedAt: "2026-06-04T10:09:00.000Z",
        metadata: {
          source: "test"
        }
      });

      await store.appendIntakeEvent({
        eventId: "intake-event-1",
        subjectId: "subject-1",
        eventType: "intake_field_accepted",
        state: "asking_problem_summary",
        fieldName: "problemSummary",
        occurredAt: "2026-06-04T10:09:30.000Z",
        metadata: {
          source: "test"
        }
      });

      expect(await store.getIntakeState("subject-1")).toBe("asking_problem_summary");
      expect(await store.getIntakeSnapshot("subject-1")).toEqual({
        subjectId: "subject-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T10:08:00.000Z",
        fields: {
          firstName: "Mario",
          problemSummary: "Sintesi breve del problema"
        }
      });
      await expect(
        store.setIntakeField("subject-1", "unknown" as "firstName", "bad")
      ).rejects.toThrow("Unsupported intake field: unknown");

      const stateRow = database
        .prepare(
          `
            SELECT
              subject_id,
              intake_state,
              updated_at,
              metadata_json
            FROM intake_states
            WHERE subject_id = ?
          `
        )
        .get("subject-1") as
        | {
            subject_id: string;
            intake_state: string;
            updated_at: string;
            metadata_json: string | null;
          }
        | undefined;
      const fieldRows = database
        .prepare(
          `
            SELECT
              subject_id,
              field_name,
              field_value,
              updated_at,
              metadata_json
            FROM intake_fields
            WHERE subject_id = ?
            ORDER BY field_name ASC
          `
        )
        .all("subject-1") as Array<{
        subject_id: string;
        field_name: string;
        field_value: string;
        updated_at: string;
        metadata_json: string | null;
      }>;
      const eventRow = database
        .prepare(
          `
            SELECT
              event_id,
              subject_id,
              event_type,
              intake_state,
              field_name,
              occurred_at,
              metadata_json
            FROM intake_events
            WHERE event_id = ?
          `
        )
        .get("intake-event-1") as
        | {
            event_id: string;
            subject_id: string;
            event_type: string;
            intake_state: string | null;
            field_name: string | null;
            occurred_at: string;
            metadata_json: string | null;
          }
        | undefined;

      expect(stateRow).toEqual({
        subject_id: "subject-1",
        intake_state: "asking_problem_summary",
        updated_at: "2026-06-04T10:08:00.000Z",
        metadata_json: JSON.stringify({ source: "test" })
      });
      expect(fieldRows).toEqual([
        {
          subject_id: "subject-1",
          field_name: "firstName",
          field_value: "Mario",
          updated_at: "2026-06-04T10:08:30.000Z",
          metadata_json: JSON.stringify({ source: "test" })
        },
        {
          subject_id: "subject-1",
          field_name: "problemSummary",
          field_value: "Sintesi breve del problema",
          updated_at: "2026-06-04T10:09:00.000Z",
          metadata_json: JSON.stringify({ source: "test" })
        }
      ]);
      expect(eventRow).toEqual({
        event_id: "intake-event-1",
        subject_id: "subject-1",
        event_type: "intake_field_accepted",
        intake_state: "asking_problem_summary",
        field_name: "problemSummary",
        occurred_at: "2026-06-04T10:09:30.000Z",
        metadata_json: JSON.stringify({ source: "test" })
      });
    } finally {
      database.close();
    }
  });

  it("supports case create/find/get/update skeleton methods", async () => {
    const { tempDir, databaseUrl } = createTempDatabaseConfig();
    runSqliteMigrations({ databaseUrl, cwd: tempDir, enabled: true });

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const store = new SqliteCaseStore(database);

      const created = await store.create({
        caseId: "case-1",
        subjectId: "subject-1",
        status: "draft",
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema",
        createdAt: "2026-06-04T10:10:00.000Z",
        updatedAt: "2026-06-04T10:10:00.000Z"
      });

      expect(created).toEqual({
        caseId: "case-1",
        subjectId: "subject-1",
        status: "draft",
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema",
        createdAt: "2026-06-04T10:10:00.000Z",
        updatedAt: "2026-06-04T10:10:00.000Z"
      });
      expect(await store.findDraftBySubjectId("subject-1")).toEqual(created);
      expect(await store.getById("case-1")).toEqual(created);

      const updated = await store.update({
        caseId: "case-1",
        status: "review_pending",
        updatedAt: "2026-06-04T10:15:00.000Z"
      });

      expect(updated).toEqual({
        caseId: "case-1",
        subjectId: "subject-1",
        status: "review_pending",
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema",
        createdAt: "2026-06-04T10:10:00.000Z",
        updatedAt: "2026-06-04T10:15:00.000Z"
      });
      expect(await store.findDraftBySubjectId("subject-1")).toBeNull();
      expect(await store.getById("case-1")).toEqual(updated);
      expect(await store.update({
        caseId: "missing-case",
        updatedAt: "2026-06-04T10:20:00.000Z"
      })).toBeNull();
    } finally {
      database.close();
    }
  });
});
