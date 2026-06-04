import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AuditEventRecord,
  AuditLogStore,
  CaseStore,
  ConsentEventRecord,
  ConsentStore,
  ProcessedMessageStore,
  SetConsentStateOptions
} from "../../src/persistence/index.ts";
import {
  InMemoryCaseStore,
  InMemoryConsentStore,
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

class CapturingConsentStore implements ConsentStore {
  stateBySubject = new Map<
    string,
    {
      state: "unknown" | "requested" | "granted" | "denied";
      updatedAt: string;
      metadata?: Record<string, unknown>;
    }
  >();
  events: ConsentEventRecord[] = [];

  async getConsentState(subjectId: string) {
    return this.stateBySubject.get(subjectId)?.state ?? "unknown";
  }

  async setConsentState(
    subjectId: string,
    state: "unknown" | "requested" | "granted" | "denied",
    options: SetConsentStateOptions = {}
  ) {
    const record = {
      subjectId,
      state,
      updatedAt: options.updatedAt ?? "2026-06-04T12:04:00.000Z",
      ...(options.metadata ? { metadata: options.metadata } : {})
    };

    this.stateBySubject.set(subjectId, {
      state,
      updatedAt: record.updatedAt,
      ...(record.metadata ? { metadata: record.metadata } : {})
    });

    return record;
  }

  async appendConsentEvent(event: ConsentEventRecord): Promise<void> {
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
      consentStore: new CapturingConsentStore(),
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
      consentStore: new InMemoryConsentStore(),
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
      await expect(service.getConsentState("subject-sqlite-1")).resolves.toBe("unknown");
      await expect(
        service.setConsentState("subject-sqlite-1", "requested", {
          updatedAt: "2026-06-04T12:07:00.000Z",
          metadata: {
            source: "sqlite-test",
            text: "remove me"
          }
        })
      ).resolves.toEqual({
        record: {
          subjectId: "subject-sqlite-1",
          state: "requested",
          updatedAt: "2026-06-04T12:07:00.000Z",
          metadata: {
            source: "sqlite-test"
          }
        },
        sanitizedMetadata: {
          source: "sqlite-test"
        }
      });
      await expect(service.getConsentState("subject-sqlite-1")).resolves.toBe("requested");
      await expect(
        service.appendConsentEvent({
          eventId: "consent-event-sqlite-1",
          subjectId: "subject-sqlite-1",
          state: "requested",
          eventType: "consent_requested",
          occurredAt: "2026-06-04T12:08:00.000Z",
          metadata: {
            source: "sqlite-test",
            content: "remove me"
          }
        })
      ).resolves.toEqual({
        eventId: "consent-event-sqlite-1",
        subjectId: "subject-sqlite-1",
        state: "requested",
        eventType: "consent_requested",
        occurredAt: "2026-06-04T12:08:00.000Z",
        metadata: {
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

      const consentRow = database
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
        .get("subject-sqlite-1") as
        | {
            subject_id: string;
            consent_state: string;
            updated_at: string;
            metadata_json: string | null;
          }
        | undefined;

      expect(consentRow).toEqual({
        subject_id: "subject-sqlite-1",
        consent_state: "requested",
        updated_at: "2026-06-04T12:07:00.000Z",
        metadata_json: JSON.stringify({
          source: "sqlite-test"
        })
      });

      const consentEventRow = database
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
        .get("consent-event-sqlite-1") as
        | {
            event_id: string;
            subject_id: string;
            consent_state: string;
            event_type: string;
            occurred_at: string;
            metadata_json: string | null;
          }
        | undefined;

      expect(consentEventRow).toEqual({
        event_id: "consent-event-sqlite-1",
        subject_id: "subject-sqlite-1",
        consent_state: "requested",
        event_type: "consent_requested",
        occurred_at: "2026-06-04T12:08:00.000Z",
        metadata_json: JSON.stringify({
          source: "sqlite-test"
        })
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
    await expect(service.getConsentState("memory-subject")).resolves.toBe("unknown");
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
      auditLogStore,
      consentStore: new CapturingConsentStore()
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

  it("persists sanitized consent state metadata and events", async () => {
    const consentStore = new CapturingConsentStore();
    const service = createPersistenceService({
      caseStore: {
        create: async () => {
          throw new Error("not used");
        },
        getById: async () => null,
        update: async () => null
      } satisfies CaseStore,
      processedMessageStore: new TrackingProcessedMessageStore(),
      auditLogStore: new CapturingAuditLogStore(),
      consentStore,
      now: () => "2026-06-04T12:08:00.000Z"
    });

    await expect(service.getConsentState("subject-1")).resolves.toBe("unknown");

    const stateResult = await service.setConsentState("subject-1", "granted", {
      metadata: {
        source: "test",
        phone: "+15551234567",
        body: "remove me",
        token: "abc1234567890123456789012345",
        browserPath: "C:\\openwa-session\\profile",
        nested: {
          text: "remove me",
          chatId: "15551234567@c.us",
          note: "call +15551234567"
        }
      }
    });

    const eventResult = await service.appendConsentEvent({
      eventId: "consent-event-1",
      subjectId: "subject-1",
      state: "granted",
      eventType: "consent_granted",
      metadata: {
        content: "remove me",
        sessionPath: "/tmp/openwa-session/profile",
        safe: true
      }
    });

    expect(stateResult).toEqual({
      record: {
        subjectId: "subject-1",
        state: "granted",
        updatedAt: "2026-06-04T12:08:00.000Z",
        metadata: {
          source: "test",
          phone: "[redacted-phone]",
          token: "[redacted-token]",
          browserPath: "[redacted-path]",
          nested: {
            chatId: "[redacted-phone]",
            note: "call [redacted-phone]"
          }
        }
      },
      sanitizedMetadata: {
        source: "test",
        phone: "[redacted-phone]",
        token: "[redacted-token]",
        browserPath: "[redacted-path]",
        nested: {
          chatId: "[redacted-phone]",
          note: "call [redacted-phone]"
        }
      }
    });
    expect(eventResult).toEqual({
      eventId: "consent-event-1",
      subjectId: "subject-1",
      state: "granted",
      eventType: "consent_granted",
      occurredAt: "2026-06-04T12:08:00.000Z",
      metadata: {
        sessionPath: "[redacted-path]",
        safe: true
      }
    });
    expect(consentStore.stateBySubject.get("subject-1")).toEqual({
      state: "granted",
      updatedAt: "2026-06-04T12:08:00.000Z",
      metadata: {
        source: "test",
        phone: "[redacted-phone]",
        token: "[redacted-token]",
        browserPath: "[redacted-path]",
        nested: {
          chatId: "[redacted-phone]",
          note: "call [redacted-phone]"
        }
      }
    });
    expect(consentStore.events).toEqual([eventResult]);
    await expect(service.getConsentState("subject-1")).resolves.toBe("granted");
  });

  it("in-memory consent store tracks state and events", async () => {
    const store = new InMemoryConsentStore();

    await expect(store.getConsentState("subject-2")).resolves.toBe("unknown");
    await expect(
      store.setConsentState("subject-2", "denied", {
        updatedAt: "2026-06-04T12:09:00.000Z",
        metadata: {
          source: "memory"
        }
      })
    ).resolves.toEqual({
      subjectId: "subject-2",
      state: "denied",
      updatedAt: "2026-06-04T12:09:00.000Z",
      metadata: {
        source: "memory"
      }
    });
    await store.appendConsentEvent({
      eventId: "consent-event-memory-1",
      subjectId: "subject-2",
      state: "denied",
      eventType: "consent_denied",
      occurredAt: "2026-06-04T12:10:00.000Z"
    });

    expect(store.snapshotStates()).toEqual([
      {
        subjectId: "subject-2",
        state: "denied",
        updatedAt: "2026-06-04T12:09:00.000Z",
        metadata: {
          source: "memory"
        }
      }
    ]);
    expect(store.snapshotEvents()).toEqual([
      {
        eventId: "consent-event-memory-1",
        subjectId: "subject-2",
        state: "denied",
        eventType: "consent_denied",
        occurredAt: "2026-06-04T12:10:00.000Z"
      }
    ]);
  });
});
