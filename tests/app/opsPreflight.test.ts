import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";
import { runOpsPreflightCommand } from "../../src/app/opsPreflight.ts";

const tempDirectories: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-ops-preflight-"));
  tempDirectories.push(tempDir);
  return tempDir;
};

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

describe("ops preflight command", () => {
  it("prints a sanitized aggregate JSON report for a migrated live database", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();
    const databaseUrl = "file:./tmp/legalbot-m29.sqlite";

    runSqliteMigrations({
      cwd: tempDir,
      databaseUrl,
      enabled: true
    });

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567"
      },
      nodeVersion: "v22.3.0",
      repoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toMatchObject({
      status: "ready",
      node: {
        ok: true,
        majorVersion: 22
      },
      runtimeEnv: {
        minimalRequiredEnv: ["LAWYER_PHONE_E164"],
        lawyerPhoneConfigured: true,
        databaseUrlConfigured: true,
        databaseMigrationsExplicit: true,
        databaseMigrationsEnabled: true,
        businessPersistenceEnabled: true,
        statusServerEnabled: true
      },
      migrations: {
        appliedMigrationCount: 11,
        pendingMigrationCount: 0
      },
      businessCheck: {
        healthy: true,
        report: {
          status: "healthy",
          pendingMigrationCount: 0
        }
      },
      caseDoctor: {
        healthy: true,
        report: {
          status: "healthy",
          migration_status: {
            pending_migration_count: 0
          }
        }
      },
      repoHygiene: {
        ok: true
      },
      blockers: []
    });
    expect(stdout.output).toBe(`${JSON.stringify(summary.report)}\n`);
    expect(stdout.output).not.toContain("+15551234567");
    expect(stdout.output).not.toContain(tempDir);
  });

  it("fails when migrations are pending", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: "file:./tmp/legalbot-m29.sqlite",
        DATABASE_MIGRATIONS_ENABLED: "true",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567"
      },
      nodeVersion: "v22.3.0",
      repoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.status).toBe("blocking_failure");
    expect(summary.report.blockers).toContain("pending_migrations");
    expect(summary.report.blockers).toContain("business_check_failed");
    expect(summary.report.blockers).toContain("case_doctor_failed");
    expect(summary.report.migrations.pendingMigrationCount).toBe(11);
  });

  it("fails when business persistence is disabled", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();
    const databaseUrl = "file:./tmp/legalbot-m29.sqlite";

    runSqliteMigrations({
      cwd: tempDir,
      databaseUrl,
      enabled: true
    });

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true",
        BUSINESS_PERSISTENCE_ENABLED: "false",
        LAWYER_PHONE_E164: "+15551234567"
      },
      nodeVersion: "v22.3.0",
      repoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.blockers).toContain("business_persistence_disabled");
    expect(summary.report.blockers).toContain("business_check_failed");
    expect(summary.report.runtimeEnv.businessPersistenceEnabled).toBe(false);
  });

  it("fails when the migration policy is not explicit", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();
    const databaseUrl = "file:./tmp/legalbot-m29.sqlite";

    runSqliteMigrations({
      cwd: tempDir,
      databaseUrl,
      enabled: true
    });

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        BUSINESS_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567"
      },
      nodeVersion: "v22.3.0",
      repoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.blockers).toContain("database_migrations_policy_not_explicit");
    expect(summary.report.runtimeEnv.databaseMigrationsExplicit).toBe(false);
  });
});
