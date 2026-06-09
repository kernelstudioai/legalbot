import {
  createIgnoredBackupPath,
  defaultBusinessCommandOptions,
  getFileSizeBytes,
  quoteSqliteString,
  requireBusinessPersistenceEnv,
  sanitizePathForOutput,
  toBusinessCommandErrorMessage,
  verifyBusinessDatabase,
  type BusinessCommandOptions
} from "./businessPersistenceCommandCommon.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";

export interface BusinessBackupReport {
  status: "backup_created";
  sourceDatabase: string;
  backupPath: string;
  createdAt: string;
  sizeBytes: number;
  migrationCount: number;
}

export interface BusinessBackupSummary extends DbCommandSummary {
  report?: BusinessBackupReport;
}

export const runBusinessBackupCommand = (
  options: BusinessCommandOptions = {}
): BusinessBackupSummary => {
  const { cwd, envSource, logger, stdout } = defaultBusinessCommandOptions(options);
  let verifiedDatabase:
    | ReturnType<typeof verifyBusinessDatabase>
    | undefined;

  try {
    const env = requireBusinessPersistenceEnv(envSource);

    logger.info("business_backup_starting", {
      business_persistence_enabled: true
    });

    verifiedDatabase = verifyBusinessDatabase({
      cwd,
      databaseUrl: env.DATABASE_URL,
      operationLabel: "Business backup"
    });

    if (verifiedDatabase.pendingMigrationIds.length > 0) {
      throw new Error(
        `Business backup requires completed migrations. Pending migration count: ${verifiedDatabase.pendingMigrationIds.length}. Run npm run db:migrate first.`
      );
    }

    const backupTarget = createIgnoredBackupPath({ cwd });

    verifiedDatabase.database.exec(
      `VACUUM INTO ${quoteSqliteString(backupTarget.absoluteBackupPath)};`
    );

    const report: BusinessBackupReport = {
      status: "backup_created",
      sourceDatabase: env.DATABASE_URL,
      backupPath: backupTarget.relativeBackupPath,
      createdAt: backupTarget.createdAt,
      sizeBytes: getFileSizeBytes(backupTarget.absoluteBackupPath),
      migrationCount: verifiedDatabase.appliedMigrationIds.length
    };

    stdout.write(`${JSON.stringify(report)}\n`);
    logger.info("business_backup_complete", {
      ...report,
      sourceDatabase: sanitizePathForOutput(verifiedDatabase.databasePath, cwd)
    });

    return {
      exitCode: 0,
      report
    };
  } catch (error) {
    logger.error("business_backup_failed", {
      error: toBusinessCommandErrorMessage(error)
    });

    return {
      exitCode: 1
    };
  } finally {
    verifiedDatabase?.database.close();
  }
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(runBusinessBackupCommand());
}
