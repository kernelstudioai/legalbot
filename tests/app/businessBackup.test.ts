import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { createSqlitePersistenceService } from "../../src/persistence/index.ts";
import { runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";
import { runBusinessBackupCommand } from "../../src/app/businessBackup.ts";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-business-backup-"));
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

describe("business backup command", () => {
  it("creates a sanitized backup file under the ignored backups directory", async () => {
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
        "Private transcript must stay out of operator output"
      );
    } finally {
      persistence.close();
    }

    const summary = runBusinessBackupCommand({
      cwd: tempDir,
      envSource: {
        BUSINESS_PERSISTENCE_ENABLED: "true",
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toBeDefined();
    expect(summary.report).toMatchObject({
      status: "backup_created",
      sourceDatabase: databaseUrl,
      backupPath: expect.stringMatching(/^backups[\\/].+\.sqlite$/),
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      migrationCount: 11
    });
    expect(summary.report!.sizeBytes).toBeGreaterThan(0);

    const backupPath = path.join(tempDir, summary.report!.backupPath);
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath).byteLength).toBe(summary.report!.sizeBytes);
    expect(stdout.output).toBe(`${JSON.stringify(summary.report)}\n`);
    expect(stdout.output).not.toContain("15551234567@c.us");
    expect(stdout.output).not.toContain("Mario");
    expect(stdout.output).not.toContain("transcript");
    expect(logger.info).toHaveBeenCalledWith("business_backup_complete", expect.objectContaining({
      status: "backup_created",
      backupPath: summary.report!.backupPath,
      migrationCount: 11
    }));
  });

  it("fails safely when migrations are pending", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: false
    });

    const summary = runBusinessBackupCommand({
      cwd: tempDir,
      envSource: {
        BUSINESS_PERSISTENCE_ENABLED: "true",
        DATABASE_URL: databaseUrl
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report).toBeUndefined();
    expect(stdout.output).toBe("");
    expect(logger.error).toHaveBeenCalledWith("business_backup_failed", {
      error:
        "Business backup requires completed migrations. Pending migration count: 11. Run npm run db:migrate first."
    });
  });
});
