import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { loadEnv, type AppEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import {
  getSqliteMigrationStatus,
  runSqliteMigrations,
  type GetSqliteMigrationStatusResult,
  type RunSqliteMigrationsResult
} from "../persistence/sqlite/index.ts";

export interface DbCommandOptions {
  cwd?: string;
  envSource?: NodeJS.ProcessEnv;
  logger?: Logger;
}

export interface DbCommandProcessLike {
  argv: string[];
  exit(code?: number): never | void;
}

export interface DbCommandSummary {
  exitCode: number;
}

interface DbLogMeta {
  applied_migration_count: number;
  applied_migration_ids: string[];
  database_path: string;
  migrations_enabled: boolean;
  pending_migration_count: number;
  pending_migration_ids: string[];
}

const createDbLogMeta = (
  env: AppEnv,
  result: GetSqliteMigrationStatusResult | RunSqliteMigrationsResult
): Record<string, unknown> => ({
  applied_migration_count: result.appliedMigrationIds.length,
  applied_migration_ids: result.appliedMigrationIds,
  database_path: result.databasePath,
  migrations_enabled: env.DATABASE_MIGRATIONS_ENABLED,
  pending_migration_count: result.pendingMigrationIds.length,
  pending_migration_ids: result.pendingMigrationIds
});

const toErrorMessage = (error: unknown): string => {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "unknown_error";
};

export const runDbMigrateCommand = ({
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger
}: DbCommandOptions = {}): DbCommandSummary => {
  try {
    const env = loadEnv(envSource);

    logger.info("db_migration_starting", {
      migrations_enabled: env.DATABASE_MIGRATIONS_ENABLED
    });

    const result = runSqliteMigrations({
      databaseUrl: env.DATABASE_URL,
      cwd,
      enabled: env.DATABASE_MIGRATIONS_ENABLED
    });

    if (result.skipped) {
      logger.info("db_migration_skipped", createDbLogMeta(env, result));
      return { exitCode: 0 };
    }

    logger.info("db_migration_complete", createDbLogMeta(env, result));
    return { exitCode: 0 };
  } catch (error) {
    logger.error("db_operation_failed", {
      operation: "db:migrate",
      error: toErrorMessage(error)
    });
    return { exitCode: 1 };
  }
};

export const runDbStatusCommand = ({
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger
}: DbCommandOptions = {}): DbCommandSummary => {
  try {
    const env = loadEnv(envSource);
    const result = getSqliteMigrationStatus({
      databaseUrl: env.DATABASE_URL,
      cwd
    });

    logger.info("db_status_checked", createDbLogMeta(env, result));
    return { exitCode: 0 };
  } catch (error) {
    logger.error("db_operation_failed", {
      operation: "db:status",
      error: toErrorMessage(error)
    });
    return { exitCode: 1 };
  }
};

export const isDirectExecution = (
  importMetaUrl: string,
  argv: string[] = process.argv
): boolean => {
  const entrypoint = argv[1];
  return entrypoint ? importMetaUrl === pathToFileURL(entrypoint).href : false;
};

export const exitWithCode = (
  summary: DbCommandSummary,
  processLike: DbCommandProcessLike = process
): never | void => processLike.exit(summary.exitCode);
