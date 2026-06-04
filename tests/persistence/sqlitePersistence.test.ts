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
  SqliteProcessedMessageStore
} from "../../src/persistence/sqlite/index.ts";

const tempDirectories: string[] = [];

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
    expect(migrationResult.appliedMigrationIds).toEqual([
      "0001_create_cases",
      "0002_create_processed_messages",
      "0003_create_audit_events",
      "0004_create_consent_states",
      "0005_create_consent_events"
    ]);
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
        "processed_messages",
        "schema_migrations"
      ]);
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

  it("supports case create/get/update skeleton methods", async () => {
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
        clientPhoneE164: "+15551234567",
        status: "pending",
        createdAt: "2026-06-04T10:10:00.000Z",
        updatedAt: "2026-06-04T10:10:00.000Z"
      });

      expect(created).toEqual({
        caseId: "case-1",
        channel: "whatsapp",
        clientPhoneE164: "+15551234567",
        status: "pending",
        createdAt: "2026-06-04T10:10:00.000Z",
        updatedAt: "2026-06-04T10:10:00.000Z"
      });
      expect(await store.getById("case-1")).toEqual(created);

      const updated = await store.update({
        caseId: "case-1",
        status: "review_pending",
        updatedAt: "2026-06-04T10:15:00.000Z"
      });

      expect(updated).toEqual({
        caseId: "case-1",
        channel: "whatsapp",
        clientPhoneE164: "+15551234567",
        status: "review_pending",
        createdAt: "2026-06-04T10:10:00.000Z",
        updatedAt: "2026-06-04T10:15:00.000Z"
      });
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
