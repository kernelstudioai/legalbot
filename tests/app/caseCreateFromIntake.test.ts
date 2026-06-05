import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaseCreationService } from "../../src/domain/cases/caseCreationService.ts";
import type { Logger } from "../../src/logging/logger.ts";
import {
  createSqlitePersistenceService,
  type PersistenceCreateCaseWithAuditInput,
  type SqlitePersistenceService
} from "../../src/persistence/index.ts";
import {
  openSqliteDatabase,
  runSqliteMigrations
} from "../../src/persistence/sqlite/index.ts";
import { runCaseCreateFromIntakeCommand } from "../../src/app/caseCreateFromIntake.ts";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-case-create-"));
  tempDirectories.push(tempDir);
  return tempDir;
};

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createStdout = () => {
  let output = "";

  return {
    get output() {
      return output;
    },
    write(chunk: string) {
      output += chunk;
    }
  };
};

const seedCompletedIntake = async (
  persistence: SqlitePersistenceService,
  subjectId: string,
  options: {
    consentState?: "unknown" | "requested" | "granted" | "denied";
    intakeState?: "not_started" | "asking_name" | "asking_problem_summary" | "intake_complete";
    name?: string;
    problemSummary?: string;
  } = {}
): Promise<void> => {
  await persistence.setConsentState(subjectId, options.consentState ?? "granted");
  await persistence.setIntakeState(subjectId, options.intakeState ?? "intake_complete");

  if (options.name !== undefined) {
    await persistence.setIntakeField(subjectId, "name", options.name);
  }

  if (options.problemSummary !== undefined) {
    await persistence.setIntakeField(subjectId, "problemSummary", options.problemSummary);
  }
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("manual case creation command", () => {
  it("fails without a subject argument", async () => {
    const logger = createLogger();
    const stdout = createStdout();

    const summary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts"],
      envSource: {
        DATABASE_URL: "file:./data/legalbot.sqlite"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(logger.error).toHaveBeenCalledWith("case_create_from_intake_failed", {
      error: "Missing required --subject <subjectId> argument"
    });
  });

  it("fails when migrations are missing", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();

    const summary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts", "--subject", "subject-123"],
      cwd: tempDir,
      envSource: {
        DATABASE_URL: "file:./data/legalbot.sqlite",
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(logger.error).toHaveBeenCalledWith("case_create_from_intake_failed", {
      error:
        "Manual case creation requires an existing migrated SQLite database. Run npm run db:migrate first."
    });
  });

  it("fails when consent is not granted", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const subjectId = "subject-123";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const persistence = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      await seedCompletedIntake(persistence, subjectId, {
        consentState: "requested",
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema"
      });
    } finally {
      persistence.close();
    }

    const summary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts", "--subject", subjectId],
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(logger.error).toHaveBeenCalledWith("case_create_from_intake_failed", {
      code: "consent_not_granted",
      error: "Consent must be granted before creating a case. Received: requested"
    });
  });

  it("fails when intake is incomplete", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const subjectId = "subject-123";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const persistence = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      await seedCompletedIntake(persistence, subjectId, {
        intakeState: "asking_problem_summary",
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema"
      });
    } finally {
      persistence.close();
    }

    const summary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts", "--subject", subjectId],
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(stdout.output).toBe("");
    expect(logger.error).toHaveBeenCalledWith("case_create_from_intake_failed", {
      code: "intake_not_complete",
      error: "Intake must be complete before creating a case"
    });
  });

  it("creates a draft case with sanitized output when consent is granted and intake is complete", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const subjectId = "subject-123";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const persistence = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      await seedCompletedIntake(persistence, subjectId, {
        name: "Mario Rossi",
        problemSummary: "Client transcript secret should never print"
      });
    } finally {
      persistence.close();
    }

    const summary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts", "--subject", subjectId],
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.result).toMatchObject({
      caseId: expect.stringMatching(/^CASE-\d{8}-[A-F0-9]{10}$/),
      status: "draft",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    });
    expect(stdout.output).toBe(`${JSON.stringify(summary.result)}\n`);
    expect(stdout.output).not.toContain(subjectId);
    expect(stdout.output).not.toContain("Mario Rossi");
    expect(stdout.output).not.toContain("Client transcript secret should never print");
    expect(stdout.output).not.toContain("transcript");
    expect(stdout.output).not.toContain("secret");
    expect(logger.info).toHaveBeenCalledWith(
      "case_create_from_intake_complete",
      summary.result
    );
    const completionMeta = vi.mocked(logger.info).mock.calls.find(
      ([message]) => message === "case_create_from_intake_complete"
    )?.[1] as Record<string, unknown> | undefined;
    expect(completionMeta).toEqual(summary.result);
    expect(completionMeta).not.toHaveProperty("subjectId");
    expect(completionMeta).not.toHaveProperty("problemSummary");
    expect(completionMeta).not.toHaveProperty("body");
    expect(completionMeta).not.toHaveProperty("transcript");

    const { database, databasePath } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const caseRow = database
        .prepare(
          `
            SELECT case_id, status, created_at, problem_summary
            FROM cases
            WHERE subject_id = ?
          `
        )
        .get(subjectId) as
        | {
            case_id: string;
            status: string;
            created_at: string;
            problem_summary: string;
          }
        | undefined;
      const auditRow = database
        .prepare(
          `
            SELECT event_type, entity_id, metadata_json
            FROM audit_events
            WHERE event_type = 'case_created_from_intake'
          `
        )
        .get() as
        | {
            event_type: string;
            entity_id: string;
            metadata_json: string;
          }
        | undefined;

      expect(databasePath.startsWith(tempDir)).toBe(true);
      expect(caseRow).toMatchObject({
        case_id: summary.result?.caseId,
        status: "draft"
      });
      expect(auditRow).toMatchObject({
        event_type: "case_created_from_intake",
        entity_id: summary.result?.caseId
      });
      expect(caseRow?.problem_summary).toBe("Client transcript secret should never print");
      expect(JSON.parse(auditRow?.metadata_json ?? "{}")).toEqual({
        source: "completed_intake",
        consentState: "granted",
        intakeState: "intake_complete",
        acceptedFieldNames: ["name", "problemSummary"]
      });
    } finally {
      database.close();
    }
  });

  it("returns the existing draft case on repeated command runs without creating duplicates", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const subjectId = "subject-123";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const persistence = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      await seedCompletedIntake(persistence, subjectId, {
        name: "Mario Rossi",
        problemSummary: "Sintesi breve del problema"
      });
    } finally {
      persistence.close();
    }

    const firstSummary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts", "--subject", subjectId],
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });
    const firstOutput = stdout.output;

    const secondSummary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts", "--subject", subjectId],
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(firstSummary.exitCode).toBe(0);
    expect(secondSummary.exitCode).toBe(0);
    expect(secondSummary.result).toEqual(firstSummary.result);
    expect(stdout.output).toBe(`${firstOutput}${JSON.stringify(secondSummary.result)}\n`);
    expect(firstSummary.result).toBeDefined();

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      const caseRows = database
        .prepare(
          `
            SELECT case_id, subject_id, status
            FROM cases
            WHERE subject_id = ?
            ORDER BY created_at ASC
          `
        )
        .all(subjectId) as Array<{
        case_id: string;
        subject_id: string;
        status: string;
      }>;
      const auditRows = database
        .prepare(
          `
            SELECT event_type, entity_id, metadata_json
            FROM audit_events
            WHERE entity_id = ?
          `
        )
        .all(firstSummary.result!.caseId) as Array<{
        event_type: string;
        entity_id: string;
        metadata_json: string | null;
      }>;

      expect(caseRows).toEqual([
        {
          case_id: firstSummary.result!.caseId,
          subject_id: subjectId,
          status: "draft"
        }
      ]);
      expect(auditRows).toHaveLength(2);
      expect(auditRows.some((row) => row.event_type === "case_created_from_intake")).toBe(true);
      expect(auditRows.some((row) => row.event_type === "case_create_from_intake_idempotent_hit")).toBe(true);
      const idempotentHitRow = auditRows.find(
        (row) => row.event_type === "case_create_from_intake_idempotent_hit"
      );

      expect(auditRows.find((row) => row.event_type === "case_created_from_intake")).toMatchObject({
        event_type: "case_created_from_intake",
        entity_id: firstSummary.result!.caseId
      });
      expect(idempotentHitRow).toMatchObject({
        event_type: "case_create_from_intake_idempotent_hit",
        entity_id: firstSummary.result!.caseId
      });
      expect(JSON.parse(idempotentHitRow?.metadata_json ?? "{}")).toEqual({
        source: "completed_intake",
        existingStatus: "draft",
        acceptedFieldNames: ["name", "problemSummary"]
      });
      expect(idempotentHitRow?.metadata_json ?? "").not.toContain("body");
      expect(idempotentHitRow?.metadata_json ?? "").not.toContain("transcript");
    } finally {
      database.close();
    }
  });

  it("uses the transactional create-case boundary", async () => {
    const logger = createLogger();
    const stdout = createStdout();
    const createCaseWithAudit = vi.fn(
      async (input: PersistenceCreateCaseWithAuditInput) => ({
      caseRecord: {
        caseId: input.case.caseId,
        subjectId: input.case.subjectId,
        status: input.case.status ?? "draft",
        name: input.case.name,
        problemSummary: input.case.problemSummary,
        createdAt: input.case.createdAt,
        updatedAt: input.case.updatedAt
      },
      auditEvent: {
        ...input.auditEvent,
        occurredAt: input.auditEvent.occurredAt ?? input.case.createdAt
      }
      })
    );
    const persistence = {
      databasePath: "/tmp/legalbot.sqlite",
      close: vi.fn(),
      runInTransaction: async (operation: () => Promise<unknown>) => operation(),
      appendAuditEvent: vi.fn(),
      findDraftCaseBySubjectId: async () => null,
      getConsentState: async () => "granted",
      getIntakeSnapshot: async () => ({
        subjectId: "subject-123",
        state: "intake_complete",
        updatedAt: "2026-06-05T08:00:00.000Z",
        fields: {
          name: "Mario Rossi",
          problemSummary: "Structured summary"
        }
      }),
      createCaseWithAudit
    } as unknown as SqlitePersistenceService;

    const summary = await runCaseCreateFromIntakeCommand({
      argv: ["node", "src/app/caseCreateFromIntake.ts", "--subject", "subject-123"],
      envSource: {
        DATABASE_URL: "file:./data/legalbot.sqlite"
      },
      logger,
      stdout,
      verifyMigrationsApplied: () => ({
        appliedMigrationIds: [
          "0001_create_cases",
          "0009_harden_cases_schema",
          "0010_enforce_draft_case_uniqueness"
        ],
        databasePath: "/tmp/legalbot.sqlite"
      }),
      createSqlitePersistenceServiceFactory: () => persistence,
      createCaseCreationServiceFactory: ({ persistence: commandPersistence }) =>
        createCaseCreationService({
          persistence: commandPersistence,
          now: () => "2026-06-05T08:00:00.000Z"
        })
    });

    expect(summary.exitCode).toBe(0);
    expect(createCaseWithAudit).toHaveBeenCalledTimes(1);
    expect(createCaseWithAudit).toHaveBeenCalledWith({
      case: {
        caseId: expect.stringMatching(/^CASE-\d{8}-[A-F0-9]{10}$/),
        subjectId: "subject-123",
        status: "draft",
        name: "Mario Rossi",
        problemSummary: "Structured summary",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z"
      },
      auditEvent: {
        eventId: expect.stringMatching(/^audit-case-created-from-intake-CASE-/),
        eventType: "case_created_from_intake",
        entityType: "case",
        entityId: expect.stringMatching(/^CASE-\d{8}-[A-F0-9]{10}$/),
        occurredAt: "2026-06-05T08:00:00.000Z",
        metadata: {
          source: "completed_intake",
          consentState: "granted",
          intakeState: "intake_complete",
          acceptedFieldNames: ["name", "problemSummary"]
        }
      }
    });
    expect(persistence.close).toHaveBeenCalledTimes(1);
  });
});
