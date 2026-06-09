import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ZodError } from "zod";
import { loadEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import { resolveSqliteDatabasePath, sqliteMigrations } from "../persistence/sqlite/index.ts";

export interface BusinessCommandOptions {
  cwd?: string;
  envSource?: NodeJS.ProcessEnv;
  logger?: Logger;
  stdout?: {
    write(chunk: string): void;
  };
}

export interface VerifiedBusinessDatabase {
  appliedMigrationIds: string[];
  database: DatabaseSync;
  databasePath: string;
  pendingMigrationIds: string[];
}

const getAppliedMigrationIds = (database: DatabaseSync): string[] =>
  (
    database
      .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id ASC")
      .all() as Array<{ migration_id: string }>
  ).map((row) => row.migration_id);

export const toBusinessCommandErrorMessage = (error: unknown): string => {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "unknown_error";
};

export const requireBusinessPersistenceEnv = (
  envSource: NodeJS.ProcessEnv = process.env
): {
  BUSINESS_PERSISTENCE_ENABLED: true;
  DATABASE_URL: string;
} => {
  const env = loadEnv(envSource);

  if (env.BUSINESS_PERSISTENCE_ENABLED !== true) {
    throw new Error(
      "Business persistence tooling requires BUSINESS_PERSISTENCE_ENABLED=true."
    );
  }

  return {
    BUSINESS_PERSISTENCE_ENABLED: true,
    DATABASE_URL: env.DATABASE_URL
  };
};

export const verifyBusinessDatabase = ({
  cwd = process.cwd(),
  databaseUrl,
  operationLabel
}: {
  cwd?: string;
  databaseUrl: string;
  operationLabel: string;
}): VerifiedBusinessDatabase => {
  const databasePath = resolveSqliteDatabasePath(databaseUrl, cwd);

  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error(
      `${operationLabel} requires an existing migrated SQLite database. Run npm run db:migrate first.`
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
      throw new Error(
        `${operationLabel} requires existing migrations. Run npm run db:migrate first.`
      );
    }

    const appliedMigrationIds = getAppliedMigrationIds(database);
    const pendingMigrationIds = sqliteMigrations
      .map((migration) => migration.id)
      .filter((migrationId) => !appliedMigrationIds.includes(migrationId));

    return {
      appliedMigrationIds,
      database,
      databasePath,
      pendingMigrationIds
    };
  } catch (error) {
    database.close();
    throw error;
  }
};

export const createIgnoredBackupPath = ({
  cwd = process.cwd(),
  createdAt = new Date()
}: {
  cwd?: string;
  createdAt?: Date;
} = {}): {
  absoluteBackupPath: string;
  createdAt: string;
  relativeBackupPath: string;
} => {
  const createdAtIso = createdAt.toISOString();
  const timestamp = createdAtIso.replaceAll(":", "-").replaceAll(".", "-");
  const relativeBackupPath = path.join("backups", `business-${timestamp}.sqlite`);
  const absoluteBackupPath = path.resolve(cwd, relativeBackupPath);

  mkdirSync(path.dirname(absoluteBackupPath), { recursive: true });

  return {
    absoluteBackupPath,
    createdAt: createdAtIso,
    relativeBackupPath
  };
};

export const getFileSizeBytes = (filePath: string): number => statSync(filePath).size;

export const quoteSqliteString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const sanitizePathForOutput = (targetPath: string, cwd: string = process.cwd()): string => {
  if (targetPath === ":memory:") {
    return targetPath;
  }

  const relativePath = path.relative(cwd, targetPath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : targetPath;
};

export const defaultBusinessCommandOptions = ({
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger,
  stdout = process.stdout
}: BusinessCommandOptions = {}): Required<BusinessCommandOptions> => ({
  cwd,
  envSource,
  logger,
  stdout
});
