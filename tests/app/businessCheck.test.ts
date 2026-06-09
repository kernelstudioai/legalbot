import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { createSqlitePersistenceService } from "../../src/persistence/index.ts";
import { openSqliteDatabase, runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";
import { runBusinessCheckCommand } from "../../src/app/businessCheck.ts";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-business-check-"));
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

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("business check command", () => {
  it("prints only sanitized aggregate fields for a healthy migrated database", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";

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
      await persistence.setConsentState("15551234567@c.us", "granted");
      await persistence.setIntakeState("15551234567@c.us", "intake_complete");
      await persistence.setIntakeField("15551234567@c.us", "firstName", "Mario");
      await persistence.setIntakeField("15551234567@c.us", "lastName", "Rossi");
      await persistence.setIntakeField("15551234567@c.us", "birthDate", "01/01/1980");
      await persistence.setIntakeField("15551234567@c.us", "city", "Roma");
      await persistence.setIntakeField(
        "15551234567@c.us",
        "problemSummary",
        "Private message body must never print"
      );
      await persistence.createCase({
        caseId: "CASE-0001",
        subjectId: "15551234567@c.us",
        status: "draft",
        name: "Mario Rossi",
        problemSummary: "Private message body must never print",
        createdAt: "2026-06-09T10:00:00.000Z",
        updatedAt: "2026-06-09T10:00:00.000Z"
      });
    } finally {
      persistence.close();
    }

    const summary = runBusinessCheckCommand({
      cwd: tempDir,
      envSource: {
        BUSINESS_PERSISTENCE_ENABLED: "true",
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toEqual({
      status: "healthy",
      sourceDatabase: databaseUrl,
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      migrationCount: 11,
      pendingMigrationCount: 0,
      consentStateCounts: {
        total: 1,
        granted: 1
      },
      intakeStateCounts: {
        total: 1,
        intake_complete: 1
      },
      completedIntakeCount: 1,
      draftCaseCount: 1,
      duplicateDraftSubjectCount: 0,
      consistencyErrors: []
    });
    expect(stdout.output).toBe(`${JSON.stringify(summary.report)}\n`);
    expect(stdout.output).not.toContain("15551234567@c.us");
    expect(stdout.output).not.toContain("CASE-0001");
    expect(stdout.output).not.toContain("Mario Rossi");
    expect(stdout.output).not.toContain("message body");
  });

  it("fails with sanitized aggregate output when migrations are pending", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: false
    });

    const summary = runBusinessCheckCommand({
      cwd: tempDir,
      envSource: {
        BUSINESS_PERSISTENCE_ENABLED: "true",
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report).toMatchObject({
      status: "consistency_errors_detected",
      sourceDatabase: databaseUrl,
      migrationCount: 0,
      pendingMigrationCount: 11,
      consentStateCounts: {
        total: 0
      },
      intakeStateCounts: {
        total: 0
      },
      completedIntakeCount: 0,
      draftCaseCount: 0,
      duplicateDraftSubjectCount: 0,
      consistencyErrors: ["pending_migrations"]
    });
    expect(stdout.output).toBe(`${JSON.stringify(summary.report)}\n`);
  });

  it("fails when duplicate draft subjects or missing completed intake relationships exist", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const { database } = openSqliteDatabase({
      databaseUrl,
      cwd: tempDir
    });

    try {
      database.exec("DROP INDEX cases_one_draft_per_subject_id;");
      database.exec(`
        INSERT INTO consent_states (subject_id, consent_state, updated_at, metadata_json)
        VALUES ('subject-a', 'requested', '2026-06-09T10:00:00.000Z', NULL);
      `);
      database.exec(`
        INSERT INTO intake_states (subject_id, intake_state, updated_at, metadata_json)
        VALUES ('subject-a', 'intake_complete', '2026-06-09T10:00:00.000Z', NULL);
      `);
      database.exec(`
        INSERT INTO intake_fields (subject_id, field_name, field_value, updated_at, metadata_json)
        VALUES
          ('subject-a', 'firstName', 'Mario', '2026-06-09T10:00:00.000Z', NULL),
          ('subject-a', 'problemSummary', 'hidden', '2026-06-09T10:00:00.000Z', NULL);
      `);
      database.exec(`
        INSERT INTO cases (case_id, subject_id, status, name, problem_summary, created_at, updated_at)
        VALUES
          ('CASE-1', 'subject-b', 'draft', 'Mario Rossi', 'hidden', '2026-06-09T10:00:00.000Z', '2026-06-09T10:00:00.000Z'),
          ('CASE-2', 'subject-b', 'draft', 'Mario Rossi', 'hidden', '2026-06-09T10:01:00.000Z', '2026-06-09T10:01:00.000Z');
      `);
    } finally {
      database.close();
    }

    const summary = runBusinessCheckCommand({
      cwd: tempDir,
      envSource: {
        BUSINESS_PERSISTENCE_ENABLED: "true",
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report?.consistencyErrors).toEqual([
      "completed_intake_without_granted_consent",
      "completed_intake_missing_required_fields",
      "draft_case_without_completed_intake",
      "draft_case_without_granted_consent",
      "duplicate_draft_subjects"
    ]);
    expect(stdout.output).not.toContain("subject-a");
    expect(stdout.output).not.toContain("subject-b");
    expect(stdout.output).not.toContain("CASE-1");
  });
});
