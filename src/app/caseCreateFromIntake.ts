import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ZodError } from "zod";
import {
  CaseCreationPreconditionError,
  createCaseCreationService,
  type CaseCreationService
} from "../domain/cases/caseCreationService.ts";
import { loadEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import {
  createSqlitePersistenceService,
  type SqlitePersistenceService
} from "../persistence/index.ts";
import {
  exitWithCode,
  isDirectExecution,
  type DbCommandSummary
} from "./dbCommandCommon.ts";
import {
  resolveSqliteDatabasePath,
  sqliteMigrations
} from "../persistence/sqlite/index.ts";

export interface CaseCreateFromIntakeCommandOptions {
  argv?: string[];
  cwd?: string;
  envSource?: NodeJS.ProcessEnv;
  logger?: Logger;
  stdout?: {
    write(chunk: string): void;
  };
  createSqlitePersistenceServiceFactory?: (config: {
    databaseUrl: string;
    cwd: string;
  }) => SqlitePersistenceService;
  createCaseCreationServiceFactory?: (options: {
    persistence: SqlitePersistenceService;
  }) => CaseCreationService;
  verifyMigrationsApplied?: (options: { databaseUrl: string; cwd: string }) => {
    appliedMigrationIds: string[];
    databasePath: string;
  };
}

export interface CaseCreateFromIntakeSummary extends DbCommandSummary {
  result?: {
    caseId: string;
    status: string;
    createdAt: string;
  };
}

const parseSubjectIdArg = (argv: string[]): string => {
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--subject") {
      const value = args[index + 1]?.trim();

      if (!value) {
        throw new Error("Missing required value for --subject");
      }

      return value;
    }

    if (arg.startsWith("--subject=")) {
      const value = arg.slice("--subject=".length).trim();

      if (!value) {
        throw new Error("Missing required value for --subject");
      }

      return value;
    }
  }

  throw new Error("Missing required --subject <subjectId> argument");
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "unknown_error";
};

const verifySqliteMigrationsApplied = ({
  databaseUrl,
  cwd
}: {
  databaseUrl: string;
  cwd: string;
}): {
  appliedMigrationIds: string[];
  databasePath: string;
} => {
  const databasePath = resolveSqliteDatabasePath(databaseUrl, cwd);

  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error(
      "Manual case creation requires an existing migrated SQLite database. Run npm run db:migrate first."
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
        "Manual case creation requires existing migrations. Run npm run db:migrate first."
      );
    }

    const appliedMigrationIds = (
      database
        .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id ASC")
        .all() as Array<{ migration_id: string }>
    ).map((row) => row.migration_id);
    const pendingMigrationIds = sqliteMigrations
      .map((migration) => migration.id)
      .filter((migrationId) => !appliedMigrationIds.includes(migrationId));

    if (pendingMigrationIds.length > 0) {
      throw new Error(
        `Manual case creation requires completed migrations. Pending migrations: ${pendingMigrationIds.join(", ")}. Run npm run db:migrate first.`
      );
    }

    return {
      appliedMigrationIds,
      databasePath
    };
  } finally {
    database.close();
  }
};

const toSanitizedResult = (result: {
  caseRecord: {
    caseId: string;
    status: string;
    createdAt: string;
  };
}): {
  caseId: string;
  status: string;
  createdAt: string;
} => ({
  caseId: result.caseRecord.caseId,
  status: result.caseRecord.status,
  createdAt: result.caseRecord.createdAt
});

export const runCaseCreateFromIntakeCommand = async ({
  argv = process.argv,
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger,
  stdout = process.stdout,
  createSqlitePersistenceServiceFactory = createSqlitePersistenceService,
  createCaseCreationServiceFactory = createCaseCreationService,
  verifyMigrationsApplied = verifySqliteMigrationsApplied
}: CaseCreateFromIntakeCommandOptions = {}): Promise<CaseCreateFromIntakeSummary> => {
  let persistence: SqlitePersistenceService | undefined;

  try {
    const subjectId = parseSubjectIdArg(argv);
    const env = loadEnv(envSource);
    verifyMigrationsApplied({
      databaseUrl: env.DATABASE_URL,
      cwd
    });

    logger.info("case_create_from_intake_starting");

    persistence = createSqlitePersistenceServiceFactory({
      databaseUrl: env.DATABASE_URL,
      cwd
    });

    const caseCreationService = createCaseCreationServiceFactory({
      persistence
    });
    const result = await caseCreationService.createCaseFromCompletedIntake(subjectId);
    const sanitizedResult = toSanitizedResult(result);

    stdout.write(`${JSON.stringify(sanitizedResult)}\n`);
    logger.info("case_create_from_intake_complete", sanitizedResult);

    return {
      exitCode: 0,
      result: sanitizedResult
    };
  } catch (error) {
    logger.error("case_create_from_intake_failed", {
      ...(error instanceof CaseCreationPreconditionError ? { code: error.code } : {}),
      error: toErrorMessage(error)
    });

    return {
      exitCode: 1
    };
  } finally {
    persistence?.close();
  }
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(await runCaseCreateFromIntakeCommand());
}
