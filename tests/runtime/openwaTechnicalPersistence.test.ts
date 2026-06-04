import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOpenWaTechnicalPersistence,
  sanitizeTechnicalAuditPayload
} from "../../src/runtime/openwa/technicalPersistence";
import { assertSqliteMigrationsApplied, runSqliteMigrations } from "../../src/persistence/sqlite";
import type { PersistenceService } from "../../src/persistence";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-openwa-technical-"));
  tempDirectories.push(tempDir);
  return tempDir;
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("openwa technical persistence", () => {
  it("sanitizes audit payloads before they reach persistence", async () => {
    const capturedEvents: Array<Record<string, unknown>> = [];
    const persistenceService: PersistenceService = {
      isMessageProcessed: async () => false,
      markMessageProcessed: async () => ({
        inserted: true,
        record: {
          messageId: "wamid.test-1",
          channel: "whatsapp",
          senderId: "[redacted-phone]",
          transportChatId: "[redacted-phone]",
          processedAt: "2026-06-04T12:00:00.000Z"
        }
      }),
      appendAuditEvent: async (event) => {
        capturedEvents.push(event as unknown as Record<string, unknown>);
        return {
          eventId: event.eventId,
          eventType: event.eventType,
          entityType: event.entityType,
          entityId: event.entityId,
          occurredAt: event.occurredAt ?? "2026-06-04T12:00:00.000Z",
          ...(event.metadata ? { metadata: event.metadata } : {})
        };
      },
      getConsentState: async () => "unknown",
      setConsentState: async () => ({
        record: {
          subjectId: "subject-1",
          state: "unknown",
          updatedAt: "2026-06-04T12:00:00.000Z"
        }
      }),
      appendConsentEvent: async (event) => ({
        eventId: event.eventId,
        subjectId: event.subjectId,
        state: event.state,
        eventType: event.eventType,
        occurredAt: event.occurredAt ?? "2026-06-04T12:00:00.000Z",
        ...(event.metadata ? { metadata: event.metadata } : {})
      }),
      getIntakeState: async () => "not_started",
      setIntakeState: async (subjectId, state, metadata) => ({
        record: {
          subjectId,
          state,
          updatedAt: metadata?.updatedAt ?? "2026-06-04T12:00:00.000Z"
        }
      }),
      setIntakeField: async (subjectId, fieldName, value, metadata) => ({
        record: {
          subjectId,
          fieldName,
          value,
          updatedAt: metadata?.updatedAt ?? "2026-06-04T12:00:00.000Z"
        }
      }),
      getIntakeSnapshot: async () => null,
      appendIntakeEvent: async (event) => ({
        event: {
          eventId: event.eventId,
          subjectId: event.subjectId,
          eventType: event.eventType,
          occurredAt: event.occurredAt ?? "2026-06-04T12:00:00.000Z",
          ...(event.state ? { state: event.state } : {}),
          ...(event.fieldName ? { fieldName: event.fieldName } : {}),
          ...(event.metadata ? { metadata: event.metadata } : {})
        },
        ...(event.metadata ? { sanitizedMetadata: event.metadata } : {})
      }),
      createCase: async () => {
        throw new Error("not used");
      },
      getCase: async () => null,
      updateCaseStatus: async () => null
    };
    const technicalPersistence = createOpenWaTechnicalPersistence(persistenceService, {
      sessionId: "legalbot-smoke"
    });

    await technicalPersistence.recordDispatchFailed(
      {
        id: "wamid.test-1",
        from: "15551234567@c.us",
        chatId: "15551234567@c.us",
        body: "Hello",
        fromMe: false,
        timestamp: Date.parse("2026-06-04T12:00:00.000Z")
      },
      new Error(
        "body=Hello token=abc1234567890123456789012345 path=C:\\openwa-session\\profile qr=marker +15551234567"
      )
    );

    expect(capturedEvents[0]).toMatchObject({
      eventType: "openwa_dispatch_failed",
      metadata: {
        messageId: "wamid.test-1",
        error: "[redacted-path]"
      }
    });
  });

  it("strips content keys, phone numbers, paths, tokens, and qr markers from generic payloads", () => {
    expect(
      sanitizeTechnicalAuditPayload({
        body: "drop",
        text: "drop",
        from: "+15551234567",
        error: "Bearer abc1234567890123456789012345",
        browserPath: "C:\\Users\\Jacopo\\Chrome\\chrome.exe",
        sessionPath: "/tmp/openwa-session/profile",
        qrData: "data:image/png;base64,abc123",
        nested: {
          chatId: "15551234567@c.us",
          messageBody: "drop",
          note: "call +15551234567"
        }
      })
    ).toEqual({
      from: "[redacted-phone]",
      error: "[redacted-token]",
      browserPath: "[redacted-path]",
      sessionPath: "[redacted-path]",
      qrData: "[redacted-qr]",
      nested: {
        chatId: "[redacted-phone]",
        note: "call [redacted-phone]"
      }
    });
  });

  it("requires migrations before technical persistence startup", () => {
    const tempDir = createTempDir();

    expect(() =>
      assertSqliteMigrationsApplied({
        databaseUrl: "file:./data/legalbot.sqlite",
        cwd: tempDir
      })
    ).toThrow(
      "Technical persistence requires an existing migrated SQLite database. Run npm run db:migrate before enabling TECHNICAL_PERSISTENCE_ENABLED."
    );
  });

  it("accepts an already migrated sqlite database", () => {
    const tempDir = createTempDir();
    runSqliteMigrations({
      databaseUrl: "file:./data/legalbot.sqlite",
      cwd: tempDir,
      enabled: true
    });

    expect(
      assertSqliteMigrationsApplied({
        databaseUrl: "file:./data/legalbot.sqlite",
        cwd: tempDir
      })
    ).toEqual({
      appliedMigrationIds: [
        "0001_create_cases",
        "0002_create_processed_messages",
        "0003_create_audit_events",
        "0004_create_consent_states",
        "0005_create_consent_events",
        "0006_create_intake_states",
        "0007_create_intake_fields",
        "0008_create_intake_events"
      ],
      databasePath: path.join(tempDir, "data", "legalbot.sqlite")
    });
  });
});
