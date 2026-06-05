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
  IntakeEventRecord,
  IntakeFieldName,
  IntakeState,
  IntakeStore,
  ProcessedMessageStore,
  SetConsentStateOptions,
  SetIntakeFieldOptions,
  SetIntakeStateOptions
} from "../../src/persistence/index.ts";
import {
  InMemoryCaseStore,
  InMemoryConsentStore,
  InMemoryIntakeStore,
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

class CapturingIntakeStore implements IntakeStore {
  stateBySubject = new Map<
    string,
    {
      state: "not_started" | "asking_name" | "asking_problem_summary" | "intake_complete";
      updatedAt: string;
      metadata?: Record<string, unknown>;
    }
  >();
  fieldBySubject = new Map<
    string,
    Map<
      IntakeFieldName,
      {
        value: string;
        updatedAt: string;
        metadata?: Record<string, unknown>;
      }
    >
  >();
  events: IntakeEventRecord[] = [];

  async getIntakeState(subjectId: string) {
    return this.stateBySubject.get(subjectId)?.state ?? "not_started";
  }

  async setIntakeState(
    subjectId: string,
    state: IntakeState,
    options: SetIntakeStateOptions = {}
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

  async setIntakeField(
    subjectId: string,
    fieldName: IntakeFieldName,
    value: string,
    options: SetIntakeFieldOptions = {}
  ) {
    if (!["name", "problemSummary"].includes(fieldName)) {
      throw new Error(`Unsupported intake field: ${fieldName}`);
    }

    const record = {
      subjectId,
      fieldName,
      value,
      updatedAt: options.updatedAt ?? "2026-06-04T12:04:00.000Z",
      ...(options.metadata ? { metadata: options.metadata } : {})
    };
    const subjectFields = this.fieldBySubject.get(subjectId) ?? new Map();
    subjectFields.set(fieldName, {
      value,
      updatedAt: record.updatedAt,
      ...(record.metadata ? { metadata: record.metadata } : {})
    });
    this.fieldBySubject.set(subjectId, subjectFields);

    return record;
  }

  async getIntakeSnapshot(subjectId: string) {
    const state = this.stateBySubject.get(subjectId);
    const fields = this.fieldBySubject.get(subjectId);

    if (!state && !fields) {
      return null;
    }

    return {
      subjectId,
      state: state?.state ?? "not_started",
      updatedAt: state?.updatedAt ?? "2026-06-04T12:04:00.000Z",
      fields: Object.fromEntries(
        [...(fields?.entries() ?? [])].map(([fieldName, record]) => [fieldName, record.value])
      )
    };
  }

  async appendIntakeEvent(event: IntakeEventRecord): Promise<void> {
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
      intakeStore: new CapturingIntakeStore(),
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
      intakeStore: new InMemoryIntakeStore(),
      now: () => "2026-06-04T12:05:00.000Z"
    });

    const created = await service.createCase({
      caseId: "case-1",
      subjectId: "subject-1",
      name: "Mario Rossi",
      problemSummary: "Sintesi breve del problema",
      createdAt: "2026-06-04T12:04:00.000Z",
      updatedAt: "2026-06-04T12:04:00.000Z"
    });

    expect(created.status).toBe("draft");
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
      await expect(service.getIntakeState("subject-sqlite-1")).resolves.toBe("not_started");
      await expect(
        service.setIntakeState("subject-sqlite-1", "asking_problem_summary", {
          updatedAt: "2026-06-04T12:08:30.000Z",
          metadata: {
            source: "sqlite-test",
            body: "remove me"
          }
        })
      ).resolves.toEqual({
        record: {
          subjectId: "subject-sqlite-1",
          state: "asking_problem_summary",
          updatedAt: "2026-06-04T12:08:30.000Z",
          metadata: {
            source: "sqlite-test"
          }
        },
        sanitizedMetadata: {
          source: "sqlite-test"
        }
      });
      await expect(
        service.setIntakeField("subject-sqlite-1", "name", "Mario Rossi", {
          updatedAt: "2026-06-04T12:09:00.000Z",
          metadata: {
            source: "sqlite-test",
            content: "remove me"
          }
        })
      ).resolves.toEqual({
        record: {
          subjectId: "subject-sqlite-1",
          fieldName: "name",
          value: "Mario Rossi",
          updatedAt: "2026-06-04T12:09:00.000Z",
          metadata: {
            source: "sqlite-test"
          }
        },
        sanitizedMetadata: {
          source: "sqlite-test"
        }
      });
      await expect(
        service.getIntakeSnapshot("subject-sqlite-1")
      ).resolves.toEqual({
        subjectId: "subject-sqlite-1",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:08:30.000Z",
        fields: {
          name: "Mario Rossi"
        }
      });
      await expect(
        service.appendIntakeEvent({
          eventId: "intake-event-sqlite-1",
          subjectId: "subject-sqlite-1",
          eventType: "intake_field_accepted",
          state: "asking_problem_summary",
          fieldName: "name",
          occurredAt: "2026-06-04T12:09:30.000Z",
          metadata: {
            source: "sqlite-test",
            text: "remove me"
          }
        })
      ).resolves.toEqual({
        event: {
          eventId: "intake-event-sqlite-1",
          subjectId: "subject-sqlite-1",
          eventType: "intake_field_accepted",
          state: "asking_problem_summary",
          fieldName: "name",
          occurredAt: "2026-06-04T12:09:30.000Z",
          metadata: {
            source: "sqlite-test"
          }
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

      const intakeStateRow = database
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
        .get("subject-sqlite-1") as
        | {
            subject_id: string;
            intake_state: string;
            updated_at: string;
            metadata_json: string | null;
          }
        | undefined;
      const intakeFieldRow = database
        .prepare(
          `
            SELECT
              subject_id,
              field_name,
              field_value,
              updated_at,
              metadata_json
            FROM intake_fields
            WHERE subject_id = ? AND field_name = ?
          `
        )
        .get("subject-sqlite-1", "name") as
        | {
            subject_id: string;
            field_name: string;
            field_value: string;
            updated_at: string;
            metadata_json: string | null;
          }
        | undefined;
      const intakeEventRow = database
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
        .get("intake-event-sqlite-1") as
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

      expect(intakeStateRow).toEqual({
        subject_id: "subject-sqlite-1",
        intake_state: "asking_problem_summary",
        updated_at: "2026-06-04T12:08:30.000Z",
        metadata_json: JSON.stringify({
          source: "sqlite-test"
        })
      });
      expect(intakeFieldRow).toEqual({
        subject_id: "subject-sqlite-1",
        field_name: "name",
        field_value: "Mario Rossi",
        updated_at: "2026-06-04T12:09:00.000Z",
        metadata_json: JSON.stringify({
          source: "sqlite-test"
        })
      });
      expect(intakeEventRow).toEqual({
        event_id: "intake-event-sqlite-1",
        subject_id: "subject-sqlite-1",
        event_type: "intake_field_accepted",
        intake_state: "asking_problem_summary",
        field_name: "name",
        occurred_at: "2026-06-04T12:09:30.000Z",
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
        subjectId: "memory-subject-1",
        name: "Giulia Verdi",
        problemSummary: "Richiesta iniziale sintetica"
      })
    ).resolves.toMatchObject({
      caseId: "case-memory-1",
      subjectId: "memory-subject-1",
      name: "Giulia Verdi",
      problemSummary: "Richiesta iniziale sintetica"
    });
    await expect(service.getConsentState("memory-subject")).resolves.toBe("unknown");
    await expect(service.getIntakeState("memory-subject")).resolves.toBe("not_started");
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
      consentStore: new CapturingConsentStore(),
      intakeStore: new CapturingIntakeStore()
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
    const intakeStore = new CapturingIntakeStore();
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
      intakeStore,
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

  it("persists sanitized intake state, fields, snapshots, and events", async () => {
    const intakeStore = new CapturingIntakeStore();
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
      consentStore: new CapturingConsentStore(),
      intakeStore,
      now: () => "2026-06-04T12:11:00.000Z"
    });

    await expect(service.getIntakeState("subject-intake-1")).resolves.toBe("not_started");

    const stateResult = await service.setIntakeState("subject-intake-1", "asking_name", {
      metadata: {
        source: "test",
        messageBody: "remove me",
        transportChatId: "15551234567@c.us",
        browserPath: "C:\\openwa-session\\profile"
      }
    });
    const fieldResult = await service.setIntakeField("subject-intake-1", "name", "Mario Rossi", {
      metadata: {
        source: "test",
        content: "remove me",
        phone: "+15551234567",
        nested: {
          text: "remove me",
          ok: true
        }
      }
    });
    const eventResult = await service.appendIntakeEvent({
      eventId: "intake-event-1",
      subjectId: "subject-intake-1",
      eventType: "intake_field_accepted",
      state: "asking_name",
      fieldName: "name",
      metadata: {
        body: "remove me",
        sessionPath: "/tmp/openwa-session/profile",
        safe: true
      }
    });

    expect(stateResult).toEqual({
      record: {
        subjectId: "subject-intake-1",
        state: "asking_name",
        updatedAt: "2026-06-04T12:11:00.000Z",
        metadata: {
          source: "test",
          transportChatId: "[redacted-phone]",
          browserPath: "[redacted-path]"
        }
      },
      sanitizedMetadata: {
        source: "test",
        transportChatId: "[redacted-phone]",
        browserPath: "[redacted-path]"
      }
    });
    expect(fieldResult).toEqual({
      record: {
        subjectId: "subject-intake-1",
        fieldName: "name",
        value: "Mario Rossi",
        updatedAt: "2026-06-04T12:11:00.000Z",
        metadata: {
          source: "test",
          phone: "[redacted-phone]",
          nested: {
            ok: true
          }
        }
      },
      sanitizedMetadata: {
        source: "test",
        phone: "[redacted-phone]",
        nested: {
          ok: true
        }
      }
    });
    expect(eventResult).toEqual({
      event: {
        eventId: "intake-event-1",
        subjectId: "subject-intake-1",
        eventType: "intake_field_accepted",
        state: "asking_name",
        fieldName: "name",
        occurredAt: "2026-06-04T12:11:00.000Z",
        metadata: {
          sessionPath: "[redacted-path]",
          safe: true
        }
      },
      sanitizedMetadata: {
        sessionPath: "[redacted-path]",
        safe: true
      }
    });
    await expect(service.getIntakeState("subject-intake-1")).resolves.toBe("asking_name");
    await expect(service.getIntakeSnapshot("subject-intake-1")).resolves.toEqual({
      subjectId: "subject-intake-1",
      state: "asking_name",
      updatedAt: "2026-06-04T12:11:00.000Z",
      fields: {
        name: "Mario Rossi"
      }
    });
    await expect(
      service.setIntakeField("subject-intake-1", "unknown" as IntakeFieldName, "nope")
    ).rejects.toThrow("Unsupported intake field: unknown");
    expect(intakeStore.events).toEqual([eventResult.event]);
  });

  it("in-memory intake store tracks state, accepted fields, and events", async () => {
    const store = new InMemoryIntakeStore();

    await expect(store.getIntakeState("subject-3")).resolves.toBe("not_started");
    await expect(store.getIntakeSnapshot("subject-3")).resolves.toBeNull();
    await expect(
      store.setIntakeState("subject-3", "asking_problem_summary", {
        updatedAt: "2026-06-04T12:12:00.000Z",
        metadata: {
          source: "memory"
        }
      })
    ).resolves.toEqual({
      subjectId: "subject-3",
      state: "asking_problem_summary",
      updatedAt: "2026-06-04T12:12:00.000Z",
      metadata: {
        source: "memory"
      }
    });
    await expect(
      store.setIntakeField("subject-3", "name", "Mario Rossi", {
        updatedAt: "2026-06-04T12:12:00.000Z"
      })
    ).resolves.toEqual({
      subjectId: "subject-3",
      fieldName: "name",
      value: "Mario Rossi",
      updatedAt: "2026-06-04T12:12:00.000Z"
    });
    await expect(
      store.setIntakeField("subject-3", "problemSummary", "Sintesi breve", {
        updatedAt: "2026-06-04T12:13:00.000Z"
      })
    ).resolves.toEqual({
      subjectId: "subject-3",
      fieldName: "problemSummary",
      value: "Sintesi breve",
      updatedAt: "2026-06-04T12:13:00.000Z"
    });
    await store.appendIntakeEvent({
      eventId: "intake-event-memory-1",
      subjectId: "subject-3",
      eventType: "intake_complete",
      state: "intake_complete",
      occurredAt: "2026-06-04T12:14:00.000Z"
    });

    await expect(store.getIntakeSnapshot("subject-3")).resolves.toEqual({
      subjectId: "subject-3",
      state: "asking_problem_summary",
      updatedAt: "2026-06-04T12:12:00.000Z",
      fields: {
        name: "Mario Rossi",
        problemSummary: "Sintesi breve"
      }
    });
    await expect(
      store.setIntakeField("subject-3", "unknown" as IntakeFieldName, "bad")
    ).rejects.toThrow("Unsupported intake field: unknown");
    expect(store.snapshotStates()).toEqual([
      {
        subjectId: "subject-3",
        state: "asking_problem_summary",
        updatedAt: "2026-06-04T12:12:00.000Z",
        metadata: {
          source: "memory"
        }
      }
    ]);
    expect(store.snapshotFields()).toEqual([
      {
        subjectId: "subject-3",
        fieldName: "name",
        value: "Mario Rossi",
        updatedAt: "2026-06-04T12:12:00.000Z"
      },
      {
        subjectId: "subject-3",
        fieldName: "problemSummary",
        value: "Sintesi breve",
        updatedAt: "2026-06-04T12:13:00.000Z"
      }
    ]);
    expect(store.snapshotEvents()).toEqual([
      {
        eventId: "intake-event-memory-1",
        subjectId: "subject-3",
        eventType: "intake_complete",
        state: "intake_complete",
        occurredAt: "2026-06-04T12:14:00.000Z"
      }
    ]);
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
