import { ZodError } from "zod";
import { loadEnv, loadSmokeRuntimeEnv } from "../config/env.ts";
import { getSqliteMigrationStatus } from "../persistence/sqlite/index.ts";
import { runBusinessCheckCommand, type BusinessCheckReport } from "./businessCheck.ts";
import { runCaseDoctorCommand, type CaseDoctorReport } from "./caseDoctor.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";
import {
  createBufferedStdout,
  hasGitIgnoreDirectoryEntry,
  parseNodeMajorVersion,
  silentLogger,
  toJsonStdout
} from "./opsCommandCommon.ts";

type PreflightStatus = "ready" | "blocking_failure";

interface OpsPreflightDirectoryCheck {
  ignored: boolean;
  path: string;
}

interface OpsPreflightReport {
  status: PreflightStatus;
  checkedAt: string;
  node: {
    currentVersion: string;
    majorVersion: number | null;
    requiredMajorVersion: 22;
    ok: boolean;
  };
  runtimeEnv: {
    minimalRequiredEnv: ["LAWYER_PHONE_E164"];
    lawyerPhoneConfigured: boolean;
    databaseUrlConfigured: boolean;
    databaseMigrationsExplicit: boolean;
    databaseMigrationsEnabled: boolean;
    businessPersistenceEnabled: boolean;
    statusServerEnabled: boolean;
  };
  migrations: {
    appliedMigrationCount: number;
    pendingMigrationCount: number;
  };
  businessCheck: {
    healthy: boolean;
    report: Pick<
      BusinessCheckReport,
      | "status"
      | "migrationCount"
      | "pendingMigrationCount"
      | "completedIntakeCount"
      | "draftCaseCount"
      | "duplicateDraftSubjectCount"
      | "consistencyErrors"
    > | null;
  };
  caseDoctor: {
    healthy: boolean;
    report: Pick<
      CaseDoctorReport,
      "status" | "migration_status" | "case_consistency" | "remediation"
    > | null;
  };
  repoHygiene: {
    requiredIgnoredDirectories: OpsPreflightDirectoryCheck[];
    ok: boolean;
  };
  blockers: string[];
}

export interface OpsPreflightCommandOptions {
  cwd?: string;
  envSource?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  repoRoot?: string;
  stdout?: {
    write(chunk: string): void;
  };
}

export interface OpsPreflightSummary extends DbCommandSummary {
  report: OpsPreflightReport;
}

const REQUIRED_IGNORED_DIRECTORIES = [
  "data",
  "backups",
  "openwa-session",
  "tmp",
  "logs"
] as const;

const toZodMessage = (error: ZodError): string =>
  error.issues.map((issue) => issue.message).join("; ");

const toBusinessCheckReport = (
  report: BusinessCheckReport | undefined
): OpsPreflightReport["businessCheck"]["report"] =>
  report
    ? {
        status: report.status,
        migrationCount: report.migrationCount,
        pendingMigrationCount: report.pendingMigrationCount,
        completedIntakeCount: report.completedIntakeCount,
        draftCaseCount: report.draftCaseCount,
        duplicateDraftSubjectCount: report.duplicateDraftSubjectCount,
        consistencyErrors: report.consistencyErrors
      }
    : null;

const toCaseDoctorReport = (
  report: CaseDoctorReport | undefined
): OpsPreflightReport["caseDoctor"]["report"] =>
  report
    ? {
        status: report.status,
        migration_status: report.migration_status,
        case_consistency: report.case_consistency,
        remediation: report.remediation
      }
    : null;

export const runOpsPreflightCommand = ({
  cwd = process.cwd(),
  envSource = process.env,
  nodeVersion = process.version,
  repoRoot = cwd,
  stdout = process.stdout
}: OpsPreflightCommandOptions = {}): OpsPreflightSummary => {
  const blockers: string[] = [];
  const nodeMajorVersion = parseNodeMajorVersion(nodeVersion);
  const nodeOk = nodeMajorVersion === 22;

  if (!nodeOk) {
    blockers.push("node_22_required");
  }

  let lawyerPhoneConfigured = false;
  let statusServerEnabled = false;
  let env = loadEnv(envSource);

  try {
    const runtimeEnv = loadSmokeRuntimeEnv(envSource);
    lawyerPhoneConfigured = runtimeEnv.LAWYER_PHONE_E164.length > 0;
    statusServerEnabled = runtimeEnv.OPENWA_STATUS_SERVER_ENABLED;
  } catch (error) {
    if (error instanceof ZodError) {
      blockers.push(`runtime_env_invalid:${toZodMessage(error)}`);
    } else {
      blockers.push("runtime_env_invalid");
    }
  }

  if (!lawyerPhoneConfigured) {
    blockers.push("lawyer_phone_missing");
  }

  const databaseUrlConfigured = env.DATABASE_URL.trim().length > 0;
  if (!databaseUrlConfigured) {
    blockers.push("database_url_missing");
  }

  const databaseMigrationsExplicit = envSource.DATABASE_MIGRATIONS_ENABLED !== undefined;
  if (!databaseMigrationsExplicit) {
    blockers.push("database_migrations_policy_not_explicit");
  }

  if (env.BUSINESS_PERSISTENCE_ENABLED !== true) {
    blockers.push("business_persistence_disabled");
  }

  const migrationStatus = getSqliteMigrationStatus({
    cwd,
    databaseUrl: env.DATABASE_URL
  });

  if (migrationStatus.pendingMigrationIds.length > 0) {
    blockers.push("pending_migrations");
  }

  const businessStdout = createBufferedStdout();
  const businessSummary = runBusinessCheckCommand({
    cwd,
    envSource,
    logger: silentLogger,
    stdout: businessStdout.stdout
  });

  if (businessSummary.exitCode !== 0) {
    blockers.push("business_check_failed");
  }

  const caseDoctorStdout = createBufferedStdout();
  const caseDoctorSummary = runCaseDoctorCommand({
    cwd,
    envSource,
    logger: silentLogger,
    stdout: caseDoctorStdout.stdout
  });

  if (caseDoctorSummary.exitCode !== 0) {
    blockers.push("case_doctor_failed");
  }

  const requiredIgnoredDirectories = REQUIRED_IGNORED_DIRECTORIES.map((directory) => ({
    path: `${directory}/`,
      ignored: hasGitIgnoreDirectoryEntry({
      cwd: repoRoot,
      directory
    })
  }));

  if (requiredIgnoredDirectories.some((entry) => !entry.ignored)) {
    blockers.push("required_runtime_directories_not_gitignored");
  }

  const report: OpsPreflightReport = {
    status: blockers.length === 0 ? "ready" : "blocking_failure",
    checkedAt: new Date().toISOString(),
    node: {
      currentVersion: nodeVersion,
      majorVersion: nodeMajorVersion,
      requiredMajorVersion: 22,
      ok: nodeOk
    },
    runtimeEnv: {
      minimalRequiredEnv: ["LAWYER_PHONE_E164"],
      lawyerPhoneConfigured,
      databaseUrlConfigured,
      databaseMigrationsExplicit,
      databaseMigrationsEnabled: env.DATABASE_MIGRATIONS_ENABLED,
      businessPersistenceEnabled: env.BUSINESS_PERSISTENCE_ENABLED,
      statusServerEnabled
    },
    migrations: {
      appliedMigrationCount: migrationStatus.appliedMigrationIds.length,
      pendingMigrationCount: migrationStatus.pendingMigrationIds.length
    },
    businessCheck: {
      healthy: businessSummary.exitCode === 0,
      report: toBusinessCheckReport(businessSummary.report)
    },
    caseDoctor: {
      healthy: caseDoctorSummary.exitCode === 0,
      report: toCaseDoctorReport(caseDoctorSummary.report)
    },
    repoHygiene: {
      requiredIgnoredDirectories,
      ok: requiredIgnoredDirectories.every((entry) => entry.ignored)
    },
    blockers
  };

  toJsonStdout(report, stdout);

  return {
    exitCode: report.status === "ready" ? 0 : 1,
    report
  };
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(runOpsPreflightCommand());
}
