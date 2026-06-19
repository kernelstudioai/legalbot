import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
        transport: "openwa",
        minimalRequiredEnv: ["LAWYER_PHONE_E164"],
        lawyerPhoneConfigured: true,
        databaseUrlConfigured: true,
        databaseMigrationsExplicit: true,
        databaseMigrationsEnabled: true,
        businessPersistenceEnabled: true,
        statusServerEnabled: true,
        cloudApiVersionConfigured: false,
        cloudPhoneNumberIdConfigured: false,
        cloudVerifyTokenConfigured: false,
        cloudAccessTokenConfigured: false,
        cloudAppSecretConfigured: false,
        cloudSignatureVerificationEnforced: false,
        webhookPort: null
      },
      migrations: {
        appliedMigrationCount: 12,
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
    expect(summary.report.migrations.pendingMigrationCount).toBe(12);
  });

  it("validates a Cloud runtime preflight without leaking secrets", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();
    const databaseUrl = "file:./tmp/legalbot-cloud.sqlite";

    runSqliteMigrations({
      cwd: tempDir,
      databaseUrl,
      enabled: true
    });

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      dockerRunner: {
        run(args: string[]) {
          if (args.join(" ") === "--version") {
            return {
              exitCode: 0,
              stdout: "Docker version 27.0.0\n",
              stderr: ""
            };
          }

          return {
            exitCode: 0,
            stdout: "Docker Compose version v2.29.0\n",
            stderr: ""
          };
        }
      },
      envSource: {
        NODE_ENV: "production",
        WHATSAPP_TRANSPORT: "cloud",
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567",
        WHATSAPP_CLOUD_API_VERSION: "v22.0",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-token-123",
        WHATSAPP_CLOUD_ACCESS_TOKEN: "access-token-123",
        WHATSAPP_CLOUD_APP_SECRET: "app-secret-123",
        WHATSAPP_CLOUD_WEBHOOK_HOST: "0.0.0.0",
        WHATSAPP_CLOUD_WEBHOOK_PORT: "3002"
      },
      nodeVersion: "v22.3.0",
      repoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toMatchObject({
      status: "ready",
      runtimeEnv: {
        transport: "cloud",
        minimalRequiredEnv: [
          "WHATSAPP_TRANSPORT",
          "LAWYER_PHONE_E164",
          "WHATSAPP_CLOUD_API_VERSION",
          "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
          "WHATSAPP_CLOUD_VERIFY_TOKEN",
          "WHATSAPP_CLOUD_ACCESS_TOKEN"
        ],
        lawyerPhoneConfigured: true,
        databaseUrlConfigured: true,
        databaseMigrationsExplicit: true,
        databaseMigrationsEnabled: true,
        businessPersistenceEnabled: true,
        statusServerEnabled: false,
        cloudApiVersionConfigured: true,
        cloudPhoneNumberIdConfigured: true,
        cloudVerifyTokenConfigured: true,
        cloudAccessTokenConfigured: true,
        cloudAppSecretConfigured: true,
        cloudSignatureVerificationEnforced: true,
        webhookHostConfigured: true,
        webhookPort: 3002
      },
      docker: {
        required: true,
        dockerAvailable: true,
        composeAvailable: true,
        cloudServiceConfigured: true
      },
      runtimeDirectories: {
        ok: true
      },
      blockers: []
    });
    expect(stdout.output).not.toContain("verify-token-123");
    expect(stdout.output).not.toContain("access-token-123");
    expect(stdout.output).not.toContain("app-secret-123");
    expect(stdout.output).not.toContain("1234567890");
  });

  it("fails Cloud preflight in production when the app secret is missing", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();
    const databaseUrl = "file:./tmp/legalbot-cloud.sqlite";

    runSqliteMigrations({
      cwd: tempDir,
      databaseUrl,
      enabled: true
    });

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      dockerRunner: {
        run() {
          return {
            exitCode: 0,
            stdout: "Docker Compose version v2.29.0\n",
            stderr: ""
          };
        }
      },
      envSource: {
        NODE_ENV: "production",
        WHATSAPP_TRANSPORT: "cloud",
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567",
        WHATSAPP_CLOUD_API_VERSION: "v22.0",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-token-123",
        WHATSAPP_CLOUD_ACCESS_TOKEN: "access-token-123"
      },
      nodeVersion: "v22.3.0",
      repoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.blockers).toContain("cloud_app_secret_required_in_production");
    expect(summary.report.runtimeEnv.cloudSignatureVerificationEnforced).toBe(true);
    expect(summary.report.runtimeEnv.cloudAppSecretConfigured).toBe(false);
    expect(stdout.output).not.toContain("verify-token-123");
    expect(stdout.output).not.toContain("access-token-123");
    expect(stdout.output).not.toContain("1234567890");
  });

  it("fails Cloud preflight when the operator phone is missing", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();
    const databaseUrl = "file:./tmp/legalbot-cloud.sqlite";

    runSqliteMigrations({
      cwd: tempDir,
      databaseUrl,
      enabled: true
    });

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      dockerRunner: {
        run() {
          return {
            exitCode: 0,
            stdout: "Docker Compose version v2.29.0\n",
            stderr: ""
          };
        }
      },
      envSource: {
        NODE_ENV: "production",
        WHATSAPP_TRANSPORT: "cloud",
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        WHATSAPP_CLOUD_API_VERSION: "v22.0",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-token-123",
        WHATSAPP_CLOUD_ACCESS_TOKEN: "access-token-123",
        WHATSAPP_CLOUD_APP_SECRET: "app-secret-123"
      },
      nodeVersion: "v22.3.0",
      repoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.runtimeEnv.lawyerPhoneConfigured).toBe(false);
    expect(summary.report.blockers).toContain("lawyer_phone_missing");
    expect(stdout.output).not.toContain("verify-token-123");
    expect(stdout.output).not.toContain("access-token-123");
    expect(stdout.output).not.toContain("app-secret-123");
    expect(stdout.output).not.toContain("1234567890");
  });

  it("fails Cloud preflight when Docker Compose is unavailable or runtime directories are not writable", () => {
    const tempDir = createTempDir();
    const stdout = createStdout();
    const missingRepoRoot = path.join(tempDir, "missing-repo", "nested");
    writeFileSync(path.join(tempDir, ".gitignore"), "data/\nbackups/\nlogs/\ntmp/\nopenwa-session/\n");

    const summary = runOpsPreflightCommand({
      cwd: tempDir,
      dockerRunner: {
        run(args: string[]) {
          if (args.join(" ") === "--version") {
            return {
              exitCode: 0,
              stdout: "Docker version 27.0.0\n",
              stderr: ""
            };
          }

          return {
            exitCode: 1,
            stdout: "",
            stderr: "compose plugin unavailable in /opt/legalbot/private/path"
          };
        }
      },
      envSource: {
        NODE_ENV: "production",
        WHATSAPP_TRANSPORT: "cloud",
        DATABASE_URL: "file:./tmp/legalbot-cloud.sqlite",
        DATABASE_MIGRATIONS_ENABLED: "true",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        LAWYER_PHONE_E164: "+15551234567",
        WHATSAPP_CLOUD_API_VERSION: "v22.0",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-token-123",
        WHATSAPP_CLOUD_ACCESS_TOKEN: "access-token-123",
        WHATSAPP_CLOUD_APP_SECRET: "app-secret-123"
      },
      nodeVersion: "v22.3.0",
      repoRoot: missingRepoRoot,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.report.blockers).toContain(
      "docker_compose_unavailable:compose plugin unavailable in redacted_path"
    );
    expect(summary.report.blockers).toContain("compose_service_missing");
    expect(summary.report.blockers).toContain("required_runtime_directories_not_gitignored");
    expect(summary.report.blockers).toContain("required_runtime_directories_not_creatable");
    expect(summary.report.blockers).toContain("required_runtime_directories_not_writable");
    expect(summary.report.runtimeDirectories.ok).toBe(false);
    expect(stdout.output).not.toContain("verify-token-123");
    expect(stdout.output).not.toContain("access-token-123");
    expect(stdout.output).not.toContain("app-secret-123");
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
