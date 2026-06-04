import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { runDbMigrateCommand, runDbStatusCommand } from "../../src/app/dbCommandCommon.ts";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-db-command-"));
  tempDirectories.push(tempDir);
  return tempDir;
};

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("db bootstrap commands", () => {
  it("db:migrate creates the parent data directory and runs migrations", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const databasePath = path.join(tempDir, "nested", "data", "legalbot.sqlite");

    const summary = runDbMigrateCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: "file:./nested/data/legalbot.sqlite",
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger
    });

    expect(summary.exitCode).toBe(0);
    expect(existsSync(databasePath)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith("db_migration_starting", {
      migrations_enabled: true
    });
    expect(logger.info).toHaveBeenCalledWith("db_migration_complete", {
      applied_migration_count: 3,
      applied_migration_ids: [
        "0001_create_cases",
        "0002_create_processed_messages",
        "0003_create_audit_events"
      ],
      database_path: databasePath,
      migrations_enabled: true,
      pending_migration_count: 0,
      pending_migration_ids: []
    });
  });

  it("db:migrate respects DATABASE_MIGRATIONS_ENABLED=false", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const databasePath = path.join(tempDir, "data", "legalbot.sqlite");

    const summary = runDbMigrateCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: "file:./data/legalbot.sqlite",
        DATABASE_MIGRATIONS_ENABLED: "false"
      },
      logger
    });

    expect(summary.exitCode).toBe(0);
    expect(existsSync(databasePath)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith("db_migration_skipped", {
      applied_migration_count: 0,
      applied_migration_ids: [],
      database_path: databasePath,
      migrations_enabled: false,
      pending_migration_count: 3,
      pending_migration_ids: [
        "0001_create_cases",
        "0002_create_processed_messages",
        "0003_create_audit_events"
      ]
    });
  });

  it("db:status reports pending and applied migrations without dumping table contents", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const databasePath = path.join(tempDir, "data", "legalbot.sqlite");

    const pendingSummary = runDbStatusCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl
      },
      logger
    });

    expect(pendingSummary.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith("db_status_checked", {
      applied_migration_count: 0,
      applied_migration_ids: [],
      database_path: databasePath,
      migrations_enabled: true,
      pending_migration_count: 3,
      pending_migration_ids: [
        "0001_create_cases",
        "0002_create_processed_messages",
        "0003_create_audit_events"
      ]
    });

    const firstStatusMeta = vi.mocked(logger.info).mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(firstStatusMeta).not.toHaveProperty("rows");
    expect(firstStatusMeta).not.toHaveProperty("message_body");

    runDbMigrateCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger: createLogger()
    });

    const statusLogger = createLogger();
    const appliedSummary = runDbStatusCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl
      },
      logger: statusLogger
    });

    expect(appliedSummary.exitCode).toBe(0);
    expect(statusLogger.info).toHaveBeenCalledWith("db_status_checked", {
      applied_migration_count: 3,
      applied_migration_ids: [
        "0001_create_cases",
        "0002_create_processed_messages",
        "0003_create_audit_events"
      ],
      database_path: databasePath,
      migrations_enabled: true,
      pending_migration_count: 0,
      pending_migration_ids: []
    });
  });

  it("fails safely for an invalid DATABASE_URL", () => {
    const logger = createLogger();

    const migrateSummary = runDbMigrateCommand({
      envSource: {
        DATABASE_URL: "postgres://example.invalid/legalbot"
      },
      logger
    });

    expect(migrateSummary.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith("db_operation_failed", {
      operation: "db:migrate",
      error: "Unsupported DATABASE_URL: postgres://example.invalid/legalbot"
    });
    const errorMeta = vi.mocked(logger.error).mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(errorMeta).not.toHaveProperty("database_url");
  });

  it("db:status does not require OpenWA runtime env vars", () => {
    const tempDir = createTempDir();
    const logger = createLogger();

    const summary = runDbStatusCommand({
      cwd: tempDir,
      envSource: {},
      logger
    });

    expect(summary.exitCode).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
