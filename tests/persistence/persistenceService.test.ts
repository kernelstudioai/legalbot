import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEventRecord, AuditLogStore, CaseStore, ProcessedMessageStore } from "../../src/persistence/index.ts";
import {
  InMemoryCaseStore,
  createInMemoryPersistenceService,
  createPersistenceService,
  createSqlitePersistenceService
} from "../../src/persistence/index.ts";
import { openSqliteDatabase, runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";

const tempDirectories: string[] = [];

class CapturingAuditLogStore implements AuditLogStore {
  events: AuditEventRecord[] = [];

  async append(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }
}

class TrackingProcessedMessageStore implements ProcessedMessageStore {
  records = new Map<string, Record<string, string>>();

  async has(messageId: string): Promise<boolean> {
    return this.records.has(messageId);
  }

  async markProcessed(record: {
    messageId: string;
    channel: "whatsapp";
    senderId: string;
    transportChatId: string;
    processedAt: string;
  }): Promise<{ inserted: boolean }> {
    if (this.records.has(record.messageId)) {
      return { inserted: false };
    }

    this.records.set(record.messageId, record);
    return { inserted: true };
  }
}

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-persistence-service-"));
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

describe("persistence service boundary", () => {
  it("reports an unprocessed message", async () => {
    const service = createInMemoryPersistenceService();

    await expect(service.isMessageProcessed("wamid.test-unprocessed")).resolves.toBe(false);
  });

  it("marks a message processed", async () => {
    const service = createInMemoryPersistenceService();

    const result = await service.markMessageProcessed("wamid.test-processed", {
      senderId: "client-123@c.us",
      transportChatId: "client-123@c.us",
      processedAt: "2026-06-04T12:00:00.000Z"
    });

    expect(result).toEqual({
      inserted: true,
      record: {
        messageId: "wamid.test-processed",
        channel: "whatsapp",
        senderId: "client-123@c.us",
        transportChatId: "client-123@c.us",
        processedAt: "2026-06-04T12:00:00.000Z"
      }
    });
    await expect(service.isMessageProcessed("wamid.test-processed")).resolves.toBe(true);
  });

  it("keeps duplicate marks idempotent", async () => {
    const service = createInMemoryPersistenceService();

    await expect(
      service.markMessageProcessed("wamid.test-duplicate", {
        senderId: "client-123@c.us",
        transportChatId: "client-123@c.us",
        processedAt: "2026-06-04T12:01:00.000Z"
      })
    ).resolves.toMatchObject({ inserted: true });

    await expect(
      service.markMessageProcessed("wamid.test-duplicate", {
        senderId: "client-123@c.us",
        transportChatId: "client-123@c.us",
        processedAt: "2026-06-04T12:02:00.000Z"
      })
    ).resolves.toMatchObject({ inserted: false });
  });

  it("appends audit events with sanitized payloads", async () => {
    const auditLogStore = new CapturingAuditLogStore();
    const service = createPersistenceService({
      caseStore: {
        create: async () => {
          throw new Error("not used");
        },
        getById: async () => null,
        update: async () => null
      } satisfies CaseStore,
      processedMessageStore: new TrackingProcessedMessageStore(),
      auditLogStore,
      now: () => "2026-06-04T12:03:00.000Z"
    });

    const appended = await service.appendAuditEvent({
      eventId: "audit-1",
      eventType: "case_created",
      entityType: "case",
      entityId: "case-1",
      metadata: {
        source: "test",
        messageBody: "remove me",
        nested: {
          text: "remove me too",
          safe: true
        }
      }
    });

    expect(appended).toEqual({
      eventId: "audit-1",
      eventType: "case_created",
      entityType: "case",
      entityId: "case-1",
      occurredAt: "2026-06-04T12:03:00.000Z",
      metadata: {
        source: "test",
        nested: {
          safe: true
        }
      }
    });
    expect(auditLogStore.events).toEqual([appended]);
  });

  it("creates, reads, and updates case status through the service", async () => {
    const service = createPersistenceService({
      caseStore: new InMemoryCaseStore(),
      processedMessageStore: new TrackingProcessedMessageStore(),
      auditLogStore: new CapturingAuditLogStore(),
      now: () => "2026-06-04T12:05:00.000Z"
    });

    const created = await service.createCase({
      caseId: "case-1",
      clientPhoneE164: "+15551234567",
      createdAt: "2026-06-04T12:04:00.000Z",
      updatedAt: "2026-06-04T12:04:00.000Z"
    });

    expect(created.status).toBe("pending");
    await expect(service.getCase("case-1")).resolves.toEqual(created);
    await expect(service.updateCaseStatus("case-1", "review_pending")).resolves.toEqual({
      ...created,
      status: "review_pending",
      updatedAt: "2026-06-04T12:05:00.000Z"
    });
    await expect(service.getCase("missing-case")).resolves.toBeNull();
  });

  it("runs the sqlite factory against a temp database only", async () => {
    const tempDir = createTempDir();
    const databaseUrl = "file:./legalbot.sqlite";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const service = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      expect(service.databasePath.startsWith(tempDir)).toBe(true);

      await expect(
        service.markMessageProcessed("wamid.sqlite-1", {
          senderId: "client-456@c.us",
          transportChatId: "client-456@c.us",
          processedAt: "2026-06-04T12:06:00.000Z",
          metadata: {
            content: "remove me",
            source: "sqlite-test"
          }
        })
      ).resolves.toEqual({
        inserted: true,
        record: {
          messageId: "wamid.sqlite-1",
          channel: "whatsapp",
          senderId: "client-456@c.us",
          transportChatId: "client-456@c.us",
          processedAt: "2026-06-04T12:06:00.000Z"
        },
        sanitizedMetadata: {
          source: "sqlite-test"
        }
      });
    } finally {
      service.close();
    }

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
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
        .get("wamid.sqlite-1") as
        | {
            message_id: string;
            channel: string;
            sender_id: string;
            transport_chat_id: string;
            processed_at: string;
          }
        | undefined;

      expect(row).toEqual({
        message_id: "wamid.sqlite-1",
        channel: "whatsapp",
        sender_id: "client-456@c.us",
        transport_chat_id: "client-456@c.us",
        processed_at: "2026-06-04T12:06:00.000Z"
      });
    } finally {
      database.close();
    }
  });

  it("works in memory without sqlite", async () => {
    const service = createInMemoryPersistenceService();

    await expect(
      service.createCase({
        caseId: "case-memory-1",
        clientPhoneE164: "+15557654321"
      })
    ).resolves.toMatchObject({
      caseId: "case-memory-1",
      clientPhoneE164: "+15557654321"
    });
  });

  it("strips forbidden content fields from processed metadata and audit payloads", async () => {
    const processedMessageStore = new TrackingProcessedMessageStore();
    const auditLogStore = new CapturingAuditLogStore();
    const service = createPersistenceService({
      caseStore: {
        create: async () => {
          throw new Error("not used");
        },
        getById: async () => null,
        update: async () => null
      } satisfies CaseStore,
      processedMessageStore,
      auditLogStore
    });

    const processedResult = await service.markMessageProcessed("wamid.sanitized-1", {
      senderId: "client-999@c.us",
      transportChatId: "client-999@c.us",
      metadata: {
        text: "strip",
        content: "strip",
        safe: "keep",
        nested: {
          body: "strip",
          ok: "keep"
        }
      }
    });
    const auditResult = await service.appendAuditEvent({
      eventId: "audit-2",
      eventType: "processed_message_recorded",
      entityType: "message",
      entityId: "wamid.sanitized-1",
      metadata: {
        messageBody: "strip",
        details: {
          content: "strip",
          ok: true
        }
      }
    });

    expect(processedMessageStore.records.get("wamid.sanitized-1")).toEqual({
      messageId: "wamid.sanitized-1",
      channel: "whatsapp",
      senderId: "client-999@c.us",
      transportChatId: "client-999@c.us",
      processedAt: processedResult.record.processedAt
    });
    expect(processedResult.sanitizedMetadata).toEqual({
      safe: "keep",
      nested: {
        ok: "keep"
      }
    });
    expect(auditResult.metadata).toEqual({
      details: {
        ok: true
      }
    });
    expect(auditLogStore.events[0]?.metadata).toEqual({
      details: {
        ok: true
      }
    });
  });
});
