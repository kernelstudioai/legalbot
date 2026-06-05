import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ZodError } from "zod";
import { loadEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import { resolveSqliteDatabasePath, sqliteMigrations } from "../persistence/sqlite/index.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";

export interface CaseDoctorCommandOptions {
  cwd?: string;
  envSource?: NodeJS.ProcessEnv;
  logger?: Logger;
  stdout?: {
    write(chunk: string): void;
  };
}

interface CaseDoctorMigrationStatus {
  applied_migration_count: number;
  pending_migration_count: number;
}

interface CaseDoctorConsistencyStatus {
  draft_case_count: number;
  draft_subject_count: number;
  duplicate_archived_case_count: number;
  duplicate_draft_case_count: number;
  duplicate_draft_subject_count: number;
  draft_uniqueness_index_present: boolean;
}

export interface CaseDoctorReport {
  status: "healthy" | "anomaly_detected";
  migration_status: CaseDoctorMigrationStatus;
  case_consistency: CaseDoctorConsistencyStatus;
  remediation: {
    action: "none" | "run_db_migrate" | "manual_case_review";
    summary: string;
  };
}

export interface CaseDoctorSummary extends DbCommandSummary {
  report?: CaseDoctorReport;
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "unknown_error";
};

const countPendingMigrations = (appliedMigrationIds: string[]): number =>
  sqliteMigrations.filter((migration) => !appliedMigrationIds.includes(migration.id)).length;

const getAppliedMigrationIds = (database: DatabaseSync): string[] =>
  (
    database
      .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id ASC")
      .all() as Array<{ migration_id: string }>
  ).map((row) => row.migration_id);

const requireMigratedDatabase = ({
  databaseUrl,
  cwd
}: {
  databaseUrl: string;
  cwd: string;
}): {
  database: DatabaseSync;
  migrationStatus: CaseDoctorMigrationStatus;
} => {
  const databasePath = resolveSqliteDatabasePath(databaseUrl, cwd);

  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error(
      "Case doctor requires an existing migrated SQLite database. Run npm run db:migrate first."
    );
  }

  const database = new DatabaseSync(databasePath);

  try {
    const migrationTable = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'schema_migrations'
        `
      )
      .get() as { name: string } | undefined;

    if (!migrationTable) {
      throw new Error("Case doctor requires existing migrations. Run npm run db:migrate first.");
    }

    const appliedMigrationIds = getAppliedMigrationIds(database);
    const pendingMigrationCount = countPendingMigrations(appliedMigrationIds);

    if (pendingMigrationCount > 0) {
      throw new Error(
        `Case doctor requires completed migrations. Pending migration count: ${pendingMigrationCount}. Run npm run db:migrate first.`
      );
    }

    return {
      database,
      migrationStatus: {
        applied_migration_count: appliedMigrationIds.length,
        pending_migration_count: pendingMigrationCount
      }
    };
  } catch (error) {
    database.close();
    throw error;
  }
};

const getCount = (database: DatabaseSync, sql: string): number =>
  Number((database.prepare(sql).get() as { count: number }).count);

const inspectCaseConsistency = (database: DatabaseSync): CaseDoctorConsistencyStatus => {
  const draftUniquenessIndexPresent =
    database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'index' AND name = 'cases_one_draft_per_subject_id'
        `
      )
      .get() !== undefined;

  const duplicateDraftSubjectCount = getCount(
    database,
    `
      SELECT COUNT(*) AS count
      FROM (
        SELECT subject_id
        FROM cases
        WHERE status = 'draft'
        GROUP BY subject_id
        HAVING COUNT(*) > 1
      )
    `
  );
  const duplicateDraftCaseCount = getCount(
    database,
    `
      SELECT COALESCE(SUM(draft_count - 1), 0) AS count
      FROM (
        SELECT COUNT(*) AS draft_count
        FROM cases
        WHERE status = 'draft'
        GROUP BY subject_id
        HAVING COUNT(*) > 1
      )
    `
  );

  return {
    draft_case_count: getCount(database, "SELECT COUNT(*) AS count FROM cases WHERE status = 'draft'"),
    draft_subject_count: getCount(
      database,
      "SELECT COUNT(DISTINCT subject_id) AS count FROM cases WHERE status = 'draft'"
    ),
    duplicate_archived_case_count: getCount(
      database,
      "SELECT COUNT(*) AS count FROM cases WHERE status = 'duplicate_archived'"
    ),
    duplicate_draft_case_count: duplicateDraftCaseCount,
    duplicate_draft_subject_count: duplicateDraftSubjectCount,
    draft_uniqueness_index_present: draftUniquenessIndexPresent
  };
};

const createCaseDoctorReport = (
  migrationStatus: CaseDoctorMigrationStatus,
  consistencyStatus: CaseDoctorConsistencyStatus
): CaseDoctorReport => {
  const anomalyDetected =
    !consistencyStatus.draft_uniqueness_index_present ||
    consistencyStatus.duplicate_draft_subject_count > 0 ||
    consistencyStatus.duplicate_draft_case_count > 0;

  if (!anomalyDetected) {
    return {
      status: "healthy",
      migration_status: migrationStatus,
      case_consistency: consistencyStatus,
      remediation: {
        action: "none",
        summary: "No case consistency anomalies detected."
      }
    };
  }

  return {
    status: "anomaly_detected",
    migration_status: migrationStatus,
    case_consistency: consistencyStatus,
    remediation: {
      action: "manual_case_review",
      summary:
        "Draft case anomalies detected. Review case state manually before attempting further manual case creation."
    }
  };
};

const toLogMeta = (report: CaseDoctorReport): Record<string, unknown> => ({
  status: report.status,
  migration_status: report.migration_status,
  case_consistency: report.case_consistency,
  remediation: report.remediation
});

export const runCaseDoctorCommand = ({
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger,
  stdout = process.stdout
}: CaseDoctorCommandOptions = {}): CaseDoctorSummary => {
  let database: DatabaseSync | undefined;

  try {
    const env = loadEnv(envSource);

    logger.info("case_doctor_starting", {
      migrations_enabled: env.DATABASE_MIGRATIONS_ENABLED
    });

    const verified = requireMigratedDatabase({
      databaseUrl: env.DATABASE_URL,
      cwd
    });
    database = verified.database;

    const report = createCaseDoctorReport(
      verified.migrationStatus,
      inspectCaseConsistency(database)
    );

    stdout.write(`${JSON.stringify(report)}\n`);
    logger.info("case_doctor_checked", toLogMeta(report));

    return {
      exitCode: report.status === "healthy" ? 0 : 1,
      report
    };
  } catch (error) {
    logger.error("case_doctor_failed", {
      error: toErrorMessage(error)
    });

    return {
      exitCode: 1
    };
  } finally {
    database?.close();
  }
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(runCaseDoctorCommand());
}
