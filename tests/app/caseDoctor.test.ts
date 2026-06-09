import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { openSqliteDatabase, runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";
import { runCaseDoctorCommand } from "../../src/app/caseDoctor.ts";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-case-doctor-"));
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

describe("case doctor command", () => {
  it("passes on a healthy migrated database with sanitized output", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const summary = runCaseDoctorCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toEqual({
      status: "healthy",
      migration_status: {
        applied_migration_count: 11,
        pending_migration_count: 0
      },
      case_consistency: {
        draft_case_count: 0,
        draft_subject_count: 0,
        duplicate_archived_case_count: 0,
        duplicate_draft_case_count: 0,
        duplicate_draft_subject_count: 0,
        draft_uniqueness_index_present: true
      },
      remediation: {
        action: "none",
        summary: "No case consistency anomalies detected."
      }
    });
    expect(stdout.output).toBe(`${JSON.stringify(summary.report)}\n`);
    expect(stdout.output).not.toContain(tempDir);
    expect(stdout.output).not.toContain("subject_id");
    expect(stdout.output).not.toContain("problem_summary");
    expect(logger.info).toHaveBeenCalledWith("case_doctor_starting", {
      migrations_enabled: true
    });
    expect(logger.info).toHaveBeenCalledWith("case_doctor_checked", summary.report);
  });

  it("fails safely when migrations are missing", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();

    const summary = runCaseDoctorCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: "file:./data/legalbot.sqlite",
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report).toBeUndefined();
    expect(stdout.output).toBe("");
    expect(logger.error).toHaveBeenCalledWith("case_doctor_failed", {
      error: "Case doctor requires an existing migrated SQLite database. Run npm run db:migrate first."
    });
  });

  it("reports duplicate draft anomalies with counts only", () => {
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
          ('CASE-ANOMALY-1', 'subject-anomaly', 'draft', 'Mario Rossi', 'Transcript should stay private', '2026-06-05T09:00:00.000Z', '2026-06-05T09:00:00.000Z'),
          ('CASE-ANOMALY-2', 'subject-anomaly', 'draft', 'Mario Rossi', 'Secret body should stay private', '2026-06-05T09:05:00.000Z', '2026-06-05T09:05:00.000Z'),
          ('CASE-ANOMALY-3', 'subject-anomaly', 'duplicate_archived', 'Mario Rossi', 'Historical remediation only', '2026-06-05T09:10:00.000Z', '2026-06-05T09:10:00.000Z');
      `);
    } finally {
      database.close();
    }

    const summary = runCaseDoctorCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report).toEqual({
      status: "anomaly_detected",
      migration_status: {
        applied_migration_count: 11,
        pending_migration_count: 0
      },
      case_consistency: {
        draft_case_count: 2,
        draft_subject_count: 1,
        duplicate_archived_case_count: 1,
        duplicate_draft_case_count: 1,
        duplicate_draft_subject_count: 1,
        draft_uniqueness_index_present: false
      },
      remediation: {
        action: "manual_case_review",
        summary:
          "Draft case anomalies detected. Review case state manually before attempting further manual case creation."
      }
    });
    expect(stdout.output).toBe(`${JSON.stringify(summary.report)}\n`);
    expect(stdout.output).not.toContain("subject-anomaly");
    expect(stdout.output).not.toContain("Transcript should stay private");
    expect(stdout.output).not.toContain("Secret body should stay private");
    expect(stdout.output).not.toContain(tempDir);
    expect(logger.info).toHaveBeenCalledWith("case_doctor_checked", summary.report);
  });
});
